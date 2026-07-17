import type {
  AutomationPoint,
  LayerAutomationConfig,
  SoundLayerConfig,
} from '../config/audio';
import type {
  BeatConfig,
  BeatVoice,
  MelodyConfig,
  ProceduralResult,
} from './types';

const midiToFrequency = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

export class ProceduralPreview {
  private audioContext: AudioContext | undefined;
  private completionTimer: number | undefined;
  private master: GainNode | undefined;
  private sources: AudioScheduledSourceNode[] = [];

  async play(result: ProceduralResult, onComplete: () => void): Promise<void> {
    this.stop();
    const context = this.context();
    if (context.state === 'suspended') await context.resume();
    const startAt = context.currentTime + 0.06;
    this.master = context.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(context.destination);

    let durationMs: number;
    if (result.mode === 'effect') {
      durationMs = this.playEffect(result.config.layers, startAt);
    } else if (result.mode === 'beat') {
      durationMs = this.playBeat(result.config, startAt);
    } else {
      durationMs = this.playMelody(result.config, startAt);
    }
    this.completionTimer = window.setTimeout(() => {
      this.clear(false);
      onComplete();
    }, durationMs + 180);
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
    this.completionTimer = undefined;
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

  private playEffect(layers: SoundLayerConfig[], startAt: number): number {
    let durationMs = 0;
    for (const layer of layers) {
      if (!layer.enabled) continue;
      const layerOffsetMs = Math.max(0, layer.startMs ?? 0);
      const layerStartAt = startAt + layerOffsetMs / 1000;
      durationMs = Math.max(durationMs, layerOffsetMs + layer.sound.durationMs);
      if (layer.kind === 'tone') {
        const oscillator = this.context().createOscillator();
        oscillator.type = layer.sound.type;
        this.scheduleParameter(
          oscillator.frequency,
          layer.automation?.frequency,
          layerStartAt,
          layer.sound.durationMs,
          layer.sound.frequencyStart,
          layer.sound.frequencyEnd
        );
        this.connectEnvelope(
          oscillator,
          layer.sound.volume,
          layer.sound.attackMs,
          layer.sound.releaseMs,
          layer.sound.durationMs,
          layer.sound.filterFrequency,
          layerStartAt,
          layer.automation
        );
      } else if (layer.kind === 'fmTone') {
        const context = this.context();
        const carrier = context.createOscillator();
        const modulator = context.createOscillator();
        const modulationGain = context.createGain();
        carrier.type = layer.sound.carrierType;
        modulator.type = layer.sound.modulatorType;
        this.scheduleParameter(
          carrier.frequency,
          layer.automation?.frequency,
          layerStartAt,
          layer.sound.durationMs,
          layer.sound.frequencyStart,
          layer.sound.frequencyEnd
        );
        modulator.frequency.value = layer.sound.modulatorFrequency;
        modulationGain.gain.value = layer.sound.modulationDepth;
        modulator.connect(modulationGain);
        modulationGain.connect(carrier.frequency);
        this.connectEnvelope(
          carrier,
          layer.sound.volume,
          layer.sound.attackMs,
          layer.sound.releaseMs,
          layer.sound.durationMs,
          layer.sound.filterFrequency,
          layerStartAt,
          layer.automation
        );
        modulator.start(layerStartAt);
        modulator.stop(layerStartAt + layer.sound.durationMs / 1000 + 0.04);
        this.sources.push(modulator);
      } else {
        const source = this.context().createBufferSource();
        source.buffer = this.noiseBuffer(layer.sound.durationMs, layer.kind === 'click');
        this.connectEnvelope(
          source,
          layer.sound.volume,
          layer.sound.attackMs,
          layer.sound.releaseMs,
          layer.sound.durationMs,
          layer.sound.filterFrequency,
          layerStartAt,
          layer.automation,
          layer.kind === 'click' ? 'highpass' : 'lowpass'
        );
      }
    }
    return Math.max(120, durationMs);
  }

  private connectEnvelope(
    source: AudioScheduledSourceNode,
    volume: number,
    attackMs: number,
    releaseMs: number,
    durationMs: number,
    filterFrequency: number | undefined,
    startAt: number,
    automation: LayerAutomationConfig | undefined,
    filterType: BiquadFilterType = 'lowpass'
  ): void {
    const context = this.context();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    const duration = durationMs / 1000;
    const attackEnd = startAt + Math.min(duration, attackMs / 1000);
    const releaseStart = startAt + Math.max(attackMs / 1000, duration - releaseMs / 1000);
    if (automation?.gain !== undefined && automation.gain.length > 0) {
      gain.gain.setValueAtTime(0, startAt);
      for (const point of automation.gain) {
        const pointTime = startAt + Math.min(duration, Math.max(0, point.timeMs / 1000));
        gain.gain.linearRampToValueAtTime(Math.max(0, point.value * volume), pointTime);
      }
    } else {
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(volume, attackEnd);
      gain.gain.setValueAtTime(volume, releaseStart);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    }
    filter.type = filterType;
    this.scheduleParameter(
      filter.frequency,
      automation?.filterFrequency,
      startAt,
      durationMs,
      filterFrequency ?? 12_000,
      filterFrequency ?? 12_000
    );
    source.connect(filter);
    filter.connect(gain);
    if (this.master !== undefined) gain.connect(this.master);
    source.start(startAt);
    source.stop(startAt + duration + 0.04);
    this.sources.push(source);
  }

  private scheduleParameter(
    parameter: AudioParam,
    curve: AutomationPoint[] | undefined,
    startAt: number,
    durationMs: number,
    startValue: number,
    endValue: number
  ): void {
    if (curve === undefined || curve.length === 0) {
      parameter.setValueAtTime(Math.max(0.0001, startValue), startAt);
      parameter.linearRampToValueAtTime(
        Math.max(0.0001, endValue),
        startAt + durationMs / 1000
      );
      return;
    }
    parameter.setValueAtTime(Math.max(0.0001, startValue), startAt);
    for (const point of curve) {
      const time = startAt + Math.min(durationMs, Math.max(0, point.timeMs)) / 1000;
      if (time === startAt) {
        parameter.setValueAtTime(Math.max(0.0001, point.value), time);
      } else {
        parameter.linearRampToValueAtTime(Math.max(0.0001, point.value), time);
      }
    }
  }

  private playBeat(config: BeatConfig, startAt: number): number {
    const stepMs = 60_000 / config.bpm / config.stepsPerBeat;
    if (this.master !== undefined) this.master.gain.value = config.masterVolume;
    for (const lane of config.lanes) {
      lane.steps.forEach((velocity, step) => {
        if (velocity <= 0) return;
        this.playBeatVoice(lane.voice, startAt + (step * stepMs) / 1000, velocity);
      });
    }
    return config.stepCount * stepMs;
  }

  private playBeatVoice(voice: BeatVoice, startAt: number, velocity: number): void {
    const context = this.context();
    const duration = voice.decayMs / 1000;
    if (voice.kind === 'kick') {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(Math.max(90, voice.frequency * 2.6), startAt);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(38, voice.frequency), startAt + duration);
      gain.gain.setValueAtTime(voice.volume * velocity, startAt);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
      oscillator.connect(gain);
      if (this.master !== undefined) gain.connect(this.master);
      oscillator.start(startAt);
      oscillator.stop(startAt + duration + 0.03);
      this.sources.push(oscillator);
    }
    if (voice.kind !== 'kick' || voice.noiseAmount > 0.15) {
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
      const noteStart = startAt + note.startMs / 1000;
      const noteEnd = noteStart + note.durationMs / 1000;
      oscillator.type = config.oscillatorType;
      oscillator.frequency.value = midiToFrequency(note.midi);
      filter.type = 'lowpass';
      filter.frequency.value = config.filterFrequency;
      gain.gain.setValueAtTime(0, noteStart);
      gain.gain.linearRampToValueAtTime(0.45 * note.velocity, noteStart + 0.012);
      gain.gain.setValueAtTime(0.45 * note.velocity, Math.max(noteStart + 0.012, noteEnd - 0.06));
      gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
      oscillator.connect(filter);
      filter.connect(gain);
      if (this.master !== undefined) gain.connect(this.master);
      oscillator.start(noteStart);
      oscillator.stop(noteEnd + 0.03);
      this.sources.push(oscillator);
      durationMs = Math.max(durationMs, note.startMs + note.durationMs);
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
