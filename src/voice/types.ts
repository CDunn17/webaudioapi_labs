import type { AutomationPoint, LayeredSoundConfig } from '../config/audio';

export type CreationMode = 'effect' | 'beat' | 'melody';

export type AnalysisEngineId = 'webAudio' | 'meyda' | 'essentia' | 'basicPitch';

export type FrameFeatures = {
  centroidHz: number;
  flatness: number;
  mfcc: number[];
  rms: number;
  rolloffHz: number;
  timeMs: number;
  zcr: number;
};

export type PitchPoint = {
  confidence: number;
  frequency: number;
  timeMs: number;
};

export type AudioFeatures = {
  amplitudeCurve: AutomationPoint[];
  brightnessCurve: AutomationPoint[];
  centroidHz: number;
  durationMs: number;
  engine: AnalysisEngineId;
  flatness: number;
  frames: FrameFeatures[];
  onsetTimesMs: number[];
  peak: number;
  pitch: PitchPoint[];
  pitchCurve: AutomationPoint[];
  rms: number;
  rolloffHz: number;
  sourceEndMs: number;
  sourceStartMs: number;
  zcr: number;
  transcribedNotes?: MelodyNote[];
};

export type BeatVoice = {
  decayMs: number;
  frequency: number;
  kind: 'kick' | 'snare' | 'hat';
  noiseAmount: number;
  volume: number;
};

export type BeatLane = {
  hits: Array<{ label: string; startMs: number; velocity: number }>;
  label: string;
  steps: number[];
  voice: BeatVoice;
};

export type BeatConfig = {
  bpm: number;
  durationMs: number;
  lanes: BeatLane[];
  masterVolume: number;
  stepCount: number;
  stepsPerBeat: number;
};

export type MelodyNote = {
  durationMs: number;
  midi: number;
  startMs: number;
  velocity: number;
};

export type MelodyConfig = {
  filterFrequency: number;
  masterVolume: number;
  notes: MelodyNote[];
  oscillatorType: OscillatorType;
};

type ProceduralResultBase = {
  engine: AnalysisEngineId;
  features: AudioFeatures;
  summary: string;
};

export type EffectResult = ProceduralResultBase & {
  config: LayeredSoundConfig;
  fit?: {
    candidateCount: number;
    finalLoss: number;
    improvement: number;
  };
  mode: 'effect';
};

export type BeatResult = ProceduralResultBase & {
  config: BeatConfig;
  mode: 'beat';
};

export type MelodyResult = ProceduralResultBase & {
  config: MelodyConfig;
  mode: 'melody';
};

export type ProceduralResult = EffectResult | BeatResult | MelodyResult;

export type AnalysisAdapter = {
  id: AnalysisEngineId;
  label: string;
  analyze: (buffer: AudioBuffer, mode: CreationMode) => Promise<AudioFeatures>;
};
