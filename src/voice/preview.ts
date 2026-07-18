import type {
  BeatConfig,
  BeatVoice,
  MelodyConfig,
  ProceduralResult,
} from './types';
import { renderEffectLayers } from './effectRenderer';

const midiToFrequency = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

export class ProceduralPreview {
  private audioContext: AudioContext | undefined;
  private completionTimer: number | undefined;
  private master: GainNode | undefined;
  private progressFrame: number | undefined;
  private sources: AudioScheduledSourceNode[] = [];

  async play(
    result: ProceduralResult,
    onProgress: (elapsedMs: number) => void,
    onComplete: () => void
  ): Promise<void> {
    this.stop();
    let context = this.context();
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
    const startAt = context.currentTime + 0.06;
    this.master = context.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(context.destination);

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
    const updateProgress = (): void => {
      onProgress(Math.max(0, (context.currentTime - startAt) * 1000));
      this.progressFrame = window.requestAnimationFrame(updateProgress);
    };
    updateProgress();
    const safeDurationMs = Number.isFinite(durationMs) ? Math.max(120, durationMs) : 1_000;
    this.completionTimer = window.setTimeout(() => {
      this.clear(false);
      onComplete();
    }, safeDurationMs + 100);
  }

  stop(): void {
    this.clear(true);
  }

  close(): void {
    this.stop();
    const context = this.audioContext;
    this.audioContext = undefined;
    if (context !== undefined && context.state !== 'closed') {
      void context.close().catch(() => undefined);
    }
  }

  private context(): AudioContext {
    if (this.audioContext === undefined || this.audioContext.state === 'closed') {
      this.audioContext = new AudioContext();
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
        this.playBeatVoice(lane.voice, startAt + hit.startMs / 1000, hit.velocity);
      }
    }
    return config.durationMs;
  }

  private playBeatVoice(voice: BeatVoice, startAt: number, velocity: number): void {
    const context = this.context();
    const duration = voice.decayMs / 1000;
    const oscillator = context.createOscillator();
    const toneGain = context.createGain();
    oscillator.type = voice.kind === 'kick' ? 'sine' : 'triangle';
    oscillator.frequency.value = voice.frequency;
    toneGain.gain.setValueAtTime(voice.volume * velocity, startAt);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(toneGain);
    if (this.master !== undefined) toneGain.connect(this.master);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.03);
    this.sources.push(oscillator);
    if (voice.noiseAmount > 0.08) {
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      source.buffer = this.noiseBuffer(voice.decayMs, false);
      filter.type = voice.kind === 'hat' ? 'highpass' : 'bandpass';
      filter.frequency.value = voice.kind === 'hat' ? Math.max(3_500, voice.frequency * 3) : Math.max(700, voice.frequency * 2);
      filter.Q.value = voice.kind === 'hat' ? 0.7 : 1.2;
      gain.gain.setValueAtTime(voice.volume * velocity * Math.max(0.25, voice.noiseAmount), startAt);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
      source.connect(filter);
      filter.connect(gain);
      if (this.master !== undefined) gain.connect(this.master);
      source.start(startAt);
      source.stop(startAt + duration + 0.03);
      this.sources.push(source);
    }
  }

  private playMelody(config: MelodyConfig, startAt: number): number {
    if (this.master !== undefined) this.master.gain.value = config.masterVolume;
    let durationMs = 0;
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
        ? Math.max(0.05, Math.min(1, note.velocity))
        : 0.7;
      const noteStart = Math.max(context.currentTime, startAt + startMs / 1000);
      const noteEnd = noteStart + noteDurationMs / 1000;
      oscillator.type = config.oscillatorType;
      oscillator.frequency.value = midiToFrequency(note.midi);
      filter.type = 'lowpass';
      filter.frequency.value = config.filterFrequency;
      gain.gain.setValueAtTime(0, noteStart);
      gain.gain.linearRampToValueAtTime(0.45 * velocity, noteStart + 0.012);
      gain.gain.setValueAtTime(0.45 * velocity, Math.max(noteStart + 0.012, noteEnd - 0.06));
      gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
      oscillator.connect(filter);
      filter.connect(gain);
      if (this.master !== undefined) gain.connect(this.master);
      oscillator.start(noteStart);
      oscillator.stop(noteEnd + 0.03);
      this.sources.push(oscillator);
      durationMs = Math.max(durationMs, startMs + noteDurationMs);
    }
    return Math.max(300, durationMs);
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
