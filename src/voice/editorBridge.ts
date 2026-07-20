import type { ProceduralResult } from './types';

export const VOICE_EDITOR_LOAD = 'voice-editor:load';
export const VOICE_EDITOR_REQUEST = 'voice-editor:request';
export const VOICE_EDITOR_RESULT = 'voice-editor:result';

export type VoiceEditorLoadMessage = {
  config: ProceduralResult['config'];
  mode: ProceduralResult['mode'];
  type: typeof VOICE_EDITOR_LOAD;
};

export type VoiceEditorRequestMessage = {
  requestId: number;
  type: typeof VOICE_EDITOR_REQUEST;
};

export type VoiceEditorResultMessage = {
  config: ProceduralResult['config'];
  mode: ProceduralResult['mode'];
  requestId: number;
  type: typeof VOICE_EDITOR_RESULT;
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const isVoiceEditorLoadMessage = (
  value: unknown
): value is VoiceEditorLoadMessage =>
  isRecord(value) &&
  value.type === VOICE_EDITOR_LOAD &&
  (value.mode === 'effect' || value.mode === 'beat' || value.mode === 'melody') &&
  isRecord(value.config);

export const isVoiceEditorRequestMessage = (
  value: unknown
): value is VoiceEditorRequestMessage =>
  isRecord(value) &&
  value.type === VOICE_EDITOR_REQUEST &&
  typeof value.requestId === 'number';

export const isVoiceEditorResultMessage = (
  value: unknown
): value is VoiceEditorResultMessage =>
  isRecord(value) &&
  value.type === VOICE_EDITOR_RESULT &&
  typeof value.requestId === 'number' &&
  (value.mode === 'effect' || value.mode === 'beat' || value.mode === 'melody') &&
  isRecord(value.config);

export const cloneConfig = <Config>(config: Config): Config =>
  structuredClone(config);

export const previewResult = <Mode extends ProceduralResult['mode']>(
  mode: Mode,
  config: Extract<ProceduralResult, { mode: Mode }>['config']
): Extract<ProceduralResult, { mode: Mode }> => ({
  config,
  engine: 'combined',
  features: {
    activityRegions: [],
    amplitudeCurve: [],
    brightnessCurve: [],
    centroidHz: 0,
    durationMs: 'durationMs' in config ? config.durationMs : 0,
    engine: 'combined',
    flatness: 0,
    frames: [],
    onsetTimesMs: [],
    peak: 0,
    pitch: [],
    pitchCurve: [],
    rms: 0,
    rolloffHz: 0,
    sampleRate: 44_100,
    sourceEndMs: 'durationMs' in config ? config.durationMs : 0,
    sourceStartMs: 0,
    zcr: 0,
  },
  mode,
  summary: 'Voice Lab editor preview',
} as unknown as Extract<ProceduralResult, { mode: Mode }>);
