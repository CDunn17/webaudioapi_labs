import Meyda from 'meyda';
import type { AutomationPoint } from '../config/audio';
import {
  clamp,
  detectBeatPeaks,
  detectOnsets,
  detectPitchTrack,
  framePeak,
  frameRms,
  frameZcr,
  mean,
  monoSamples,
  simplifyAutomationCurve,
  smoothValues,
  spectralFeatures,
  trimActiveRegion,
} from './dsp';
import type {
  AnalysisAdapter,
  ActivityRegion,
  AudioFeatures,
  CreationMode,
  FrameFeatures,
  PitchPoint,
  ResultEngineId,
} from './types';

const FRAME_SIZE = 2048;
const HOP_SIZE = 1024;

type FeatureOverrides = {
  onsetTimesMs?: number[];
  pitch?: PitchPoint[];
};

const alignToLocalPeaks = (times: number[], frames: FrameFeatures[]): number[] =>
  times.map((time) => {
    const candidates = frames.filter(
      (frame) => frame.timeMs >= time - 15 && frame.timeMs <= time + 80
    );
    return candidates.sort((first, second) => second.rms - first.rms)[0]?.timeMs ?? time;
  });

const percentile = (values: number[], amount: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  const index = Math.round(clamp(amount, 0, 1) * (sorted.length - 1));
  return sorted[index] ?? 0;
};

const amplitudeEvidence = (
  samples: Float32Array,
  sampleRate: number,
  durationMs: number,
  mode: CreationMode,
  noiseRoll: { end: boolean; start: boolean }
): { activityRegions: ActivityRegion[]; curve: AutomationPoint[] } => {
  if (samples.length === 0) return { activityRegions: [], curve: [] };
  // Shape uses a separate short envelope instead of the ~46 ms spectral
  // window, so a brief rest cannot be averaged together with both neighbors.
  const windowSize = Math.max(32, Math.round(sampleRate * 0.01));
  const hopSize = Math.max(16, Math.round(sampleRate * 0.005));
  const envelopeFrames: Array<{ rms: number; timeMs: number }> = [];
  for (let start = 0; start < samples.length; start += hopSize) {
    const end = Math.min(samples.length, start + windowSize);
    let energy = 0;
    for (let index = start; index < end; index += 1) {
      const sample = samples[index] ?? 0;
      energy += sample * sample;
    }
    envelopeFrames.push({
      rms: Math.sqrt(energy / Math.max(1, end - start)),
      timeMs: Math.min(samples.length, start + (end - start) / 2) / sampleRate * 1000,
    });
  }
  const levels = envelopeFrames.map((frame) => Math.max(0, frame.rms));
  const peak = Math.max(0, ...levels);
  if (peak <= 1e-7) {
    return {
      activityRegions: [],
      curve: envelopeFrames.map((frame) => ({ timeMs: Math.round(frame.timeMs), value: 0 })),
    };
  }
  const relativeGate = mode === 'beat' ? 0.025 : mode === 'melody' ? 0.03 : 0.025;
  // Pre/post-roll normally provides the best available room-noise sample.
  // A clip-wide low percentile is unsafe here: in a continuous crescendo its
  // "floor" is still intentional signal and would erase the quieter phrase.
  const edgeCount = Math.max(2, Math.min(12, Math.ceil(levels.length * 0.08)));
  const edgeLevels = [
    ...(noiseRoll.start ? levels.slice(0, edgeCount) : []),
    ...(noiseRoll.end ? levels.slice(-edgeCount) : []),
  ];
  const edgeFloor = percentile(edgeLevels, 0.35);
  // Only edges created by trim pre/post-roll are known noise evidence. If the
  // recording is active right to a clip boundary, do not reinterpret its
  // quiet edge as a floor. The cap stays continuous for near-noise signals.
  const noiseGate = Math.min(edgeFloor * 1.45, peak * 0.3);
  const gate = Math.max(
    noiseGate,
    peak * relativeGate,
    Math.min(0.002, peak * 0.08)
  );
  const values = levels.map((level) =>
    level <= gate ? 0 : clamp(level / peak, 0, 1)
  );
  const hopMs = hopSize / sampleRate * 1000;
  const rawRegions: ActivityRegion[] = [];
  let regionStart = -1;
  let regionPeak = 0;
  values.forEach((value, index) => {
    const frame = envelopeFrames[index];
    if (frame === undefined) return;
    if (value > 0) {
      if (regionStart < 0) {
        regionStart = index === 0 ? 0 : Math.max(0, frame.timeMs - hopMs / 2);
      }
      regionPeak = Math.max(regionPeak, value);
      return;
    }
    if (regionStart < 0) return;
    rawRegions.push({
      endMs: clamp(frame.timeMs - hopMs / 2, regionStart, durationMs),
      peak: regionPeak,
      startMs: regionStart,
    });
    regionStart = -1;
    regionPeak = 0;
  });
  if (regionStart >= 0) {
    rawRegions.push({ endMs: durationMs, peak: regionPeak, startMs: regionStart });
  }
  const bridgeMs = mode === 'melody' ? 35 : mode === 'beat' ? 25 : 20;
  const activityRegions: ActivityRegion[] = [];
  for (const region of rawRegions) {
    const previous = activityRegions[activityRegions.length - 1];
    if (previous !== undefined && region.startMs - previous.endMs <= bridgeMs) {
      previous.endMs = region.endMs;
      previous.peak = Math.max(previous.peak, region.peak);
    } else {
      activityRegions.push({ ...region });
    }
  }
  const boundaryPoints = activityRegions.flatMap((region) => [
    ...(region.startMs > 0.5 ? [{ timeMs: Math.ceil(region.startMs), value: 0 }] : []),
    ...(region.endMs < durationMs - 0.5
      ? [{ timeMs: Math.floor(region.endMs), value: 0 }]
      : []),
  ]);
  const byTime = new Map<number, number>();
  for (const point of [
    ...envelopeFrames.map((frame, index) => ({
      timeMs: Math.round(frame.timeMs),
      value: values[index] ?? 0,
    })),
    ...boundaryPoints,
  ].sort((first, second) => first.timeMs - second.timeMs)) {
    // A measured non-zero frame wins over a coincident synthetic boundary.
    byTime.set(point.timeMs, Math.max(byTime.get(point.timeMs) ?? 0, point.value));
  }
  return {
    activityRegions,
    curve: [...byTime].map(([timeMs, value]) => ({ timeMs, value })),
  };
};

const aggregateFeatures = (
  buffer: AudioBuffer,
  engine: AudioFeatures['engine'],
  samples: Float32Array,
  sourceStartMs: number,
  sourceEndMs: number,
  frames: FrameFeatures[],
  mode: CreationMode,
  overrides: FeatureOverrides = {}
): AudioFeatures => {
  const durationMs = (samples.length / buffer.sampleRate) * 1000;
  const finite = (value: number): number => Number.isFinite(value) ? value : 0;
  const safeFrames = frames.map((frame) => ({
    centroidHz: finite(frame.centroidHz),
    flatness: clamp(finite(frame.flatness), 0, 1),
    mfcc: frame.mfcc.map(finite),
    rms: Math.max(0, finite(frame.rms)),
    rolloffHz: Math.max(0, finite(frame.rolloffHz)),
    timeMs: Math.max(0, finite(frame.timeMs)),
    zcr: Math.max(0, finite(frame.zcr)),
  }));
  const activeFrames = safeFrames.filter((frame) => frame.rms > 0.008);
  const selected = activeFrames.length > 0 ? activeFrames : safeFrames;
  const weights = selected.map((frame) => Math.max(0.001, frame.rms));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const weightedMean = (values: number[]): number =>
    totalWeight > 0
      ? values.reduce((sum, value, index) => sum + value * (weights[index] ?? 0), 0) /
        totalWeight
      : mean(values);
  // The short amplitude envelope can resolve attacks that the 46 ms spectral
  // frames cannot. Keep that resolution for fast beatboxing instead of
  // collapsing legitimate hits around 40--45 ms apart.
  const minimumGap = mode === 'beat' ? 35 : mode === 'effect' ? 45 : 90;
  const sourceDurationMs = buffer.length / buffer.sampleRate * 1000;
  const amplitude = amplitudeEvidence(samples, buffer.sampleRate, durationMs, mode, {
    end: sourceEndMs < sourceDurationMs - 0.5,
    start: sourceStartMs > 0.5,
  });
  const amplitudePointLimit = mode === 'effect' ? 128 : mode === 'beat' ? 192 : 256;
  const amplitudeCurve = simplifyAutomationCurve(
    amplitude.curve,
    amplitudePointLimit
  );
  const brightnessValues = smoothValues(safeFrames.map((frame) => frame.centroidHz), 2);
  const brightnessCurve = simplifyAutomationCurve(
    safeFrames.map((frame, index) => ({
      timeMs: Math.round(frame.timeMs),
      value: Math.round(clamp(brightnessValues[index] ?? 0, 80, 16_000)),
    })),
    mode === 'effect' ? 48 : 96
  );
  const rawPitch = overrides.pitch ?? (
    mode === 'beat' ? [] : detectPitchTrack(
      samples,
      buffer.sampleRate,
      FRAME_SIZE,
      mode === 'melody' ? 512 : FRAME_SIZE,
      mode === 'effect' ? 5_000 : mode === 'melody' ? 1_600 : 720
    )
  );
  const pitch = rawPitch.filter((point) =>
    Number.isFinite(point.confidence) && Number.isFinite(point.frequency) &&
    Number.isFinite(point.timeMs) && point.frequency > 0 && point.timeMs >= 0
  );
  const pitchValues = smoothValues(pitch.map((point) => point.frequency), 1);
  const pitchCurve = simplifyAutomationCurve(
    pitch.map((point, index) => ({
      timeMs: Math.round(point.timeMs),
      value: Math.round(clamp(
        pitchValues[index] ?? point.frequency,
        40,
        mode === 'effect' ? 6_000 : 2_400
      )),
    })),
    mode === 'melody' ? 128 : 64
  );
  const rawOnsets = overrides.onsetTimesMs ?? (
    mode === 'beat'
      ? detectBeatPeaks(safeFrames, minimumGap)
      : detectOnsets(safeFrames, minimumGap)
  );
  const effectOnsets = mode !== 'effect' ? [] : rawOnsets.flatMap((time) => {
    const region = amplitude.activityRegions.find((candidate) =>
      time >= candidate.startMs - 20 && time <= candidate.endMs
    );
    // A centered spectral frame can precede the short-hop activity boundary.
    // Never let its procedural transient begin before measured activity.
    if (region === undefined) return [];
    if (time <= region.startMs + 60) {
      const regionAttack = amplitude.curve.find((point) =>
        point.timeMs >= region.startMs && point.timeMs <= region.endMs &&
        point.value >= Math.max(0.02, region.peak * 0.18)
      );
      return [regionAttack?.timeMs ?? region.startMs];
    }
    return [time];
  });
  const activityPeaks = mode === 'melody' ? [] : amplitude.activityRegions.flatMap((region) => {
    const points = amplitude.curve.filter(
      (point) => point.timeMs >= region.startMs && point.timeMs <= region.endMs
    );
    if (mode === 'effect') {
      const hasDetectedAttack = effectOnsets.some(
        (time) =>
          time >= region.startMs &&
          time <= Math.min(region.endMs, region.startMs + 60)
      );
      if (hasDetectedAttack) return [];
      // Guarantee one attack for a very short region without turning every
      // later envelope maximum into an extra click.
      return [points.find((point) => point.value > 0)?.timeMs ?? region.startMs];
    }
    const candidates = points.filter((point, index) =>
      point.value >= 0.02 &&
      point.value >= (points[index - 1]?.value ?? 0) &&
      point.value >= (points[index + 1]?.value ?? 0)
    );
    const selected: AutomationPoint[] = [];
    for (const candidate of candidates) {
      const previous = selected[selected.length - 1];
      if (previous === undefined) {
        selected.push(candidate);
        continue;
      }
      if (candidate.timeMs - previous.timeMs < 35) {
        if (candidate.value > previous.value) selected[selected.length - 1] = candidate;
        continue;
      }
      const valley = Math.min(...points
        .filter((point) => point.timeMs > previous.timeMs && point.timeMs < candidate.timeMs)
        .map((point) => point.value));
      if (valley <= Math.min(previous.value, candidate.value) * 0.62) {
        selected.push(candidate);
      } else if (candidate.value > previous.value) {
        selected[selected.length - 1] = candidate;
      }
    }
    const strongest = points.sort((first, second) => second.value - first.value)[0];
    return (selected.length > 0 ? selected : strongest === undefined ? [] : [strongest])
      .map((point) => point.timeMs);
  });
  const detectedOnsets = mode === 'beat'
    ? [...alignToLocalPeaks(rawOnsets, safeFrames), ...activityPeaks]
    : mode === 'effect' ? [...effectOnsets, ...activityPeaks] : rawOnsets;
  const supportedOnsets = detectedOnsets
    .filter((time) =>
      Number.isFinite(time) && time >= 0 && time <= Math.max(0, durationMs - 10)
    )
    .sort((first, second) => first - second)
    .filter((time) => amplitude.activityRegions.some((region) =>
        time >= region.startMs - 20 && time <= region.endMs
    ));
  const onsetClusters: number[][] = [];
  for (const time of supportedOnsets) {
    const cluster = onsetClusters[onsetClusters.length - 1];
    if (cluster === undefined || time - (cluster[0] ?? time) >= minimumGap) {
      onsetClusters.push([time]);
    } else {
      cluster.push(time);
    }
  }
  const onsetStrength = (timeMs: number): number => amplitude.curve.reduce(
    (best, point) => Math.abs(point.timeMs - timeMs) < Math.abs(best.timeMs - timeMs)
      ? point
      : best,
    amplitude.curve[0] ?? { timeMs: 0, value: 0 }
  ).value;
  const clusteredOnsets = onsetClusters.map((cluster) => [...cluster].sort((first, second) => {
    return onsetStrength(second) - onsetStrength(first);
  })[0] ?? 0).sort((first, second) => first - second);
  const beatOnsets = clusteredOnsets.reduce<number[]>(
    (selectedOnsets, time) => {
      const previous = selectedOnsets[selectedOnsets.length - 1];
      if (previous === undefined) {
        selectedOnsets.push(time);
        return selectedOnsets;
      }
      const sharedRegion = amplitude.activityRegions.some((region) =>
        previous >= region.startMs - 20 && time <= region.endMs + 20
      );
      if (!sharedRegion) {
        selectedOnsets.push(time);
        return selectedOnsets;
      }
      const between = amplitude.curve.filter(
        (point) => point.timeMs > previous && point.timeMs < time
      );
      const previousStrength = onsetStrength(previous);
      const currentStrength = onsetStrength(time);
      const valley = between.length > 0
        ? Math.min(...between.map((point) => point.value))
        : Math.min(previousStrength, currentStrength);
      const preAttack = amplitude.curve.filter(
        (point) => point.timeMs >= time - 35 && point.timeMs < time
      );
      const preAttackFloor = preAttack.length > 0
        ? Math.min(...preAttack.map((point) => point.value))
        : currentStrength;
      const deepValley = valley <= Math.min(previousStrength, currentStrength) * 0.68;
      const clearRise = currentStrength - preAttackFloor >= Math.max(0.025, currentStrength * 0.18);
      if (deepValley || clearRise) selectedOnsets.push(time);
      return selectedOnsets;
    },
    []
  );
  const effectStructureOnsets = clusteredOnsets.reduce<number[]>((selectedOnsets, time) => {
    const previous = selectedOnsets[selectedOnsets.length - 1];
    if (previous === undefined) {
      selectedOnsets.push(time);
      return selectedOnsets;
    }
    const sharedRegion = amplitude.activityRegions.some((region) =>
      previous >= region.startMs - 20 && time <= region.endMs + 20
    );
    if (!sharedRegion) {
      selectedOnsets.push(time);
      return selectedOnsets;
    }
    const between = amplitude.curve.filter(
      (point) => point.timeMs > previous && point.timeMs < time
    );
    const valley = between.length > 0
      ? Math.min(...between.map((point) => point.value))
      : Math.min(onsetStrength(previous), onsetStrength(time));
    const localPeak = Math.max(
      onsetStrength(time),
      ...amplitude.curve
        .filter((point) => point.timeMs >= time - 10 && point.timeMs <= time + 20)
        .map((point) => point.value)
    );
    const priorPoints = amplitude.curve
      .filter((point) => point.timeMs >= time - 45 && point.timeMs <= time - 15)
      .map((point) => point.value);
    const priorLevel = percentile(priorPoints, 0.5);
    const clearRise = localPeak - priorLevel >= Math.max(0.08, localPeak * 0.22);
    if (
      valley <= Math.min(onsetStrength(previous), onsetStrength(time)) * 0.55 ||
      clearRise
    ) {
      selectedOnsets.push(time);
    }
    return selectedOnsets;
  }, []);
  const onsetTimesMs = mode === 'beat'
    ? beatOnsets
    : mode === 'effect' ? effectStructureOnsets : clusteredOnsets;

  return {
    activityRegions: amplitude.activityRegions,
    amplitudeCurve,
    brightnessCurve,
    centroidHz: weightedMean(selected.map((frame) => frame.centroidHz)),
    durationMs,
    engine,
    flatness: weightedMean(selected.map((frame) => frame.flatness)),
    frames: safeFrames,
    onsetTimesMs,
    peak: framePeak(samples),
    pitch,
    pitchCurve,
    rms: frameRms(samples),
    rolloffHz: weightedMean(selected.map((frame) => frame.rolloffHz)),
    sampleRate: buffer.sampleRate,
    sourceEndMs,
    sourceStartMs,
    zcr: weightedMean(selected.map((frame) => frame.zcr)),
  };
};

const localFrames = (samples: Float32Array, sampleRate: number): FrameFeatures[] => {
  const frames: FrameFeatures[] = [];
  for (let start = 0; start < samples.length; start += HOP_SIZE) {
    const frame = new Float32Array(FRAME_SIZE);
    frame.set(samples.slice(start, Math.min(samples.length, start + FRAME_SIZE)));
    const spectral = spectralFeatures(frame, sampleRate);
    frames.push({
      centroidHz: spectral.centroidHz,
      flatness: spectral.flatness,
      mfcc: [],
      rms: frameRms(frame),
      rolloffHz: spectral.rolloffHz,
      timeMs: Math.min(samples.length, start + FRAME_SIZE / 2) / sampleRate * 1000,
      zcr: frameZcr(frame),
    });
  }
  return frames;
};

const analyzeWithWebAudio = async (
  buffer: AudioBuffer,
  mode: CreationMode
): Promise<AudioFeatures> => {
  const trimmed = trimActiveRegion(monoSamples(buffer), buffer.sampleRate);
  const samples = trimmed.samples;
  const frames = localFrames(samples, buffer.sampleRate);
  return aggregateFeatures(
    buffer,
    'webAudio',
    samples,
    trimmed.startMs,
    trimmed.endMs,
    frames,
    mode
  );
};

let essentiaModulePromise: Promise<unknown> | undefined;
const ESSENTIA_SAMPLE_RATE = 44_100;
const ESSENTIA_PITCH_HOP = 512;

const prepareEssentiaSignal = (
  samples: Float32Array,
  inputSampleRate: number
): { originalLength: number; samples: Float32Array } => {
  const outputLength = Math.max(1, Math.round(samples.length * ESSENTIA_SAMPLE_RATE / inputSampleRate));
  const paddedLength = Math.max(
    FRAME_SIZE,
    Math.ceil((outputLength - FRAME_SIZE) / ESSENTIA_PITCH_HOP) * ESSENTIA_PITCH_HOP + FRAME_SIZE
  );
  const output = new Float32Array(paddedLength);
  let peak = 0;
  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * inputSampleRate / ESSENTIA_SAMPLE_RATE;
    const firstIndex = Math.min(samples.length - 1, Math.floor(sourcePosition));
    const secondIndex = Math.min(samples.length - 1, firstIndex + 1);
    const blend = sourcePosition - firstIndex;
    const first = samples[firstIndex] ?? 0;
    const second = samples[secondIndex] ?? first;
    const value = Number.isFinite(first) && Number.isFinite(second)
      ? first + (second - first) * blend
      : 0;
    output[index] = value;
    peak = Math.max(peak, Math.abs(value));
  }
  if (peak > 0) {
    const gain = Math.min(16, 0.9 / peak);
    for (let index = 0; index < outputLength; index += 1) {
      output[index] = (output[index] ?? 0) * gain;
    }
  }
  return { originalLength: outputLength, samples: output };
};

const analyzeWithEssentia = async (
  buffer: AudioBuffer,
  mode: CreationMode
): Promise<AudioFeatures> => {
  const [{ default: Essentia }, { default: EssentiaWasmFactory }, { default: essentiaWasmUrl }] =
    await Promise.all([
      import('essentia.js/dist/essentia.js-core.es.js'),
      import('essentia.js/dist/essentia-wasm.web.js'),
      import('essentia.js/dist/essentia-wasm.web.wasm?url'),
    ]);
  essentiaModulePromise ??= EssentiaWasmFactory({
    locateFile: () => essentiaWasmUrl,
  });
  const module = await essentiaModulePromise;
  const essentia = new Essentia(module);
  const trimmed = trimActiveRegion(monoSamples(buffer), buffer.sampleRate);
  const samples = trimmed.samples;
  const localFeatureFrames = localFrames(samples, buffer.sampleRate);
  const vectorValues = (vector: unknown): Float32Array => {
    try {
      return essentia.vectorToArray(vector);
    } catch {
      return new Float32Array();
    }
  };
  const localOnsets = mode === 'beat'
    ? detectBeatPeaks(localFeatureFrames, 45)
    : detectOnsets(localFeatureFrames, mode === 'melody' ? 90 : 45);
  const localPitch = mode === 'beat'
    ? []
    : detectPitchTrack(
        samples,
        buffer.sampleRate,
        FRAME_SIZE,
        mode === 'melody' ? 512 : FRAME_SIZE,
        mode === 'effect' ? 5_000 : mode === 'melody' ? 1_600 : 720
      );
  let onsetTimesMs = localOnsets;
  let pitch = localPitch;
  const hasAnalyzableSignal = samples.length > 0 && framePeak(samples) >= 0.00001;
  if (hasAnalyzableSignal) {
    const prepared = prepareEssentiaSignal(samples, buffer.sampleRate);
    const resampledSignal = essentia.arrayToVector(
      prepared.samples.slice(0, prepared.originalLength)
    );
    try {
      const onsetResult = essentia.OnsetRate(resampledSignal);
      const detectedOnsets = [...vectorValues(onsetResult.onsets)]
        .filter((time) => Number.isFinite(time) && time >= 0)
        .map((time) => time * 1000);
      if (detectedOnsets.length > 0) onsetTimesMs = detectedOnsets;
    } catch {
      // Local onsets remain available when the native onset detector rejects a clip.
    } finally {
      resampledSignal.delete();
    }
    if (mode !== 'beat') {
      const detectedPitch: PitchPoint[] = [];
      const maximumPitch = mode === 'effect' ? 5_000 : 1_600;
      for (
        let start = 0;
        start < prepared.originalLength;
        start += ESSENTIA_PITCH_HOP
      ) {
        const frame = prepared.samples.slice(start, start + FRAME_SIZE);
        const frameVector = essentia.arrayToVector(frame);
        try {
          const result = essentia.PitchYin(
            frameVector,
            FRAME_SIZE,
            true,
            maximumPitch,
            55,
            ESSENTIA_SAMPLE_RATE,
            0.2
          );
          if (
            Number.isFinite(result.pitch) && result.pitch >= 55 && result.pitch <= maximumPitch
            && Number.isFinite(result.pitchConfidence) && result.pitchConfidence >= 0.35
          ) {
            detectedPitch.push({
              confidence: result.pitchConfidence,
              frequency: result.pitch,
              timeMs: Math.min(prepared.originalLength, start + FRAME_SIZE / 2) /
                ESSENTIA_SAMPLE_RATE * 1000,
            });
          }
        } catch {
          // A rejected frame does not prevent analysis of the remaining recording.
        } finally {
          frameVector.delete();
        }
      }
      if (detectedPitch.length > 0) {
        const nativeCoverageMs = ESSENTIA_PITCH_HOP / ESSENTIA_SAMPLE_RATE * 1000 * 2;
        pitch = [
          ...localPitch.filter((localPoint) => !detectedPitch.some(
            (nativePoint) => Math.abs(nativePoint.timeMs - localPoint.timeMs) <= nativeCoverageMs
          )),
          ...detectedPitch,
        ].sort((first, second) => first.timeMs - second.timeMs);
      }
    }
  }
  try {
    essentia.delete();
  } catch {
    // A native algorithm failure can also make cleanup unavailable.
  }
  return aggregateFeatures(
    buffer,
    'essentia',
    samples,
    trimmed.startMs,
    trimmed.endMs,
    localFeatureFrames,
    mode,
    { onsetTimesMs, pitch }
  );
};

const BASIC_PITCH_SAMPLE_RATE = 22_050;

const resampleForBasicPitch = async (buffer: AudioBuffer): Promise<AudioBuffer> => {
  if (buffer.sampleRate === BASIC_PITCH_SAMPLE_RATE && buffer.numberOfChannels === 1) return buffer;
  const frameCount = Math.max(1, Math.round(buffer.duration * BASIC_PITCH_SAMPLE_RATE));
  const context = new OfflineAudioContext(
    1,
    frameCount,
    BASIC_PITCH_SAMPLE_RATE
  );
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
  return context.startRendering();
};

const loadBasicPitchModel = async () => {
  const [tf, modelModule, weightsModule] = await Promise.all([
    import('@tensorflow/tfjs'),
    import('@spotify/basic-pitch/model/model.json'),
    import('@spotify/basic-pitch/model/group1-shard1of1.bin?url'),
  ]);
  const weightsUrl = new URL(weightsModule.default, document.baseURI).href;
  const response = await fetch(weightsUrl);
  if (!response.ok) {
    throw new Error(`Could not load Basic Pitch model weights (${response.status}).`);
  }
  const files = [
    new File([JSON.stringify(modelModule.default)], 'model.json', { type: 'application/json' }),
    new File([await response.blob()], 'group1-shard1of1.bin', {
      type: 'application/octet-stream',
    }),
  ];
  return tf.loadGraphModel(tf.io.browserFiles(files));
};

let basicPitchModelPromise: ReturnType<typeof loadBasicPitchModel> | undefined;

const basicPitchModel = (): ReturnType<typeof loadBasicPitchModel> => {
  basicPitchModelPromise ??= loadBasicPitchModel().catch((error: unknown) => {
    basicPitchModelPromise = undefined;
    throw error;
  });
  return basicPitchModelPromise;
};

const analyzeWithBasicPitch = async (
  buffer: AudioBuffer,
  mode: CreationMode
): Promise<AudioFeatures> => {
  if (mode !== 'melody') throw new Error('Basic Pitch is available in melody mode only.');
  const {
    addPitchBendsToNoteEvents,
    BasicPitch,
    noteFramesToTime,
    outputToNotesPoly,
  } = await import('@spotify/basic-pitch');
  const base = await analyzeWithWebAudio(buffer, mode);
  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];
  const basicPitch = new BasicPitch(basicPitchModel());
  const modelInput = await resampleForBasicPitch(buffer);
  await basicPitch.evaluateModel(modelInput, (frameValues, onsetValues, contourValues) => {
    frames.push(...frameValues);
    onsets.push(...onsetValues);
    contours.push(...contourValues);
  }, () => undefined);
  const noteEvents = noteFramesToTime(addPitchBendsToNoteEvents(
    contours,
    outputToNotesPoly(frames, onsets, 0.4, 0.3, 4, true, null, null, true, 3)
  ));
  const originSeconds = base.sourceStartMs / 1000;
  const timedNotes = noteEvents.map((note) => {
    const startMs = Math.round((note.startTimeSeconds - originSeconds) * 1000);
    const originalDurationMs = Math.round(note.durationSeconds * 1000);
    const unclippedEndMs = startMs + originalDurationMs;
    const clippedStartMs = clamp(startMs, 0, base.durationMs);
    const clippedEndMs = clamp(unclippedEndMs, clippedStartMs, base.durationMs);
    const pitchBends = note.pitchBends ?? [];
    const originalBendCurve = pitchBends.map((bend, index) => ({
      timeMs: (index / Math.max(1, pitchBends.length)) * originalDurationMs,
      value: bend * (100 / 3),
    }));
    const clipOffsetMs = clippedStartMs - startMs;
    const clippedDurationMs = clippedEndMs - clippedStartMs;
    const bendValueAt = (timeMs: number): number => {
      const nextIndex = originalBendCurve.findIndex((point) => point.timeMs >= timeMs);
      if (nextIndex < 0) return originalBendCurve[originalBendCurve.length - 1]?.value ?? 0;
      if (nextIndex === 0) return originalBendCurve[0]?.value ?? 0;
      const previous = originalBendCurve[nextIndex - 1];
      const next = originalBendCurve[nextIndex];
      if (previous === undefined || next === undefined) return next?.value ?? previous?.value ?? 0;
      const amount = (timeMs - previous.timeMs) / Math.max(1, next.timeMs - previous.timeMs);
      return previous.value + (next.value - previous.value) * amount;
    };
    const pitchBendCurve = simplifyAutomationCurve(
      pitchBends.length === 0 ? [] : [
        { timeMs: 0, value: bendValueAt(clipOffsetMs) },
        ...originalBendCurve
          .filter((point) =>
            point.timeMs > clipOffsetMs && point.timeMs < clipOffsetMs + clippedDurationMs
          )
          .map((point) => ({
            timeMs: Math.round(point.timeMs - clipOffsetMs),
            value: point.value,
          })),
        {
          timeMs: clippedDurationMs,
          value: bendValueAt(clipOffsetMs + clippedDurationMs),
        },
      ],
      Math.min(64, Math.max(8, Math.ceil(clippedDurationMs / 35)))
    );
    return {
      confidence: note.amplitude,
      durationMs: Math.round(clippedEndMs - clippedStartMs),
      midi: note.pitchMidi,
      pitchBendCurve,
      startMs: Math.round(clippedStartMs),
      velocity: clamp(note.amplitude, 0.1, 1),
    };
  }).filter((note) => note.durationMs >= 20);
  return {
    ...base,
    engine: 'basicPitch',
    onsetTimesMs: timedNotes.map((note) => note.startMs),
    // Keep the dense monophonic tracker as independent evidence for rejecting
    // delayed harmonic notes. Fall back to transcription anchors only when the
    // local tracker found no stable pitch.
    pitch: base.pitch.length > 0 ? base.pitch : timedNotes.map((note) => ({
        confidence: note.confidence,
        frequency: 440 * 2 ** ((note.midi - 69) / 12),
        timeMs: note.startMs,
      })),
    transcribedNotes: timedNotes.map(({ confidence: _confidence, ...note }) => note),
  };
};

const analyzeWithMeyda = async (
  buffer: AudioBuffer,
  mode: CreationMode
): Promise<AudioFeatures> => {
  const trimmed = trimActiveRegion(monoSamples(buffer), buffer.sampleRate);
  const samples = trimmed.samples;
  const frames: FrameFeatures[] = [];
  Meyda.bufferSize = FRAME_SIZE;
  Meyda.sampleRate = buffer.sampleRate;
  Meyda.numberOfMFCCCoefficients = 8;
  let previousFrame: Float32Array | undefined;

  for (let start = 0; start < samples.length; start += HOP_SIZE) {
    const frame = new Float32Array(FRAME_SIZE);
    frame.set(samples.slice(start, Math.min(samples.length, start + FRAME_SIZE)));
    const extracted = Meyda.extract(
      ['rms', 'zcr', 'spectralCentroid', 'spectralFlatness', 'spectralRolloff', 'mfcc'],
      frame,
      previousFrame
    );
    previousFrame = frame;
    if (extracted === null) continue;
    const centroidBin = extracted.spectralCentroid ?? 0;
    frames.push({
      centroidHz: centroidBin * (buffer.sampleRate / FRAME_SIZE),
      flatness: clamp(extracted.spectralFlatness ?? 0, 0, 1),
      mfcc: extracted.mfcc ?? [],
      rms: extracted.rms ?? 0,
      rolloffHz: extracted.spectralRolloff ?? 0,
      timeMs: Math.min(samples.length, start + FRAME_SIZE / 2) /
        buffer.sampleRate * 1000,
      zcr: (extracted.zcr ?? 0) / FRAME_SIZE,
    });
  }
  return aggregateFeatures(
    buffer,
    'meyda',
    samples,
    trimmed.startMs,
    trimmed.endMs,
    frames.length > 0 ? frames : localFrames(samples, buffer.sampleRate),
    mode
  );
};

export const ANALYSIS_ADAPTERS: AnalysisAdapter[] = [
  {
    analyze: analyzeWithWebAudio,
    id: 'webAudio',
    label: 'Web Audio + local DSP',
  },
  {
    analyze: analyzeWithMeyda,
    id: 'meyda',
    label: 'Meyda',
  },
  {
    analyze: analyzeWithEssentia,
    id: 'essentia',
    label: 'Essentia.js',
  },
  {
    analyze: analyzeWithBasicPitch,
    id: 'basicPitch',
    label: 'Spotify Basic Pitch',
  },
];

export const analysisAdapter = (id: AnalysisAdapter['id']): AnalysisAdapter | undefined =>
  ANALYSIS_ADAPTERS.find((adapter) => adapter.id === id);

export const analysisEngineLabel = (id: ResultEngineId): string =>
  id === 'combined' ? 'Imported config' : analysisAdapter(id)?.label ?? id;
