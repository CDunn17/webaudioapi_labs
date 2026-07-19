import type {
  BeatConfig,
  BeatVoice,
  MelodyConfig,
  ProceduralResult,
} from './types';
import type { AutomationPoint } from '../config/audio';
import { clamp } from './dsp';
import { renderEffectLayers } from './effectRenderer';

const midiToFrequency = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

const automationPoints = (
  curve: AutomationPoint[] | undefined,
  durationMs: number,
  minimumValue: number,
  maximumValue: number
): AutomationPoint[] => {
  if (!Array.isArray(curve)) return [];
  const points = curve
    .filter((point) => Number.isFinite(point.timeMs) && Number.isFinite(point.value))
    .map((point) => ({
      timeMs: Math.max(0, Math.min(durationMs, point.timeMs)),
      value: Math.max(minimumValue, Math.min(maximumValue, point.value)),
    }))
    .sort((first, second) => first.timeMs - second.timeMs);
  const unique: AutomationPoint[] = [];
  for (const point of points) {
    const previous = unique[unique.length - 1];
    if (previous?.timeMs === point.timeMs) previous.value = point.value;
    else unique.push(point);
  }
  return unique;
};

export class ProceduralPreview {
  private audioContext: AudioContext | undefined;
  private completionTimer: number | undefined;
  private master: GainNode | undefined;
  private mediaDestination: MediaStreamAudioDestinationNode | undefined;
  private progressFrame: number | undefined;
  private sources: AudioScheduledSourceNode[] = [];

  constructor(private readonly mediaElement?: HTMLAudioElement) {}

  async play(
    result: ProceduralResult,
    onProgress: (elapsedMs: number) => void,
    onComplete: () => void,
    onScheduled?: (leadMs: number) => void
  ): Promise<void> {
    this.clear(true);
    let context = this.context();
    const mediaPlayback = this.mediaElement?.play();
    if (context.state !== 'running') await context.resume();
    if (context.state !== 'running') {
      await context.close().catch(() => undefined);
      this.audioContext = undefined;
      context = this.context();
      await context.resume();
    }
    if (context.state !== 'running') {
      throw new Error(`Audio output could not start (${context.state}).`);
    }
    await mediaPlayback;
    const schedulingComplexity = result.mode === 'effect'
      ? result.config.layers.length
      : result.mode === 'beat'
        ? result.config.lanes.reduce(
            (count, lane) => count + lane.hits.length * (lane.voice.noiseAmount >= 0.08 ? 2 : 1),
            0
          )
        : result.config.notes.length;
    // Graph construction is synchronous. Reserve proportionally more future
    // time for dense patterns so no source starts before the original overlay
    // receives the shared scheduled start.
    const schedulingLeadMs = Math.min(800, 60 + schedulingComplexity * 2);
    const startAt = context.currentTime + schedulingLeadMs / 1000;
    this.master = context.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.mediaDestination ?? context.destination);

    let durationMs: number;
    if (result.mode === 'effect') {
      if (this.master === undefined) return;
      const rendered = renderEffectLayers(
        context,
        this.master,
        result.config.layers,
        startAt
      );
      this.sources.push(...rendered.sources);
      durationMs = rendered.durationMs;
    } else if (result.mode === 'beat') {
      durationMs = this.playBeat(result.config, startAt);
    } else {
      durationMs = this.playMelody(result.config, startAt);
    }
    const remainingLeadMs = Math.max(0, (startAt - context.currentTime) * 1000);
    onScheduled?.(remainingLeadMs);
    const updateProgress = (): void => {
      onProgress(Math.max(0, (context.currentTime - startAt) * 1000));
      this.progressFrame = window.requestAnimationFrame(updateProgress);
    };
    updateProgress();
    const safeDurationMs = Number.isFinite(durationMs) ? Math.max(120, durationMs) : 1_000;
    this.completionTimer = window.setTimeout(() => {
      this.clear(false);
      onComplete();
    }, safeDurationMs + remainingLeadMs);
  }

  stop(): void {
    this.clear(true);
    this.mediaElement?.pause();
  }

  close(): void {
    this.stop();
    const context = this.audioContext;
    this.audioContext = undefined;
    this.mediaDestination = undefined;
    if (this.mediaElement !== undefined) this.mediaElement.srcObject = null;
    if (context !== undefined && context.state !== 'closed') {
      void context.close().catch(() => undefined);
    }
  }

  private context(): AudioContext {
    if (this.audioContext === undefined || this.audioContext.state === 'closed') {
      this.audioContext = new AudioContext();
      if (this.mediaElement !== undefined) {
        this.mediaDestination = this.audioContext.createMediaStreamDestination();
        this.mediaElement.srcObject = this.mediaDestination.stream;
      }
    }
    return this.audioContext;
  }

  private clear(stopSources: boolean): void {
    if (this.completionTimer !== undefined) window.clearTimeout(this.completionTimer);
    if (this.progressFrame !== undefined) window.cancelAnimationFrame(this.progressFrame);
    this.completionTimer = undefined;
    this.progressFrame = undefined;
    if (stopSources) {
      for (const source of this.sources) {
        try {
          source.stop();
        } catch {
          // A source that already ended needs no further cleanup.
        }
      }
    }
    this.sources = [];
    this.master?.disconnect();
    this.master = undefined;
  }

  private playBeat(config: BeatConfig, startAt: number): number {
    if (this.master !== undefined) this.master.gain.value = config.masterVolume;
    for (const lane of config.lanes) {
      for (const hit of lane.hits) {
        const durationMs = typeof hit.durationMs === 'number' && Number.isFinite(hit.durationMs)
          ? Math.max(1, hit.durationMs)
          : lane.voice.decayMs;
        this.playBeatVoice(
          lane.voice,
          startAt + hit.startMs / 1000,
          hit.velocity,
          durationMs
        );
      }
    }
    return config.durationMs;
  }

  private playBeatVoice(
    voice: BeatVoice,
    startAt: number,
    velocity: number,
    durationMs: number
  ): void {
    const context = this.context();
    const duration = durationMs / 1000;
    const endAt = startAt + duration;
    const oscillator = context.createOscillator();
    const toneGain = context.createGain();
    oscillator.type = voice.kind === 'kick' ? 'sine' : 'triangle';
    oscillator.frequency.value = voice.frequency;
    const toneLevel = voice.volume * velocity * clamp(1 - voice.noiseAmount * 0.75, 0.12, 1);
    toneGain.gain.setValueAtTime(toneLevel, startAt);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, endAt);
    toneGain.gain.setValueAtTime(0, endAt);
    oscillator.connect(toneGain);
    if (this.master !== undefined) toneGain.connect(this.master);
    oscillator.start(startAt);
    oscillator.stop(endAt);
    this.sources.push(oscillator);
    if (voice.noiseAmount >= 0.08) {
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      source.buffer = this.noiseBuffer(durationMs, false);
      filter.type = voice.kind === 'hat' ? 'highpass' : 'bandpass';
      filter.frequency.value = voice.kind === 'hat' ? Math.max(3_500, voice.frequency * 3) : Math.max(700, voice.frequency * 2);
      filter.Q.value = voice.kind === 'hat' ? 0.7 : 1.2;
      gain.gain.setValueAtTime(voice.volume * velocity * voice.noiseAmount, startAt);
      gain.gain.exponentialRampToValueAtTime(0.0001, endAt);
      gain.gain.setValueAtTime(0, endAt);
      source.connect(filter);
      filter.connect(gain);
      if (this.master !== undefined) gain.connect(this.master);
      source.start(startAt);
      source.stop(endAt);
      this.sources.push(source);
    }
  }

  private playMelody(config: MelodyConfig, startAt: number): number {
    if (this.master !== undefined) this.master.gain.value = config.masterVolume;
    let contentDurationMs = 0;
    for (const note of config.notes) {
      const context = this.context();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const filter = context.createBiquadFilter();
      const startMs = Number.isFinite(note.startMs) ? Math.max(0, note.startMs) : 0;
      const noteDurationMs = Number.isFinite(note.durationMs)
        ? Math.max(20, note.durationMs)
        : 100;
      const velocity = Number.isFinite(note.velocity)
        ? Math.max(0.01, Math.min(1, note.velocity))
        : 0.7;
      const noteStart = Math.max(context.currentTime, startAt + startMs / 1000);
      const noteEnd = noteStart + noteDurationMs / 1000;
      oscillator.type = config.oscillatorType;
      oscillator.frequency.value = midiToFrequency(note.midi);
      const pitchBendCurve = automationPoints(
        note.pitchBendCurve,
        noteDurationMs,
        -4_800,
        4_800
      );
      oscillator.detune.setValueAtTime(0, noteStart);
      for (const point of pitchBendCurve) {
        const pointAt = noteStart + point.timeMs / 1000;
        if (point.timeMs === 0) oscillator.detune.setValueAtTime(point.value, pointAt);
        else oscillator.detune.linearRampToValueAtTime(point.value, pointAt);
      }
      filter.type = 'lowpass';
      const filterFrequency = typeof note.filterFrequency === 'number'
        && Number.isFinite(note.filterFrequency)
        ? note.filterFrequency
        : config.filterFrequency;
      filter.frequency.setValueAtTime(
        Math.max(20, Math.min(context.sampleRate / 2, filterFrequency)),
        noteStart
      );
      const gainCurve = automationPoints(note.gainCurve, noteDurationMs, 0, 1);
      const peakGain = 0.45 * velocity;
      gain.gain.setValueAtTime(0, noteStart);
      if (gainCurve.length > 0) {
        for (const point of gainCurve) {
          const pointAt = noteStart + point.timeMs / 1000;
          const value = peakGain * point.value;
          if (point.timeMs === 0) gain.gain.setValueAtTime(value, pointAt);
          else gain.gain.linearRampToValueAtTime(value, pointAt);
        }
        gain.gain.setValueAtTime(0, noteEnd);
      } else {
        const attackEnd = Math.min(noteEnd, noteStart + 0.012);
        const releaseStart = Math.max(attackEnd, noteEnd - 0.06);
        gain.gain.linearRampToValueAtTime(peakGain, attackEnd);
        gain.gain.setValueAtTime(peakGain, releaseStart);
        gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
        gain.gain.setValueAtTime(0, noteEnd);
      }
      oscillator.connect(filter);
      filter.connect(gain);
      if (this.master !== undefined) gain.connect(this.master);
      oscillator.start(noteStart);
      oscillator.stop(noteEnd + 0.03);
      this.sources.push(oscillator);
      contentDurationMs = Math.max(contentDurationMs, startMs + noteDurationMs);
    }
    const configuredDurationMs = Number.isFinite(config.durationMs)
      ? Math.max(0, config.durationMs)
      : undefined;
    return configuredDurationMs === undefined
      ? Math.max(300, contentDurationMs)
      : Math.max(configuredDurationMs, contentDurationMs);
  }

  private noiseBuffer(durationMs: number, click: boolean): AudioBuffer {
    const context = this.context();
    const length = Math.max(1, Math.ceil(context.sampleRate * (durationMs / 1000 + 0.05)));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      const envelope = click ? Math.exp((-index / context.sampleRate) * 95) : 1;
      data[index] = (Math.random() * 2 - 1) * envelope;
    }
    return buffer;
  }
}
