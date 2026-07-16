import {
  GAME_MUSIC,
  MUSIC_SCALE_LIBRARY,
  MUSIC_SCALE_NAMES,
  type GameMusicConfig,
  type MusicScaleName,
} from './config/music';

type PitchSample = {
  frequency: number | undefined;
  level: number;
  timeMs: number;
};

type NoteEvent = {
  durationMs: number;
  frequency: number;
  startMs: number;
};

type AnalysisResult = {
  bpm: number;
  confidence: number;
  config: GameMusicConfig;
  noteEvents: NoteEvent[];
  rootName: string;
  scale: MusicScaleName;
};

type PulseStepHandler = (stepIndex: number | undefined) => void;

const MAX_CAPTURE_MS = 8000;
const MIN_VOICED_SAMPLES = 8;
const NOTE_CHANGE_SEMITONES = 0.85;
const NOTE_GAP_MS = 180;
const NOTE_MIN_DURATION_MS = 90;
const NOTE_MIN_SAMPLES = 2;
const oscillatorTypes: OscillatorType[] = ['sine', 'triangle', 'sawtooth', 'square'];
const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

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

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const roundedInt = (value: number, minimum: number, maximum: number): number =>
  Math.round(clamp(value, minimum, maximum));

const median = (values: number[]): number => {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((first, second) => first - second);
  const midpoint = Math.floor(sorted.length / 2);
  const middleValue = sorted[midpoint] ?? 0;
  if (sorted.length % 2 === 1) return middleValue;

  return ((sorted[midpoint - 1] ?? middleValue) + middleValue) / 2;
};

const frequencyToMidi = (frequency: number): number =>
  69 + 12 * Math.log2(frequency / 440);

const midiToFrequency = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

const nearestScaleSemitone = (
  semitone: number,
  scale: MusicScaleName
): { error: number; semitone: number } => {
  const intervals = MUSIC_SCALE_LIBRARY[scale].intervals;
  let bestSemitone = 0;
  let bestError = Number.POSITIVE_INFINITY;

  for (let octave = -3; octave <= 5; octave += 1) {
    for (const interval of intervals) {
      const candidate = interval + octave * 12;
      const error = Math.abs(semitone - candidate);
      if (error < bestError) {
        bestError = error;
        bestSemitone = candidate;
      }
    }
  }

  return { error: bestError, semitone: bestSemitone };
};

const semitoneToScaleStep = (semitone: number, scale: MusicScaleName): number => {
  const intervals = MUSIC_SCALE_LIBRARY[scale].intervals;
  const nearest = nearestScaleSemitone(semitone, scale).semitone;
  const octave = Math.floor(nearest / 12);
  const interval = nearest - octave * 12;
  const index = intervals.findIndex((value) => value === interval);
  const safeIndex = index >= 0 ? index : 0;

  return octave * intervals.length + safeIndex;
};

const scaleStepToSemitone = (step: number, scale: MusicScaleName): number => {
  const intervals = MUSIC_SCALE_LIBRARY[scale].intervals;
  const scaleLength = intervals.length;
  const octave = Math.floor(step / scaleLength);
  const index = step - octave * scaleLength;

  return (intervals[index] ?? 0) + octave * 12;
};

const estimateRms = (buffer: Float32Array): number => {
  let sum = 0;
  for (const sample of buffer) sum += sample * sample;

  return Math.sqrt(sum / buffer.length);
};

const detectPitch = (
  buffer: Float32Array,
  sampleRate: number
): { frequency: number | undefined; level: number } => {
  const level = estimateRms(buffer);
  if (level < 0.012) return { frequency: undefined, level };

  const minimumLag = Math.floor(sampleRate / 720);
  const maximumLag = Math.floor(sampleRate / 70);
  let bestCorrelation = 0;
  let bestLag = 0;

  for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
    let cross = 0;
    let firstEnergy = 0;
    let secondEnergy = 0;
    const comparisonLength = buffer.length - lag;

    for (let index = 0; index < comparisonLength; index += 1) {
      const first = buffer[index] ?? 0;
      const second = buffer[index + lag] ?? 0;
      cross += first * second;
      firstEnergy += first * first;
      secondEnergy += second * second;
    }

    const denominator = Math.sqrt(firstEnergy * secondEnergy);
    if (denominator === 0) continue;

    const correlation = cross / denominator;
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  if (bestCorrelation < 0.5 || bestLag === 0) {
    return { frequency: undefined, level };
  }

  return { frequency: sampleRate / bestLag, level };
};

const pitchDistance = (firstFrequency: number, secondFrequency: number): number =>
  Math.abs(12 * Math.log2(firstFrequency / secondFrequency));

const createNoteEvents = (samples: PitchSample[]): NoteEvent[] => {
  const voiced = samples.filter(
    (sample): sample is PitchSample & { frequency: number } =>
      sample.frequency !== undefined
  );
  const events: NoteEvent[] = [];
  let group: (PitchSample & { frequency: number })[] = [];

  const flushGroup = (): void => {
    if (group.length < NOTE_MIN_SAMPLES) {
      group = [];
      return;
    }

    const first = group[0];
    const last = group[group.length - 1];
    if (first === undefined || last === undefined) {
      group = [];
      return;
    }

    const durationMs = Math.max(NOTE_MIN_DURATION_MS, last.timeMs - first.timeMs);
    const frequency = median(group.map((sample) => sample.frequency));
    events.push({
      durationMs,
      frequency,
      startMs: first.timeMs,
    });
    group = [];
  };

  for (const sample of voiced) {
    const previous = group[group.length - 1];
    if (
      previous !== undefined &&
      (sample.timeMs - previous.timeMs > NOTE_GAP_MS ||
        pitchDistance(sample.frequency, median(group.map((item) => item.frequency))) >
          NOTE_CHANGE_SEMITONES)
    ) {
      flushGroup();
    }

    group.push(sample);
  }

  flushGroup();

  return events.slice(0, 32);
};

const chooseRhythm = (noteEvents: NoteEvent[]): { bpm: number; subdivision: number } => {
  const deltas = noteEvents
    .slice(1)
    .map((event, index) => event.startMs - (noteEvents[index]?.startMs ?? event.startMs))
    .filter((delta) => delta > 80);
  const fallbackStepMs = median(noteEvents.map((event) => event.durationMs)) || 320;
  const stepMs = median(deltas) || fallbackStepMs;
  let best = { bpm: 120, subdivision: 2, score: Number.POSITIVE_INFINITY };

  for (let subdivision = 1; subdivision <= 4; subdivision += 1) {
    const bpm = 60000 / (stepMs * subdivision);
    const clampedBpm = clamp(bpm, 36, 180);
    const rangePenalty = bpm < 72 || bpm > 150 ? 28 : 0;
    const score = Math.abs(clampedBpm - 116) + rangePenalty;
    if (score < best.score) {
      best = {
        bpm: roundedInt(clampedBpm, 36, 180),
        subdivision,
        score,
      };
    }
  }

  return { bpm: best.bpm, subdivision: best.subdivision };
};

const chooseRootAndScale = (
  noteEvents: NoteEvent[]
): { rootClass: number; rootMidi: number; scale: MusicScaleName; confidence: number } => {
  const midiValues = noteEvents.map((event) => frequencyToMidi(event.frequency));
  let best = {
    error: Number.POSITIVE_INFINITY,
    rootClass: 0,
    scale: 'minorPentatonic' as MusicScaleName,
  };

  for (let rootClass = 0; rootClass < 12; rootClass += 1) {
    for (const scale of MUSIC_SCALE_NAMES) {
      const errors = midiValues.map((midi) => {
        const relativeSemitone = Math.round(midi) - rootClass;
        return nearestScaleSemitone(relativeSemitone, scale).error;
      });
      const error = errors.reduce((sum, value) => sum + value * value, 0) / errors.length;
      if (error < best.error) {
        best = { error, rootClass, scale };
      }
    }
  }

  const lowMidi = Math.min(...midiValues);
  let rootMidi = best.rootClass + 12 * Math.floor((lowMidi - best.rootClass) / 12);
  while (midiToFrequency(rootMidi) < 32) rootMidi += 12;
  while (midiToFrequency(rootMidi) > 220) rootMidi -= 12;

  return {
    confidence: clamp(1 - best.error / 2.4, 0, 1),
    rootClass: best.rootClass,
    rootMidi,
    scale: best.scale,
  };
};

const buildAnalysis = (samples: PitchSample[]): AnalysisResult | undefined => {
  const voicedSamples = samples.filter((sample) => sample.frequency !== undefined);
  if (voicedSamples.length < MIN_VOICED_SAMPLES) return undefined;

  const noteEvents = createNoteEvents(samples);
  if (noteEvents.length < 2) return undefined;

  const rootAndScale = chooseRootAndScale(noteEvents);
  const rhythm = chooseRhythm(noteEvents);
  const steps = noteEvents.map((event) => {
    const semitone = Math.round(frequencyToMidi(event.frequency) - rootAndScale.rootMidi);
    return roundedInt(semitoneToScaleStep(semitone, rootAndScale.scale), -14, 28);
  });
  const averageDuration = median(noteEvents.map((event) => event.durationMs));
  const finalSteps = steps.length > 0 ? steps : [0, 0, 0, 0];
  const config = cloneMusicConfig(GAME_MUSIC);

  config.baseBpm = rhythm.bpm;
  config.baseFrequency = roundedInt(midiToFrequency(rootAndScale.rootMidi), 32, 220);
  config.scale = rootAndScale.scale;
  config.phraseLength = roundedInt(finalSteps.length, 2, 32);
  config.rhythmSubdivision = rhythm.subdivision;
  config.masterVolume = 0.2;
  config.intensity = 0.74;
  config.droneType = 'triangle';
  config.harmonyType = 'sine';
  config.harmonyInterval = 7;
  config.baseFilterFrequency = 1800;
  config.droneVolume = 0.08;
  config.harmonyVolume = rootAndScale.confidence > 0.62 ? 0.035 : 0;
  config.pulse = {
    type: choosePulseType(rootAndScale.confidence, finalSteps),
    steps: finalSteps,
    volume: 0.22,
    durationMs: roundedInt(averageDuration * 0.7, 70, 420),
    attackMs: 8,
    releaseMs: roundedInt(averageDuration * 0.28, 45, 260),
  };

  return {
    bpm: rhythm.bpm,
    confidence: rootAndScale.confidence,
    config,
    noteEvents,
    rootName: noteNames[rootAndScale.rootClass] ?? 'C',
    scale: rootAndScale.scale,
  };
};

const choosePulseType = (
  confidence: number,
  steps: number[]
): OscillatorType => {
  const range = Math.max(...steps) - Math.min(...steps);
  if (confidence > 0.72 && range > 5) return 'sawtooth';
  if (range <= 2) return 'triangle';

  return oscillatorTypes.includes('square') ? 'square' : 'triangle';
};

class MusicPreview {
  private audioContext: AudioContext | undefined;
  private filter: BiquadFilterNode | undefined;
  private harmony: OscillatorNode | undefined;
  private harmonyGain: GainNode | undefined;
  private isPlaying = false;
  private masterGain: GainNode | undefined;
  private nextPulseAt = 0;
  private pulseIndex = 0;
  private pulseStepTimers: number[] = [];
  private timer: number | undefined;

  constructor(
    private config: GameMusicConfig,
    private readonly onPulseStep: PulseStepHandler
  ) {}

  async start(): Promise<void> {
    if (this.isPlaying) return;

    const audioContext = this.context();
    if (audioContext === undefined || this.masterGain === undefined) return;

    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    const now = audioContext.currentTime;
    this.filter = audioContext.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.setValueAtTime(this.filteredFrequency(), now);
    this.filter.connect(this.masterGain);

    this.harmonyGain = audioContext.createGain();
    this.harmonyGain.gain.setValueAtTime(
      this.config.harmonyVolume * this.intensity(),
      now
    );
    this.harmonyGain.connect(this.filter);

    this.harmony = this.startOscillator(
      audioContext,
      this.config.harmonyType,
      this.config.baseFrequency * 2 ** (this.config.harmonyInterval / 12),
      this.harmonyGain
    );

    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(0, now);
    this.masterGain.gain.linearRampToValueAtTime(
      this.config.masterVolume,
      now + this.config.fadeInMs / 1000
    );
    this.isPlaying = true;
    this.nextPulseAt = now + 0.1;
    this.pulseIndex = 0;
    this.timer = window.setInterval(() => this.tick(), 30);
  }

  stop(): void {
    if (!this.isPlaying) return;

    const audioContext = this.audioContext;
    const masterGain = this.masterGain;
    if (audioContext === undefined || masterGain === undefined) {
      this.clearPlaybackState();
      return;
    }

    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;

    const now = audioContext.currentTime;
    const stopAt = now + this.config.fadeOutMs / 1000;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(0, stopAt);
    this.harmony?.stop(stopAt + 0.04);
    this.clearPlaybackState();
  }

  updateConfig(config: GameMusicConfig): void {
    this.config = config;
  }

  playing(): boolean {
    return this.isPlaying;
  }

  refreshContext(): void {
    this.clearPlaybackState();
    const audioContext = this.audioContext;
    this.audioContext = undefined;
    this.masterGain = undefined;
    if (audioContext === undefined || audioContext.state === 'closed') return;

    void audioContext.close().catch(() => undefined);
  }

  private clearPlaybackState(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    for (const timer of this.pulseStepTimers) window.clearTimeout(timer);
    this.timer = undefined;
    this.pulseStepTimers = [];
    this.filter = undefined;
    this.harmony = undefined;
    this.harmonyGain = undefined;
    this.isPlaying = false;
    this.onPulseStep(undefined);
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

  private playPulse(startAt: number): void {
    const audioContext = this.audioContext;
    const filter = this.filter;
    if (audioContext === undefined || filter === undefined) return;

    const phraseStep = this.pulseIndex % Math.max(1, this.config.phraseLength);
    const step = this.config.pulse.steps[
      phraseStep % Math.max(1, this.config.pulse.steps.length)
    ];
    if (step === undefined) return;

    this.pulseIndex += 1;
    this.schedulePulseStepHighlight(phraseStep, startAt);

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const duration = this.config.pulse.durationMs / 1000;
    const attack = this.config.pulse.attackMs / 1000;
    const releaseStart = Math.max(
      attack,
      duration - this.config.pulse.releaseMs / 1000
    );
    const volume = this.config.pulse.volume * (0.35 + this.intensity() * 0.65);
    oscillator.type = this.config.pulse.type;
    oscillator.frequency.setValueAtTime(
      this.config.baseFrequency *
        2 ** (scaleStepToSemitone(step, this.config.scale) / 12),
      startAt
    );
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(volume, startAt + attack);
    gain.gain.setValueAtTime(volume, startAt + releaseStart);
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

  private intensity(): number {
    return clamp(this.config.intensity, 0, 1);
  }

  private filteredFrequency(): number {
    return this.config.baseFilterFrequency * (0.72 + this.intensity() * 0.72);
  }
}

let activePulseStep: number | undefined;
let analysisResult: AnalysisResult | undefined;
let analyser: AnalyserNode | undefined;
let captureStartedAt = 0;
let captureTimer: number | undefined;
let mediaStream: MediaStream | undefined;
let microphoneContext: AudioContext | undefined;
let microphoneSource: MediaStreamAudioSourceNode | undefined;
let pitchSamples: PitchSample[] = [];

const recordButton = document.getElementById('record-button');
const retakeButton = document.getElementById('retake-button');
const playButton = document.getElementById('play-button');
const copyButton = document.getElementById('copy-button');
const captureStatus = document.getElementById('capture-status');
const playbackStatus = document.getElementById('playback-status');
const pitchValue = document.getElementById('pitch-value');
const sampleCount = document.getElementById('sample-count');
const captureTime = document.getElementById('capture-time');
const levelFill = document.getElementById('level-fill');
const pitchTrace = document.getElementById('pitch-trace');
const analysisGrid = document.getElementById('analysis-grid');
const configPreview = document.getElementById('config-preview');
const copyStatus = document.getElementById('copy-status');

if (
  !(recordButton instanceof HTMLButtonElement) ||
  !(retakeButton instanceof HTMLButtonElement) ||
  !(playButton instanceof HTMLButtonElement) ||
  !(copyButton instanceof HTMLButtonElement) ||
  captureStatus === null ||
  playbackStatus === null ||
  pitchValue === null ||
  sampleCount === null ||
  captureTime === null ||
  levelFill === null ||
  pitchTrace === null ||
  analysisGrid === null ||
  configPreview === null ||
  !(copyStatus instanceof HTMLOutputElement)
) {
  throw new Error('Humdinger markup is missing required elements.');
}

const preview = new MusicPreview(cloneMusicConfig(GAME_MUSIC), (stepIndex) => {
  activePulseStep = stepIndex;
  renderAnalysis();
});

const setCaptureStatus = (status: string): void => {
  captureStatus.textContent = status;
};

const renderTransport = (): void => {
  playButton.textContent = preview.playing() ? 'Stop Config' : 'Play Config';
  playbackStatus.textContent = preview.playing() ? 'Playing' : 'Stopped';
};

const formatConfig = (config: GameMusicConfig): string =>
  `export const GAME_MUSIC: GameMusicConfig = ${JSON.stringify(config, null, 2)};`;

const renderPitchTrace = (): void => {
  pitchTrace.replaceChildren();
  const samples = pitchSamples.slice(-96);
  for (const sample of samples) {
    const bar = document.createElement('span');
    const frequency = sample.frequency ?? 70;
    const normalizedPitch = clamp((frequencyToMidi(frequency) - 36) / 36, 0, 1);
    bar.style.height = `${Math.max(8, normalizedPitch * 100)}%`;
    bar.style.opacity = sample.frequency === undefined ? '0.26' : '1';
    pitchTrace.append(bar);
  }
};

const addAnalysisItem = (label: string, value: string): void => {
  const item = document.createElement('div');
  const labelElement = document.createElement('span');
  const valueElement = document.createElement('strong');
  labelElement.textContent = label;
  valueElement.textContent = value;
  item.append(labelElement, valueElement);
  analysisGrid.append(item);
};

const renderAnalysis = (): void => {
  analysisGrid.replaceChildren();

  if (analysisResult === undefined) {
    addAnalysisItem('Status', 'Waiting for hum');
    addAnalysisItem('Best Take', `${pitchSamples.length} samples`);
    configPreview.textContent = '';
    return;
  }

  const config = analysisResult.config;
  addAnalysisItem('Root', `${analysisResult.rootName} / ${config.baseFrequency} Hz`);
  addAnalysisItem('Scale', MUSIC_SCALE_LIBRARY[analysisResult.scale].label);
  addAnalysisItem('Tempo', `${analysisResult.bpm} BPM`);
  addAnalysisItem('Phrase', `${config.phraseLength} steps`);
  addAnalysisItem('Subdivision', `${config.rhythmSubdivision} per beat`);
  addAnalysisItem(
    'Fit',
    `${Math.round(analysisResult.confidence * 100)}%`
  );
  addAnalysisItem('Notes', `${analysisResult.noteEvents.length}`);

  const steps = document.createElement('div');
  steps.className = 'hum-step-strip';
  for (let index = 0; index < config.pulse.steps.length; index += 1) {
    const step = document.createElement('span');
    step.classList.toggle('is-playing', activePulseStep === index);
    step.textContent = `${config.pulse.steps[index] ?? 0}`;
    steps.append(step);
  }
  analysisGrid.append(steps);
  configPreview.textContent = formatConfig(config);
};

const refreshCaptureReadout = (sample: PitchSample | undefined): void => {
  if (sample !== undefined && sample.frequency !== undefined) {
    pitchValue.textContent = `${Math.round(sample.frequency)} Hz`;
  } else if (sample !== undefined) {
    pitchValue.textContent = '--';
  }

  const voicedCount = pitchSamples.filter((item) => item.frequency !== undefined).length;
  sampleCount.textContent = `${voicedCount}`;
  captureTime.textContent = `${((sample?.timeMs ?? 0) / 1000).toFixed(1)}s`;
  levelFill.style.width = `${clamp((sample?.level ?? 0) * 700, 0, 100)}%`;
  renderPitchTrace();
};

const stopMicrophone = (): void => {
  if (captureTimer !== undefined) window.clearInterval(captureTimer);
  captureTimer = undefined;
  microphoneSource?.disconnect();
  microphoneSource = undefined;
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = undefined;
  const context = microphoneContext;
  microphoneContext = undefined;
  analyser = undefined;
  if (context !== undefined && context.state !== 'closed') {
    void context.close().catch(() => undefined);
  }
};

const finishCapture = (): void => {
  stopMicrophone();
  recordButton.textContent = 'Record Hum';
  const result = buildAnalysis(pitchSamples);
  analysisResult = result;
  if (result === undefined) {
    setCaptureStatus('Try Again');
    copyStatus.value = 'Humdinger needs a clearer, longer monophonic hum.';
  } else {
    preview.stop();
    preview.updateConfig(result.config);
    setCaptureStatus('Analyzed');
    copyStatus.value = 'Generated a Music Lab config from your hum.';
  }
  renderAnalysis();
  renderTransport();
};

const sampleMicrophone = (): void => {
  if (analyser === undefined || microphoneContext === undefined) return;

  const data = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);
  const pitch = detectPitch(data, microphoneContext.sampleRate);
  const elapsedMs = performance.now() - captureStartedAt;
  const sample: PitchSample = {
    frequency: pitch.frequency,
    level: pitch.level,
    timeMs: elapsedMs,
  };
  pitchSamples.push(sample);
  refreshCaptureReadout(sample);

  if (elapsedMs >= MAX_CAPTURE_MS) finishCapture();
};

const startCapture = async (): Promise<void> => {
  if (!navigator.mediaDevices?.getUserMedia) {
    setCaptureStatus('Unavailable');
    copyStatus.value = 'This browser does not expose microphone capture.';
    return;
  }

  try {
    preview.stop();
    renderTransport();
    pitchSamples = [];
    analysisResult = undefined;
    activePulseStep = undefined;
    renderAnalysis();
    copyStatus.value = '';
    setCaptureStatus('Listening');
    recordButton.textContent = 'Stop Recording';

    microphoneContext = new AudioContext();
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    microphoneSource = microphoneContext.createMediaStreamSource(mediaStream);
    analyser = microphoneContext.createAnalyser();
    analyser.fftSize = 2048;
    microphoneSource.connect(analyser);
    captureStartedAt = performance.now();
    captureTimer = window.setInterval(sampleMicrophone, 70);
  } catch {
    stopMicrophone();
    recordButton.textContent = 'Record Hum';
    setCaptureStatus('Blocked');
    copyStatus.value = 'Microphone permission was not available.';
  }
};

recordButton.addEventListener('click', () => {
  if (captureTimer !== undefined) {
    finishCapture();
    return;
  }

  void startCapture();
});

retakeButton.addEventListener('click', () => {
  preview.stop();
  stopMicrophone();
  pitchSamples = [];
  analysisResult = undefined;
  activePulseStep = undefined;
  pitchValue.textContent = '--';
  sampleCount.textContent = '0';
  captureTime.textContent = '0.0s';
  levelFill.style.width = '0%';
  recordButton.textContent = 'Record Hum';
  copyStatus.value = '';
  setCaptureStatus('Ready');
  renderPitchTrace();
  renderAnalysis();
  renderTransport();
});

playButton.addEventListener('click', () => {
  if (preview.playing()) {
    preview.stop();
    renderTransport();
    return;
  }

  if (analysisResult === undefined) {
    copyStatus.value = 'Record a hum before previewing a config.';
    return;
  }

  void preview.start().then(renderTransport);
});

copyButton.addEventListener('click', () => {
  if (analysisResult === undefined) {
    copyStatus.value = 'Record a hum before copying a config.';
    return;
  }

  const configText = formatConfig(analysisResult.config);
  void navigator.clipboard
    .writeText(configText)
    .then(() => {
      copyStatus.value = 'Copied Humdinger config.';
    })
    .catch(() => {
      copyStatus.value = configText;
    });
});

window.addEventListener('beforeunload', () => {
  preview.stop();
  stopMicrophone();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    preview.stop();
    stopMicrophone();
    renderTransport();
  }
});

window.addEventListener('pagehide', () => {
  preview.refreshContext();
  stopMicrophone();
});

renderPitchTrace();
renderAnalysis();
renderTransport();
