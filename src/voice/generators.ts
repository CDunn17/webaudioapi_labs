import type {
  AutomationPoint,
  FmToneLayerConfig,
  LayeredSoundConfig,
  NoiseLayerConfig,
  ResonatorBankLayerConfig,
  SoundLayerConfig,
  ToneLayerConfig,
} from '../config/audio';
import { clamp, mean, median, simplifyAutomationCurve } from './dsp';
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

const melodyOscillatorFor = (features: AudioFeatures): OscillatorType => {
  // A monophonic hum is normally closer to a filtered sine/triangle than the
  // bright square/saw choices used for short effects.
  if (features.flatness < 0.16 || features.centroidHz < 850) return 'sine';
  if (features.flatness < 0.42 || features.centroidHz < 2_400) return 'triangle';
  return 'sawtooth';
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

const curveValueAt = (curve: AutomationPoint[], timeMs: number, fallback = 0): number => {
  if (curve.length === 0) return fallback;
  const ordered = [...curve].sort((first, second) => first.timeMs - second.timeMs);
  const nextIndex = ordered.findIndex((point) => point.timeMs >= timeMs);
  if (nextIndex === -1) return ordered[ordered.length - 1]?.value ?? fallback;
  if (nextIndex === 0) return ordered[0]?.value ?? fallback;
  const previous = ordered[nextIndex - 1];
  const next = ordered[nextIndex];
  if (previous === undefined || next === undefined) return next?.value ?? previous?.value ?? fallback;
  const amount = (timeMs - previous.timeMs) / Math.max(1, next.timeMs - previous.timeMs);
  return previous.value + (next.value - previous.value) * amount;
};

const sliceCurve = (
  curve: AutomationPoint[],
  startMs: number,
  endMs: number
): AutomationPoint[] => {
  const durationMs = Math.max(0, endMs - startMs);
  return [
    { timeMs: 0, value: curveValueAt(curve, startMs) },
    ...curve
      .filter((point) => point.timeMs > startMs && point.timeMs < endMs)
      .map((point) => ({ timeMs: point.timeMs - startMs, value: point.value })),
    { timeMs: durationMs, value: curveValueAt(curve, endMs) },
  ];
};

const peakCurveValue = (
  curve: AutomationPoint[],
  startMs: number,
  endMs: number
): number => Math.max(
  curveValueAt(curve, startMs),
  curveValueAt(curve, endMs),
  ...curve
    .filter((point) => point.timeMs >= startMs && point.timeMs <= endMs)
    .map((point) => point.value)
);

const activeEndAfter = (features: AudioFeatures, timeMs: number): number => {
  const region = features.activityRegions.find(
    (candidate) => timeMs >= candidate.startMs - 20 && timeMs < candidate.endMs
  );
  const regionEnd = region?.endMs ?? timeMs + 60;
  const firstValley = features.amplitudeCurve.find(
    (point) => point.timeMs > timeMs + 2 && point.timeMs <= regionEnd && point.value <= 0.005
  );
  return Math.min(regionEnd, firstValley?.timeMs ?? regionEnd);
};

const filterCurve = (features: AudioFeatures, durationMs: number): AutomationPoint[] =>
  curveWithDuration(
    features.brightnessCurve.map((point) => ({
      timeMs: point.timeMs,
      value: rounded(point.value * 1.7, 180, 14_000),
    })),
    durationMs
  );

const eventOnsets = (features: AudioFeatures, maximumEvents = 16): number[] => {
  const onsets = features.onsetTimesMs.filter(
    (time, index, values) => index === 0 || time - (values[index - 1] ?? 0) >= 45
  );
  if (onsets.length <= maximumEvents) return onsets;
  // Retain the most prominent measured events instead of evenly sampling the
  // list, which could discard the clip's defining attacks.
  return onsets
    .map((time) => ({ level: nearestFrame(features, time).rms, time }))
    .sort((first, second) => second.level - first.level)
    .slice(0, maximumEvents)
    .sort((first, second) => first.time - second.time)
    .map(({ time }) => time);
};

const effectConfig = (features: AudioFeatures): LayeredSoundConfig => {
  const durationMs = rounded(features.durationMs, 1, 4_000);
  const releaseMs = rounded(durationMs * (0.45 + features.flatness * 0.35), 45, durationMs);
  const filterFrequency = rounded(
    Math.max(features.centroidHz * 1.7, features.rolloffHz * 0.7),
    180,
    14_000
  );
  const volume = clamp(0.08 + features.rms * 1.7, 0.08, 0.34);
  const stablePitch = pitchMedian(features);
  const expectedPitchZcr = stablePitch === undefined
    ? 0
    : 2 * stablePitch / Math.max(1, features.sampleRate || 44_100);
  const excessZcr = stablePitch !== undefined && features.flatness < 0.08
    ? 0
    : Math.max(0, features.zcr - expectedPitchZcr);
  const textureAmount = clamp(features.flatness * 1.25 + excessZcr * 1.5, 0, 1);
  const engineId = features.engine === 'webAudio'
    ? 'web-audio'
    : features.engine === 'basicPitch' ? 'basic-pitch' : features.engine;
  const layers: SoundLayerConfig[] = [];
  const gainCurve = curveWithDuration(features.amplitudeCurve, durationMs, 0);
  const brightnessAutomation = filterCurve(features, durationMs);
  const attackPoint = gainCurve.find((point) => point.value >= 0.9);

  if (textureAmount >= 0.04) {
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
        volume: clamp(volume * textureAmount, 0, 0.34),
      },
    };
    layers.push(noiseLayer);
  }

  if (stablePitch !== undefined && features.pitch.length >= 2) {
    const orderedPitch = [...features.pitch].sort((first, second) => first.timeMs - second.timeMs);
    const early = median(orderedPitch.slice(0, 4).map((point) => point.frequency));
    const late = median(orderedPitch.slice(-4).map((point) => point.frequency));
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
        frequencyEnd: rounded(late || stablePitch, 40, 6_000),
        frequencyStart: rounded(early || stablePitch, 40, 6_000),
        releaseMs: rounded(releaseMs * 0.8, 40, durationMs),
        type: oscillatorFor(features),
        volume: clamp(volume * 0.55, 0.04, 0.2),
      },
    };
    layers.push(toneLayer);
  } else if (
    features.flatness < 0.28 && features.activityRegions.length > 0 &&
    features.activityRegions.length <= 2
  ) {
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
        volume: clamp(volume * 0.24, 0.02, 0.1),
      },
    };
    layers.push(fmLayer);
  }

  const onsets = eventOnsets(features);
  const crestFactor = features.peak / Math.max(0.01, features.rms);
  const eventLevels = onsets.map((onset, index) => peakCurveValue(
    features.amplitudeCurve,
    onsets[index - 1] === undefined ? Math.max(0, onset - 30) :
      ((onsets[index - 1] ?? onset) + onset) / 2,
    onsets[index + 1] === undefined ? Math.min(durationMs, onset + 100) :
      (onset + (onsets[index + 1] ?? onset)) / 2
  ));
  const maximumEventLevel = Math.max(
    1e-6,
    ...eventLevels
  );
  onsets.forEach((onset, index) => {
    const frame = nearestFrame(features, onset);
    const transientLike = frame.flatness >= 0.18 ||
      (stablePitch === undefined && frame.zcr >= 0.08) || crestFactor >= 3.2;
    if (!transientLike) return;
    const nextOnset = onsets[index + 1];
    const measuredEnd = activeEndAfter(features, onset);
    const eventStartMs = rounded(onset, 0, durationMs);
    const availableDuration = Math.max(1, Math.min(
      measuredEnd - eventStartMs,
      nextOnset === undefined ? durationMs - eventStartMs : (nextOnset - eventStartMs) * 0.82
    ));
    const eventDuration = clamp(
      Math.floor(frame.flatness > 0.38 ? availableDuration : availableDuration * 0.72),
      1,
      280
    );
    const relativeEventLevel = (eventLevels[index] ?? 0) / maximumEventLevel;
    const eventVolume = clamp(
      relativeEventLevel * 0.18,
      0.002,
      0.18
    );
    const eventIsClick = eventDuration < 85 || frame.centroidHz > 2_800;
    layers.push({
      enabled: true,
      id: `${engineId}-event-${index + 1}`,
      kind: eventIsClick ? 'click' : 'noise',
      name: index === 0 ? 'Initial event' : `Detected event ${index + 1}`,
      processors: [],
      startMs: eventStartMs,
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

  const isImpactLike = crestFactor > 4 && onsets.length > 0;
  if (isImpactLike && features.flatness < 0.32) {
    const baseFrequency = clamp(features.centroidHz * 0.32, 180, 2_200);
    const ratios = [1, 1.37, 1.91, 2.63, 3.44, 4.17];
    const resonanceStart = onsets[0] ?? 0;
    const resonanceDuration = rounded(
      Math.min(activeEndAfter(features, resonanceStart) - resonanceStart, durationMs * 0.55),
      1,
      900
    );
    const resonatorLayer: ResonatorBankLayerConfig = {
      automation: {
        gain: curveWithDuration(
          sliceCurve(features.amplitudeCurve, resonanceStart, resonanceStart + resonanceDuration),
          resonanceDuration,
          0
        ),
      },
      enabled: true,
      id: `${engineId}-resonator-bank`,
      kind: 'resonatorBank',
      name: 'Inharmonic resonances',
      processors: [],
      startMs: rounded(resonanceStart, 0, durationMs),
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
  return { layers };
};

const nearestFrame = (features: AudioFeatures, timeMs: number): FrameFeatures => {
  const first = features.frames[0];
  if (first === undefined) {
    return {
      centroidHz: features.centroidHz,
      flatness: features.flatness,
      mfcc: [],
      rms: features.rms,
      rolloffHz: features.rolloffHz,
      timeMs,
      zcr: features.zcr,
    };
  }
  return features.frames.reduce((best, frame) =>
    Math.abs(frame.timeMs - timeMs) < Math.abs(best.timeMs - timeMs) ? frame : best,
    first
  );
};

const peakRegionFrame = (
  features: AudioFeatures,
  timeMs: number,
  previousTimeMs?: number,
  nextTimeMs?: number
): FrameFeatures => {
  const lowerBound = previousTimeMs === undefined
    ? timeMs - 20
    : Math.max(timeMs - 20, (previousTimeMs + timeMs) / 2);
  const upperBound = nextTimeMs === undefined
    ? timeMs + 90
    : Math.min(timeMs + 90, (timeMs + nextTimeMs) / 2);
  const region = features.frames.filter(
    (frame) => frame.timeMs >= lowerBound && frame.timeMs <= upperBound
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

const estimateTempo = (onsets: number[]): { bpm: number; stepsPerBeat: number } => {
  const intervals = onsets
    .slice(1)
    .map((time, index) => time - (onsets[index] ?? time))
    .filter((interval) => interval >= 35 && interval <= 1_500);
  if (intervals.length === 0) return { bpm: 120, stepsPerBeat: 4 };
  const candidates = new Set<number>();
  for (const interval of intervals) {
    for (const steps of [1, 2, 3, 4, 6, 8]) {
      let bpm = 60_000 / (interval * steps);
      while (bpm < 60) bpm *= 2;
      while (bpm > 180) bpm /= 2;
      candidates.add(Math.round(bpm));
    }
  }
  const origin = onsets[0] ?? 0;
  let best = { bpm: 120, score: Number.POSITIVE_INFINITY, stepsPerBeat: 4 };
  for (const bpm of candidates) {
    for (const stepsPerBeat of [3, 4]) {
      const gridMs = 60_000 / bpm / stepsPerBeat;
      const timingError = mean(onsets.map((time) => {
        const steps = (time - origin) / gridMs;
        return Math.abs(steps - Math.round(steps));
      }));
      // This is descriptive metadata only; keep small priors to resolve
      // half/double-time and straight/triplet ties without moving any event.
      const score = timingError + Math.abs(bpm - 112) / 4_000 +
        (stepsPerBeat === 3 ? 0.002 : 0);
      if (score < best.score) best = { bpm, score, stepsPerBeat };
    }
  }
  return {
    bpm: rounded(best.bpm, 60, 180),
    stepsPerBeat: best.stepsPerBeat,
  };
};

const beatConfig = (features: AudioFeatures): BeatConfig => {
  const onsets = features.onsetTimesMs;
  const { bpm, stepsPerBeat } = estimateTempo(onsets);
  const stepMs = 60_000 / bpm / stepsPerBeat;
  const durationMs = rounded(features.durationMs, 120, 60_000);
  const stepCount = rounded(
    Math.ceil(Math.max(1, durationMs / stepMs) / stepsPerBeat) * stepsPerBeat,
    stepsPerBeat,
    768
  );
  if (onsets.length === 0) {
    return {
      bpm,
      durationMs,
      lanes: [],
      masterVolume: 0.55,
      stepCount,
      stepsPerBeat,
    };
  }
  const eventFrames = onsets.map((time, index) => peakRegionFrame(
    features,
    time,
    onsets[index - 1],
    onsets[index + 1]
  ));
  const eventLevels = onsets.map((time, index) => peakCurveValue(
    features.amplitudeCurve,
    onsets[index - 1] === undefined ? Math.max(0, time - 30) :
      ((onsets[index - 1] ?? time) + time) / 2,
    onsets[index + 1] === undefined ? Math.min(features.durationMs, time + 100) :
      (time + (onsets[index + 1] ?? time)) / 2
  ));
  const vectors = eventFrames.map(frameVector);
  const timbreSpread = Math.max(0, ...vectors.flatMap((first, index) =>
    vectors.slice(index + 1).map((second) => vectorDistance(first, second))
  ));
  const clusterCount = eventFrames.length >= 8 && timbreSpread > 0.48
    ? 3
    : eventFrames.length >= 4 && timbreSpread > 0.22 ? 2 : 1;
  const assignments = clusterFrames(eventFrames, clusterCount);
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
  }).filter((cluster) => cluster.memberIndexes.length > 0);
  const ordered = clusterData
    .map((cluster, index) => ({ ...cluster, originalIndex: index }))
    .sort((first, second) => first.centroid - second.centroid);

  const lanes: BeatLane[] = ordered.map((cluster, orderedIndex) => {
    const kind = cluster.centroid < 1_100 && cluster.flatness < 0.42
      ? 'kick'
      : cluster.centroid > 3_200 || cluster.zcr > 0.16 ? 'hat' : 'snare';
    const steps = Array.from({ length: stepCount }, () => 0);
    const maximumEventLevel = Math.max(1e-6, ...eventLevels);
    const velocityFor = (eventIndex: number): number => clamp(
      (eventLevels[eventIndex] ?? 0) / maximumEventLevel,
      0.005,
      1
    );
    cluster.memberIndexes.forEach((eventIndex) => {
      const onset = onsets[eventIndex] ?? 0;
      const step = rounded(Math.round(onset / stepMs), 0, stepCount - 1);
      steps[step] = Math.max(steps[step] ?? 0, velocityFor(eventIndex));
    });
    const decayFor = (eventIndex: number): number => {
      const onset = onsets[eventIndex] ?? 0;
      const nextOnset = onsets[eventIndex + 1];
      const hitStartMs = rounded(onset, 0, durationMs);
      return Math.max(1, Math.min(
        activeEndAfter(features, onset) - hitStartMs,
        nextOnset === undefined ? durationMs - hitStartMs : (nextOnset - hitStartMs) * 0.82
      ));
    };
    const hits = cluster.memberIndexes.map((eventIndex) => ({
      durationMs: clamp(Math.floor(decayFor(eventIndex)), 1, 280),
      label: `Sound ${String.fromCharCode(65 + orderedIndex)}`,
      startMs: rounded(onsets[eventIndex] ?? 0, 0, durationMs),
      velocity: velocityFor(eventIndex),
    }));
    const measuredDecays = cluster.memberIndexes.map(decayFor);
    const frequency = kind === 'kick'
      ? clamp(48 + cluster.centroid * 0.08, 52, 165)
      : kind === 'snare'
        ? clamp(120 + cluster.centroid * 0.13, 170, 620)
        : clamp(360 + cluster.centroid * 0.18, 550, 1_800);
    const noiseAmount = clamp(
      cluster.flatness * 1.05 + cluster.zcr * 2.4,
      kind === 'kick' ? 0 : 0.08,
      kind === 'kick' ? 0.42 : 1
    );
    return {
      hits,
      label: hits[0]?.label ?? `Sound ${String.fromCharCode(65 + orderedIndex)}`,
      steps,
      voice: {
        decayMs: clamp(Math.floor(median(measuredDecays)), 1, 280),
        frequency: rounded(frequency, 40, 2_000),
        kind,
        noiseAmount,
        volume: clamp(0.1 + features.rms * 1.8, 0.1, 0.28),
      },
    };
  });

  return {
    bpm,
    durationMs,
    lanes,
    masterVolume: 0.55,
    stepCount,
    stepsPerBeat,
  };
};

const frequencyToMidi = (frequency: number): number => 69 + 12 * Math.log2(frequency / 440);

const melodyNoteLimit = (features: AudioFeatures): number => rounded(
  Math.ceil(features.durationMs / 1_000 * 8),
  64,
  192
);

const shapedNote = (
  features: AudioFeatures,
  note: MelodyNote,
  confidence: number
): MelodyNote | undefined => {
  const startMs = clamp(note.startMs, 0, features.durationMs);
  const endMs = clamp(startMs + note.durationMs, startMs, features.durationMs);
  const durationMs = endMs - startMs;
  if (durationMs < 20) return undefined;
  const sourcePeak = peakCurveValue(features.amplitudeCurve, startMs, endMs);
  if (sourcePeak <= 0.01) return undefined;
  const localEnvelope = sliceCurve(features.amplitudeCurve, startMs, endMs);
  const envelopePeak = Math.max(0.001, ...localEnvelope.map((point) => point.value));
  const endValue = clamp(curveValueAt(localEnvelope, durationMs) / envelopePeak, 0, 1);
  const releaseMs = Math.min(3, durationMs * 0.2);
  const gainCurve = simplifyAutomationCurve([
    { timeMs: 0, value: clamp(curveValueAt(localEnvelope, 0) / envelopePeak, 0, 1) },
    ...localEnvelope
      .filter((point) => point.timeMs > 0 && point.timeMs < durationMs - releaseMs)
      .map((point) => ({ ...point, value: clamp(point.value / envelopePeak, 0, 1) })),
    { timeMs: Math.max(0, durationMs - releaseMs), value: endValue },
    { timeMs: Math.round(durationMs), value: 0 },
  ], Math.min(48, Math.max(8, Math.ceil(durationMs / 35))));
  const localFrames = features.frames.filter(
    (frame) => frame.timeMs >= startMs && frame.timeMs <= endMs && frame.rms > 0
  );
  const weights = localFrames.map((frame) => Math.max(0.001, frame.rms));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const weightedCentroid = totalWeight > 0
    ? localFrames.reduce(
      (sum, frame, index) => sum + frame.centroidHz * (weights[index] ?? 0),
      0
    ) / totalWeight
    : features.centroidHz;
  const weightedRolloff = totalWeight > 0
    ? localFrames.reduce(
      (sum, frame, index) => sum + frame.rolloffHz * (weights[index] ?? 0),
      0
    ) / totalWeight
    : features.rolloffHz;
  return {
    ...note,
    durationMs: Math.round(durationMs),
    filterFrequency: rounded(
      Math.max(weightedCentroid * 1.5, weightedRolloff * 0.62),
      700,
      9_000
    ),
    gainCurve,
    midi: rounded(note.midi, 0, 127),
    startMs: Math.round(startMs),
    velocity: clamp(sourcePeak * (0.86 + clamp(confidence, 0, 1) * 0.14), 0.01, 1),
  };
};

const trimNoteCurve = (
  curve: AutomationPoint[] | undefined,
  offsetMs: number,
  durationMs: number
): AutomationPoint[] | undefined => {
  if (curve === undefined || curve.length === 0) return undefined;
  return simplifyAutomationCurve(
    sliceCurve(curve, offsetMs, offsetMs + durationMs),
    Math.min(64, Math.max(8, Math.ceil(durationMs / 35)))
  );
};

const monophonic = (notes: MelodyNote[], pitchEvidence: AudioFeatures['pitch']): MelodyNote[] => {
  const simultaneousGroups: MelodyNote[][] = [];
  for (const note of [...notes].sort((first, second) => first.startMs - second.startMs)) {
    const group = simultaneousGroups[simultaneousGroups.length - 1];
    const overlapsGroup = group?.some((candidate) =>
      note.startMs < candidate.startMs + candidate.durationMs &&
      candidate.startMs < note.startMs + note.durationMs
    ) ?? false;
    if (
      group === undefined || note.startMs - (group[0]?.startMs ?? 0) > 30 ||
      !overlapsGroup
    ) {
      simultaneousGroups.push([note]);
    } else {
      group.push(note);
    }
  }
  const selected = simultaneousGroups.map((group) => [...group].sort(
    (first, second) => second.velocity - first.velocity
  )[0]!).sort((first, second) => first.startMs - second.startMs);
  const output: MelodyNote[] = [];
  for (const note of selected) {
    const previous = output[output.length - 1];
    if (previous !== undefined) {
      const previousEnd = previous.startMs + previous.durationMs;
      if (note.startMs < previousEnd) {
        const overlap = previousEnd - note.startMs;
        const pitchDistance = Math.abs(note.midi - previous.midi);
        const localPitch = pitchEvidence.filter((point) =>
          point.timeMs >= note.startMs &&
          point.timeMs <= Math.min(note.startMs + 90, note.startMs + note.durationMs)
        );
        const trackedMidi = localPitch.length > 0
          ? median(localPitch.map((point) => frequencyToMidi(point.frequency)))
          : undefined;
        const supportsEstablishedVoice = trackedMidi !== undefined &&
          Math.abs(trackedMidi - previous.midi) + 1.5 < Math.abs(trackedMidi - note.midi);
        // Polyphonic transcription occasionally introduces a delayed harmonic
        // inside one held vocal tone. Prefer the already-established voice
        // unless the later, distant pitch is materially stronger or occurs at
        // a real boundary; otherwise synthesis adds a note the singer did not.
        if (
          overlap > 35 && pitchDistance >= 7 &&
          note.velocity <= previous.velocity * 1.15 && supportsEstablishedVoice
        ) {
          continue;
        }
        const shortenedDuration = note.startMs - previous.startMs;
        if (shortenedDuration < 20) {
          if (note.velocity > previous.velocity) output[output.length - 1] = note;
          continue;
        }
        previous.durationMs = shortenedDuration;
        const trimmedPitch = trimNoteCurve(previous.pitchBendCurve, 0, shortenedDuration);
        if (trimmedPitch === undefined) delete previous.pitchBendCurve;
        else previous.pitchBendCurve = trimmedPitch;
        if (previous.gainCurve !== undefined) {
          previous.gainCurve = [
            ...previous.gainCurve.filter((point) => point.timeMs < shortenedDuration),
            { timeMs: shortenedDuration, value: 0 },
          ];
        }
      }
    }
    output.push(note);
  }
  return output;
};

const melodyNotes = (features: AudioFeatures): MelodyNote[] => {
  if (features.transcribedNotes !== undefined) {
    const sourceNotes = features.transcribedNotes
      .filter((note) => Number.isFinite(note.startMs) && Number.isFinite(note.durationMs))
      .sort((first, second) => first.startMs - second.startMs);
    const activeRegions = features.activityRegions.length > 0
      ? features.activityRegions
      : [{ endMs: features.durationMs, peak: 1, startMs: 0 }];
    const clipped = sourceNotes.flatMap((note) => {
      const noteStart = clamp(note.startMs, 0, features.durationMs);
      const noteEnd = clamp(noteStart + note.durationMs, noteStart, features.durationMs);
      return activeRegions.flatMap((region) => {
        const startMs = Math.max(noteStart, region.startMs);
        const endMs = Math.min(noteEnd, region.endMs);
        const durationMs = endMs - startMs;
        if (durationMs < 20) return [];
        const pitchBendCurve = trimNoteCurve(
          note.pitchBendCurve,
          startMs - noteStart,
          durationMs
        );
        return [{
          ...note,
          durationMs,
          ...(pitchBendCurve === undefined ? {} : { pitchBendCurve }),
          startMs,
          velocity: clamp(Number.isFinite(note.velocity) ? note.velocity : 0.7, 0.01, 1),
        }];
      });
    });
    return monophonic(clipped, features.pitch)
      .map((note) => shapedNote(features, note, note.velocity))
      .filter((note): note is MelodyNote => note !== undefined)
      .slice(0, melodyNoteLimit(features));
  }
  const notes: MelodyNote[] = [];
  let group: typeof features.pitch = [];
  let segmentStart = 0;
  let segmentEnd = features.durationMs;
  const flush = (boundaryMs = segmentEnd): void => {
    if (group.length === 0) return;
    const first = group[0];
    const last = group[group.length - 1];
    if (first === undefined || last === undefined) return;
    const start = Math.max(segmentStart, first.timeMs - 24);
    const end = Math.min(segmentEnd, boundaryMs, last.timeMs + 24);
    const durationMs = end - start;
    const midi = rounded(median(group.map((point) => frequencyToMidi(point.frequency))), 24, 96);
    if (durationMs >= 20) {
      const pitchBendCurve = simplifyAutomationCurve(group.map((point) => ({
        timeMs: rounded(point.timeMs - start, 0, durationMs),
        value: (frequencyToMidi(point.frequency) - midi) * 100,
      })), Math.min(64, Math.max(8, Math.ceil(durationMs / 35))));
      const note = shapedNote(features, {
        durationMs,
        midi,
        pitchBendCurve,
        startMs: start,
        velocity: 1,
      }, mean(group.map((point) => point.confidence)));
      if (note !== undefined) notes.push(note);
    }
    group = [];
  };

  const orderedPitch = [...features.pitch].sort((first, second) => first.timeMs - second.timeMs);
  for (const region of features.activityRegions) {
    segmentStart = region.startMs;
    segmentEnd = region.endMs;
    const regionPoints = orderedPitch.filter(
      (point) => point.timeMs >= region.startMs && point.timeMs <= region.endMs
    );
    for (const point of regionPoints) {
      const previous = group[group.length - 1];
      const sharpJump = previous !== undefined
        && point.timeMs - previous.timeMs < 70
        && Math.abs(frequencyToMidi(point.frequency) - frequencyToMidi(previous.frequency)) > 1.8;
      if (previous !== undefined && (point.timeMs - previous.timeMs > 65 || sharpJump)) {
        flush((previous.timeMs + point.timeMs) / 2);
        segmentStart = Math.max(region.startMs, (previous.timeMs + point.timeMs) / 2);
      }
      group.push(point);
    }
    flush(region.endMs);
  }
  return monophonic(notes, features.pitch).slice(0, melodyNoteLimit(features));
};

const melodyConfig = (features: AudioFeatures): MelodyConfig => ({
  durationMs: rounded(features.durationMs, 120, 60_000),
  filterFrequency: rounded(Math.max(1_000, features.centroidHz * 1.8), 700, 9_000),
  masterVolume: 0.24,
  notes: melodyNotes(features),
  oscillatorType: melodyOscillatorFor(features),
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
      summary: `${config.layers.length} evidence-gated layers follow ${features.activityRegions.length} active regions, the measured envelope, pitch, and ${features.onsetTimesMs.length} events.`,
    };
  }
  if (mode === 'beat') {
    const config = beatConfig(features);
    return {
      config,
      engine: features.engine,
      features,
      mode,
      summary: features.onsetTimesMs.length > 0
        ? `${config.lanes.length} timbre-matched sounds with ${features.onsetTimesMs.length} hits, measured dynamics, and unquantized source timing.`
        : 'No clear beatboxing hits were detected; no fallback hit was synthesized.',
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
        ? `${config.notes.length} source-bounded notes preserve phrase timing, rests, dynamics, and pitch contour.`
        : 'No stable melody was detected; try a clearer single-note line.',
  };
};
