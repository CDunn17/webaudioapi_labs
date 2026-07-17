import {
  GAME_AUDIO,
  type AutomationPoint,
  type LayerAutomationConfig,
  type NoiseSoundConfig,
  type OneShotSoundConfig,
  type SustainedAudioConfig,
  type SustainedSoundConfig,
  type ToneSoundConfig,
} from './config/audio';

type SoundId =
  | 'thrust'
  | 'charging'
  | 'boost'
  | 'chargeBoost'
  | 'fuelPickup'
  | 'chargePickup'
  | 'coreCrashTone'
  | 'coreCrashNoise'
  | 'countdown'
  | 'countdownFinal'
  | 'dailyFinish';

type ProcessorConfig = {
  kind: 'reserved';
};

type ChargeModulationConfig = {
  filterFrequency?: number;
  frequency?: number;
  modulationDepth?: number;
  pulseFrequency?: number;
  volume?: number;
};

type LayerBase = {
  automation?: LayerAutomationConfig;
  enabled: boolean;
  id: string;
  name: string;
  processors: ProcessorConfig[];
  startMs?: number;
};

type ToneLayerConfig = LayerBase & {
  kind: 'tone';
  sound: ToneSoundConfig;
};

type NoiseLayerConfig = LayerBase & {
  kind: 'noise';
  sound: NoiseSoundConfig;
};

type ClickLayerConfig = LayerBase & {
  kind: 'click';
  sound: NoiseSoundConfig;
};

type FmToneSoundConfig = {
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

type FmToneLayerConfig = LayerBase & {
  kind: 'fmTone';
  sound: FmToneSoundConfig;
};

type SustainedNoiseSoundConfig = {
  volume: number;
  attackMs: number;
  releaseMs: number;
  filterFrequency: number;
  pulseFrequency?: number;
  pulseDepth?: number;
};

type FmSustainedSoundConfig = {
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

type SustainedToneLayerConfig = LayerBase & {
  kind: 'sustainedTone';
  sound: SustainedSoundConfig;
};

type SustainedNoiseLayerConfig = LayerBase & {
  kind: 'sustainedNoise';
  sound: SustainedNoiseSoundConfig;
};

type FmSustainedLayerConfig = LayerBase & {
  kind: 'fmSustained';
  sound: FmSustainedSoundConfig;
};

type SoundLayerConfig =
  | ToneLayerConfig
  | NoiseLayerConfig
  | ClickLayerConfig
  | FmToneLayerConfig;

type SustainedLayerConfig =
  | (SustainedToneLayerConfig & { chargeModulation?: ChargeModulationConfig })
  | (SustainedNoiseLayerConfig & { chargeModulation?: ChargeModulationConfig })
  | (FmSustainedLayerConfig & { chargeModulation?: ChargeModulationConfig });

type LayeredSoundConfig = {
  layers: SoundLayerConfig[];
};

type LayeredSustainedSoundConfig = {
  layers: SustainedLayerConfig[];
};

type LayeredDefinition = {
  id: SoundId;
  title: string;
  summary: string;
  kind: 'layered';
  original: LayeredSoundConfig;
  draft: LayeredSoundConfig;
};

type SustainedDefinition = {
  id: SoundId;
  title: string;
  summary: string;
  kind: 'sustained';
  original: LayeredSustainedSoundConfig;
  draft: LayeredSustainedSoundConfig;
};

type SoundDefinition = LayeredDefinition | SustainedDefinition;

type NumericField = {
  key:
    | 'attackMs'
    | 'durationMs'
    | 'filterFrequency'
    | 'frequency'
    | 'frequencyEnd'
    | 'frequencyStart'
    | 'modulationDepth'
    | 'modulatorFrequency'
    | 'pulseDepth'
    | 'pulseFrequency'
    | 'releaseMs'
    | 'volume';
  label: string;
  maximum: number;
  minimum: number;
  step: number;
};

type FieldInfo = {
  description: string;
  title: string;
};

type ReferenceKey =
  | NumericField['key']
  | 'chargeModulation'
  | 'click'
  | 'fmSustained'
  | 'fmTone'
  | 'layers'
  | 'noise'
  | 'processors'
  | 'sustainedNoise'
  | 'sustainedTone'
  | 'tone'
  | 'type';

type SustainedHandle = {
  gain: GainNode;
  sources: AudioScheduledSourceNode[];
};

type OneShotHandle = {
  gain: GainNode;
  source: AudioScheduledSourceNode;
};

const tone = (config: ToneSoundConfig): ToneSoundConfig => ({ ...config });
const noise = (config: NoiseSoundConfig): NoiseSoundConfig => ({ ...config });
const sustained = (
  config: SustainedSoundConfig
): SustainedSoundConfig => ({ ...config });
const fmTone = (config: FmToneSoundConfig): FmToneSoundConfig => ({ ...config });
const sustainedNoise = (
  config: SustainedNoiseSoundConfig
): SustainedNoiseSoundConfig => ({ ...config });
const fmSustained = (
  config: FmSustainedSoundConfig
): FmSustainedSoundConfig => ({ ...config });

const cloneAutomation = (
  automation: LayerAutomationConfig | undefined
): LayerAutomationConfig | undefined => {
  if (automation === undefined) return undefined;
  const cloned: LayerAutomationConfig = {};
  if (automation.filterFrequency !== undefined) {
    cloned.filterFrequency = automation.filterFrequency.map((point) => ({ ...point }));
  }
  if (automation.frequency !== undefined) {
    cloned.frequency = automation.frequency.map((point) => ({ ...point }));
  }
  if (automation.gain !== undefined) {
    cloned.gain = automation.gain.map((point) => ({ ...point }));
  }
  return cloned;
};

const toneLayer = (
  id: string,
  name: string,
  sound: ToneSoundConfig
): ToneLayerConfig => ({
  enabled: true,
  id,
  kind: 'tone',
  name,
  processors: [],
  sound: tone(sound),
});

const noiseLayer = (
  id: string,
  name: string,
  sound: NoiseSoundConfig
): NoiseLayerConfig => ({
  enabled: true,
  id,
  kind: 'noise',
  name,
  processors: [],
  sound: noise(sound),
});

const clickLayer = (
  id: string,
  name: string,
  sound: NoiseSoundConfig
): ClickLayerConfig => ({
  enabled: true,
  id,
  kind: 'click',
  name,
  processors: [],
  sound: noise(sound),
});

const fmToneLayer = (
  id: string,
  name: string,
  sound: FmToneSoundConfig
): FmToneLayerConfig => ({
  enabled: true,
  id,
  kind: 'fmTone',
  name,
  processors: [],
  sound: fmTone(sound),
});

const sustainedToneLayer = (
  id: string,
  name: string,
  sound: SustainedSoundConfig
): SustainedToneLayerConfig => ({
  enabled: true,
  id,
  kind: 'sustainedTone',
  name,
  processors: [],
  sound: sustained(sound),
});

const sustainedNoiseLayer = (
  id: string,
  name: string,
  sound: SustainedNoiseSoundConfig
): SustainedNoiseLayerConfig => ({
  enabled: true,
  id,
  kind: 'sustainedNoise',
  name,
  processors: [],
  sound: sustainedNoise(sound),
});

const fmSustainedLayer = (
  id: string,
  name: string,
  sound: FmSustainedSoundConfig
): FmSustainedLayerConfig => ({
  enabled: true,
  id,
  kind: 'fmSustained',
  name,
  processors: [],
  sound: fmSustained(sound),
});

const cloneLayer = (layer: SoundLayerConfig): SoundLayerConfig => {
  const withTimeline = <Layer extends SoundLayerConfig>(clonedLayer: Layer): Layer => {
    clonedLayer.enabled = layer.enabled;
    clonedLayer.processors = [...layer.processors];
    if (layer.startMs !== undefined) clonedLayer.startMs = layer.startMs;
    const automation = cloneAutomation(layer.automation);
    if (automation !== undefined) clonedLayer.automation = automation;
    return clonedLayer;
  };
  if (layer.kind === 'tone') {
    return withTimeline(toneLayer(layer.id, layer.name, layer.sound));
  }
  if (layer.kind === 'noise') {
    return withTimeline(noiseLayer(layer.id, layer.name, layer.sound));
  }
  if (layer.kind === 'click') {
    return withTimeline(clickLayer(layer.id, layer.name, layer.sound));
  }
  return withTimeline(fmToneLayer(layer.id, layer.name, layer.sound));
};

const cloneSustainedLayer = (
  layer: SustainedLayerConfig
): SustainedLayerConfig => {
  const chargeModulation =
    layer.chargeModulation === undefined
      ? undefined
      : { ...layer.chargeModulation };
  const withChargeModulation = <Layer extends SustainedLayerConfig>(
    clonedLayer: Layer
  ): Layer => {
    if (chargeModulation === undefined) return clonedLayer;

    clonedLayer.chargeModulation = chargeModulation;
    return clonedLayer;
  };

  if (layer.kind === 'sustainedTone') {
    return withChargeModulation(
      sustainedToneLayer(layer.id, layer.name, layer.sound)
    );
  }
  if (layer.kind === 'sustainedNoise') {
    return withChargeModulation(
      sustainedNoiseLayer(layer.id, layer.name, layer.sound)
    );
  }
  return withChargeModulation(fmSustainedLayer(layer.id, layer.name, layer.sound));
};

const layered = (layers: SoundLayerConfig[]): LayeredSoundConfig => ({
  layers: layers.map(cloneLayer),
});

const layeredSustained = (
  layers: SustainedLayerConfig[]
): LayeredSustainedSoundConfig => ({
  layers: layers.map(cloneSustainedLayer),
});

const isLayeredOneShotConfig = (
  config: OneShotSoundConfig
): config is LayeredSoundConfig => 'layers' in config;

const isToneConfig = (
  config: OneShotSoundConfig
): config is ToneSoundConfig => 'type' in config;

const isLayeredSustainedConfig = (
  config: SustainedAudioConfig
): config is LayeredSustainedSoundConfig => 'layers' in config;

const oneShotLayersFromConfig = (
  config: OneShotSoundConfig,
  id: string,
  name: string
): SoundLayerConfig[] => {
  if (isLayeredOneShotConfig(config)) return config.layers.map(cloneLayer);
  if (isToneConfig(config)) return [toneLayer(id, name, config)];
  return [noiseLayer(id, name, config)];
};

const sustainedLayersFromConfig = (
  config: SustainedAudioConfig,
  id: string,
  name: string
): SustainedLayerConfig[] => {
  if (isLayeredSustainedConfig(config)) {
    return config.layers.map(cloneSustainedLayer);
  }
  return [sustainedToneLayer(id, name, config)];
};

const isOscillatorType = (value: string): value is OscillatorType =>
  value === 'sine' ||
  value === 'triangle' ||
  value === 'sawtooth' ||
  value === 'square';

const sounds: SoundDefinition[] = [
  {
    id: 'thrust',
    title: 'Thrust',
    summary: 'A layered sustained engine sound used while burning fuel.',
    kind: 'sustained',
    original: layeredSustained(
      sustainedLayersFromConfig(GAME_AUDIO.thrust, 'thrust-tone', 'Engine tone')
    ),
    draft: layeredSustained(
      sustainedLayersFromConfig(GAME_AUDIO.thrust, 'thrust-tone', 'Engine tone')
    ),
  },
  {
    id: 'charging',
    title: 'Charging',
    summary: 'A layered sustained charge sound with shimmer and fizz.',
    kind: 'sustained',
    original: layeredSustained(
      sustainedLayersFromConfig(GAME_AUDIO.charging, 'charging-tone', 'Charge tone')
    ),
    draft: layeredSustained(
      sustainedLayersFromConfig(GAME_AUDIO.charging, 'charging-tone', 'Charge tone')
    ),
  },
  {
    id: 'boost',
    title: 'Boost',
    summary: 'A layered burst for boost pickups.',
    kind: 'layered',
    original: layered(
      oneShotLayersFromConfig(GAME_AUDIO.boost, 'boost-tone', 'Rising sweep')
    ),
    draft: layered(
      oneShotLayersFromConfig(GAME_AUDIO.boost, 'boost-tone', 'Rising sweep')
    ),
  },
  {
    id: 'chargeBoost',
    title: 'Charge Boost',
    summary: 'A layered launch snap fired by charged thrust.',
    kind: 'layered',
    original: layered(
      oneShotLayersFromConfig(
        GAME_AUDIO.chargeBoost,
        'charge-boost-tone',
        'Charged sweep'
      )
    ),
    draft: layered(
      oneShotLayersFromConfig(
        GAME_AUDIO.chargeBoost,
        'charge-boost-tone',
        'Charged sweep'
      )
    ),
  },
  {
    id: 'fuelPickup',
    title: 'Fuel Pickup',
    summary: 'A warm pickup made from a tone plus a soft noise bloom.',
    kind: 'layered',
    original: layered(
      oneShotLayersFromConfig(GAME_AUDIO.fuelPickup, 'fuel-tone', 'Warm chime')
    ),
    draft: layered(
      oneShotLayersFromConfig(GAME_AUDIO.fuelPickup, 'fuel-tone', 'Warm chime')
    ),
  },
  {
    id: 'chargePickup',
    title: 'Charge Pickup',
    summary: 'A bright charge pickup with a small FM sparkle layer.',
    kind: 'layered',
    original: layered(
      oneShotLayersFromConfig(
        GAME_AUDIO.chargePickup,
        'charge-pickup-tone',
        'Bright chime'
      )
    ),
    draft: layered(
      oneShotLayersFromConfig(
        GAME_AUDIO.chargePickup,
        'charge-pickup-tone',
        'Bright chime'
      )
    ),
  },
  {
    id: 'coreCrashTone',
    title: 'Core Crash Tone',
    summary: 'The pitched portion of a gravity-well crash.',
    kind: 'layered',
    original: layered(
      oneShotLayersFromConfig(
        GAME_AUDIO.coreCrashTone,
        'core-crash-tone',
        'Falling tone'
      )
    ),
    draft: layered(
      oneShotLayersFromConfig(
        GAME_AUDIO.coreCrashTone,
        'core-crash-tone',
        'Falling tone'
      )
    ),
  },
  {
    id: 'coreCrashNoise',
    title: 'Core Crash Noise',
    summary: 'The noisy impact layer of a gravity-well crash.',
    kind: 'layered',
    original: layered(
      oneShotLayersFromConfig(
        GAME_AUDIO.coreCrashNoise,
        'core-crash-noise',
        'Impact noise'
      )
    ),
    draft: layered(
      oneShotLayersFromConfig(
        GAME_AUDIO.coreCrashNoise,
        'core-crash-noise',
        'Impact noise'
      )
    ),
  },
  {
    id: 'countdown',
    title: 'Countdown',
    summary: 'The short countdown tick before launch.',
    kind: 'layered',
    original: layered(
      oneShotLayersFromConfig(GAME_AUDIO.countdown, 'countdown-tone', 'Tick tone')
    ),
    draft: layered(
      oneShotLayersFromConfig(GAME_AUDIO.countdown, 'countdown-tone', 'Tick tone')
    ),
  },
  {
    id: 'countdownFinal',
    title: 'Countdown Final',
    summary: 'The final countdown tone before the run begins.',
    kind: 'layered',
    original: layered(
      oneShotLayersFromConfig(
        GAME_AUDIO.countdownFinal,
        'countdown-final-tone',
        'Final tick'
      )
    ),
    draft: layered(
      oneShotLayersFromConfig(
        GAME_AUDIO.countdownFinal,
        'countdown-final-tone',
        'Final tick'
      )
    ),
  },
  {
    id: 'dailyFinish',
    title: 'Daily Finish',
    summary: 'A longer celebratory tone for completing the daily challenge.',
    kind: 'layered',
    original: layered(
      oneShotLayersFromConfig(
        GAME_AUDIO.dailyFinish,
        'daily-finish-tone',
        'Celebration sweep'
      )
    ),
    draft: layered(
      oneShotLayersFromConfig(
        GAME_AUDIO.dailyFinish,
        'daily-finish-tone',
        'Celebration sweep'
      )
    ),
  },
];

const fieldInfo: Record<ReferenceKey, FieldInfo> = {
  attackMs: {
    title: 'Attack',
    description:
      'How long the sound takes to fade in. Tiny values feel clicky and immediate; longer values feel softer.',
  },
  durationMs: {
    title: 'Duration',
    description:
      'Total length of one-shot sounds. Release is folded into this time.',
  },
  filterFrequency: {
    title: 'Filter Frequency',
    description:
      'Low-pass cutoff in hertz. Lower values remove brightness; higher values let sharper harmonics through.',
  },
  frequency: {
    title: 'Frequency',
    description:
      'Pitch in hertz for sustained tones. Lower values feel heavier; higher values feel smaller or brighter.',
  },
  frequencyEnd: {
    title: 'End Frequency',
    description:
      'Final pitch of a one-shot sweep. Higher than the start rises; lower than the start falls.',
  },
  frequencyStart: {
    title: 'Start Frequency',
    description: 'Initial pitch of a one-shot oscillator sweep.',
  },
  click: {
    title: 'Click Layer',
    description:
      'A very short impulse-like noise source. Use it for contact, snap, button, and pickup attack layers.',
  },
  chargeModulation: {
    title: 'Charge Modulation',
    description:
      'Optional per-layer deltas applied as charge progress moves from empty to full. Use it to ramp pitch, pulse, volume, filter, or FM depth on specific sustained layers.',
  },
  fmTone: {
    title: 'FM Tone Layer',
    description:
      'A carrier oscillator whose pitch is pushed by a modulator oscillator. Useful for metallic, electric, or sparkling tones.',
  },
  fmSustained: {
    title: 'FM Sustained Layer',
    description:
      'A held carrier oscillator whose pitch is pushed by a modulator. Useful for charge shimmer and unstable engine harmonics.',
  },
  layers: {
    title: 'Layers',
    description:
      'A sound can play multiple enabled sources at once. Keep each layer quiet so the combined result has room.',
  },
  modulationDepth: {
    title: 'Modulation Depth',
    description:
      'How strongly the FM modulator bends the carrier pitch. Higher values sound more metallic or unstable.',
  },
  modulatorFrequency: {
    title: 'Modulator Frequency',
    description:
      'How quickly the FM modulator moves the carrier pitch. Higher values add buzz and sparkle.',
  },
  noise: {
    title: 'Noise Layer',
    description:
      'A short random buffer shaped by an envelope and filter. Useful for air, impacts, dust, and soft pickup blooms.',
  },
  processors: {
    title: 'Processors',
    description:
      'Each layer reserves a processor chain for future filters, distortion, delays, and sends after the source.',
  },
  pulseDepth: {
    title: 'Pulse Depth',
    description:
      'How strongly a sustained sound wobbles in volume. Zero disables the wobble.',
  },
  pulseFrequency: {
    title: 'Pulse Frequency',
    description: 'How fast the sustained volume pulse repeats, in hertz.',
  },
  releaseMs: {
    title: 'Release',
    description:
      'How long the sound takes to fade out. Longer releases leave a tail.',
  },
  type: {
    title: 'Oscillator Type',
    description:
      'Sine is pure, triangle is soft, sawtooth is buzzy, and square is hollow and forceful.',
  },
  tone: {
    title: 'Tone Layer',
    description:
      'A pitched oscillator sweep with an envelope. This is the clean arcade building block for most effects.',
  },
  sustainedNoise: {
    title: 'Sustained Noise Layer',
    description:
      'A looped noise bed shaped by gain, filter, and pulse. Useful for engine rumble, exhaust air, charge fizz, and texture.',
  },
  sustainedTone: {
    title: 'Sustained Tone Layer',
    description:
      'A held oscillator with an optional volume pulse. This is the main layer for thrust and charge hums.',
  },
  volume: {
    title: 'Volume',
    description:
      'Per-sound gain before the master volume. Keep this modest to avoid harsh clipping.',
  },
};

const toneFields: NumericField[] = [
  { key: 'frequencyStart', label: 'Start Frequency', minimum: 20, maximum: 2400, step: 1 },
  { key: 'frequencyEnd', label: 'End Frequency', minimum: 20, maximum: 3200, step: 1 },
  { key: 'volume', label: 'Volume', minimum: 0, maximum: 0.5, step: 0.01 },
  { key: 'durationMs', label: 'Duration', minimum: 20, maximum: 2000, step: 5 },
  { key: 'attackMs', label: 'Attack', minimum: 0, maximum: 300, step: 1 },
  { key: 'releaseMs', label: 'Release', minimum: 0, maximum: 1800, step: 5 },
  { key: 'filterFrequency', label: 'Filter Frequency', minimum: 80, maximum: 8000, step: 10 },
];

const noiseFields: NumericField[] = [
  { key: 'volume', label: 'Volume', minimum: 0, maximum: 0.5, step: 0.01 },
  { key: 'durationMs', label: 'Duration', minimum: 20, maximum: 2000, step: 5 },
  { key: 'attackMs', label: 'Attack', minimum: 0, maximum: 300, step: 1 },
  { key: 'releaseMs', label: 'Release', minimum: 0, maximum: 1800, step: 5 },
  { key: 'filterFrequency', label: 'Filter Frequency', minimum: 80, maximum: 8000, step: 10 },
];

const fmToneFields: NumericField[] = [
  { key: 'frequencyStart', label: 'Start Frequency', minimum: 20, maximum: 3200, step: 1 },
  { key: 'frequencyEnd', label: 'End Frequency', minimum: 20, maximum: 4800, step: 1 },
  { key: 'modulatorFrequency', label: 'Modulator Frequency', minimum: 0, maximum: 320, step: 1 },
  { key: 'modulationDepth', label: 'Modulation Depth', minimum: 0, maximum: 900, step: 1 },
  { key: 'volume', label: 'Volume', minimum: 0, maximum: 0.5, step: 0.01 },
  { key: 'durationMs', label: 'Duration', minimum: 20, maximum: 2000, step: 5 },
  { key: 'attackMs', label: 'Attack', minimum: 0, maximum: 300, step: 1 },
  { key: 'releaseMs', label: 'Release', minimum: 0, maximum: 1800, step: 5 },
  { key: 'filterFrequency', label: 'Filter Frequency', minimum: 80, maximum: 8000, step: 10 },
];

const sustainedFields: NumericField[] = [
  { key: 'frequency', label: 'Frequency', minimum: 20, maximum: 1200, step: 1 },
  { key: 'volume', label: 'Volume', minimum: 0, maximum: 0.5, step: 0.01 },
  { key: 'attackMs', label: 'Attack', minimum: 0, maximum: 1000, step: 5 },
  { key: 'releaseMs', label: 'Release', minimum: 0, maximum: 1200, step: 5 },
  { key: 'filterFrequency', label: 'Filter Frequency', minimum: 80, maximum: 8000, step: 10 },
  { key: 'pulseFrequency', label: 'Pulse Frequency', minimum: 0, maximum: 60, step: 0.5 },
  { key: 'pulseDepth', label: 'Pulse Depth', minimum: 0, maximum: 1, step: 0.01 },
];

const sustainedNoiseFields: NumericField[] = [
  { key: 'volume', label: 'Volume', minimum: 0, maximum: 0.5, step: 0.01 },
  { key: 'attackMs', label: 'Attack', minimum: 0, maximum: 1000, step: 5 },
  { key: 'releaseMs', label: 'Release', minimum: 0, maximum: 1200, step: 5 },
  { key: 'filterFrequency', label: 'Filter Frequency', minimum: 80, maximum: 8000, step: 10 },
  { key: 'pulseFrequency', label: 'Pulse Frequency', minimum: 0, maximum: 60, step: 0.5 },
  { key: 'pulseDepth', label: 'Pulse Depth', minimum: 0, maximum: 1, step: 0.01 },
];

const fmSustainedFields: NumericField[] = [
  { key: 'frequency', label: 'Frequency', minimum: 20, maximum: 1600, step: 1 },
  { key: 'modulatorFrequency', label: 'Modulator Frequency', minimum: 0, maximum: 320, step: 1 },
  { key: 'modulationDepth', label: 'Modulation Depth', minimum: 0, maximum: 900, step: 1 },
  { key: 'volume', label: 'Volume', minimum: 0, maximum: 0.5, step: 0.01 },
  { key: 'attackMs', label: 'Attack', minimum: 0, maximum: 1000, step: 5 },
  { key: 'releaseMs', label: 'Release', minimum: 0, maximum: 1200, step: 5 },
  { key: 'filterFrequency', label: 'Filter Frequency', minimum: 80, maximum: 8000, step: 10 },
  { key: 'pulseFrequency', label: 'Pulse Frequency', minimum: 0, maximum: 60, step: 0.5 },
  { key: 'pulseDepth', label: 'Pulse Depth', minimum: 0, maximum: 1, step: 0.01 },
];

class LabAudio {
  private audioContext: AudioContext | undefined;
  private masterGain: GainNode | undefined;
  private clickBuffer: AudioBuffer | undefined;
  private noiseBuffer: AudioBuffer | undefined;
  private oneShotHandles: OneShotHandle[] = [];
  private sustainedHandles: SustainedHandle[] = [];

  setMasterVolume(volume: number): void {
    const audioContext = this.context();
    const masterGain = this.destination();
    if (audioContext === undefined || masterGain === undefined) return;

    masterGain.gain.setTargetAtTime(volume, audioContext.currentTime, 0.015);
  }

  async play(
    sound: SoundDefinition,
    masterVolume: number,
    shouldRefreshContext: boolean,
    shouldContinue: () => boolean = () => true
  ): Promise<boolean> {
    if (shouldRefreshContext) this.refreshContext();
    this.stop();
    const audioContext = await this.runningContext();
    const masterGain = this.destination();
    if (audioContext === undefined || masterGain === undefined) return false;
    if (!shouldContinue()) return false;

    masterGain.gain.setTargetAtTime(masterVolume, audioContext.currentTime, 0.015);
    if (sound.kind === 'layered') return this.playLayered(sound.draft) > 0;
    if (sound.kind === 'sustained') {
      this.sustainedHandles = this.startLayeredSustained(sound.draft);
      return this.sustainedHandles.length > 0;
    }
    return false;
  }

  stop(): void {
    const audioContext = this.audioContext;
    if (audioContext === undefined) return;

    const stopAt = audioContext.currentTime + 0.08;
    for (const handle of this.oneShotHandles) {
      handle.gain.gain.cancelScheduledValues(audioContext.currentTime);
      handle.gain.gain.setTargetAtTime(0, audioContext.currentTime, 0.02);
      try {
        handle.source.stop(stopAt);
      } catch {
        // Already stopped sounds are harmless here.
      }
    }
    this.oneShotHandles = [];

    for (const handle of this.sustainedHandles) {
      handle.gain.gain.cancelScheduledValues(audioContext.currentTime);
      handle.gain.gain.setTargetAtTime(0, audioContext.currentTime, 0.02);
      for (const source of handle.sources) {
        try {
          source.stop(stopAt);
        } catch {
          // Already stopped sounds are harmless here.
        }
      }
    }
    this.sustainedHandles = [];
  }

  private refreshContext(): void {
    const audioContext = this.audioContext;
    this.audioContext = undefined;
    this.masterGain = undefined;
    this.clickBuffer = undefined;
    this.noiseBuffer = undefined;
    this.oneShotHandles = [];
    this.sustainedHandles = [];
    if (audioContext === undefined || audioContext.state === 'closed') return;

    void audioContext.close().catch(() => {
      // Closing is best-effort; the next play has already moved to a new context.
    });
  }

  private context(): AudioContext | undefined {
    if (this.audioContext?.state === 'closed') {
      this.audioContext = undefined;
      this.masterGain = undefined;
      this.clickBuffer = undefined;
      this.noiseBuffer = undefined;
      this.oneShotHandles = [];
      this.sustainedHandles = [];
    }

    if (this.audioContext !== undefined) return this.audioContext;

    try {
      this.audioContext = new AudioContext();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = GAME_AUDIO.masterVolume;
      this.masterGain.connect(this.audioContext.destination);
      return this.audioContext;
    } catch {
      return undefined;
    }
  }

  private destination(): GainNode | undefined {
    this.context();
    return this.masterGain;
  }

  private async runningContext(): Promise<AudioContext | undefined> {
    const audioContext = this.context();
    if (audioContext === undefined) return undefined;
    if (audioContext.state === 'suspended') {
      try {
        await audioContext.resume();
      } catch {
        return undefined;
      }
    }

    return audioContext.state === 'running' ? audioContext : undefined;
  }

  private playTone(
    sound: ToneSoundConfig,
    startAt?: number,
    automation?: LayerAutomationConfig
  ): void {
    const audioContext = this.context();
    const destination = this.destination();
    if (audioContext === undefined || destination === undefined) return;

    const now = startAt ?? audioContext.currentTime;
    const duration = sound.durationMs / 1000;
    const attack = sound.attackMs / 1000;
    const releaseStart = Math.max(attack, duration - sound.releaseMs / 1000);
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = sound.type;
    this.scheduleParameter(
      oscillator.frequency,
      automation?.frequency,
      now,
      sound.durationMs,
      sound.frequencyStart,
      sound.frequencyEnd
    );
    this.scheduleEnvelope(
      gain.gain,
      automation?.gain,
      now,
      sound.durationMs,
      sound.volume,
      attack,
      releaseStart
    );
    this.connectOutput(
      audioContext,
      oscillator,
      gain,
      sound.filterFrequency,
      automation?.filterFrequency,
      now,
      sound.durationMs
    );
    gain.connect(destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.03);
    this.trackOneShot({ gain, source: oscillator });
  }

  private playNoise(
    sound: NoiseSoundConfig,
    startAt?: number,
    automation?: LayerAutomationConfig
  ): void {
    const audioContext = this.context();
    const destination = this.destination();
    if (audioContext === undefined || destination === undefined) return;

    const now = startAt ?? audioContext.currentTime;
    const duration = sound.durationMs / 1000;
    const attack = sound.attackMs / 1000;
    const releaseStart = Math.max(attack, duration - sound.releaseMs / 1000);
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    source.buffer = this.noise(audioContext);
    this.scheduleEnvelope(
      gain.gain,
      automation?.gain,
      now,
      sound.durationMs,
      sound.volume,
      attack,
      releaseStart
    );
    this.connectOutput(
      audioContext,
      source,
      gain,
      sound.filterFrequency,
      automation?.filterFrequency,
      now,
      sound.durationMs
    );
    gain.connect(destination);
    source.start(now);
    source.stop(now + duration + 0.03);
    this.trackOneShot({ gain, source });
  }

  private playClick(
    sound: NoiseSoundConfig,
    startAt?: number,
    automation?: LayerAutomationConfig
  ): void {
    const audioContext = this.context();
    const destination = this.destination();
    if (audioContext === undefined || destination === undefined) return;

    const now = startAt ?? audioContext.currentTime;
    const duration = sound.durationMs / 1000;
    const attack = sound.attackMs / 1000;
    const releaseStart = Math.max(attack, duration - sound.releaseMs / 1000);
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    source.buffer = this.click(audioContext);
    this.scheduleEnvelope(
      gain.gain,
      automation?.gain,
      now,
      sound.durationMs,
      sound.volume,
      attack,
      releaseStart
    );
    this.connectOutput(
      audioContext,
      source,
      gain,
      sound.filterFrequency,
      automation?.filterFrequency,
      now,
      sound.durationMs
    );
    gain.connect(destination);
    source.start(now);
    source.stop(now + duration + 0.03);
    this.trackOneShot({ gain, source });
  }

  private playFmTone(
    sound: FmToneSoundConfig,
    startAt?: number,
    automation?: LayerAutomationConfig
  ): void {
    const audioContext = this.context();
    const destination = this.destination();
    if (audioContext === undefined || destination === undefined) return;

    const now = startAt ?? audioContext.currentTime;
    const duration = sound.durationMs / 1000;
    const attack = sound.attackMs / 1000;
    const releaseStart = Math.max(attack, duration - sound.releaseMs / 1000);
    const carrier = audioContext.createOscillator();
    const modulator = audioContext.createOscillator();
    const modulationGain = audioContext.createGain();
    const gain = audioContext.createGain();
    carrier.type = sound.carrierType;
    this.scheduleParameter(
      carrier.frequency,
      automation?.frequency,
      now,
      sound.durationMs,
      sound.frequencyStart,
      sound.frequencyEnd
    );
    modulator.type = sound.modulatorType;
    modulator.frequency.setValueAtTime(sound.modulatorFrequency, now);
    modulationGain.gain.setValueAtTime(sound.modulationDepth, now);
    modulator.connect(modulationGain);
    modulationGain.connect(carrier.frequency);
    this.scheduleEnvelope(
      gain.gain,
      automation?.gain,
      now,
      sound.durationMs,
      sound.volume,
      attack,
      releaseStart
    );
    this.connectOutput(
      audioContext,
      carrier,
      gain,
      sound.filterFrequency,
      automation?.filterFrequency,
      now,
      sound.durationMs
    );
    gain.connect(destination);
    carrier.start(now);
    modulator.start(now);
    carrier.stop(now + duration + 0.03);
    modulator.stop(now + duration + 0.03);
    this.trackOneShot({ gain, source: carrier });
    this.trackOneShot({ gain, source: modulator });
  }

  private playLayered(sound: LayeredSoundConfig): number {
    let playedLayerCount = 0;
    const baseStart = this.context()?.currentTime ?? 0;
    for (const layer of sound.layers) {
      if (!layer.enabled) continue;
      const startAt = baseStart + Math.max(0, layer.startMs ?? 0) / 1000;

      if (layer.kind === 'tone') this.playTone(layer.sound, startAt, layer.automation);
      if (layer.kind === 'noise') this.playNoise(layer.sound, startAt, layer.automation);
      if (layer.kind === 'click') this.playClick(layer.sound, startAt, layer.automation);
      if (layer.kind === 'fmTone') this.playFmTone(layer.sound, startAt, layer.automation);
      playedLayerCount += 1;
    }
    return playedLayerCount;
  }

  private startSustained(sound: SustainedSoundConfig): SustainedHandle | undefined {
    const audioContext = this.context();
    const destination = this.destination();
    if (audioContext === undefined || destination === undefined) return undefined;

    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const filter = audioContext.createBiquadFilter();
    const gain = audioContext.createGain();
    oscillator.type = sound.type;
    oscillator.frequency.setValueAtTime(sound.frequency, now);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(sound.filterFrequency ?? 8000, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(sound.volume, now + sound.attackMs / 1000);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    oscillator.start(now);

    const sources: AudioScheduledSourceNode[] = [oscillator];
    const pulse = this.startPulse(audioContext, gain, sound);
    if (pulse !== undefined) sources.push(pulse);

    return { gain, sources };
  }

  private startSustainedNoise(
    sound: SustainedNoiseSoundConfig
  ): SustainedHandle | undefined {
    const audioContext = this.context();
    const destination = this.destination();
    if (audioContext === undefined || destination === undefined) return undefined;

    const now = audioContext.currentTime;
    const source = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    const gain = audioContext.createGain();
    source.buffer = this.noise(audioContext);
    source.loop = true;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(sound.filterFrequency, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(sound.volume, now + sound.attackMs / 1000);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    source.start(now);

    const sources: AudioScheduledSourceNode[] = [source];
    const pulse = this.startPulse(audioContext, gain, sound);
    if (pulse !== undefined) sources.push(pulse);
    return { gain, sources };
  }

  private startFmSustained(
    sound: FmSustainedSoundConfig
  ): SustainedHandle | undefined {
    const audioContext = this.context();
    const destination = this.destination();
    if (audioContext === undefined || destination === undefined) return undefined;

    const now = audioContext.currentTime;
    const carrier = audioContext.createOscillator();
    const modulator = audioContext.createOscillator();
    const modulationGain = audioContext.createGain();
    const gain = audioContext.createGain();
    carrier.type = sound.carrierType;
    carrier.frequency.setValueAtTime(sound.frequency, now);
    modulator.type = sound.modulatorType;
    modulator.frequency.setValueAtTime(sound.modulatorFrequency, now);
    modulationGain.gain.setValueAtTime(sound.modulationDepth, now);
    modulator.connect(modulationGain);
    modulationGain.connect(carrier.frequency);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(sound.volume, now + sound.attackMs / 1000);
    this.connectOutput(audioContext, carrier, gain, sound.filterFrequency);
    gain.connect(destination);
    carrier.start(now);
    modulator.start(now);

    const sources: AudioScheduledSourceNode[] = [carrier, modulator];
    const pulse = this.startPulse(audioContext, gain, sound);
    if (pulse !== undefined) sources.push(pulse);
    return { gain, sources };
  }

  private startLayeredSustained(
    sound: LayeredSustainedSoundConfig
  ): SustainedHandle[] {
    const handles: SustainedHandle[] = [];
    for (const layer of sound.layers) {
      if (!layer.enabled) continue;

      const handle =
        layer.kind === 'sustainedTone'
          ? this.startSustained(layer.sound)
          : layer.kind === 'sustainedNoise'
            ? this.startSustainedNoise(layer.sound)
            : this.startFmSustained(layer.sound);
      if (handle !== undefined) handles.push(handle);
    }
    return handles;
  }

  private startPulse(
    audioContext: AudioContext,
    gain: GainNode,
    sound: {
      pulseDepth?: number;
      pulseFrequency?: number;
      volume: number;
    }
  ): OscillatorNode | undefined {
    if (
      sound.pulseFrequency === undefined ||
      sound.pulseDepth === undefined ||
      sound.pulseDepth <= 0
    )
      return undefined;

    const pulse = audioContext.createOscillator();
    const pulseGain = audioContext.createGain();
    pulse.type = 'sine';
    pulse.frequency.value = sound.pulseFrequency;
    pulseGain.gain.value = sound.volume * sound.pulseDepth;
    pulse.connect(pulseGain);
    pulseGain.connect(gain.gain);
    pulse.start();
    return pulse;
  }

  private connectOutput(
    audioContext: AudioContext,
    source: AudioNode,
    gain: GainNode,
    filterFrequency: number | undefined,
    filterCurve?: AutomationPoint[],
    startAt = audioContext.currentTime,
    durationMs = 0
  ): void {
    if (filterFrequency === undefined) {
      source.connect(gain);
      return;
    }

    const filter = audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    this.scheduleParameter(
      filter.frequency,
      filterCurve,
      startAt,
      durationMs,
      filterFrequency,
      filterFrequency
    );
    source.connect(filter);
    filter.connect(gain);
  }

  private scheduleEnvelope(
    parameter: AudioParam,
    curve: AutomationPoint[] | undefined,
    startAt: number,
    durationMs: number,
    volume: number,
    attackSeconds: number,
    releaseStartSeconds: number
  ): void {
    const endAt = startAt + durationMs / 1000;
    parameter.setValueAtTime(0, startAt);
    if (curve !== undefined && curve.length > 0) {
      for (const point of curve) {
        const time = startAt + Math.min(durationMs, Math.max(0, point.timeMs)) / 1000;
        const value = Math.max(0, point.value * volume);
        if (time === startAt) parameter.setValueAtTime(value, time);
        else parameter.linearRampToValueAtTime(value, time);
      }
      return;
    }
    parameter.linearRampToValueAtTime(volume, startAt + attackSeconds);
    parameter.setValueAtTime(volume, startAt + releaseStartSeconds);
    parameter.linearRampToValueAtTime(0, endAt);
  }

  private scheduleParameter(
    parameter: AudioParam,
    curve: AutomationPoint[] | undefined,
    startAt: number,
    durationMs: number,
    startValue: number,
    endValue: number
  ): void {
    parameter.setValueAtTime(Math.max(0.0001, startValue), startAt);
    if (curve === undefined || curve.length === 0) {
      if (durationMs > 0) {
        parameter.linearRampToValueAtTime(
          Math.max(0.0001, endValue),
          startAt + durationMs / 1000
        );
      }
      return;
    }
    for (const point of curve) {
      const time = startAt + Math.min(durationMs, Math.max(0, point.timeMs)) / 1000;
      const value = Math.max(0.0001, point.value);
      if (time === startAt) parameter.setValueAtTime(value, time);
      else parameter.linearRampToValueAtTime(value, time);
    }
  }

  private trackOneShot(handle: OneShotHandle): void {
    this.oneShotHandles.push(handle);
    handle.source.addEventListener('ended', () => {
      handle.gain.disconnect();
      this.oneShotHandles = this.oneShotHandles.filter(
        (activeHandle) => activeHandle !== handle
      );
    });
  }

  private noise(audioContext: AudioContext): AudioBuffer {
    if (this.noiseBuffer !== undefined) return this.noiseBuffer;

    const sampleCount = audioContext.sampleRate * 2;
    this.noiseBuffer = audioContext.createBuffer(1, sampleCount, audioContext.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let index = 0; index < sampleCount; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }
    return this.noiseBuffer;
  }

  private click(audioContext: AudioContext): AudioBuffer {
    if (this.clickBuffer !== undefined) return this.clickBuffer;

    const sampleCount = Math.max(1, Math.round(audioContext.sampleRate * 0.012));
    this.clickBuffer = audioContext.createBuffer(1, sampleCount, audioContext.sampleRate);
    const data = this.clickBuffer.getChannelData(0);
    for (let index = 0; index < sampleCount; index += 1) {
      const falloff = 1 - index / sampleCount;
      data[index] = (Math.random() * 2 - 1) * falloff * falloff;
    }
    return this.clickBuffer;
  }
}

const audio = new LabAudio();
const initialSound = sounds[0];
if (initialSound === undefined) {
  throw new Error('Audio lab requires at least one sound definition.');
}
let selectedSound: SoundDefinition = initialSound;
let isPlaying = false;
let loopTimer: number | undefined;
let playbackEndTimer: number | undefined;
let playbackRequestId = 0;
let sustainedRestartTimer: number | undefined;

const soundSelect = document.getElementById('sound-select');
const soundList = document.getElementById('sound-list');
const editorTitle = document.getElementById('editor-title');
const editorSummary = document.getElementById('editor-summary');
const soundKind = document.getElementById('sound-kind');
const parameterGrid = document.getElementById('parameter-grid');
const referenceList = document.getElementById('reference-list');
const playToggleButton = document.getElementById('play-toggle-button');
const loopControl = document.getElementById('loop-control');
const loopCheckbox = document.getElementById('loop-checkbox');
const resetButton = document.getElementById('reset-button');
const copyButton = document.getElementById('copy-button');
const copyStatus = document.getElementById('copy-status');
const masterVolume = document.getElementById('master-volume');

if (
  !(soundSelect instanceof HTMLSelectElement) ||
  soundList === null ||
  editorTitle === null ||
  editorSummary === null ||
  soundKind === null ||
  parameterGrid === null ||
  referenceList === null ||
  !(playToggleButton instanceof HTMLButtonElement) ||
  !(loopControl instanceof HTMLLabelElement) ||
  !(loopCheckbox instanceof HTMLInputElement) ||
  !(resetButton instanceof HTMLButtonElement) ||
  !(copyButton instanceof HTMLButtonElement) ||
  !(copyStatus instanceof HTMLOutputElement) ||
  !(masterVolume instanceof HTMLInputElement)
) {
  throw new Error('Audio lab markup is missing required elements.');
}

masterVolume.value = `${GAME_AUDIO.masterVolume}`;

const layerDurationMs = (layer: SoundLayerConfig): number =>
  Math.max(0, layer.startMs ?? 0) + layer.sound.durationMs;

const oneShotDurationMs = (sound: LayeredDefinition): number => {
  const durations = sound.draft.layers
    .filter((layer) => layer.enabled)
    .map(layerDurationMs);
  return Math.max(90, ...durations) + 90;
};

const clearLoopTimer = (): void => {
  if (loopTimer === undefined) return;

  window.clearTimeout(loopTimer);
  loopTimer = undefined;
};

const clearPlaybackEndTimer = (): void => {
  if (playbackEndTimer === undefined) return;

  window.clearTimeout(playbackEndTimer);
  playbackEndTimer = undefined;
};

const clearSustainedRestartTimer = (): void => {
  if (sustainedRestartTimer === undefined) return;

  window.clearTimeout(sustainedRestartTimer);
  sustainedRestartTimer = undefined;
};

const updateTransportControls = (): void => {
  playToggleButton.textContent = isPlaying ? 'Stop' : 'Play';
  loopControl.hidden = selectedSound.kind === 'sustained';
};

const stopPlayback = (): void => {
  playbackRequestId += 1;
  clearLoopTimer();
  clearPlaybackEndTimer();
  clearSustainedRestartTimer();
  audio.stop();
  isPlaying = false;
  updateTransportControls();
};

const playSelectedSound = async (
  shouldRefreshContext = false
): Promise<void> => {
  const requestId = playbackRequestId + 1;
  playbackRequestId = requestId;
  const playedSound = selectedSound;
  clearLoopTimer();
  clearPlaybackEndTimer();
  const didPlay = await audio.play(
    playedSound,
    Number(masterVolume.value),
    shouldRefreshContext,
    () => playbackRequestId === requestId && selectedSound === playedSound
  );
  if (playbackRequestId !== requestId || selectedSound !== playedSound) return;

  if (!didPlay) {
    isPlaying = false;
    updateTransportControls();
    return;
  }

  isPlaying = true;
  updateTransportControls();

  if (playedSound.kind === 'sustained') return;

  const delay = oneShotDurationMs(playedSound);
  if (loopCheckbox.checked) {
    loopTimer = window.setTimeout(() => {
      if (!loopCheckbox.checked || selectedSound.kind === 'sustained') {
        isPlaying = false;
        updateTransportControls();
        return;
      }
      void playSelectedSound();
    }, delay);
    return;
  }

  playbackEndTimer = window.setTimeout(() => {
    if (selectedSound !== playedSound) return;

    isPlaying = false;
    updateTransportControls();
  }, delay);
};

const togglePlayback = (): void => {
  if (isPlaying) {
    stopPlayback();
    return;
  }

  void playSelectedSound(true);
};

const layerNumericValue = (
  layer: SoundLayerConfig,
  key: NumericField['key']
): number | undefined => {
  if (layer.kind === 'tone') {
    if (key === 'attackMs') return layer.sound.attackMs;
    if (key === 'durationMs') return layer.sound.durationMs;
    if (key === 'filterFrequency') return layer.sound.filterFrequency;
    if (key === 'frequencyEnd') return layer.sound.frequencyEnd;
    if (key === 'frequencyStart') return layer.sound.frequencyStart;
    if (key === 'releaseMs') return layer.sound.releaseMs;
    if (key === 'volume') return layer.sound.volume;
    return undefined;
  }

  if (layer.kind === 'noise' || layer.kind === 'click') {
    if (key === 'attackMs') return layer.sound.attackMs;
    if (key === 'durationMs') return layer.sound.durationMs;
    if (key === 'filterFrequency') return layer.sound.filterFrequency;
    if (key === 'releaseMs') return layer.sound.releaseMs;
    if (key === 'volume') return layer.sound.volume;
    return undefined;
  }

  if (key === 'attackMs') return layer.sound.attackMs;
  if (key === 'durationMs') return layer.sound.durationMs;
  if (key === 'filterFrequency') return layer.sound.filterFrequency;
  if (key === 'frequencyEnd') return layer.sound.frequencyEnd;
  if (key === 'frequencyStart') return layer.sound.frequencyStart;
  if (key === 'modulationDepth') return layer.sound.modulationDepth;
  if (key === 'modulatorFrequency') return layer.sound.modulatorFrequency;
  if (key === 'releaseMs') return layer.sound.releaseMs;
  if (key === 'volume') return layer.sound.volume;
  return undefined;
};

const sustainedLayerNumericValue = (
  layer: SustainedLayerConfig,
  key: NumericField['key']
): number | undefined => {
  if (key === 'attackMs') return layer.sound.attackMs;
  if (key === 'filterFrequency') return layer.sound.filterFrequency;
  if (key === 'frequency' && layer.kind !== 'sustainedNoise') {
    return layer.sound.frequency;
  }
  if (key === 'modulationDepth' && layer.kind === 'fmSustained') {
    return layer.sound.modulationDepth;
  }
  if (key === 'modulatorFrequency' && layer.kind === 'fmSustained') {
    return layer.sound.modulatorFrequency;
  }
  if (key === 'pulseDepth') return layer.sound.pulseDepth;
  if (key === 'pulseFrequency') return layer.sound.pulseFrequency;
  if (key === 'releaseMs') return layer.sound.releaseMs;
  if (key === 'volume') return layer.sound.volume;
  return undefined;
};

const setLayerNumericValue = (
  layer: SoundLayerConfig,
  key: NumericField['key'],
  value: number
): void => {
  if (layer.kind === 'tone') {
    if (key === 'attackMs') layer.sound.attackMs = value;
    if (key === 'durationMs') layer.sound.durationMs = value;
    if (key === 'filterFrequency') layer.sound.filterFrequency = value;
    if (key === 'frequencyEnd') layer.sound.frequencyEnd = value;
    if (key === 'frequencyStart') layer.sound.frequencyStart = value;
    if (key === 'releaseMs') layer.sound.releaseMs = value;
    if (key === 'volume') layer.sound.volume = value;
    return;
  }
  if (layer.kind === 'noise' || layer.kind === 'click') {
    if (key === 'attackMs') layer.sound.attackMs = value;
    if (key === 'durationMs') layer.sound.durationMs = value;
    if (key === 'filterFrequency') layer.sound.filterFrequency = value;
    if (key === 'releaseMs') layer.sound.releaseMs = value;
    if (key === 'volume') layer.sound.volume = value;
    return;
  }
  if (key === 'attackMs') layer.sound.attackMs = value;
  if (key === 'durationMs') layer.sound.durationMs = value;
  if (key === 'filterFrequency') layer.sound.filterFrequency = value;
  if (key === 'frequencyEnd') layer.sound.frequencyEnd = value;
  if (key === 'frequencyStart') layer.sound.frequencyStart = value;
  if (key === 'modulationDepth') layer.sound.modulationDepth = value;
  if (key === 'modulatorFrequency') layer.sound.modulatorFrequency = value;
  if (key === 'releaseMs') layer.sound.releaseMs = value;
  if (key === 'volume') layer.sound.volume = value;
};

const setSustainedLayerNumericValue = (
  layer: SustainedLayerConfig,
  key: NumericField['key'],
  value: number
): void => {
  if (key === 'attackMs') layer.sound.attackMs = value;
  if (key === 'filterFrequency') layer.sound.filterFrequency = value;
  if (key === 'frequency' && layer.kind !== 'sustainedNoise') {
    layer.sound.frequency = value;
  }
  if (key === 'modulationDepth' && layer.kind === 'fmSustained') {
    layer.sound.modulationDepth = value;
  }
  if (key === 'modulatorFrequency' && layer.kind === 'fmSustained') {
    layer.sound.modulatorFrequency = value;
  }
  if (key === 'pulseDepth') layer.sound.pulseDepth = value;
  if (key === 'pulseFrequency') layer.sound.pulseFrequency = value;
  if (key === 'releaseMs') layer.sound.releaseMs = value;
  if (key === 'volume') layer.sound.volume = value;
};

const syncLiveSustainedSound = (): void => {
  if (!isPlaying || selectedSound.kind !== 'sustained') return;

  clearSustainedRestartTimer();
  sustainedRestartTimer = window.setTimeout(() => {
    sustainedRestartTimer = undefined;
    if (!isPlaying || selectedSound.kind !== 'sustained') return;

    void playSelectedSound();
  }, 80);
};

const renderSoundList = (): void => {
  soundSelect.replaceChildren();
  soundList.replaceChildren();

  for (const sound of sounds) {
    const option = document.createElement('option');
    option.value = sound.id;
    option.textContent = sound.title;
    soundSelect.append(option);

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = sound.title;
    button.classList.toggle('is-active', sound.id === selectedSound.id);
    button.addEventListener('click', () => selectSound(sound.id));
    soundList.append(button);
  }
  soundSelect.value = selectedSound.id;
};

const selectSound = (id: SoundId): void => {
  const nextSound = sounds.find((sound) => sound.id === id);
  if (nextSound === undefined) return;

  stopPlayback();
  selectedSound = nextSound;
  render();
};

const render = (): void => {
  renderSoundList();
  editorTitle.textContent = selectedSound.title;
  editorSummary.textContent = selectedSound.summary;
  soundKind.textContent = selectedSound.kind;
  updateTransportControls();
  renderParameters();
  renderReference();
};

const renderParameters = (): void => {
  parameterGrid.replaceChildren();
  if (selectedSound.kind === 'layered') {
    renderLayeredParameters(selectedSound);
    return;
  }

  renderSustainedParameters(selectedSound);
};

const renderLayeredParameters = (sound: LayeredDefinition): void => {
  const toolbar = document.createElement('div');
  toolbar.className = 'layer-toolbar';
  const label = document.createElement('span');
  label.textContent = 'Layers';
  toolbar.append(label);
  const layerKinds: SoundLayerConfig['kind'][] = [
    'tone',
    'noise',
    'click',
    'fmTone',
  ];
  for (const kind of layerKinds) {
    const button = document.createElement('button');
    button.className = 'secondary-button';
    button.type = 'button';
    button.textContent = `Add ${layerKindLabel(kind)}`;
    button.addEventListener('click', () => {
      sound.draft.layers.push(createDefaultLayer(kind));
      renderParameters();
    });
    toolbar.append(button);
  }
  parameterGrid.append(toolbar);

  for (const layer of sound.draft.layers) {
    parameterGrid.append(createLayerCard(sound, layer));
  }
};

const renderSustainedParameters = (sound: SustainedDefinition): void => {
  const toolbar = document.createElement('div');
  toolbar.className = 'layer-toolbar';
  const label = document.createElement('span');
  label.textContent = 'Sustained Layers';
  toolbar.append(label);
  const layerKinds: SustainedLayerConfig['kind'][] = [
    'sustainedTone',
    'sustainedNoise',
    'fmSustained',
  ];
  for (const kind of layerKinds) {
    const button = document.createElement('button');
    button.className = 'secondary-button';
    button.type = 'button';
    button.textContent = `Add ${layerKindLabel(kind)}`;
    button.addEventListener('click', () => {
      sound.draft.layers.push(createDefaultSustainedLayer(kind));
      renderParameters();
      syncLiveSustainedSound();
    });
    toolbar.append(button);
  }
  parameterGrid.append(toolbar);

  for (const layer of sound.draft.layers) {
    parameterGrid.append(createSustainedLayerCard(sound, layer));
  }
};

const layerKindLabel = (
  kind: SoundLayerConfig['kind'] | SustainedLayerConfig['kind']
): string => {
  if (kind === 'fmTone') return 'FM';
  if (kind === 'fmSustained') return 'FM Sustained';
  if (kind === 'sustainedTone') return 'Tone';
  if (kind === 'sustainedNoise') return 'Noise';
  return kind[0]?.toUpperCase() + kind.slice(1);
};

const createDefaultLayer = (kind: SoundLayerConfig['kind']): SoundLayerConfig => {
  const id = `${kind}-${Date.now().toString(36)}`;
  if (kind === 'tone') {
    return toneLayer(id, 'New tone', {
      type: 'sine',
      frequencyStart: 520,
      frequencyEnd: 920,
      volume: 0.08,
      durationMs: 140,
      attackMs: 4,
      releaseMs: 100,
      filterFrequency: 2_400,
    });
  }
  if (kind === 'noise') {
    return noiseLayer(id, 'New noise', {
      volume: 0.035,
      durationMs: 120,
      attackMs: 2,
      releaseMs: 95,
      filterFrequency: 1_200,
    });
  }
  if (kind === 'click') {
    return clickLayer(id, 'New click', {
      volume: 0.05,
      durationMs: 42,
      attackMs: 0,
      releaseMs: 32,
      filterFrequency: 3_000,
    });
  }
  return fmToneLayer(id, 'New FM tone', {
    carrierType: 'sine',
    modulatorType: 'sine',
    frequencyStart: 640,
    frequencyEnd: 1_180,
    modulatorFrequency: 32,
    modulationDepth: 80,
    volume: 0.045,
    durationMs: 150,
    attackMs: 3,
    releaseMs: 105,
    filterFrequency: 3_200,
  });
};

const createDefaultSustainedLayer = (
  kind: SustainedLayerConfig['kind']
): SustainedLayerConfig => {
  const id = `${kind}-${Date.now().toString(36)}`;
  if (kind === 'sustainedTone') {
    return sustainedToneLayer(id, 'New tone', {
      type: 'triangle',
      frequency: 260,
      volume: 0.06,
      attackMs: 80,
      releaseMs: 140,
      filterFrequency: 1_200,
      pulseFrequency: 8,
      pulseDepth: 0.25,
    });
  }
  if (kind === 'sustainedNoise') {
    return sustainedNoiseLayer(id, 'New noise', {
      volume: 0.02,
      attackMs: 80,
      releaseMs: 140,
      filterFrequency: 1_200,
      pulseFrequency: 10,
      pulseDepth: 0.2,
    });
  }
  return fmSustainedLayer(id, 'New FM sustained', {
    carrierType: 'sine',
    modulatorType: 'sine',
    frequency: 300,
    modulatorFrequency: 18,
    modulationDepth: 40,
    volume: 0.035,
    attackMs: 90,
    releaseMs: 150,
    filterFrequency: 1_800,
    pulseFrequency: 8,
    pulseDepth: 0.2,
  });
};

const createLayerCard = (
  sound: LayeredDefinition,
  layer: SoundLayerConfig
): HTMLElement => {
  const card = document.createElement('section');
  card.className = 'layer-card';

  const header = document.createElement('div');
  header.className = 'layer-header';

  const enabledLabel = document.createElement('label');
  enabledLabel.className = 'layer-toggle';
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = layer.enabled;
  enabled.addEventListener('change', () => {
    layer.enabled = enabled.checked;
  });
  enabledLabel.append(enabled, document.createTextNode('Enabled'));

  const nameInput = document.createElement('input');
  nameInput.className = 'layer-name-input';
  nameInput.value = layer.name;
  nameInput.addEventListener('input', () => {
    layer.name = nameInput.value;
  });

  const kind = document.createElement('span');
  kind.className = 'layer-kind';
  kind.textContent = layerKindLabel(layer.kind);

  const duplicate = document.createElement('button');
  duplicate.className = 'secondary-button';
  duplicate.type = 'button';
  duplicate.textContent = 'Duplicate';
  duplicate.addEventListener('click', () => {
    sound.draft.layers.push(cloneLayer(layer));
    renderParameters();
  });

  const remove = document.createElement('button');
  remove.className = 'secondary-button';
  remove.type = 'button';
  remove.textContent = 'Remove';
  remove.addEventListener('click', () => {
    sound.draft.layers = sound.draft.layers.filter(
      (candidate) => candidate !== layer
    );
    renderParameters();
  });

  header.append(enabledLabel, nameInput, kind, duplicate, remove);
  card.append(header);

  const fields = document.createElement('div');
  fields.className = 'layer-fields';
  if (layer.kind === 'tone') fields.append(createLayerOscillatorTypeField(layer));
  if (layer.kind === 'fmTone') fields.append(createFmOscillatorTypeFields(layer));
  for (const field of layerFields(layer)) {
    const value = layerNumericValue(layer, field.key);
    if (value === undefined) continue;

    fields.append(
      createNumericField(field, value, (nextValue) => {
        setLayerNumericValue(layer, field.key, nextValue);
      })
    );
  }
  card.append(fields, createProcessorPlaceholder(layer));
  return card;
};

const createSustainedLayerCard = (
  sound: SustainedDefinition,
  layer: SustainedLayerConfig
): HTMLElement => {
  const card = document.createElement('section');
  card.className = 'layer-card';

  const header = document.createElement('div');
  header.className = 'layer-header';

  const enabledLabel = document.createElement('label');
  enabledLabel.className = 'layer-toggle';
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = layer.enabled;
  enabled.addEventListener('change', () => {
    layer.enabled = enabled.checked;
    syncLiveSustainedSound();
  });
  enabledLabel.append(enabled, document.createTextNode('Enabled'));

  const nameInput = document.createElement('input');
  nameInput.className = 'layer-name-input';
  nameInput.value = layer.name;
  nameInput.addEventListener('input', () => {
    layer.name = nameInput.value;
  });

  const kind = document.createElement('span');
  kind.className = 'layer-kind';
  kind.textContent = layerKindLabel(layer.kind);

  const duplicate = document.createElement('button');
  duplicate.className = 'secondary-button';
  duplicate.type = 'button';
  duplicate.textContent = 'Duplicate';
  duplicate.addEventListener('click', () => {
    sound.draft.layers.push(cloneSustainedLayer(layer));
    renderParameters();
    syncLiveSustainedSound();
  });

  const remove = document.createElement('button');
  remove.className = 'secondary-button';
  remove.type = 'button';
  remove.textContent = 'Remove';
  remove.addEventListener('click', () => {
    sound.draft.layers = sound.draft.layers.filter(
      (candidate) => candidate !== layer
    );
    renderParameters();
    syncLiveSustainedSound();
  });

  header.append(enabledLabel, nameInput, kind, duplicate, remove);
  card.append(header);

  const fields = document.createElement('div');
  fields.className = 'layer-fields';
  if (layer.kind === 'sustainedTone') {
    fields.append(createSustainedToneOscillatorTypeField(layer));
  }
  if (layer.kind === 'fmSustained') {
    fields.append(createFmSustainedOscillatorTypeFields(layer));
  }
  for (const field of sustainedLayerFields(layer)) {
    const value = sustainedLayerNumericValue(layer, field.key);
    if (value === undefined) continue;

    fields.append(
      createNumericField(field, value, (nextValue) => {
        setSustainedLayerNumericValue(layer, field.key, nextValue);
        syncLiveSustainedSound();
      })
    );
  }
  card.append(fields, createProcessorPlaceholder(layer));
  return card;
};

const layerFields = (layer: SoundLayerConfig): NumericField[] => {
  if (layer.kind === 'tone') return toneFields;
  if (layer.kind === 'fmTone') return fmToneFields;
  return noiseFields;
};

const sustainedLayerFields = (layer: SustainedLayerConfig): NumericField[] => {
  if (layer.kind === 'sustainedTone') return sustainedFields;
  if (layer.kind === 'sustainedNoise') return sustainedNoiseFields;
  return fmSustainedFields;
};

const createSustainedToneOscillatorTypeField = (
  layer: SustainedToneLayerConfig
): HTMLElement => {
  const row = document.createElement('div');
  row.className = 'parameter-row';

  const label = document.createElement('label');
  label.className = 'field';
  label.append(document.createElement('span'));
  label.firstElementChild?.replaceChildren('Oscillator Type');

  const select = document.createElement('select');
  for (const type of ['sine', 'triangle', 'sawtooth', 'square']) {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = type;
    select.append(option);
  }
  select.value = layer.sound.type;
  select.addEventListener('change', () => {
    if (!isOscillatorType(select.value)) return;

    layer.sound.type = select.value;
    syncLiveSustainedSound();
  });
  label.append(select);
  row.append(label, document.createElement('span'));
  return row;
};

const createFmSustainedOscillatorTypeFields = (
  layer: FmSustainedLayerConfig
): HTMLElement => {
  const group = document.createElement('div');
  group.className = 'layer-subgrid';
  group.append(
    createFmOscillatorTypeField('Carrier Type', layer.sound.carrierType, (type) => {
      layer.sound.carrierType = type;
      syncLiveSustainedSound();
    }),
    createFmOscillatorTypeField('Modulator Type', layer.sound.modulatorType, (type) => {
      layer.sound.modulatorType = type;
      syncLiveSustainedSound();
    })
  );
  return group;
};

const createLayerOscillatorTypeField = (layer: ToneLayerConfig): HTMLElement => {
  const row = document.createElement('div');
  row.className = 'parameter-row';

  const label = document.createElement('label');
  label.className = 'field';
  const labelText = document.createElement('span');
  labelText.textContent = 'Oscillator Type';

  const select = document.createElement('select');
  for (const type of ['sine', 'triangle', 'sawtooth', 'square']) {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = type;
    select.append(option);
  }
  select.value = layer.sound.type;
  select.addEventListener('change', () => {
    if (!isOscillatorType(select.value)) return;

    layer.sound.type = select.value;
  });
  label.append(labelText, select);
  row.append(label, document.createElement('span'));
  return row;
};

const createFmOscillatorTypeFields = (layer: FmToneLayerConfig): HTMLElement => {
  const group = document.createElement('div');
  group.className = 'layer-subgrid';
  group.append(
    createFmOscillatorTypeField('Carrier Type', layer.sound.carrierType, (type) => {
      layer.sound.carrierType = type;
    }),
    createFmOscillatorTypeField('Modulator Type', layer.sound.modulatorType, (type) => {
      layer.sound.modulatorType = type;
    })
  );
  return group;
};

const createFmOscillatorTypeField = (
  labelText: string,
  value: OscillatorType,
  onChange: (type: OscillatorType) => void
): HTMLElement => {
  const row = document.createElement('div');
  row.className = 'parameter-row';
  const label = document.createElement('label');
  label.className = 'field';
  const text = document.createElement('span');
  text.textContent = labelText;
  const select = document.createElement('select');
  for (const type of ['sine', 'triangle', 'sawtooth', 'square']) {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = type;
    select.append(option);
  }
  select.value = value;
  select.addEventListener('change', () => {
    if (!isOscillatorType(select.value)) return;

    onChange(select.value);
  });
  label.append(text, select);
  row.append(label, document.createElement('span'));
  return row;
};

const createProcessorPlaceholder = (
  layer: SoundLayerConfig | SustainedLayerConfig
): HTMLElement => {
  const placeholder = document.createElement('div');
  placeholder.className = 'processor-placeholder';
  placeholder.textContent =
    layer.processors.length === 0
      ? 'Processor chain reserved: filters, distortion, and delay can be added here later.'
      : `${layer.processors.length} processor slot reserved.`;
  return placeholder;
};

const createNumericField = (
  field: NumericField,
  value: number,
  onChange: (nextValue: number) => void
): HTMLElement => {
  const row = document.createElement('div');
  row.className = 'parameter-row';

  const sliderLabel = document.createElement('label');
  sliderLabel.className = 'field';
  const labelText = document.createElement('span');
  labelText.textContent = field.label;
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = `${field.minimum}`;
  slider.max = `${field.maximum}`;
  slider.step = `${field.step}`;
  slider.value = `${value}`;
  sliderLabel.append(labelText, slider);

  const valueInput = document.createElement('input');
  valueInput.className = 'value-input';
  valueInput.type = 'number';
  valueInput.min = `${field.minimum}`;
  valueInput.max = `${field.maximum}`;
  valueInput.step = `${field.step}`;
  valueInput.value = `${value}`;

  const sync = (nextValue: number): void => {
    onChange(nextValue);
    slider.value = `${nextValue}`;
    valueInput.value = `${nextValue}`;
  };

  slider.addEventListener('input', () => sync(Number(slider.value)));
  valueInput.addEventListener('input', () => sync(Number(valueInput.value)));
  row.append(sliderLabel, valueInput);
  return row;
};

const renderReference = (): void => {
  referenceList.replaceChildren();
  const keys: ReferenceKey[] =
    selectedSound.kind === 'layered'
      ? [
          'layers',
          'tone',
          'noise',
          'click',
          'fmTone',
          'processors',
          'type',
          ...toneFields.map((field) => field.key),
          'modulatorFrequency',
          'modulationDepth',
        ]
      : [
          'layers',
          'sustainedTone',
          'sustainedNoise',
          'fmSustained',
          'chargeModulation',
          'processors',
          'type',
          ...sustainedFields.map((field) => field.key),
          'modulatorFrequency',
          'modulationDepth',
        ];

  for (const key of keys) {
    const info = fieldInfo[key];
    const item = document.createElement('article');
    item.className = 'reference-item';
    const title = document.createElement('h3');
    title.textContent = info.title;
    const description = document.createElement('p');
    description.textContent = info.description;
    item.append(title, description);
    referenceList.append(item);
  }
};

const resetSelected = (): void => {
  const sound = selectedSound;
  if (sound.kind === 'layered') sound.draft = layered(sound.original.layers);
  if (sound.kind === 'sustained') {
    sound.draft = layeredSustained(sound.original.layers);
  }
  render();
};

const configValueText = (value: unknown, indent: number): string => {
  const spacing = ' '.repeat(indent);
  const childSpacing = ' '.repeat(indent + 2);
  if (typeof value === 'string') return `'${value}'`;
  if (typeof value === 'number' || typeof value === 'boolean') return `${value}`;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';

    return [
      '[',
      ...value.map((item) => `${childSpacing}${configValueText(item, indent + 2)},`),
      `${spacing}]`,
    ].join('\n');
  }
  if (typeof value === 'object' && value !== null) {
    const lines = ['{'];
    for (const [key, childValue] of Object.entries(value)) {
      lines.push(`${childSpacing}${key}: ${configValueText(childValue, indent + 2)},`);
    }
    lines.push(`${spacing}}`);
    return lines.join('\n');
  }
  return 'undefined';
};

const selectedConfigText = (): string => {
  const config = selectedSound.draft;
  return `${selectedSound.id}: ${configValueText(config, 0)},`;
};

const copySelectedConfig = async (): Promise<void> => {
  const text = selectedConfigText();
  try {
    await navigator.clipboard.writeText(text);
    copyStatus.value = 'Copied current config block.';
  } catch {
    copyStatus.value = text;
  }
};

soundSelect.addEventListener('change', () => {
  const nextId = sounds.find((sound) => sound.id === soundSelect.value)?.id;
  if (nextId !== undefined) selectSound(nextId);
});

playToggleButton.addEventListener('click', togglePlayback);
loopCheckbox.addEventListener('change', () => {
  if (!loopCheckbox.checked) clearLoopTimer();
  if (!loopCheckbox.checked && isPlaying && selectedSound.kind !== 'sustained') {
    clearPlaybackEndTimer();
    playbackEndTimer = window.setTimeout(() => {
      isPlaying = false;
      updateTransportControls();
    }, oneShotDurationMs(selectedSound));
  }
});
resetButton.addEventListener('click', resetSelected);
copyButton.addEventListener('click', () => {
  void copySelectedConfig();
});
masterVolume.addEventListener('input', () => {
  audio.setMasterVolume(Number(masterVolume.value));
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') stopPlayback();
});
window.addEventListener('pagehide', stopPlayback);

render();
