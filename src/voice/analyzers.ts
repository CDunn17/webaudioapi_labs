import Meyda from 'meyda';
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
  AudioFeatures,
  CreationMode,
  FrameFeatures,
  PitchPoint,
} from './types';

const FRAME_SIZE = 2048;
const HOP_SIZE = 1024;

type FeatureOverrides = {
  onsetTimesMs?: number[];
  pitch?: PitchPoint[];
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
  const activeFrames = frames.filter((frame) => frame.rms > 0.008);
  const selected = activeFrames.length > 0 ? activeFrames : frames;
  const weights = selected.map((frame) => Math.max(0.001, frame.rms));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const weightedMean = (values: number[]): number =>
    totalWeight > 0
      ? values.reduce((sum, value, index) => sum + value * (weights[index] ?? 0), 0) /
        totalWeight
      : mean(values);
  const minimumGap = mode === 'beat' ? 85 : mode === 'effect' ? 45 : 110;
  const amplitudeValues = smoothValues(frames.map((frame) => frame.rms), 1);
  const maximumAmplitude = Math.max(0.001, ...amplitudeValues);
  const amplitudeCurve = simplifyAutomationCurve(
    frames.map((frame, index) => ({
      timeMs: Math.round(frame.timeMs),
      value: clamp((amplitudeValues[index] ?? 0) / maximumAmplitude, 0, 1),
    })),
    16
  );
  const brightnessValues = smoothValues(frames.map((frame) => frame.centroidHz), 2);
  const brightnessCurve = simplifyAutomationCurve(
    frames.map((frame, index) => ({
      timeMs: Math.round(frame.timeMs),
      value: Math.round(clamp(brightnessValues[index] ?? 0, 80, 16_000)),
    })),
    14
  );
  const pitch = overrides.pitch ?? (
    mode === 'beat' ? [] : detectPitchTrack(samples, buffer.sampleRate, FRAME_SIZE, FRAME_SIZE)
  );
  const pitchValues = smoothValues(pitch.map((point) => point.frequency), 1);
  const pitchCurve = simplifyAutomationCurve(
    pitch.map((point, index) => ({
      timeMs: Math.round(point.timeMs),
      value: Math.round(clamp(pitchValues[index] ?? point.frequency, 40, 2_400)),
    })),
    14
  );

  return {
    amplitudeCurve,
    brightnessCurve,
    centroidHz: weightedMean(selected.map((frame) => frame.centroidHz)),
    durationMs: (samples.length / buffer.sampleRate) * 1000,
    engine,
    flatness: weightedMean(selected.map((frame) => frame.flatness)),
    frames,
    onsetTimesMs: overrides.onsetTimesMs ?? (
      mode === 'beat'
        ? detectBeatPeaks(frames, minimumGap)
        : detectOnsets(frames, minimumGap)
    ),
    peak: framePeak(samples),
    pitch,
    pitchCurve,
    rms: frameRms(samples),
    rolloffHz: weightedMean(selected.map((frame) => frame.rolloffHz)),
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
      timeMs: (start / sampleRate) * 1000,
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
  const signal = essentia.arrayToVector(samples);
  const resampledResult = essentia.Resample(signal, buffer.sampleRate, 44_100, 1);
  const resampled = essentia.vectorToArray(resampledResult.signal);
  const resampledSignal = essentia.arrayToVector(resampled);
  const vectorValues = (vector: unknown): Float32Array => {
    try {
      return essentia.vectorToArray(vector);
    } catch {
      return new Float32Array();
    }
  };
  const onsetResult = essentia.OnsetRate(resampledSignal);
  const onsetTimesMs = [...vectorValues(onsetResult.onsets)].map((time) => time * 1000);
  let pitch: PitchPoint[] = [];
  if (mode !== 'beat') {
    const pitchResult = essentia.PitchYinProbabilistic(
      resampledSignal,
      FRAME_SIZE,
      256,
      0.02,
      'zero',
      false,
      44_100
    );
    const frequencies = vectorValues(pitchResult.pitch);
    const probabilities = vectorValues(pitchResult.voicedProbabilities);
    pitch = [...frequencies].map((frequency, index) => ({
      confidence: probabilities[index] ?? 0,
      frequency,
      timeMs: (index * 256 / 44_100) * 1000,
    })).filter((point) => point.frequency > 0 && point.confidence >= 0.35);
  }
  essentia.delete();
  return aggregateFeatures(
    buffer,
    'essentia',
    samples,
    trimmed.startMs,
    trimmed.endMs,
    localFrames(samples, buffer.sampleRate),
    mode,
    { onsetTimesMs, pitch }
  );
};

let basicPitchModelUrlPromise: Promise<string> | undefined;

const basicPitchUrl = async (): Promise<string> => {
  basicPitchModelUrlPromise ??= Promise.all([
    import('@spotify/basic-pitch/model/model.json'),
    import('@spotify/basic-pitch/model/group1-shard1of1.bin?url'),
  ]).then(([modelModule, weightsModule]) => {
    const definition = structuredClone(modelModule.default);
    definition.weightsManifest[0]!.paths = [weightsModule.default];
    return URL.createObjectURL(new Blob([JSON.stringify(definition)], {
      type: 'application/json',
    }));
  });
  return basicPitchModelUrlPromise;
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
  const basicPitch = new BasicPitch(await basicPitchUrl());
  await basicPitch.evaluateModel(buffer, (frameValues, onsetValues, contourValues) => {
    frames.push(...frameValues);
    onsets.push(...onsetValues);
    contours.push(...contourValues);
  }, () => undefined);
  const noteEvents = noteFramesToTime(addPitchBendsToNoteEvents(
    contours,
    outputToNotesPoly(frames, onsets, 0.25, 0.25, 5)
  ));
  const originSeconds = noteEvents[0]?.startTimeSeconds ?? 0;
  return {
    ...base,
    engine: 'basicPitch',
    onsetTimesMs: noteEvents.map((note) => (note.startTimeSeconds - originSeconds) * 1000),
    pitch: noteEvents.map((note) => ({
      confidence: note.amplitude,
      frequency: 440 * 2 ** ((note.pitchMidi - 69) / 12),
      timeMs: (note.startTimeSeconds - originSeconds) * 1000,
    })),
    transcribedNotes: noteEvents.map((note) => ({
      durationMs: Math.round(note.durationSeconds * 1000),
      midi: note.pitchMidi,
      startMs: Math.round((note.startTimeSeconds - originSeconds) * 1000),
      velocity: clamp(note.amplitude, 0.1, 1),
    })),
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
      timeMs: (start / buffer.sampleRate) * 1000,
      zcr: (extracted.zcr ?? 0) / FRAME_SIZE,
    });
  }
  return aggregateFeatures(
    buffer,
    'meyda',
    samples,
    trimmed.startMs,
    trimmed.endMs,
    frames,
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

export const analysisEngineLabel = (id: AnalysisAdapter['id']): string =>
  analysisAdapter(id)?.label ?? id;
