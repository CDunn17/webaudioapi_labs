export type ToneSoundConfig = {
  type: OscillatorType;
  frequencyStart: number;
  frequencyEnd: number;
  volume: number;
  durationMs: number;
  attackMs: number;
  releaseMs: number;
  filterFrequency?: number;
};

export type NoiseSoundConfig = {
  volume: number;
  durationMs: number;
  attackMs: number;
  releaseMs: number;
  filterFrequency: number;
};

export type SustainedSoundConfig = {
  type: OscillatorType;
  frequency: number;
  volume: number;
  attackMs: number;
  releaseMs: number;
  filterFrequency?: number;
  pulseFrequency?: number;
  pulseDepth?: number;
};

export type ProcessorConfig = {
  kind: 'reserved';
};

export type ChargeModulationConfig = {
  filterFrequency?: number;
  frequency?: number;
  modulationDepth?: number;
  pulseFrequency?: number;
  volume?: number;
};

export type LayerBase = {
  enabled: boolean;
  id: string;
  name: string;
  processors: ProcessorConfig[];
};

export type ToneLayerConfig = LayerBase & {
  kind: 'tone';
  sound: ToneSoundConfig;
};

export type NoiseLayerConfig = LayerBase & {
  kind: 'noise';
  sound: NoiseSoundConfig;
};

export type ClickLayerConfig = LayerBase & {
  kind: 'click';
  sound: NoiseSoundConfig;
};

export type FmToneSoundConfig = {
  carrierType: OscillatorType;
  modulatorType: OscillatorType;
  frequencyStart: number;
  frequencyEnd: number;
  modulatorFrequency: number;
  modulationDepth: number;
  volume: number;
  durationMs: number;
  attackMs: number;
  releaseMs: number;
  filterFrequency?: number;
};

export type FmToneLayerConfig = LayerBase & {
  kind: 'fmTone';
  sound: FmToneSoundConfig;
};

export type SoundLayerConfig =
  | ToneLayerConfig
  | NoiseLayerConfig
  | ClickLayerConfig
  | FmToneLayerConfig;

export type LayeredSoundConfig = {
  layers: SoundLayerConfig[];
};

export type SustainedNoiseSoundConfig = {
  volume: number;
  attackMs: number;
  releaseMs: number;
  filterFrequency: number;
  pulseFrequency?: number;
  pulseDepth?: number;
};

export type FmSustainedSoundConfig = {
  carrierType: OscillatorType;
  modulatorType: OscillatorType;
  frequency: number;
  modulatorFrequency: number;
  modulationDepth: number;
  volume: number;
  attackMs: number;
  releaseMs: number;
  filterFrequency?: number;
  pulseFrequency?: number;
  pulseDepth?: number;
};

export type SustainedToneLayerConfig = LayerBase & {
  kind: 'sustainedTone';
  sound: SustainedSoundConfig;
};

export type SustainedNoiseLayerConfig = LayerBase & {
  kind: 'sustainedNoise';
  sound: SustainedNoiseSoundConfig;
};

export type FmSustainedLayerConfig = LayerBase & {
  kind: 'fmSustained';
  sound: FmSustainedSoundConfig;
};

// Optional per-layer deltas applied by GameAudio.setCharging(progress).
// Example: chargeModulation: { frequency: 100, pulseFrequency: 5 }
// means "at full charge, add +100Hz and +5Hz pulse to this layer".
export type SustainedLayerConfig =
  | (SustainedToneLayerConfig & { chargeModulation?: ChargeModulationConfig })
  | (SustainedNoiseLayerConfig & { chargeModulation?: ChargeModulationConfig })
  | (FmSustainedLayerConfig & { chargeModulation?: ChargeModulationConfig });

export type LayeredSustainedSoundConfig = {
  layers: SustainedLayerConfig[];
};

export type OneShotSoundConfig =
  | ToneSoundConfig
  | NoiseSoundConfig
  | LayeredSoundConfig;

export type SustainedAudioConfig =
  | SustainedSoundConfig
  | LayeredSustainedSoundConfig;

export type GameAudioConfig = {
  masterVolume: number;
  thrust: SustainedAudioConfig;
  charging: SustainedAudioConfig;
  boost: OneShotSoundConfig;
  chargeBoost: OneShotSoundConfig;
  fuelPickup: OneShotSoundConfig;
  chargePickup: OneShotSoundConfig;
  coreCrashTone: OneShotSoundConfig;
  coreCrashNoise: OneShotSoundConfig;
  countdown: OneShotSoundConfig;
  countdownFinal: OneShotSoundConfig;
  dailyFinish: OneShotSoundConfig;
};

export const GAME_AUDIO: GameAudioConfig = {
  masterVolume: 0.38,
  thrust: {
  layers: [
    {
      enabled: true,
      id: 'thrust-rumble',
      kind: 'sustainedNoise',
      name: 'Filtered rumble',
      processors: [],
      sound: {
        volume: 0.06,
        attackMs: 40,
        releaseMs: 345,
        filterFrequency: 790,
        pulseFrequency: 11,
        pulseDepth: 0.16,
      },
    },
    {
      enabled: true,
      id: 'sustainedNoise-mqzpuhez',
      kind: 'sustainedNoise',
      name: 'New noise',
      processors: [],
      sound: {
        volume: 0.01,
        attackMs: 20,
        releaseMs: 140,
        filterFrequency: 5990,
        pulseFrequency: 50,
        pulseDepth: 0.41,
      },
    },
  ],
},
  charging: {
    layers: [
      {
        enabled: true,
        id: 'charging-tone',
        kind: 'sustainedTone',
        name: 'Charge tone',
        processors: [],
        sound: {
          type: 'triangle',
          frequency: 150,
          volume: 0.08,
          attackMs: 80,
          releaseMs: 130,
          filterFrequency: 760,
          pulseFrequency: 10,
          pulseDepth: 0.45,
        },
        chargeModulation: {
          frequency: 100,
          pulseFrequency: 5,
        },
      },
      {
      enabled: true,
      id: 'sustainedTone-mqzqtapk',
      kind: 'sustainedTone',
      name: 'Charge pulse',
      processors: [],
      sound: {
        type: 'triangle',
        frequency: 137,
        volume: 0.06,
        attackMs: 80,
        releaseMs: 905,
        filterFrequency: 1640,
        pulseFrequency: 10,
        pulseDepth: 0.5,
      },
      chargeModulation: {
        pulseFrequency: 30
      }
    }
    ],
  },
  boost: {
    type: 'sawtooth',
    frequencyStart: 220,
    frequencyEnd: 1_120,
    volume: 0.18,
    durationMs: 220,
    attackMs: 8,
    releaseMs: 170,
    filterFrequency: 2_300,
  },
  chargeBoost: {
    type: 'square',
    frequencyStart: 250,
    frequencyEnd: 650,
    volume: 0.16,
    durationMs: 350,
    attackMs: 14,
    releaseMs: 780,
    filterFrequency: 2650,
},
  fuelPickup: {
    type: 'sine',
    frequencyStart: 460,
    frequencyEnd: 820,
    volume: 0.13,
    durationMs: 145,
    attackMs: 6,
    releaseMs: 105,
  },
 chargePickup: {
  type: 'triangle',
  frequencyStart: 300,
  frequencyEnd: 1000,
  volume: 0.12,
  durationMs: 290,
  attackMs: 25,
  releaseMs: 130,
  filterFrequency: 3550,
},
  coreCrashTone: {
  layers: [
    {
      enabled: true,
      id: 'core-crash-tone',
      kind: 'tone',
      name: 'Falling tone',
      processors: [],
      sound: {
        type: 'sawtooth',
        frequencyStart: 596,
        frequencyEnd: 3200,
        volume: 0.2,
        durationMs: 1030,
        attackMs: 8,
        releaseMs: 520,
        filterFrequency: 2980,
      },
    },
    {
      enabled: true,
      id: 'noise-mqwzapfs',
      kind: 'noise',
      name: 'New noise',
      processors: [],
      sound: {
        volume: 0.11,
        durationMs: 120,
        attackMs: 51,
        releaseMs: 95,
        filterFrequency: 1200,
      },
    },
  ],
},
  coreCrashNoise: {
    volume: 0.18,
    durationMs: 520,
    attackMs: 4,
    releaseMs: 450,
    filterFrequency: 980,
  },
  countdown: {
    type: 'sine',
    frequencyStart: 520,
    frequencyEnd: 520,
    volume: 0.12,
    durationMs: 130,
    attackMs: 4,
    releaseMs: 95,
  },
  countdownFinal: {
    type: 'sine',
    frequencyStart: 740,
    frequencyEnd: 980,
    volume: 0.15,
    durationMs: 210,
    attackMs: 5,
    releaseMs: 160,
  },
  dailyFinish: {
    type: 'triangle',
    frequencyStart: 440,
    frequencyEnd: 1_320,
    volume: 0.18,
    durationMs: 760,
    attackMs: 12,
    releaseMs: 520,
    filterFrequency: 2_000,
  },
};

