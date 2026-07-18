import type {
  AutomationPoint,
  FmToneLayerConfig,
  ImpulseClusterLayerConfig,
  LayeredSoundConfig,
  NoiseLayerConfig,
  ResonatorBankLayerConfig,
  SoundLayerConfig,
  ToneLayerConfig,
} from '../config/audio';
import { clamp, mean, median } from './dsp';
import type {
  AudioFeatures,
  BeatConfig,
  BeatLane,
  CreationMode,
  FrameFeatures,
  MelodyConfig,
  MelodyNote,
  ProceduralResult,
} from './types';

const rounded = (value: number, minimum: number, maximum: number): number =>
  Math.round(clamp(value, minimum, maximum));

const oscillatorFor = (features: AudioFeatures): OscillatorType => {
  if (features.flatness > 0.38) return 'sawtooth';
  if (features.centroidHz > 2_800) return 'square';
  if (features.centroidHz > 1_100) return 'triangle';
  return 'sine';
};

const pitchMedian = (features: AudioFeatures): number | undefined => {
  if (features.pitch.length === 0) return undefined;
  return median(features.pitch.map((point) => point.frequency));
};

const curveWithDuration = (
  curve: AutomationPoint[],
  durationMs: number,
  finalValue?: number
): AutomationPoint[] => {
  if (curve.length === 0) return [];
  const points = curve.map((point) => ({
    timeMs: rounded(point.timeMs, 0, durationMs),
    value: point.value,
  }));
  const first = points[0];
  if (first !== undefined && first.timeMs > 0) {
    points.unshift({ timeMs: 0, value: first.value });
  }
  const last = points[points.length - 1];
  if (last !== undefined && last.timeMs < durationMs) {
    points.push({ timeMs: durationMs, value: finalValue ?? last.value });
  } else if (last !== undefined && finalValue !== undefined) {
    last.value = finalValue;
  }
  return points;
};

const filterCurve = (features: AudioFeatures, durationMs: number): AutomationPoint[] =>
  curveWithDuration(
    features.brightnessCurve.map((point) => ({
      timeMs: point.timeMs,
      value: rounded(point.value * 1.7, 180, 14_000),
    })),
    durationMs
  );

const eventOnsets = (features: AudioFeatures, maximumEvents = 8): number[] => {
  const onsets = features.onsetTimesMs.filter(
    (time, index, values) => index === 0 || time - (values[index - 1] ?? 0) >= 45
  );
  if (onsets.length <= maximumEvents) return onsets;
  return Array.from({ length: maximumEvents }, (_, index) => {
    const sourceIndex = Math.round((index / (maximumEvents - 1)) * (onsets.length - 1));
    return onsets[sourceIndex] ?? 0;
  });
};

const effectConfig = (features: AudioFeatures): LayeredSoundConfig => {
  const durationMs = rounded(features.durationMs, 80, 4_000);
  const releaseMs = rounded(durationMs * (0.45 + features.flatness * 0.35), 45, durationMs);
  const filterFrequency = rounded(
    Math.max(features.centroidHz * 1.7, features.rolloffHz * 0.7),
    180,
    14_000
  );
  const volume = clamp(0.08 + features.rms * 1.7, 0.08, 0.34);
  const engineId = features.engine === 'webAudio' ? 'web-audio' : 'meyda';
  const layers: SoundLayerConfig[] = [];
  const gainCurve = curveWithDuration(features.amplitudeCurve, durationMs, 0);
  const brightnessAutomation = filterCurve(features, durationMs);
  const attackPoint = gainCurve.find((point) => point.value >= 0.9);

  const noiseLayer: NoiseLayerConfig = {
    automation: {
      filterFrequency: brightnessAutomation,
      gain: gainCurve,
    },
    enabled: true,
    id: `${engineId}-texture`,
    kind: 'noise',
    name: 'Detected texture',
    processors: [],
    startMs: 0,
    sound: {
      attackMs: rounded(attackPoint?.timeMs ?? 8, 1, 120),
      durationMs,
      filterFrequency,
      releaseMs,
      volume,
    },
  };
  layers.push(noiseLayer);

  const stablePitch = pitchMedian(features);
  if (stablePitch !== undefined && features.pitch.length >= 2) {
    const early = median(features.pitch.slice(0, 4).map((point) => point.frequency));
    const late = median(features.pitch.slice(-4).map((point) => point.frequency));
    const toneLayer: ToneLayerConfig = {
      automation: {
        filterFrequency: brightnessAutomation.map((point) => ({
          ...point,
          value: rounded(point.value * 0.72, 300, 8_000),
        })),
        frequency: curveWithDuration(features.pitchCurve, durationMs),
        gain: gainCurve,
      },
      enabled: true,
      id: `${engineId}-body`,
      kind: 'tone',
      name: 'Detected tonal body',
      processors: [],
      startMs: 0,
      sound: {
        attackMs: rounded(durationMs * 0.015, 2, 60),
        durationMs,
        filterFrequency: rounded(Math.max(600, features.centroidHz * 1.25), 400, 8_000),
        frequencyEnd: rounded(late || stablePitch, 40, 2_400),
        frequencyStart: rounded(early || stablePitch, 40, 2_400),
        releaseMs: rounded(releaseMs * 0.8, 40, durationMs),
        type: oscillatorFor(features),
        volume: clamp(volume * 0.55, 0.04, 0.2),
      },
    };
    layers.push(toneLayer);
  } else if (features.flatness < 0.42) {
    const fmLayer: FmToneLayerConfig = {
      automation: {
        filterFrequency: brightnessAutomation,
        gain: gainCurve,
      },
      enabled: true,
      id: `${engineId}-resonance`,
      kind: 'fmTone',
      name: 'Inferred resonance',
      processors: [],
      startMs: 0,
      sound: {
        attackMs: 2,
        carrierType: 'sine',
        durationMs: rounded(durationMs * 0.72, 60, durationMs),
        filterFrequency: rounded(features.centroidHz * 1.4, 500, 10_000),
        frequencyEnd: rounded(features.centroidHz * 0.12, 70, 1_400),
        frequencyStart: rounded(features.centroidHz * 0.22, 90, 2_200),
        modulationDepth: rounded(80 + features.flatness * 900, 60, 1_200),
        modulatorFrequency: rounded(20 + features.zcr * 1_500, 18, 320),
        modulatorType: 'triangle',
        releaseMs: rounded(releaseMs * 0.68, 35, durationMs),
        volume: clamp(volume * 0.32, 0.03, 0.13),
      },
    };
    layers.push(fmLayer);
  }

  const onsets = eventOnsets(features);
  onsets.forEach((onset, index) => {
    const frame = nearestFrame(features, onset);
    const nextOnset = onsets[index + 1];
    const availableDuration = nextOnset === undefined
      ? durationMs - onset
      : (nextOnset - onset) * 0.62;
    const eventDuration = rounded(
      frame.flatness > 0.38 ? availableDuration : availableDuration * 0.55,
      24,
      240
    );
    const eventVolume = clamp(
      0.05 + (frame.rms / Math.max(0.01, features.rms * 2.2)) * 0.16,
      0.05,
      0.22
    );
    const eventIsClick = eventDuration < 85 || frame.centroidHz > 2_800;
    layers.push({
      enabled: true,
      id: `${engineId}-event-${index + 1}`,
      kind: eventIsClick ? 'click' : 'noise',
      name: index === 0 ? 'Initial event' : `Detected event ${index + 1}`,
      processors: [],
      startMs: rounded(onset, 0, durationMs),
      sound: {
        attackMs: 0,
        durationMs: eventDuration,
        filterFrequency: rounded(
          Math.max(frame.centroidHz * 1.6, frame.rolloffHz * 0.7),
          eventIsClick ? 1_200 : 300,
          14_000
        ),
        releaseMs: rounded(eventDuration * (eventIsClick ? 0.82 : 0.68), 18, eventDuration),
        volume: eventVolume,
      },
    });
  });

  const crestFactor = features.peak / Math.max(0.01, features.rms);
  const isImpactLike = crestFactor > 3.2 || onsets.length > 1;
  if (isImpactLike && features.flatness < 0.72) {
    const baseFrequency = clamp(features.centroidHz * 0.32, 180, 2_200);
    const ratios = [1, 1.37, 1.91, 2.63, 3.44, 4.17];
    const resonanceDuration = rounded(durationMs * 0.72, 140, 1_800);
    const resonatorLayer: ResonatorBankLayerConfig = {
      enabled: true,
      id: `${engineId}-resonator-bank`,
      kind: 'resonatorBank',
      name: 'Inharmonic resonances',
      processors: [],
      startMs: rounded(onsets[0] ?? 0, 0, durationMs),
      sound: {
        attackMs: 1,
        durationMs: resonanceDuration,
        filterFrequency: rounded(features.rolloffHz, 1_200, 14_000),
        releaseMs: resonanceDuration,
        resonances: ratios.map((ratio, index) => ({
          decayMs: rounded(
            resonanceDuration * (0.92 - index * 0.09) * (0.7 + features.flatness * 0.3),
            80,
            resonanceDuration
          ),
          frequency: rounded(baseFrequency * ratio, 90, 12_000),
          gain: clamp(0.52 / (1 + index * 0.38), 0.08, 0.52),
        })),
        volume: clamp(volume * 0.42, 0.035, 0.14),
      },
    };
    layers.push(resonatorLayer);
  }

  if (isImpactLike && (features.flatness > 0.14 || onsets.length > 2)) {
    const impulseLayer: ImpulseClusterLayerConfig = {
      enabled: true,
      id: `${engineId}-impulse-cluster`,
      kind: 'impulseCluster',
      name: 'Scattered fragments',
      processors: [],
      startMs: rounded(onsets[0] ?? 0, 0, durationMs),
      sound: {
        count: rounded(4 + onsets.length * 1.4 + features.flatness * 8, 4, 20),
        decayMs: rounded(28 + features.flatness * 105, 24, 150),
        durationMs: rounded(durationMs * 0.72, 120, 2_000),
        filterFrequency: rounded(features.rolloffHz, 1_800, 16_000),
        maxFrequency: rounded(Math.max(2_400, features.rolloffHz), 2_400, 16_000),
        minFrequency: rounded(Math.max(350, features.centroidHz * 0.42), 300, 5_000),
        seed: features.engine === 'meyda' ? 20_031 : 10_019,
        spreadMs: rounded(durationMs * (0.32 + features.flatness * 0.38), 90, 1_500),
        volume: clamp(volume * 0.5, 0.04, 0.17),
      },
    };
    layers.push(impulseLayer);
  }
  return { layers };
};

const nearestFrame = (features: AudioFeatures, timeMs: number): FrameFeatures =>
  features.frames.reduce((best, frame) =>
    Math.abs(frame.timeMs - timeMs) < Math.abs(best.timeMs - timeMs) ? frame : best
  );

const peakRegionFrame = (features: AudioFeatures, timeMs: number): FrameFeatures => {
  const region = features.frames.filter(
    (frame) => frame.timeMs >= timeMs - 20 && frame.timeMs <= timeMs + 90
  );
  if (region.length === 0) return nearestFrame(features, timeMs);
  const weights = region.map((frame) => Math.max(0.001, frame.rms));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const weighted = (select: (frame: FrameFeatures) => number): number =>
    region.reduce(
      (sum, frame, index) => sum + select(frame) * (weights[index] ?? 0),
      0
    ) / totalWeight;
  const mfccLength = Math.max(0, ...region.map((frame) => frame.mfcc.length));
  return {
    centroidHz: weighted((frame) => frame.centroidHz),
    flatness: weighted((frame) => frame.flatness),
    mfcc: Array.from({ length: mfccLength }, (_, index) =>
      weighted((frame) => frame.mfcc[index] ?? 0)
    ),
    rms: Math.max(...region.map((frame) => frame.rms)),
    rolloffHz: weighted((frame) => frame.rolloffHz),
    timeMs,
    zcr: weighted((frame) => frame.zcr),
  };
};

const frameVector = (frame: FrameFeatures): number[] => {
  const base = [
    Math.log2(Math.max(40, frame.centroidHz)) / 14,
    frame.flatness,
    frame.zcr * 4,
    Math.log10(Math.max(1e-5, frame.rms)) / 5 + 1,
  ];
  const mfcc = frame.mfcc.slice(0, 4).map((value) => clamp(value / 100, -1, 1));
  return [...base, ...mfcc];
};

const vectorDistance = (first: number[], second: number[]): number =>
  Math.sqrt(
    first.reduce((sum, value, index) => sum + (value - (second[index] ?? 0)) ** 2, 0)
  );

const clusterFrames = (frames: FrameFeatures[], clusterCount: number): number[] => {
  if (clusterCount <= 1) return frames.map(() => 0);
  const vectors = frames.map(frameVector);
  const sortedIndexes = frames
    .map((frame, index) => ({ centroid: frame.centroidHz, index }))
    .sort((first, second) => first.centroid - second.centroid)
    .map((item) => item.index);
  let centroids = Array.from({ length: clusterCount }, (_, index) => {
    const position = Math.round((index / Math.max(1, clusterCount - 1)) * (sortedIndexes.length - 1));
    return [...(vectors[sortedIndexes[position] ?? 0] ?? [])];
  });
  let assignments = frames.map(() => 0);

  for (let iteration = 0; iteration < 8; iteration += 1) {
    assignments = vectors.map((vector) => {
      let bestIndex = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      centroids.forEach((centroid, index) => {
        const distance = vectorDistance(vector, centroid);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      });
      return bestIndex;
    });
    centroids = centroids.map((centroid, clusterIndex) => {
      const members = vectors.filter((_, index) => assignments[index] === clusterIndex);
      if (members.length === 0) return centroid;
      return centroid.map((_, dimension) => mean(members.map((member) => member[dimension] ?? 0)));
    });
  }
  return assignments;
};

const estimateBpm = (onsets: number[]): number => {
  const intervals = onsets
    .slice(1)
    .map((time, index) => time - (onsets[index] ?? time))
    .filter((interval) => interval >= 80 && interval <= 1_500);
  if (intervals.length === 0) return 120;
  const interval = median(intervals);
  let best = { bpm: 120, score: Number.POSITIVE_INFINITY };
  for (const subdivision of [1, 2, 4]) {
    let bpm = 60_000 / (interval * subdivision);
    while (bpm < 60) bpm *= 2;
    while (bpm > 180) bpm /= 2;
    const preference = Math.abs(bpm - 112) * 0.18;
    const reconstructedInterval = 60_000 / bpm / subdivision;
    const score = Math.abs(reconstructedInterval - interval) + preference;
    if (score < best.score) best = { bpm, score };
  }
  return rounded(best.bpm, 60, 180);
};

const beatConfig = (features: AudioFeatures): BeatConfig => {
  const onsets = features.onsetTimesMs.length > 0 ? features.onsetTimesMs : [0];
  const eventFrames = onsets.map((time) => peakRegionFrame(features, time));
  const clusterCount = eventFrames.length < 3 ? 1 : eventFrames.length < 7 ? 2 : 3;
  const assignments = clusterFrames(eventFrames, clusterCount);
  const bpm = estimateBpm(onsets);
  const stepsPerBeat = 4;
  const stepMs = 60_000 / bpm / stepsPerBeat;
  const origin = onsets[0] ?? 0;
  const lastStep = Math.max(
    7,
    ...onsets.map((time) => Math.round((time - origin) / stepMs))
  );
  const stepCount = clamp(Math.ceil((lastStep + 1) / 8) * 8, 8, 32);
  const clusterData = Array.from({ length: clusterCount }, (_, clusterIndex) => {
    const memberIndexes = assignments
      .map((assignment, index) => (assignment === clusterIndex ? index : -1))
      .filter((index) => index >= 0);
    const members = memberIndexes.map((index) => eventFrames[index]).filter((frame) => frame !== undefined);
    return {
      centroid: mean(members.map((frame) => frame.centroidHz)),
      flatness: mean(members.map((frame) => frame.flatness)),
      memberIndexes,
      rms: mean(members.map((frame) => frame.rms)),
      zcr: mean(members.map((frame) => frame.zcr)),
    };
  });
  const ordered = clusterData
    .map((cluster, index) => ({ ...cluster, originalIndex: index }))
    .sort((first, second) => first.centroid - second.centroid);

  const lanes: BeatLane[] = ordered.map((cluster, orderedIndex) => {
    const kind =
      ordered.length === 1
        ? cluster.centroid < 1_100
          ? 'kick'
          : cluster.centroid > 3_200
            ? 'hat'
            : 'snare'
        : orderedIndex === 0
          ? 'kick'
          : orderedIndex === ordered.length - 1
            ? 'hat'
            : 'snare';
    const steps = Array.from({ length: stepCount }, () => 0);
    cluster.memberIndexes.forEach((eventIndex) => {
      const onset = onsets[eventIndex] ?? origin;
      const step = Math.round((onset - origin) / stepMs) % stepCount;
      steps[step] = Math.max(steps[step] ?? 0, clamp((eventFrames[eventIndex]?.rms ?? 0.1) * 5, 0.35, 1));
    });
    const hits = cluster.memberIndexes.map((eventIndex) => ({
      label: kind === 'kick' ? 'Sound A' : kind === 'snare' ? 'Sound B' : 'Sound C',
      startMs: rounded((onsets[eventIndex] ?? origin) - origin, 0, features.durationMs),
      velocity: clamp((eventFrames[eventIndex]?.rms ?? 0.1) * 5, 0.35, 1),
    }));
    const relativeFrequencies =
      ordered.length === 1 ? [220] : ordered.length === 2 ? [110, 440] : [90, 260, 760];
    return {
      hits,
      label: hits[0]?.label ?? 'Sound A',
      steps,
      voice: {
        decayMs: kind === 'kick' ? 105 : kind === 'snare' ? 80 : 55,
        frequency: relativeFrequencies[orderedIndex] ?? 220,
        kind,
        noiseAmount: 0,
        volume: clamp(0.08 + cluster.rms * 2.4, 0.08, 0.28),
      },
    };
  });

  return {
    bpm,
    durationMs: rounded((onsets[onsets.length - 1] ?? origin) - origin + 260, 300, features.durationMs + 300),
    lanes,
    masterVolume: 0.55,
    stepCount,
    stepsPerBeat,
  };
};

const frequencyToMidi = (frequency: number): number => 69 + 12 * Math.log2(frequency / 440);

const melodyNotes = (features: AudioFeatures): MelodyNote[] => {
  if (features.transcribedNotes !== undefined) {
    const notes = features.transcribedNotes
      .filter((note) => Number.isFinite(note.startMs) && Number.isFinite(note.durationMs))
      .sort((first, second) => first.startMs - second.startMs)
      .slice(0, 64);
    const origin = notes[0]?.startMs ?? 0;
    return notes.map((note) => ({
      ...note,
      durationMs: rounded(note.durationMs, 20, 10_000),
      midi: rounded(note.midi, 0, 127),
      startMs: Math.max(0, Math.round(note.startMs - origin)),
      velocity: clamp(Number.isFinite(note.velocity) ? note.velocity : 0.7, 0.05, 1),
    }));
  }
  const notes: MelodyNote[] = [];
  let group: typeof features.pitch = [];
  const flush = (): void => {
    if (group.length === 0) return;
    const start = group[0]?.timeMs ?? 0;
    const last = group[group.length - 1]?.timeMs ?? start;
    notes.push({
      durationMs: rounded(last - start + 90, 90, 2_500),
      midi: rounded(median(group.map((point) => frequencyToMidi(point.frequency))), 24, 96),
      startMs: Math.round(start),
      velocity: clamp(mean(group.map((point) => point.confidence)), 0.35, 1),
    });
    group = [];
  };

  for (const point of [...features.pitch].sort((first, second) => first.timeMs - second.timeMs)) {
    const previous = group[group.length - 1];
    const groupMidi = group.length > 0
      ? median(group.map((item) => frequencyToMidi(item.frequency)))
      : frequencyToMidi(point.frequency);
    if (
      previous !== undefined &&
      (point.timeMs - previous.timeMs > 150 ||
        Math.abs(frequencyToMidi(point.frequency) - groupMidi) > 0.85)
    ) {
      flush();
    }
    group.push(point);
  }
  flush();
  if (notes.length === 0) return notes;
  const origin = notes[0]?.startMs ?? 0;
  return notes.slice(0, 64).map((note) => ({ ...note, startMs: note.startMs - origin }));
};

const melodyConfig = (features: AudioFeatures): MelodyConfig => ({
  filterFrequency: rounded(Math.max(1_000, features.centroidHz * 1.8), 700, 9_000),
  masterVolume: 0.24,
  notes: melodyNotes(features),
  oscillatorType: oscillatorFor(features),
});

export const generateResult = (
  mode: CreationMode,
  features: AudioFeatures
): ProceduralResult => {
  if (mode === 'effect') {
    const config = effectConfig(features);
    return {
      config,
      engine: features.engine,
      features,
      mode,
      summary: `${config.layers.length} timed layers shaped by gain, brightness, pitch, and ${features.onsetTimesMs.length} detected events.`,
    };
  }
  if (mode === 'beat') {
    const config = beatConfig(features);
    return {
      config,
      engine: features.engine,
      features,
      mode,
      summary: `${config.lanes.length} peak-matched sounds with ${features.onsetTimesMs.length} hits at their recorded timing.`,
    };
  }
  const config = melodyConfig(features);
  return {
    config,
    engine: features.engine,
    features,
    mode,
    summary:
      config.notes.length > 0
        ? `${config.notes.length} timed notes with preserved durations.`
        : 'No stable melody was detected; try a clearer single-note line.',
  };
};
