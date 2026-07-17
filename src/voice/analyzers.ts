import Meyda from 'meyda';
import {
  clamp,
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
} from './types';

const FRAME_SIZE = 2048;
const HOP_SIZE = 1024;

const aggregateFeatures = (
  buffer: AudioBuffer,
  engine: AudioFeatures['engine'],
  samples: Float32Array,
  sourceStartMs: number,
  sourceEndMs: number,
  frames: FrameFeatures[],
  mode: CreationMode
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
  const pitch =
    mode === 'beat' ? [] : detectPitchTrack(samples, buffer.sampleRate, FRAME_SIZE, FRAME_SIZE);
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
    onsetTimesMs: detectOnsets(frames, minimumGap),
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

const analyzeWithWebAudio = async (
  buffer: AudioBuffer,
  mode: CreationMode
): Promise<AudioFeatures> => {
  const trimmed = trimActiveRegion(monoSamples(buffer), buffer.sampleRate);
  const samples = trimmed.samples;
  const frames: FrameFeatures[] = [];
  for (let start = 0; start < samples.length; start += HOP_SIZE) {
    const frame = new Float32Array(FRAME_SIZE);
    frame.set(samples.slice(start, Math.min(samples.length, start + FRAME_SIZE)));
    const spectral = spectralFeatures(frame, buffer.sampleRate);
    frames.push({
      centroidHz: spectral.centroidHz,
      flatness: spectral.flatness,
      mfcc: [],
      rms: frameRms(frame),
      rolloffHz: spectral.rolloffHz,
      timeMs: (start / buffer.sampleRate) * 1000,
      zcr: frameZcr(frame),
    });
  }
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
];

export const analysisAdapter = (id: AnalysisAdapter['id']): AnalysisAdapter | undefined =>
  ANALYSIS_ADAPTERS.find((adapter) => adapter.id === id);

export const analysisEngineLabel = (id: AnalysisAdapter['id']): string =>
  analysisAdapter(id)?.label ?? id;
