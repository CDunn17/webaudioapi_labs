import {
  GAME_MUSIC,
  MUSIC_SCALE_LIBRARY,
  MUSIC_SCALE_NAMES,
  type GameMusicConfig,
  type MusicScaleName,
} from './config/music';
import {
  VOICE_EDITOR_RESULT,
  cloneConfig,
  isVoiceEditorLoadMessage,
  isVoiceEditorRequestMessage,
  previewResult,
} from './voice/editorBridge';
import { ProceduralPreview } from './voice/preview';
import type { MelodyConfig } from './voice/types';

type MusicSection = 'score' | 'tone' | 'pulse';

type NumericField = {
  key: string;
  label: string;
  minimum: number;
  maximum: number;
  step: number;
  value: () => number;
  onChange: (value: number) => void;
};

type ReferenceItem = {
  title: string;
  body: string;
};

type ReferenceGroup = {
  section: MusicSection;
  title: string;
  summary: string;
  items: ReferenceItem[];
};

type PulseStepHandler = (stepIndex: number | undefined) => void;

type MusicExample = {
  key: string;
  label: string;
  config: GameMusicConfig;
};

const oscillatorTypes: OscillatorType[] = ['sine', 'triangle', 'sawtooth', 'square'];

const references: ReferenceGroup[] = [
  {
    section: 'score',
    title: 'Score',
    summary: 'Score controls the clock, key center, scale map, and phrase length for the whole loop.',
    items: [
      {
        title: 'Tempo',
        body: 'Sets the beat clock in BPM. Slower values feel like ambient drift; 120-135 gives a techno-style pulse.',
      },
      {
        title: 'Root Frequency',
        body: 'The base pitch everything is measured from. Lower roots feel heavy and engine-like; higher roots become more melodic.',
      },
      {
        title: 'Scale',
        body: 'Turns pulse step numbers into notes. Minor pentatonic is sturdy and sparse, dorian adds motion, and whole tone feels stranger.',
      },
      {
        title: 'Phrase Length',
        body: 'The number of pulse steps before the pattern wraps. Eight feels immediate; sixteen gives more room for a beat-grid phrase.',
      },
      {
        title: 'Rhythm Subdivision',
        body: 'How many pulse notes fire per beat. One is spacious, two is steady, and four creates sixteenth-note drive.',
      },
      {
        title: 'Fades',
        body: 'Fade in and fade out shape how the preview or game music enters and exits without changing the pattern.',
      },
    ],
  },
  {
    section: 'tone',
    title: 'Tone',
    summary: 'Tone controls the continuous drone and harmony bed that the pulse plays through.',
    items: [
      {
        title: 'Drone Type',
        body: 'The main sustained oscillator. Sine is pure, triangle is warm, sawtooth is bright, and square is buzzy.',
      },
      {
        title: 'Drone Volume',
        body: 'Sets the weight of the sustained root. Keep it low for rhythmic clarity or raise it for a heavier engine bed.',
      },
      {
        title: 'Harmony Type',
        body: 'The second sustained oscillator. Brighter shapes add edge, while sine or triangle keeps the harmony understated.',
      },
      {
        title: 'Harmony Interval',
        body: 'Measured in semitones above the root. Seven is a stable fifth, twelve is an octave, and smaller intervals add more tension.',
      },
      {
        title: 'Harmony Volume',
        body: 'Controls how present the harmony is. Small values preserve a techno bass feel; larger values make the loop more musical.',
      },
      {
        title: 'Filter Frequency',
        body: 'A lowpass brightness control. Lower values are darker and rounder; higher values open the synth and make pulses sharper.',
      },
    ],
  },
  {
    section: 'pulse',
    title: 'Pulse',
    summary: 'Pulse controls the repeating note sequence that gives the loop its rhythm and melodic motion.',
    items: [
      {
        title: 'Pulse Type',
        body: 'The oscillator used for triggered notes. Square and sawtooth feel assertive; sine and triangle are smoother.',
      },
      {
        title: 'Pulse Volume',
        body: 'Sets the level of each triggered note. Higher values cut through, especially with four subdivisions per beat.',
      },
      {
        title: 'Pulse Duration',
        body: 'Controls note length in milliseconds. Short notes are tight and percussive; longer notes smear into the drone.',
      },
      {
        title: 'Attack',
        body: 'How quickly each note reaches full volume. Zero is snappy; higher values soften the front of the pulse.',
      },
      {
        title: 'Release',
        body: 'How long each note takes to fade out. Short releases feel clipped; longer releases make the sequence flow.',
      },
      {
        title: 'Step Grid',
        body: 'Each number is a scale step, not a raw pitch. Zero is the root; repeating zeros makes a hypnotic pulse, while higher numbers add melodic jumps.',
      },
    ],
  },
];

const cloneMusicConfig = (config: GameMusicConfig): GameMusicConfig => ({
  masterVolume: config.masterVolume,
  fadeInMs: config.fadeInMs,
  fadeOutMs: config.fadeOutMs,
  baseBpm: config.baseBpm,
  baseFrequency: config.baseFrequency,
  scale: config.scale,
  phraseLength: config.phraseLength,
  rhythmSubdivision: config.rhythmSubdivision,
  intensity: config.intensity,
  droneType: config.droneType,
  harmonyType: config.harmonyType,
  harmonyInterval: config.harmonyInterval,
  baseFilterFrequency: config.baseFilterFrequency,
  droneVolume: config.droneVolume,
  harmonyVolume: config.harmonyVolume,
  pulse: {
    type: config.pulse.type,
    steps: [...config.pulse.steps],
    volume: config.pulse.volume,
    durationMs: config.pulse.durationMs,
    attackMs: config.pulse.attackMs,
    releaseMs: config.pulse.releaseMs,
  },
});

const musicExamples: MusicExample[] = [
  {
    key: 'minor-techno-pulse',
    label: '128 Minor Pulse',
    config: {
      masterVolume: 0.2,
      fadeInMs: 300,
      fadeOutMs: 500,
      baseBpm: 128,
      baseFrequency: 55,
      scale: 'minorPentatonic',
      phraseLength: 16,
      rhythmSubdivision: 4,
      intensity: 0.8,
      droneType: 'triangle',
      harmonyType: 'sawtooth',
      harmonyInterval: 7,
      baseFilterFrequency: 1600,
      droneVolume: 0.1,
      harmonyVolume: 0.04,
      pulse: {
        type: 'square',
        steps: [0, 0, 0, 0, 3, 0, 0, 0, 5, 0, 3, 0, 7, 0, 5, 3],
        volume: 0.22,
        durationMs: 110,
        attackMs: 0,
        releaseMs: 80,
      },
    },
  },
  {
    key: 'hypnotic-root-grid',
    label: 'Hypnotic Root Grid',
    config: {
      masterVolume: 0.18,
      fadeInMs: 450,
      fadeOutMs: 650,
      baseBpm: 126,
      baseFrequency: 55,
      scale: 'minorPentatonic',
      phraseLength: 16,
      rhythmSubdivision: 4,
      intensity: 0.72,
      droneType: 'triangle',
      harmonyType: 'sine',
      harmonyInterval: 7,
      baseFilterFrequency: 1180,
      droneVolume: 0.14,
      harmonyVolume: 0.03,
      pulse: {
        type: 'square',
        steps: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 3, 0, 1, 0],
        volume: 0.2,
        durationMs: 95,
        attackMs: 0,
        releaseMs: 65,
      },
    },
  },
  {
    key: 'acid-saw-push',
    label: 'Acid Saw Push',
    config: {
      masterVolume: 0.19,
      fadeInMs: 250,
      fadeOutMs: 450,
      baseBpm: 132,
      baseFrequency: 65,
      scale: 'dorian',
      phraseLength: 16,
      rhythmSubdivision: 4,
      intensity: 0.88,
      droneType: 'sine',
      harmonyType: 'square',
      harmonyInterval: 12,
      baseFilterFrequency: 2200,
      droneVolume: 0.07,
      harmonyVolume: 0.025,
      pulse: {
        type: 'sawtooth',
        steps: [0, 0, 2, 0, 5, 0, 3, 0, 7, 5, 3, 0, 9, 0, 7, 3],
        volume: 0.18,
        durationMs: 85,
        attackMs: 0,
        releaseMs: 55,
      },
    },
  },
];

const isMusicScaleName = (value: string): value is MusicScaleName =>
  MUSIC_SCALE_NAMES.some((scaleName) => scaleName === value);

const isOscillatorType = (value: string): value is OscillatorType =>
  value === 'sine' ||
  value === 'triangle' ||
  value === 'sawtooth' ||
  value === 'square';

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const roundedInt = (value: number, minimum: number, maximum: number): number =>
  Math.round(clamp(value, minimum, maximum));

const formatLimit = (value: number): string => `${value}`;

class MusicPreview {
  private audioContext: AudioContext | undefined;
  private masterGain: GainNode | undefined;
  private filter: BiquadFilterNode | undefined;
  private droneGain: GainNode | undefined;
  private harmonyGain: GainNode | undefined;
  private drone: OscillatorNode | undefined;
  private harmony: OscillatorNode | undefined;
  private timer: number | undefined;
  private pulseStepTimers: number[] = [];
  private nextPulseAt = 0;
  private pulseIndex = 0;
  private isPlaying = false;

  constructor(
    private config: GameMusicConfig,
    private readonly onPulseStep: PulseStepHandler
  ) {}

  async start(): Promise<void> {
    if (this.isPlaying) return;

    const audioContext = this.context();
    const masterGain = this.destination();
    if (audioContext === undefined || masterGain === undefined) return;

    if (audioContext.state === 'suspended') {
      try {
        await audioContext.resume();
      } catch {
        this.refreshContext();
        return;
      }
    }
    if (audioContext.state !== 'running') return;

    const now = audioContext.currentTime;
    this.isPlaying = true;
    this.nextPulseAt = now + 0.12;
    this.pulseIndex = 0;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(0, now);
    masterGain.gain.linearRampToValueAtTime(
      this.config.masterVolume,
      now + this.config.fadeInMs / 1000
    );

    this.filter = audioContext.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.setValueAtTime(this.filteredFrequency(), now);
    this.filter.connect(masterGain);

    this.droneGain = audioContext.createGain();
    this.droneGain.gain.setValueAtTime(
      this.config.droneVolume * this.intensityVolumeScale(),
      now
    );
    this.droneGain.connect(this.filter);

    this.harmonyGain = audioContext.createGain();
    this.harmonyGain.gain.setValueAtTime(
      this.config.harmonyVolume * this.intensity(),
      now
    );
    this.harmonyGain.connect(this.filter);

    this.drone = this.startOscillator(
      audioContext,
      this.config.droneType,
      this.config.baseFrequency,
      this.droneGain
    );
    this.harmony = this.startOscillator(
      audioContext,
      this.config.harmonyType,
      this.harmonyFrequency(),
      this.harmonyGain
    );

    this.timer = window.setInterval(() => this.tick(), 30);
  }

  stop(): void {
    if (!this.isPlaying) return;

    const audioContext = this.audioContext;
    const masterGain = this.masterGain;
    if (
      audioContext === undefined ||
      masterGain === undefined ||
      audioContext.state === 'closed'
    ) {
      this.clearPlaybackState();
      return;
    }

    if (this.timer !== undefined) {
      window.clearInterval(this.timer);
      this.timer = undefined;
    }

    const now = audioContext.currentTime;
    const stopAt = now + this.config.fadeOutMs / 1000;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(0, stopAt);
    this.drone?.stop(stopAt + 0.04);
    this.harmony?.stop(stopAt + 0.04);
    this.drone = undefined;
    this.harmony = undefined;
    this.filter = undefined;
    this.droneGain = undefined;
    this.harmonyGain = undefined;
    this.isPlaying = false;
    this.onPulseStep(undefined);
  }

  refreshContext(): void {
    this.clearPlaybackState();
    const audioContext = this.audioContext;
    this.audioContext = undefined;
    this.masterGain = undefined;
    if (audioContext === undefined || audioContext.state === 'closed') return;

    void audioContext.close().catch(() => {
      // Closing is best-effort; the next play creates a fresh context.
    });
  }

  updateConfig(config: GameMusicConfig): void {
    this.config = config;
    if (!this.isPlaying) return;

    const audioContext = this.audioContext;
    if (audioContext === undefined) return;

    const now = audioContext.currentTime;
    const rampEnd = now + 0.08;
    this.masterGain?.gain.linearRampToValueAtTime(this.config.masterVolume, rampEnd);
    this.filter?.frequency.linearRampToValueAtTime(this.filteredFrequency(), rampEnd);
    if (this.drone !== undefined) this.drone.type = this.config.droneType;
    if (this.harmony !== undefined) this.harmony.type = this.config.harmonyType;
    this.drone?.frequency.linearRampToValueAtTime(
      this.config.baseFrequency,
      rampEnd
    );
    this.harmony?.frequency.linearRampToValueAtTime(this.harmonyFrequency(), rampEnd);
    this.droneGain?.gain.linearRampToValueAtTime(
      this.config.droneVolume * this.intensityVolumeScale(),
      rampEnd
    );
    this.harmonyGain?.gain.linearRampToValueAtTime(
      this.config.harmonyVolume * this.intensity(),
      rampEnd
    );
  }

  playing(): boolean {
    return this.isPlaying;
  }

  private context(): AudioContext | undefined {
    if (this.audioContext?.state === 'closed') {
      this.audioContext = undefined;
      this.masterGain = undefined;
    }

    if (this.audioContext !== undefined) return this.audioContext;

    try {
      this.audioContext = new AudioContext();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = 0;
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

  private clearPlaybackState(): void {
    if (this.timer !== undefined) {
      window.clearInterval(this.timer);
      this.timer = undefined;
    }
    for (const timer of this.pulseStepTimers) window.clearTimeout(timer);
    this.pulseStepTimers = [];

    this.drone = undefined;
    this.harmony = undefined;
    this.filter = undefined;
    this.droneGain = undefined;
    this.harmonyGain = undefined;
    this.isPlaying = false;
    this.onPulseStep(undefined);
  }

  private tick(): void {
    if (!this.isPlaying) return;

    const audioContext = this.audioContext;
    if (audioContext === undefined) return;

    const pulseInterval =
      60 / this.config.baseBpm / Math.max(1, this.config.rhythmSubdivision);
    while (this.nextPulseAt <= audioContext.currentTime + 0.06) {
      this.playPulse(this.nextPulseAt);
      this.nextPulseAt += pulseInterval;
    }
  }

  private startOscillator(
    audioContext: AudioContext,
    type: OscillatorType,
    frequency: number,
    destination: AudioNode
  ): OscillatorNode {
    const oscillator = audioContext.createOscillator();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    oscillator.connect(destination);
    oscillator.start();
    return oscillator;
  }

  private playPulse(startAt: number): void {
    const audioContext = this.audioContext;
    const filter = this.filter;
    if (audioContext === undefined || filter === undefined) return;
    if (this.config.pulse.steps.length === 0) return;

    const phraseStep = this.pulseIndex % Math.max(1, this.config.phraseLength);
    const step = this.config.pulse.steps[
      phraseStep % this.config.pulse.steps.length
    ];
    if (step === undefined) return;
    this.pulseIndex += 1;
    this.schedulePulseStepHighlight(phraseStep, startAt);

    const duration = this.config.pulse.durationMs / 1000;
    const attack = this.config.pulse.attackMs / 1000;
    const releaseStart = Math.max(
      attack,
      duration - this.config.pulse.releaseMs / 1000
    );
    const pulseVolume = this.config.pulse.volume * this.intensityVolumeScale();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = this.config.pulse.type;
    oscillator.frequency.setValueAtTime(
      this.config.baseFrequency * 2 ** (this.scaleStepToSemitone(step) / 12),
      startAt
    );
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(pulseVolume, startAt + attack);
    gain.gain.setValueAtTime(pulseVolume, startAt + releaseStart);
    gain.gain.linearRampToValueAtTime(0, startAt + duration);
    oscillator.connect(gain);
    gain.connect(filter);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.03);
  }

  private schedulePulseStepHighlight(stepIndex: number, startAt: number): void {
    const audioContext = this.audioContext;
    if (audioContext === undefined) return;

    const delayMs = Math.max(0, (startAt - audioContext.currentTime) * 1000);
    const timer = window.setTimeout(() => {
      this.pulseStepTimers = this.pulseStepTimers.filter((item) => item !== timer);
      if (this.isPlaying) this.onPulseStep(stepIndex);
    }, delayMs);
    this.pulseStepTimers.push(timer);
  }

  private intensity(): number {
    return clamp(this.config.intensity, 0, 1);
  }

  private intensityVolumeScale(): number {
    return 0.35 + this.intensity() * 0.65;
  }

  private filteredFrequency(): number {
    return this.config.baseFilterFrequency * (0.72 + this.intensity() * 0.72);
  }

  private harmonyFrequency(): number {
    return this.config.baseFrequency * 2 ** (this.config.harmonyInterval / 12);
  }

  private scaleStepToSemitone(step: number): number {
    const intervals = MUSIC_SCALE_LIBRARY[this.config.scale].intervals;
    const scaleLength = intervals.length;
    const octave = Math.floor(step / scaleLength);
    const index = step - octave * scaleLength;
    const interval = intervals[index];
    if (interval === undefined) return 0;

    return interval + octave * 12;
  }
}

let draft = cloneMusicConfig(GAME_MUSIC);
let selectedSection: MusicSection = 'score';
let activePulseStep: number | undefined;
let embeddedMelodyConfig: MelodyConfig | undefined;
let embeddedMelodyOriginal: MelodyConfig | undefined;
let embeddedMelodyPlaying = false;
const preview = new MusicPreview(draft, (stepIndex) => {
  activePulseStep = stepIndex;
  updatePulseStepHighlight();
});
const embeddedPreview = new ProceduralPreview();

const sectionList = document.getElementById('section-list');
const editorTitle = document.getElementById('editor-title');
const editorSummary = document.getElementById('editor-summary');
const playbackStatus = document.getElementById('playback-status');
const parameterGrid = document.getElementById('parameter-grid');
const referenceList = document.getElementById('reference-list');
const playToggleButton = document.getElementById('play-toggle-button');
const resetButton = document.getElementById('reset-button');
const copyButton = document.getElementById('copy-button');
const copyStatus = document.getElementById('copy-status');
const exampleSelect = document.getElementById('example-select');
const masterVolume = document.getElementById('master-volume');
const intensity = document.getElementById('intensity');

if (
  sectionList === null ||
  editorTitle === null ||
  editorSummary === null ||
  playbackStatus === null ||
  parameterGrid === null ||
  referenceList === null ||
  !(playToggleButton instanceof HTMLButtonElement) ||
  !(resetButton instanceof HTMLButtonElement) ||
  !(copyButton instanceof HTMLButtonElement) ||
  !(copyStatus instanceof HTMLOutputElement) ||
  !(exampleSelect instanceof HTMLSelectElement) ||
  !(masterVolume instanceof HTMLInputElement) ||
  !(intensity instanceof HTMLInputElement)
) {
  throw new Error('Music lab markup is missing required elements.');
}

const sections: { key: MusicSection; label: string; summary: string }[] = [
  {
    key: 'score',
    label: 'Score',
    summary: 'Root, scale, tempo, phrase length, subdivision, and fades.',
  },
  {
    key: 'tone',
    label: 'Tone',
    summary: 'Continuous drone, harmony interval, filter, and layer volumes.',
  },
  {
    key: 'pulse',
    label: 'Pulse',
    summary: 'The repeating scale-degree phrase played over the drone.',
  },
];

const syncPreview = (): void => {
  preview.updateConfig(draft);
  masterVolume.value = `${draft.masterVolume}`;
  intensity.value = `${draft.intensity}`;
};

const renderExamples = (): void => {
  for (const example of musicExamples) {
    const option = document.createElement('option');
    option.value = example.key;
    option.textContent = example.label;
    exampleSelect.append(option);
  }
};

const updateTransport = (): void => {
  const playing = embeddedMelodyConfig === undefined ? preview.playing() : embeddedMelodyPlaying;
  playToggleButton.textContent = playing ? 'Stop' : 'Play';
  playbackStatus.textContent = playing ? 'Playing' : 'Stopped';
};

const updatePulseStepHighlight = (): void => {
  const stepCells = parameterGrid.querySelectorAll<HTMLElement>('.step-cell');
  for (const cell of stepCells) {
    cell.classList.toggle(
      'is-playing',
      activePulseStep !== undefined && cell.dataset.stepIndex === `${activePulseStep}`
    );
  }
};

const ensurePhraseSteps = (): void => {
  const phraseLength = Math.max(1, roundedInt(draft.phraseLength, 1, 32));
  draft.phraseLength = phraseLength;
  if (draft.pulse.steps.length === 0) draft.pulse.steps.push(0);

  while (draft.pulse.steps.length < phraseLength) {
    const sourceIndex = draft.pulse.steps.length % Math.max(1, draft.pulse.steps.length);
    draft.pulse.steps.push(draft.pulse.steps[sourceIndex] ?? 0);
  }

  if (draft.pulse.steps.length > phraseLength) {
    draft.pulse.steps = draft.pulse.steps.slice(0, phraseLength);
  }
};

const createNumericField = (field: NumericField): HTMLElement => {
  const row = document.createElement('div');
  row.className = 'parameter-row';

  const label = document.createElement('label');
  label.className = 'field';
  label.htmlFor = field.key;
  const labelText = document.createElement('span');
  labelText.textContent = field.label;
  const slider = document.createElement('input');
  slider.id = field.key;
  slider.type = 'range';
  slider.min = `${field.minimum}`;
  slider.max = `${field.maximum}`;
  slider.step = `${field.step}`;
  slider.value = `${field.value()}`;
  const rangeLimits = document.createElement('span');
  rangeLimits.className = 'range-limits';
  const minimum = document.createElement('span');
  minimum.textContent = formatLimit(field.minimum);
  const maximum = document.createElement('span');
  maximum.textContent = formatLimit(field.maximum);
  rangeLimits.append(minimum, maximum);
  label.append(labelText, slider, rangeLimits);

  const valueInput = document.createElement('input');
  valueInput.className = 'value-input';
  valueInput.type = 'number';
  valueInput.min = `${field.minimum}`;
  valueInput.max = `${field.maximum}`;
  valueInput.step = `${field.step}`;
  valueInput.value = `${field.value()}`;

  const sync = (value: number): void => {
    const nextValue = clamp(value, field.minimum, field.maximum);
    field.onChange(nextValue);
    slider.value = `${field.value()}`;
    valueInput.value = `${field.value()}`;
    syncPreview();
  };

  slider.addEventListener('input', () => sync(Number(slider.value)));
  valueInput.addEventListener('input', () => sync(Number(valueInput.value)));
  row.append(label, valueInput);
  return row;
};

const createSelectField = (
  labelText: string,
  value: string,
  options: { value: string; label: string }[],
  onChange: (value: string) => void
): HTMLElement => {
  const row = document.createElement('div');
  row.className = 'parameter-row';
  const label = document.createElement('label');
  label.className = 'field';
  const span = document.createElement('span');
  span.textContent = labelText;
  const select = document.createElement('select');

  for (const optionConfig of options) {
    const option = document.createElement('option');
    option.value = optionConfig.value;
    option.textContent = optionConfig.label;
    select.append(option);
  }

  select.value = value;
  select.addEventListener('change', () => {
    onChange(select.value);
    syncPreview();
    render();
  });
  label.append(span, select);
  row.append(label, document.createElement('span'));
  return row;
};

const oscillatorOptions = (): { value: string; label: string }[] =>
  oscillatorTypes.map((type) => ({ value: type, label: type }));

const scaleOptions = (): { value: string; label: string }[] =>
  MUSIC_SCALE_NAMES.map((scaleName) => ({
    value: scaleName,
    label: MUSIC_SCALE_LIBRARY[scaleName].label,
  }));

const scoreFields = (): HTMLElement[] => [
  createNumericField({
    key: 'base-bpm',
    label: 'Tempo',
    minimum: 36,
    maximum: 180,
    step: 1,
    value: () => draft.baseBpm,
    onChange: (value) => {
      draft.baseBpm = roundedInt(value, 36, 180);
    },
  }),
  createNumericField({
    key: 'base-frequency',
    label: 'Root Frequency',
    minimum: 32,
    maximum: 220,
    step: 1,
    value: () => draft.baseFrequency,
    onChange: (value) => {
      draft.baseFrequency = value;
    },
  }),
  createSelectField('Scale', draft.scale, scaleOptions(), (value) => {
    if (!isMusicScaleName(value)) return;

    draft.scale = value;
  }),
  createNumericField({
    key: 'phrase-length',
    label: 'Phrase Length',
    minimum: 1,
    maximum: 32,
    step: 1,
    value: () => draft.phraseLength,
    onChange: (value) => {
      draft.phraseLength = roundedInt(value, 1, 32);
      ensurePhraseSteps();
    },
  }),
  createNumericField({
    key: 'rhythm-subdivision',
    label: 'Rhythm Subdivision',
    minimum: 1,
    maximum: 4,
    step: 1,
    value: () => draft.rhythmSubdivision,
    onChange: (value) => {
      draft.rhythmSubdivision = roundedInt(value, 1, 4);
    },
  }),
  createNumericField({
    key: 'fade-in-ms',
    label: 'Fade In',
    minimum: 0,
    maximum: 4000,
    step: 50,
    value: () => draft.fadeInMs,
    onChange: (value) => {
      draft.fadeInMs = roundedInt(value, 0, 4000);
    },
  }),
  createNumericField({
    key: 'fade-out-ms',
    label: 'Fade Out',
    minimum: 0,
    maximum: 4000,
    step: 50,
    value: () => draft.fadeOutMs,
    onChange: (value) => {
      draft.fadeOutMs = roundedInt(value, 0, 4000);
    },
  }),
];

const toneFields = (): HTMLElement[] => [
  createSelectField('Drone Type', draft.droneType, oscillatorOptions(), (value) => {
    if (!isOscillatorType(value)) return;

    draft.droneType = value;
  }),
  createNumericField({
    key: 'drone-volume',
    label: 'Drone Volume',
    minimum: 0,
    maximum: 0.6,
    step: 0.01,
    value: () => draft.droneVolume,
    onChange: (value) => {
      draft.droneVolume = value;
    },
  }),
  createSelectField(
    'Harmony Type',
    draft.harmonyType,
    oscillatorOptions(),
    (value) => {
      if (!isOscillatorType(value)) return;

      draft.harmonyType = value;
    }
  ),
  createNumericField({
    key: 'harmony-interval',
    label: 'Harmony Interval',
    minimum: -12,
    maximum: 24,
    step: 1,
    value: () => draft.harmonyInterval,
    onChange: (value) => {
      draft.harmonyInterval = roundedInt(value, -12, 24);
    },
  }),
  createNumericField({
    key: 'harmony-volume',
    label: 'Harmony Volume',
    minimum: 0,
    maximum: 0.6,
    step: 0.01,
    value: () => draft.harmonyVolume,
    onChange: (value) => {
      draft.harmonyVolume = value;
    },
  }),
  createNumericField({
    key: 'filter-frequency',
    label: 'Filter Frequency',
    minimum: 80,
    maximum: 5000,
    step: 10,
    value: () => draft.baseFilterFrequency,
    onChange: (value) => {
      draft.baseFilterFrequency = value;
    },
  }),
];

const createStepGrid = (): HTMLElement => {
  ensurePhraseSteps();
  const group = document.createElement('div');
  group.className = 'step-grid';

  for (let index = 0; index < draft.phraseLength; index += 1) {
    const label = document.createElement('label');
    label.className = 'step-cell';
    label.dataset.stepIndex = `${index}`;
    label.classList.toggle('is-playing', activePulseStep === index);
    const span = document.createElement('span');
    span.textContent = `${index + 1}`;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '-14';
    input.max = '28';
    input.step = '1';
    input.value = `${draft.pulse.steps[index] ?? 0}`;
    input.addEventListener('input', () => {
      draft.pulse.steps[index] = roundedInt(Number(input.value), -14, 28);
      syncPreview();
    });
    label.append(span, input);
    group.append(label);
  }

  return group;
};

const pulseFields = (): HTMLElement[] => [
  createSelectField('Pulse Type', draft.pulse.type, oscillatorOptions(), (value) => {
    if (!isOscillatorType(value)) return;

    draft.pulse.type = value;
  }),
  createNumericField({
    key: 'pulse-volume',
    label: 'Pulse Volume',
    minimum: 0,
    maximum: 0.5,
    step: 0.01,
    value: () => draft.pulse.volume,
    onChange: (value) => {
      draft.pulse.volume = value;
    },
  }),
  createNumericField({
    key: 'pulse-duration',
    label: 'Pulse Duration',
    minimum: 20,
    maximum: 900,
    step: 10,
    value: () => draft.pulse.durationMs,
    onChange: (value) => {
      draft.pulse.durationMs = roundedInt(value, 20, 900);
    },
  }),
  createNumericField({
    key: 'pulse-attack',
    label: 'Pulse Attack',
    minimum: 0,
    maximum: 300,
    step: 5,
    value: () => draft.pulse.attackMs,
    onChange: (value) => {
      draft.pulse.attackMs = roundedInt(value, 0, 300);
    },
  }),
  createNumericField({
    key: 'pulse-release',
    label: 'Pulse Release',
    minimum: 0,
    maximum: 800,
    step: 5,
    value: () => draft.pulse.releaseMs,
    onChange: (value) => {
      draft.pulse.releaseMs = roundedInt(value, 0, 800);
    },
  }),
  createStepGrid(),
];

const sectionFields = (): HTMLElement[] => {
  if (selectedSection === 'tone') return toneFields();
  if (selectedSection === 'pulse') return pulseFields();

  return scoreFields();
};

const renderSections = (): void => {
  sectionList.replaceChildren();
  for (const section of sections) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = section.label;
    button.classList.toggle('is-active', section.key === selectedSection);
    button.addEventListener('click', () => {
      selectedSection = section.key;
      render();
    });
    sectionList.append(button);
  }
};

const renderReference = (): void => {
  referenceList.replaceChildren();
  const visibleReferences = references.filter(
    (group) => group.section === selectedSection
  );

  for (const group of visibleReferences.length > 0 ? visibleReferences : references) {
    const groupElement = document.createElement('section');
    groupElement.className = 'reference-group';
    groupElement.dataset.section = group.section;

    const title = document.createElement('h3');
    title.textContent = group.title;
    const summary = document.createElement('p');
    summary.className = 'reference-summary';
    summary.textContent = group.summary;
    groupElement.append(title, summary);

    for (const item of group.items) {
      const element = document.createElement('article');
      element.className = 'reference-item';
      const itemTitle = document.createElement('h4');
      itemTitle.textContent = item.title;
      const body = document.createElement('p');
      body.textContent = item.body;
      element.append(itemTitle, body);
      groupElement.append(element);
    }

    referenceList.append(groupElement);
  }
};

const melodyNumberField = (
  labelText: string,
  value: number,
  minimum: number,
  maximum: number,
  step: number,
  onChange: (value: number) => void
): HTMLLabelElement => {
  const label = document.createElement('label');
  const text = document.createElement('span');
  const input = document.createElement('input');
  text.textContent = labelText;
  input.type = 'number';
  input.min = `${minimum}`;
  input.max = `${maximum}`;
  input.step = `${step}`;
  input.value = `${value}`;
  input.addEventListener('input', () => {
    const parsed = Number(input.value);
    if (!Number.isFinite(parsed)) return;
    onChange(clamp(parsed, minimum, maximum));
  });
  label.append(text, input);
  return label;
};

const renderMelodyEditor = (): void => {
  const config = embeddedMelodyConfig;
  if (config === undefined) return;
  editorTitle.textContent = 'Generated melody';
  editorSummary.textContent = 'Edit the detected note timeline and synth tone.';
  masterVolume.value = `${config.masterVolume}`;
  intensity.closest('label')?.setAttribute('hidden', '');
  exampleSelect.closest('label')?.setAttribute('hidden', '');

  const sectionButton = document.createElement('button');
  sectionButton.type = 'button';
  sectionButton.textContent = 'Generated melody';
  sectionButton.className = 'is-active';
  sectionList.replaceChildren(sectionButton);

  const globals = document.createElement('section');
  globals.className = 'voice-config-card';
  const globalHeading = document.createElement('div');
  globalHeading.className = 'voice-config-toolbar';
  const globalTitle = document.createElement('h3');
  globalTitle.textContent = 'Melody synth';
  const addNote = document.createElement('button');
  addNote.className = 'secondary-button';
  addNote.type = 'button';
  addNote.textContent = 'Add note';
  addNote.addEventListener('click', () => {
    const lastNote = config.notes[config.notes.length - 1];
    const startMs = lastNote === undefined ? 0 : lastNote.startMs + lastNote.durationMs;
    config.notes.push({
      durationMs: 300,
      midi: lastNote?.midi ?? 60,
      startMs,
      velocity: lastNote?.velocity ?? 0.7,
    });
    config.durationMs = Math.max(config.durationMs, startMs + 300);
    render();
  });
  globalHeading.append(globalTitle, addNote);
  const globalFields = document.createElement('div');
  globalFields.className = 'voice-config-fields';
  const oscillatorLabel = document.createElement('label');
  const oscillatorText = document.createElement('span');
  const oscillator = document.createElement('select');
  oscillatorText.textContent = 'Oscillator';
  for (const value of oscillatorTypes) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    oscillator.append(option);
  }
  oscillator.value = config.oscillatorType;
  oscillator.addEventListener('change', () => {
    if (isOscillatorType(oscillator.value)) config.oscillatorType = oscillator.value;
  });
  oscillatorLabel.append(oscillatorText, oscillator);
  globalFields.append(
    oscillatorLabel,
    melodyNumberField('Filter (Hz)', config.filterFrequency, 20, 20_000, 10, (value) => {
      config.filterFrequency = value;
    }),
    melodyNumberField('Duration (ms)', config.durationMs, 20, 120_000, 10, (value) => {
      config.durationMs = value;
    })
  );
  globals.append(globalHeading, globalFields);

  const notes = document.createElement('div');
  notes.className = 'voice-config-grid';
  config.notes.forEach((note, index) => {
    const card = document.createElement('section');
    card.className = 'voice-config-card';
    const heading = document.createElement('div');
    heading.className = 'voice-config-card-header';
    const title = document.createElement('h3');
    title.textContent = `Note ${index + 1}`;
    const remove = document.createElement('button');
    remove.className = 'secondary-button';
    remove.type = 'button';
    remove.textContent = 'Remove note';
    remove.addEventListener('click', () => {
      config.notes.splice(index, 1);
      render();
    });
    heading.append(title, remove);
    const fields = document.createElement('div');
    fields.className = 'voice-config-fields';
    fields.append(
      melodyNumberField('MIDI note', note.midi, 0, 127, 1, (value) => {
        note.midi = Math.round(value);
      }),
      melodyNumberField('Start (ms)', note.startMs, 0, 120_000, 1, (value) => {
        note.startMs = value;
      }),
      melodyNumberField('Duration (ms)', note.durationMs, 20, 30_000, 1, (value) => {
        note.durationMs = value;
      }),
      melodyNumberField('Velocity', note.velocity, 0.01, 1, 0.01, (value) => {
        note.velocity = value;
      }),
      melodyNumberField(
        'Note filter (Hz)',
        note.filterFrequency ?? config.filterFrequency,
        20,
        20_000,
        10,
        (value) => {
          note.filterFrequency = value;
        }
      )
    );
    card.append(heading, fields);
    notes.append(card);
  });
  parameterGrid.replaceChildren(globals, notes);

  const reference = document.createElement('article');
  reference.className = 'reference-item';
  const referenceTitle = document.createElement('h3');
  const referenceBody = document.createElement('p');
  referenceTitle.textContent = 'Melody result';
  referenceBody.textContent = 'MIDI controls pitch; start and duration preserve the detected performance timeline. Existing gain and pitch-bend curves remain attached to each note.';
  reference.append(referenceTitle, referenceBody);
  referenceList.replaceChildren(reference);
};

const render = (): void => {
  if (embeddedMelodyConfig !== undefined) {
    renderMelodyEditor();
    updateTransport();
    return;
  }
  const section = sections.find((item) => item.key === selectedSection);
  editorTitle.textContent = section?.label ?? 'Score';
  editorSummary.textContent = section?.summary ?? '';
  masterVolume.value = `${draft.masterVolume}`;
  intensity.value = `${draft.intensity}`;
  parameterGrid.replaceChildren(...sectionFields());
  renderSections();
  renderReference();
  updateTransport();
};

const copyConfig = async (): Promise<void> => {
  const configText = embeddedMelodyConfig === undefined
    ? `export const GAME_MUSIC: GameMusicConfig = ${JSON.stringify(draft, null, 2)};`
    : `export const GENERATED_MELODY = ${JSON.stringify(embeddedMelodyConfig, null, 2)};`;

  try {
    await navigator.clipboard.writeText(configText);
    copyStatus.value = embeddedMelodyConfig === undefined
      ? 'Copied GAME_MUSIC config.'
      : 'Copied generated melody config.';
  } catch {
    copyStatus.value = configText;
  }
};

masterVolume.addEventListener('input', () => {
  if (embeddedMelodyConfig !== undefined) {
    embeddedMelodyConfig.masterVolume = Number(masterVolume.value);
    return;
  }
  draft.masterVolume = Number(masterVolume.value);
  syncPreview();
});

intensity.addEventListener('input', () => {
  draft.intensity = Number(intensity.value);
  syncPreview();
});

playToggleButton.addEventListener('click', () => {
  if (embeddedMelodyConfig !== undefined) {
    if (embeddedMelodyPlaying) {
      embeddedPreview.stop();
      embeddedMelodyPlaying = false;
      updateTransport();
      return;
    }
    embeddedMelodyPlaying = true;
    updateTransport();
    void embeddedPreview.play(
      previewResult('melody', embeddedMelodyConfig),
      () => undefined,
      () => {
        embeddedMelodyPlaying = false;
        updateTransport();
      }
    ).catch((error: unknown) => {
      embeddedMelodyPlaying = false;
      updateTransport();
      copyStatus.value = error instanceof Error ? error.message : String(error);
    });
    return;
  }
  if (preview.playing()) {
    preview.stop();
    updateTransport();
    return;
  }

  void preview.start().then(updateTransport);
});

resetButton.addEventListener('click', () => {
  if (embeddedMelodyConfig !== undefined && embeddedMelodyOriginal !== undefined) {
    embeddedPreview.stop();
    embeddedMelodyPlaying = false;
    embeddedMelodyConfig = cloneConfig(embeddedMelodyOriginal);
    render();
    return;
  }
  preview.stop();
  draft = cloneMusicConfig(GAME_MUSIC);
  exampleSelect.value = '';
  syncPreview();
  render();
});

copyButton.addEventListener('click', () => {
  void copyConfig();
});

exampleSelect.addEventListener('change', () => {
  const selectedExample = musicExamples.find(
    (example) => example.key === exampleSelect.value
  );
  if (selectedExample === undefined) return;

  draft = cloneMusicConfig(selectedExample.config);
  ensurePhraseSteps();
  selectedSection = 'score';
  copyStatus.value = `Loaded ${selectedExample.label}.`;
  syncPreview();
  render();
});

window.addEventListener('beforeunload', () => {
  preview.stop();
  embeddedPreview.stop();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    preview.stop();
    embeddedPreview.stop();
    embeddedMelodyPlaying = false;
    updateTransport();
  }
});
window.addEventListener('pagehide', () => {
  preview.refreshContext();
  embeddedPreview.close();
  updateTransport();
});

const loadEmbeddedMelody = (config: MelodyConfig): void => {
  preview.stop();
  embeddedPreview.stop();
  embeddedMelodyPlaying = false;
  embeddedMelodyConfig = cloneConfig(config);
  embeddedMelodyOriginal = cloneConfig(config);
  document.body.classList.add('embedded-lab');
  const appTitle = document.querySelector('.app-header h1');
  const appSummary = document.querySelector('.app-header p');
  if (appTitle !== null) appTitle.textContent = 'Music Lab';
  if (appSummary !== null) appSummary.textContent = 'Editing a generated Voice Lab melody.';
  render();
};

window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin || event.source !== window.parent) return;
  if (isVoiceEditorLoadMessage(event.data)) {
    if (event.data.mode === 'melody' && 'notes' in event.data.config) {
      loadEmbeddedMelody(event.data.config as MelodyConfig);
    }
    return;
  }
  if (
    !isVoiceEditorRequestMessage(event.data) ||
    embeddedMelodyConfig === undefined
  ) return;

  const contentDurationMs = embeddedMelodyConfig.notes.reduce(
    (duration, note) => Math.max(duration, note.startMs + note.durationMs),
    0
  );
  embeddedMelodyConfig.durationMs = Math.max(
    embeddedMelodyConfig.durationMs,
    contentDurationMs
  );
  window.parent.postMessage({
    config: cloneConfig(embeddedMelodyConfig),
    mode: 'melody',
    requestId: event.data.requestId,
    type: VOICE_EDITOR_RESULT,
  }, window.location.origin);
});

renderExamples();
syncPreview();
render();
