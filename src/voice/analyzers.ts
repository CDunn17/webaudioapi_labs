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
  ResultEngineId,
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
    mode === 'beat' ? [] : detectPitchTrack(
      samples,
      buffer.sampleRate,
      FRAME_SIZE,
      mode === 'melody' ? 512 : FRAME_SIZE
    )
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
    ? detectBeatPeaks(localFeatureFrames, 85)
    : detectOnsets(localFeatureFrames, mode === 'melody' ? 110 : 45);
  const localPitch = mode === 'beat'
    ? []
    : detectPitchTrack(samples, buffer.sampleRate, FRAME_SIZE, mode === 'melody' ? 512 : FRAME_SIZE);
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
            1_600,
            55,
            ESSENTIA_SAMPLE_RATE,
            0.2
          );
          if (
            Number.isFinite(result.pitch) && result.pitch >= 55 && result.pitch <= 1_600
            && Number.isFinite(result.pitchConfidence) && result.pitchConfidence >= 0.35
          ) {
            detectedPitch.push({
              confidence: result.pitchConfidence,
              frequency: result.pitch,
              timeMs: start / ESSENTIA_SAMPLE_RATE * 1000,
            });
          }
        } catch {
          // A rejected frame does not prevent analysis of the remaining recording.
        } finally {
          frameVector.delete();
        }
      }
      if (detectedPitch.length > 0) pitch = detectedPitch;
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

export const analysisEngineLabel = (id: ResultEngineId): string =>
  id === 'combined' ? 'Combined result' : analysisAdapter(id)?.label ?? id;
