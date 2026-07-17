import type {
  AutomationPoint,
  LayerAutomationConfig,
  SoundLayerConfig,
} from '../config/audio';

export type EffectRenderHandle = {
  durationMs: number;
  sources: AudioScheduledSourceNode[];
};

const seededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const noiseBuffer = (
  context: BaseAudioContext,
  durationMs: number,
  random: () => number,
  click = false
): AudioBuffer => {
  const length = Math.max(1, Math.ceil(context.sampleRate * (durationMs / 1000 + 0.02)));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) {
    const envelope = click ? Math.exp((-index / context.sampleRate) * 110) : 1;
    data[index] = (random() * 2 - 1) * envelope;
  }
  return buffer;
};

const scheduleParameter = (
  parameter: AudioParam,
  curve: AutomationPoint[] | undefined,
  startAt: number,
  durationMs: number,
  startValue: number,
  endValue: number
): void => {
  parameter.setValueAtTime(Math.max(0.0001, startValue), startAt);
  if (curve === undefined || curve.length === 0) {
    parameter.linearRampToValueAtTime(
      Math.max(0.0001, endValue),
      startAt + durationMs / 1000
    );
    return;
  }
  for (const point of curve) {
    const pointAt = startAt + Math.min(durationMs, Math.max(0, point.timeMs)) / 1000;
    const value = Math.max(0.0001, point.value);
    if (pointAt === startAt) parameter.setValueAtTime(value, pointAt);
    else parameter.linearRampToValueAtTime(value, pointAt);
  }
};

const scheduleEnvelope = (
  parameter: AudioParam,
  automation: LayerAutomationConfig | undefined,
  startAt: number,
  durationMs: number,
  volume: number,
  attackMs: number,
  releaseMs: number
): void => {
  const duration = durationMs / 1000;
  parameter.setValueAtTime(0, startAt);
  if (automation?.gain !== undefined && automation.gain.length > 0) {
    for (const point of automation.gain) {
      const pointAt = startAt + Math.min(durationMs, Math.max(0, point.timeMs)) / 1000;
      const value = Math.max(0, point.value * volume);
      if (pointAt === startAt) parameter.setValueAtTime(value, pointAt);
      else parameter.linearRampToValueAtTime(value, pointAt);
    }
    return;
  }
  const attackEnd = startAt + Math.min(duration, attackMs / 1000);
  const releaseStart = startAt + Math.max(attackMs / 1000, duration - releaseMs / 1000);
  parameter.linearRampToValueAtTime(volume, attackEnd);
  parameter.setValueAtTime(volume, releaseStart);
  parameter.linearRampToValueAtTime(0, startAt + duration);
};

const connectOutput = (
  context: BaseAudioContext,
  source: AudioNode,
  destination: AudioNode,
  automation: LayerAutomationConfig | undefined,
  filterFrequency: number | undefined,
  startAt: number,
  durationMs: number,
  filterType: BiquadFilterType = 'lowpass'
): void => {
  const filter = context.createBiquadFilter();
  filter.type = filterType;
  scheduleParameter(
    filter.frequency,
    automation?.filterFrequency,
    startAt,
    durationMs,
    filterFrequency ?? 12_000,
    filterFrequency ?? 12_000
  );
  source.connect(filter);
  filter.connect(destination);
};

export const renderEffectLayers = (
  context: BaseAudioContext,
  destination: AudioNode,
  layers: SoundLayerConfig[],
  startAt: number
): EffectRenderHandle => {
  const sources: AudioScheduledSourceNode[] = [];
  let durationMs = 0;

  for (const layer of layers) {
    if (!layer.enabled) continue;
    const offsetMs = Math.max(0, layer.startMs ?? 0);
    const layerStart = startAt + offsetMs / 1000;
    const layerDuration =
      layer.kind === 'impulseCluster'
        ? Math.max(
            layer.sound.durationMs,
            layer.sound.spreadMs + layer.sound.decayMs
          )
        : layer.sound.durationMs;
    durationMs = Math.max(durationMs, offsetMs + layerDuration);

    if (layer.kind === 'tone' || layer.kind === 'fmTone') {
      const sound = layer.sound;
      const carrier = context.createOscillator();
      const gain = context.createGain();
      carrier.type =
        layer.kind === 'tone' ? layer.sound.type : layer.sound.carrierType;
      scheduleParameter(
        carrier.frequency,
        layer.automation?.frequency,
        layerStart,
        sound.durationMs,
        sound.frequencyStart,
        sound.frequencyEnd
      );
      scheduleEnvelope(
        gain.gain,
        layer.automation,
        layerStart,
        sound.durationMs,
        sound.volume,
        sound.attackMs,
        sound.releaseMs
      );
      connectOutput(
        context,
        carrier,
        gain,
        layer.automation,
        sound.filterFrequency,
        layerStart,
        sound.durationMs
      );
      gain.connect(destination);
      carrier.start(layerStart);
      carrier.stop(layerStart + sound.durationMs / 1000 + 0.03);
      sources.push(carrier);

      if (layer.kind === 'fmTone') {
        const modulator = context.createOscillator();
        const modulationGain = context.createGain();
        modulator.type = layer.sound.modulatorType;
        modulator.frequency.value = layer.sound.modulatorFrequency;
        modulationGain.gain.value = layer.sound.modulationDepth;
        modulator.connect(modulationGain);
        modulationGain.connect(carrier.frequency);
        modulator.start(layerStart);
        modulator.stop(layerStart + sound.durationMs / 1000 + 0.03);
        sources.push(modulator);
      }
      continue;
    }

    if (layer.kind === 'noise' || layer.kind === 'click') {
      const sound = layer.sound;
      const source = context.createBufferSource();
      const gain = context.createGain();
      const random = seededRandom(layer.id.length * 2_653_443_761 + offsetMs);
      source.buffer = noiseBuffer(context, sound.durationMs, random, layer.kind === 'click');
      scheduleEnvelope(
        gain.gain,
        layer.automation,
        layerStart,
        sound.durationMs,
        sound.volume,
        sound.attackMs,
        sound.releaseMs
      );
      connectOutput(
        context,
        source,
        gain,
        layer.automation,
        sound.filterFrequency,
        layerStart,
        sound.durationMs,
        layer.kind === 'click' ? 'highpass' : 'lowpass'
      );
      gain.connect(destination);
      source.start(layerStart);
      source.stop(layerStart + sound.durationMs / 1000 + 0.03);
      sources.push(source);
      continue;
    }

    if (layer.kind === 'resonatorBank') {
      const sound = layer.sound;
      const layerGain = context.createGain();
      scheduleEnvelope(
        layerGain.gain,
        layer.automation,
        layerStart,
        sound.durationMs,
        sound.volume,
        sound.attackMs,
        sound.releaseMs
      );
      layerGain.connect(destination);
      for (const resonance of sound.resonances) {
        const oscillator = context.createOscillator();
        const resonanceGain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = resonance.frequency;
        resonanceGain.gain.setValueAtTime(Math.max(0.0001, resonance.gain), layerStart);
        resonanceGain.gain.exponentialRampToValueAtTime(
          0.0001,
          layerStart + Math.max(0.02, resonance.decayMs / 1000)
        );
        oscillator.connect(resonanceGain);
        connectOutput(
          context,
          resonanceGain,
          layerGain,
          layer.automation,
          sound.filterFrequency,
          layerStart,
          sound.durationMs
        );
        oscillator.start(layerStart);
        oscillator.stop(layerStart + sound.durationMs / 1000 + 0.03);
        sources.push(oscillator);
      }
      continue;
    }

    const sound = layer.sound;
    const random = seededRandom(sound.seed);
    for (let index = 0; index < sound.count; index += 1) {
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      const impulseOffsetMs = random() ** 1.35 * sound.spreadMs;
      const impulseStart = layerStart + impulseOffsetMs / 1000;
      const impulseDurationMs = Math.max(12, sound.decayMs * (0.45 + random() * 0.75));
      const frequency = sound.minFrequency *
        (sound.maxFrequency / sound.minFrequency) ** random();
      source.buffer = noiseBuffer(context, impulseDurationMs, random, true);
      filter.type = 'bandpass';
      filter.frequency.value = Math.min(sound.filterFrequency, frequency);
      filter.Q.value = 1.5 + random() * 5;
      gain.gain.setValueAtTime(sound.volume * (0.35 + random() * 0.65), impulseStart);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        impulseStart + impulseDurationMs / 1000
      );
      source.connect(filter);
      filter.connect(gain);
      gain.connect(destination);
      source.start(impulseStart);
      source.stop(impulseStart + impulseDurationMs / 1000 + 0.02);
      sources.push(source);
    }
  }

  return { durationMs: Math.max(120, durationMs), sources };
};
