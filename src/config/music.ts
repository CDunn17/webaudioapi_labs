export type MusicScaleName =
  | 'minorPentatonic'
  | 'naturalMinor'
  | 'dorian'
  | 'majorPentatonic'
  | 'wholeTone';

export type MusicScaleConfig = {
  label: string;
  intervals: number[];
};

export type MusicPulseConfig = {
  type: OscillatorType;
  steps: number[];
  volume: number;
  durationMs: number;
  attackMs: number;
  releaseMs: number;
};

export type GameMusicConfig = {
  masterVolume: number;
  fadeInMs: number;
  fadeOutMs: number;
  baseBpm: number;
  baseFrequency: number;
  scale: MusicScaleName;
  phraseLength: number;
  rhythmSubdivision: number;
  intensity: number;
  droneType: OscillatorType;
  harmonyType: OscillatorType;
  harmonyInterval: number;
  baseFilterFrequency: number;
  droneVolume: number;
  harmonyVolume: number;
  pulse: MusicPulseConfig;
};

export const ENDLESS_MUSIC_ROOT_FREQUENCY_SECTION_INTERVAL = 4;
export const ENDLESS_MUSIC_ROOT_FREQUENCY_INCREASE = 3;
export const ENDLESS_MUSIC_ROOT_FREQUENCY_MAX = 121;
export const LOW_FUEL_MUSIC_THRESHOLD = 0.25;
export const LOW_FUEL_MUSIC_RHYTHM_SUBDIVISION = 3;
export const CRITICAL_FUEL_MUSIC_THRESHOLD = 0.1;
export const CRITICAL_FUEL_MUSIC_RHYTHM_SUBDIVISION = 2;

export const MUSIC_SCALE_LIBRARY: Record<MusicScaleName, MusicScaleConfig> = {
  minorPentatonic: {
    label: 'Minor pentatonic',
    intervals: [0, 3, 5, 7, 10],
  },
  naturalMinor: {
    label: 'Natural minor',
    intervals: [0, 2, 3, 5, 7, 8, 10],
  },
  dorian: {
    label: 'Dorian',
    intervals: [0, 2, 3, 5, 7, 9, 10],
  },
  majorPentatonic: {
    label: 'Major pentatonic',
    intervals: [0, 2, 4, 7, 9],
  },
  wholeTone: {
    label: 'Whole tone',
    intervals: [0, 2, 4, 6, 8, 10],
  },
};

export const MUSIC_SCALE_NAMES: MusicScaleName[] = [
  'minorPentatonic',
  'naturalMinor',
  'dorian',
  'majorPentatonic',
  'wholeTone',
];

export const GAME_MUSIC: GameMusicConfig = {
  "masterVolume": 0.2,
  "fadeInMs": 300,
  "fadeOutMs": 500,
  "baseBpm": 128,
  "baseFrequency": 55,
  "scale": "minorPentatonic",
  "phraseLength": 24,
  "rhythmSubdivision": 4,
  "intensity": 0.8,
  "droneType": "triangle",
  "harmonyType": "sawtooth",
  "harmonyInterval": 7,
  "baseFilterFrequency": 1600,
  "droneVolume": 0.1,
  "harmonyVolume": 0,
  "pulse": {
    "type": "square",
    "steps": [
      0,
      0,
      0,
      0,
      3,
      0,
      0,
      0,
      5,
      0,
      3,
      0,
      7,
      0,
      5,
      3,
      0,
      4,
      0,
      4,
      0,
      8,
      8,
      12
    ],
    "volume": 0.22,
    "durationMs": 110,
    "attackMs": 0,
    "releaseMs": 80
  }
};
