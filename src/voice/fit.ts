import type {
  AutomationPoint,
  LayeredSoundConfig,
  SoundLayerConfig,
} from '../config/audio';
import { clamp, mean, median } from './dsp';
import { renderEffectLayers } from './effectRenderer';
import type { AnalysisAdapter, AudioFeatures } from './types';

type FitParameters = {
  eventGain: number;
  filterScale: number;
  resonanceGain: number;
  textureGain: number;
  toneGain: number;
};

export type EffectFitResult = {
  candidateCount: number;
  config: LayeredSoundConfig;
  finalLoss: number;
  initialLoss: number;
};

type ProgressHandler = (completed: number, total: number) => void;

const INITIAL_PARAMETERS: FitParameters = {
  eventGain: 1,
  filterScale: 1,
  resonanceGain: 1,
  textureGain: 1,
  toneGain: 1,
};

const cloneConfig = (config: LayeredSoundConfig): LayeredSoundConfig =>
  JSON.parse(JSON.stringify(config)) as LayeredSoundConfig;

const layerDurationMs = (layer: SoundLayerConfig): number => {
  const soundDuration = layer.kind === 'impulseCluster'
    ? Math.max(layer.sound.durationMs, layer.sound.spreadMs + layer.sound.decayMs)
    : layer.sound.durationMs;
  return Math.max(0, layer.startMs ?? 0) + soundDuration;
};

const renderConfig = async (config: LayeredSoundConfig): Promise<AudioBuffer> => {
  const sampleRate = 44_100;
  const durationMs = Math.max(160, ...config.layers.map(layerDurationMs));
  const frameCount = Math.ceil(sampleRate * (durationMs / 1000 + 0.12));
  const context = new OfflineAudioContext(1, frameCount, sampleRate);
  const master = context.createGain();
  master.gain.value = 0.8;
  master.connect(context.destination);
  renderEffectLayers(context, master, config.layers, 0);
  return context.startRendering();
};

const volumeScaleFor = (layer: SoundLayerConfig, parameters: FitParameters): number => {
  if (layer.kind === 'impulseCluster' || layer.id.includes('-event-')) {
    return parameters.eventGain;
  }
  if (layer.kind === 'resonatorBank') return parameters.resonanceGain;
  if (layer.kind === 'tone' || layer.kind === 'fmTone') return parameters.toneGain;
  return parameters.textureGain;
};

const scaledConfig = (
  base: LayeredSoundConfig,
  parameters: FitParameters
): LayeredSoundConfig => {
  const config = cloneConfig(base);
  for (const layer of config.layers) {
    layer.sound.volume = clamp(
      layer.sound.volume * volumeScaleFor(layer, parameters),
      0,
      0.48
    );
    if ('filterFrequency' in layer.sound && layer.sound.filterFrequency !== undefined) {
      layer.sound.filterFrequency = Math.round(
        clamp(layer.sound.filterFrequency * parameters.filterScale, 80, 18_000)
      );
    }
    if (layer.automation?.filterFrequency !== undefined) {
      layer.automation.filterFrequency = layer.automation.filterFrequency.map((point) => ({
        ...point,
        value: Math.round(clamp(point.value * parameters.filterScale, 80, 18_000)),
      }));
    }
    if (layer.kind === 'resonatorBank') {
      const frequencyScale = Math.sqrt(parameters.filterScale);
      layer.sound.resonances = layer.sound.resonances.map((resonance) => ({
        ...resonance,
        frequency: Math.round(clamp(resonance.frequency * frequencyScale, 60, 16_000)),
      }));
    }
    if (layer.kind === 'impulseCluster') {
      const frequencyScale = Math.sqrt(parameters.filterScale);
      layer.sound.minFrequency = Math.round(
        clamp(layer.sound.minFrequency * frequencyScale, 120, 8_000)
      );
      layer.sound.maxFrequency = Math.round(
        clamp(layer.sound.maxFrequency * frequencyScale, layer.sound.minFrequency, 18_000)
      );
    }
  }
  return config;
};

const curveValueAt = (
  curve: AutomationPoint[],
  progress: number,
  durationMs: number
): number => {
  if (curve.length === 0) return 0;
  const timeMs = progress * durationMs;
  const nextIndex = curve.findIndex((point) => point.timeMs >= timeMs);
  if (nextIndex < 0) return curve[curve.length - 1]?.value ?? 0;
  if (nextIndex === 0) return curve[0]?.value ?? 0;
  const previous = curve[nextIndex - 1];
  const next = curve[nextIndex];
  if (previous === undefined || next === undefined) return next?.value ?? previous?.value ?? 0;
  const range = Math.max(1, next.timeMs - previous.timeMs);
  const amount = (timeMs - previous.timeMs) / range;
  return previous.value + (next.value - previous.value) * amount;
};

const curveLoss = (
  target: AutomationPoint[],
  candidate: AutomationPoint[],
  targetDurationMs: number,
  candidateDurationMs: number,
  logarithmic = false
): number => {
  const errors: number[] = [];
  for (let index = 0; index < 24; index += 1) {
    const progress = index / 23;
    const targetValue = curveValueAt(target, progress, targetDurationMs);
    const candidateValue = curveValueAt(candidate, progress, candidateDurationMs);
    if (logarithmic) {
      errors.push(Math.abs(Math.log2(Math.max(40, targetValue) / Math.max(40, candidateValue))));
    } else {
      errors.push(Math.abs(targetValue - candidateValue));
    }
  }
  return mean(errors);
};

type AmplitudeLoss = {
  overfill: number;
  shape: number;
  silenceOverfill: number;
};

const amplitudeLoss = (
  target: AutomationPoint[],
  candidate: AutomationPoint[],
  targetDurationMs: number,
  candidateDurationMs: number
): AmplitudeLoss => {
  const comparisonDurationMs = Math.max(1, targetDurationMs, candidateDurationMs);
  const sampleCount = Math.max(
    96,
    Math.min(256, Math.ceil(comparisonDurationMs / 20) + 1)
  );
  const shapeErrors: number[] = [];
  const overfillErrors: number[] = [];
  const silenceOverfillErrors: number[] = [];
  const silenceThreshold = 0.04;

  for (let index = 0; index < sampleCount; index += 1) {
    const timeMs = (index / (sampleCount - 1)) * comparisonDurationMs;
    const targetValue = timeMs <= targetDurationMs
      ? curveValueAt(target, timeMs / Math.max(1, targetDurationMs), targetDurationMs)
      : 0;
    const candidateValue = timeMs <= candidateDurationMs
      ? curveValueAt(candidate, timeMs / Math.max(1, candidateDurationMs), candidateDurationMs)
      : 0;
    const overfill = Math.max(0, candidateValue - targetValue);
    const silenceWeight = clamp(
      (silenceThreshold - targetValue) / silenceThreshold,
      0,
      1
    );
    shapeErrors.push(Math.abs(targetValue - candidateValue));
    overfillErrors.push(overfill);
    silenceOverfillErrors.push(candidateValue * silenceWeight);
  }

  return {
    overfill: mean(overfillErrors),
    shape: mean(shapeErrors),
    silenceOverfill: mean(silenceOverfillErrors),
  };
};

const normalizedOnsets = (features: AudioFeatures): number[] =>
  features.onsetTimesMs.map((time) => time / Math.max(1, features.durationMs));

const onsetLoss = (target: AudioFeatures, candidate: AudioFeatures): number => {
  const targetOnsets = normalizedOnsets(target);
  const candidateOnsets = normalizedOnsets(candidate);
  const countLoss = Math.abs(targetOnsets.length - candidateOnsets.length) /
    Math.max(1, targetOnsets.length);
  const pairCount = Math.min(targetOnsets.length, candidateOnsets.length);
  const timingErrors = Array.from({ length: pairCount }, (_, index) =>
    Math.abs((targetOnsets[index] ?? 0) - (candidateOnsets[index] ?? 0))
  );
  return countLoss * 0.65 + mean(timingErrors) * 0.35;
};

const featureLoss = (target: AudioFeatures, candidate: AudioFeatures): number => {
  const amplitude = amplitudeLoss(
    target.amplitudeCurve,
    candidate.amplitudeCurve,
    target.durationMs,
    candidate.durationMs
  );
  const brightness = curveLoss(
    target.brightnessCurve,
    candidate.brightnessCurve,
    target.durationMs,
    candidate.durationMs,
    true
  );
  const rms = Math.abs(
    Math.log2(Math.max(0.002, target.rms) / Math.max(0.002, candidate.rms))
  );
  const texture = Math.abs(target.flatness - candidate.flatness);
  const duration = Math.abs(
    Math.log2(Math.max(20, target.durationMs) / Math.max(20, candidate.durationMs))
  );
  const pitch =
    target.pitch.length > 0 && candidate.pitch.length > 0
      ? Math.abs(
          Math.log2(
            median(target.pitch.map((point) => point.frequency)) /
              median(candidate.pitch.map((point) => point.frequency))
          )
        )
      : 0;
  return (
    amplitude.shape * 3.6 +
    amplitude.overfill * 5.5 +
    amplitude.silenceOverfill * 12 +
    brightness * 0.9 +
    rms * 0.5 +
    texture * 0.7 +
    duration * 0.65 +
    onsetLoss(target, candidate) * 0.9 +
    pitch * 0.3
  );
};

const evaluate = async (
  base: LayeredSoundConfig,
  parameters: FitParameters,
  target: AudioFeatures,
  adapter: AnalysisAdapter
): Promise<{ config: LayeredSoundConfig; loss: number }> => {
  const config = scaledConfig(base, parameters);
  const rendered = await renderConfig(config);
  const features = await adapter.analyze(rendered, 'effect');
  return { config, loss: featureLoss(target, features) };
};

export const fitEffectConfig = async (
  base: LayeredSoundConfig,
  target: AudioFeatures,
  adapter: AnalysisAdapter,
  onProgress?: ProgressHandler
): Promise<EffectFitResult> => {
  const dimensions: (keyof FitParameters)[] = [
    'textureGain',
    'toneGain',
    'eventGain',
    'resonanceGain',
    'filterScale',
  ];
  const passes = [
    { down: 0.35, up: 1.34 },
    { down: 0.72, up: 1.16 },
  ];
  const gainDimensions = new Set<keyof FitParameters>([
    'textureGain',
    'toneGain',
    'eventGain',
    'resonanceGain',
  ]);
  const total = 1 + passes.reduce(
    (count) => count + dimensions.reduce(
      (passCount, dimension) => passCount + (gainDimensions.has(dimension) ? 4 : 2),
      0
    ),
    0
  );
  let candidateCount = 0;
  let parameters = { ...INITIAL_PARAMETERS };
  let best = await evaluate(base, parameters, target, adapter);
  const initialLoss = best.loss;
  candidateCount += 1;
  onProgress?.(candidateCount, total);

  for (const pass of passes) {
    for (const dimension of dimensions) {
      let dimensionBest = best;
      let dimensionParameters = parameters;
      const currentValue = parameters[dimension];
      const candidateValues = gainDimensions.has(dimension)
        ? [
            clamp(currentValue * pass.down, 0, 1.9),
            clamp(currentValue * pass.up, 0, 1.9),
            0,
            1,
          ]
        : [
            clamp(currentValue * pass.down, 0, 1.9),
            clamp(currentValue * pass.up, 0, 1.9),
          ];
      for (const candidateValue of candidateValues) {
        const candidateParameters = {
          ...parameters,
          [dimension]: candidateValue,
        };
        const candidate = await evaluate(base, candidateParameters, target, adapter);
        candidateCount += 1;
        onProgress?.(candidateCount, total);
        if (candidate.loss < dimensionBest.loss) {
          dimensionBest = candidate;
          dimensionParameters = candidateParameters;
        }
      }
      best = dimensionBest;
      parameters = dimensionParameters;
    }
  }

  return {
    candidateCount,
    config: best.config,
    finalLoss: best.loss,
    initialLoss,
  };
};
