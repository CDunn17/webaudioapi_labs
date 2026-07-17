import type {
  AutomationPoint,
  LayeredSoundConfig,
  SoundLayerConfig,
} from '../config/audio';
import { clamp, mean, median } from './dsp';
import { renderEffectLayers } from './effectRenderer';
import type { AnalysisAdapter, AudioFeatures } from './types';

type FitParameters = {
  durationScale: number;
  eventGain: number;
  filterScale: number;
  resonanceGain: number;
  spreadScale: number;
  tailScale: number;
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
  durationScale: 1,
  eventGain: 1,
  filterScale: 1,
  resonanceGain: 1,
  spreadScale: 1,
  tailScale: 1,
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
  const sampleRate = 22_050;
  const durationMs = Math.max(160, ...config.layers.map(layerDurationMs));
  const frameCount = Math.ceil(sampleRate * (durationMs / 1000 + 0.12));
  const context = new OfflineAudioContext(1, frameCount, sampleRate);
  const master = context.createGain();
  master.gain.value = 0.8;
  master.connect(context.destination);
  renderEffectLayers(context, master, config.layers, 0.01);
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
    layer.sound.durationMs = Math.round(
      clamp(layer.sound.durationMs * parameters.durationScale, 20, 4_000)
    );
    if (layer.automation !== undefined) {
      for (const key of ['filterFrequency', 'frequency', 'gain'] as const) {
        const curve = layer.automation[key];
        if (curve !== undefined) {
          layer.automation[key] = curve.map((point) => ({
            ...point,
            timeMs: Math.round(point.timeMs * parameters.durationScale),
          }));
        }
      }
    }
    layer.sound.volume = clamp(
      layer.sound.volume * volumeScaleFor(layer, parameters),
      0.005,
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
        decayMs: Math.round(clamp(resonance.decayMs * parameters.tailScale, 20, 4_000)),
        frequency: Math.round(clamp(resonance.frequency * frequencyScale, 60, 16_000)),
      }));
      layer.sound.releaseMs = Math.round(
        clamp(layer.sound.releaseMs * parameters.tailScale, 10, layer.sound.durationMs)
      );
    }
    if (layer.kind === 'impulseCluster') {
      const frequencyScale = Math.sqrt(parameters.filterScale);
      layer.sound.minFrequency = Math.round(
        clamp(layer.sound.minFrequency * frequencyScale, 120, 8_000)
      );
      layer.sound.maxFrequency = Math.round(
        clamp(layer.sound.maxFrequency * frequencyScale, layer.sound.minFrequency, 18_000)
      );
      layer.sound.decayMs = Math.round(
        clamp(layer.sound.decayMs * parameters.tailScale, 8, 1_500)
      );
      layer.sound.spreadMs = Math.round(
        clamp(layer.sound.spreadMs * parameters.spreadScale, 0, 3_000)
      );
    } else if (layer.kind !== 'resonatorBank' && 'releaseMs' in layer.sound) {
      layer.sound.releaseMs = Math.round(
        clamp(layer.sound.releaseMs * parameters.tailScale, 0, layer.sound.durationMs)
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
  if (nextIndex <= 0) return curve[0]?.value ?? 0;
  if (nextIndex < 0) return curve[curve.length - 1]?.value ?? 0;
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
  const amplitude = curveLoss(
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
    amplitude * 2.8 +
    brightness * 1.25 +
    rms * 0.7 +
    texture * 1.1 +
    duration * 0.9 +
    onsetLoss(target, candidate) * 1.4 +
    pitch * 0.45
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
    'durationScale',
    'tailScale',
    'spreadScale',
    'textureGain',
    'toneGain',
    'eventGain',
    'resonanceGain',
    'filterScale',
  ];
  const passes = [
    { down: 0.72, up: 1.34 },
    { down: 0.86, up: 1.16 },
  ];
  const total = 1 + dimensions.length * 2 * passes.length;
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
      for (const factor of [pass.down, pass.up]) {
        const candidateParameters = {
          ...parameters,
          [dimension]: clamp(parameters[dimension] * factor, 0.42, 1.9),
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
