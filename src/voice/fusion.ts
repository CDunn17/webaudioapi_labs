import { clamp, mean, median } from './dsp';
import { generateResult } from './generators';
import type {
  AudioFeatures,
  MelodyNote,
  MelodyResult,
  ProceduralResult,
  ResultEngineId,
} from './types';

const ENGINE_WEIGHT: Record<ResultEngineId, number> = {
  basicPitch: 4,
  combined: 0,
  essentia: 3,
  meyda: 1.5,
  webAudio: 1.5,
};

const overlapMs = (first: MelodyNote, second: MelodyNote): number => {
  const firstEnd = first.startMs + first.durationMs;
  const secondEnd = second.startMs + second.durationMs;
  return Math.max(0, Math.min(firstEnd, secondEnd) - Math.max(first.startMs, second.startMs));
};

const weightedMedian = (values: Array<{ value: number; weight: number }>): number => {
  const sorted = values.sort((first, second) => first.value - second.value);
  const midpoint = sorted.reduce((sum, item) => sum + item.weight, 0) / 2;
  let accumulated = 0;
  for (const item of sorted) {
    accumulated += item.weight;
    if (accumulated >= midpoint) return item.value;
  }
  return sorted[sorted.length - 1]?.value ?? 60;
};

const matchingNote = (result: MelodyResult, anchor: MelodyNote): MelodyNote | undefined => {
  const anchorEnd = anchor.startMs + anchor.durationMs;
  return result.config.notes
    .map((note) => {
      const overlap = overlapMs(anchor, note);
      const noteEnd = note.startMs + note.durationMs;
      const pitchDistance = Math.abs(note.midi - anchor.midi);
      const timingDistance = Math.abs(note.startMs - anchor.startMs) +
        Math.abs(noteEnd - anchorEnd) * 0.5;
      const score = pitchDistance * 90 + timingDistance - overlap * 0.35;
      return { note, overlap, pitchDistance, score };
    })
    .filter(({ note, overlap, pitchDistance }) =>
      pitchDistance <= 1.6 &&
      (overlap >= Math.min(35, anchor.durationMs * 0.2) ||
        Math.abs(note.startMs - anchor.startMs) <= 35)
    )
    .sort((first, second) => first.score - second.score)[0]?.note;
};

const supportingNotes = (results: MelodyResult[], anchor: MelodyNote) =>
  results.flatMap((result) => {
    const note = matchingNote(result, anchor);
    return note === undefined ? [] : [{ engine: result.engine, note }];
  });

const amplitudeNear = (result: ProceduralResult, timeMs: number): number => {
  const point = [...result.features.amplitudeCurve].sort(
    (first, second) => Math.abs(first.timeMs - timeMs) - Math.abs(second.timeMs - timeMs)
  )[0];
  return clamp(point?.value ?? 0, 0, 1);
};

const combinedNote = (results: MelodyResult[], anchor: MelodyNote): MelodyNote => {
  const support = supportingNotes(results, anchor);
  const values = support.length > 0 ? support : [{ engine: 'combined' as const, note: anchor }];
  const midpoint = anchor.startMs + anchor.durationMs / 2;
  const dynamics = mean(results.map((result) => amplitudeNear(result, midpoint)));
  const filterFrequencies = values
    .map(({ note }) => note.filterFrequency)
    .filter((frequency): frequency is number => frequency !== undefined);
  const midi = Math.round(weightedMedian(values.map(({ engine, note }) => ({
    value: note.midi,
    weight: ENGINE_WEIGHT[engine],
  }))));
  const pitchBendCurve = anchor.pitchBendCurve?.map((point) => ({
    ...point,
    value: point.value + (anchor.midi - midi) * 100,
  }));
  return {
    // Boundaries come from one coherent transcription clock. Other engines
    // contribute pitch and tone, but cannot stretch notes across its rests.
    durationMs: anchor.durationMs,
    ...(filterFrequencies.length > 0
      ? { filterFrequency: Math.round(median(filterFrequencies)) }
      : {}),
    ...(anchor.gainCurve === undefined ? {} : { gainCurve: anchor.gainCurve }),
    midi,
    ...(pitchBendCurve === undefined
      ? {}
      : { pitchBendCurve }),
    startMs: anchor.startMs,
    velocity: clamp(mean(values.map(({ note }) => note.velocity)) * 0.55 + dynamics * 0.45, 0.01, 1),
  };
};

const boundarySource = (results: MelodyResult[]): MelodyResult | undefined => {
  const basicPitch = results.find((result) => result.engine === 'basicPitch' && result.config.notes.length > 0);
  return basicPitch ?? [...results].sort(
    (first, second) => second.config.notes.length - first.config.notes.length
  )[0];
};

export const combineMelodyResults = (results: MelodyResult[]): MelodyResult | undefined => {
  const source = boundarySource(results);
  if (source === undefined || source.config.notes.length === 0) return undefined;
  const anchors = [...source.config.notes];
  const durationMs = Math.max(...results.map((result) => result.config.durationMs));
  const noteLimit = Math.min(192, Math.max(64, Math.ceil(durationMs / 1_000 * 8)));
  const notes = anchors
    .map((anchor) => combinedNote(results, anchor))
    .sort((first, second) => first.startMs - second.startMs)
    .slice(0, noteLimit);
  const meyda = results.find((result) => result.engine === 'meyda');
  const timbreSource = meyda ?? source;
  const features = {
    ...source.features,
    amplitudeCurve: timbreSource.features.amplitudeCurve,
    brightnessCurve: timbreSource.features.brightnessCurve,
    centroidHz: median(results.map((result) => result.features.centroidHz)),
    engine: 'combined' as const,
    flatness: median(results.map((result) => result.features.flatness)),
    onsetTimesMs: notes.map((note) => note.startMs),
    pitch: results.flatMap((result) => result.features.pitch)
      .sort((first, second) => first.timeMs - second.timeMs),
    rolloffHz: median(results.map((result) => result.features.rolloffHz)),
    transcribedNotes: notes,
    zcr: median(results.map((result) => result.features.zcr)),
  };
  return {
    config: {
      durationMs,
      filterFrequency: timbreSource.config.filterFrequency,
      masterVolume: clamp(mean(results.map((result) => result.config.masterVolume)), 0.1, 0.8),
      notes,
      oscillatorType: timbreSource.config.oscillatorType,
    },
    engine: 'combined',
    features,
    mode: 'melody',
    summary: `${notes.length} source-bounded notes using ${source.engine === 'basicPitch' ? 'Basic Pitch' : source.engine} timing, cross-engine pitch support, and ${timbreSource.engine} timbre.`,
  };
};

const consensusOnsets = (results: ProceduralResult[]): number[] => {
  const tolerance = results[0]?.mode === 'beat' ? 50 : 45;
  const events = results.flatMap((result) => result.features.onsetTimesMs.map((time) => ({
    engine: result.engine,
    time,
  }))).sort((first, second) => first.time - second.time);
  const clusters: typeof events[] = [];
  for (const event of events) {
    const cluster = clusters
      .filter((candidate) => !candidate.some((item) => item.engine === event.engine))
      .map((candidate) => ({
        candidate,
        center: median(candidate.map((item) => item.time)),
        span: Math.max(...candidate.map((item) => item.time), event.time) -
          Math.min(...candidate.map((item) => item.time), event.time),
      }))
      .filter(({ center, span }) => Math.abs(event.time - center) <= tolerance && span <= tolerance)
      .sort((first, second) =>
        Math.abs(event.time - first.center) - Math.abs(event.time - second.center)
      )[0]?.candidate;
    if (cluster === undefined) {
      clusters.push([event]);
    } else {
      cluster.push(event);
    }
  }
  const evidence = clusters.map((cluster) => {
    const timeMs = median(cluster.map((event) => event.time));
    return {
      cluster,
      sourceStrength: mean(results.map((result) => amplitudeNear(result, timeMs))),
      support: new Set(cluster.map((event) => event.engine)).size,
      timeMs,
    };
  });
  const consensus = evidence
    .filter((item, index) => item.support >= 2 || (
      item.sourceStrength >= 0.18 &&
      !evidence.some((other, otherIndex) =>
        otherIndex !== index && Math.abs(other.timeMs - item.timeMs) < 45
      )
    ))
    .map(({ timeMs }) => Math.round(timeMs));
  if (consensus.length > 0) return consensus;
  // If detectors disagree at close offsets, retain only the strongest
  // source-backed interpretation. Never restore an unfiltered engine list,
  // which would bypass the evidence checks above.
  const fallback: typeof evidence = [];
  for (const item of [...evidence]
    .filter((candidate) => candidate.sourceStrength >= 0.18)
    .sort((first, second) => second.sourceStrength - first.sourceStrength)) {
    if (fallback.some((candidate) => Math.abs(candidate.timeMs - item.timeMs) < 45)) continue;
    fallback.push(item);
  }
  return fallback.map((item) => Math.round(item.timeMs)).sort((first, second) => first - second);
};

const combineFeatures = (results: ProceduralResult[]): AudioFeatures => {
  const source = results.find((result) => result.engine === 'meyda') ?? results[0]!;
  return {
    ...source.features,
    centroidHz: median(results.map((result) => result.features.centroidHz)),
    durationMs: Math.max(...results.map((result) => result.features.durationMs)),
    engine: 'combined',
    flatness: median(results.map((result) => result.features.flatness)),
    onsetTimesMs: consensusOnsets(results),
    peak: median(results.map((result) => result.features.peak)),
    pitch: results.flatMap((result) => result.features.pitch)
      .sort((first, second) => first.timeMs - second.timeMs),
    rms: median(results.map((result) => result.features.rms)),
    rolloffHz: median(results.map((result) => result.features.rolloffHz)),
    sourceEndMs: Math.max(...results.map((result) => result.features.sourceEndMs)),
    sourceStartMs: Math.min(...results.map((result) => result.features.sourceStartMs)),
    zcr: median(results.map((result) => result.features.zcr)),
  };
};

export const combineProceduralResults = (
  results: ProceduralResult[]
): ProceduralResult | undefined => {
  const individual = results.filter((result) => result.engine !== 'combined');
  if (individual.length < 2) return undefined;
  if (individual.every((result) => result.mode === 'melody')) {
    return combineMelodyResults(individual as MelodyResult[]);
  }
  const mode = individual[0]?.mode;
  if (mode === undefined || individual.some((result) => result.mode !== mode)) return undefined;
  const combined = generateResult(mode, combineFeatures(individual));
  if (combined.mode === 'beat') {
    combined.summary = `${combined.features.onsetTimesMs.length} source-supported hits with Meyda timbre and cross-engine timing; strong measured peaks survive a single detector miss.`;
  } else if (combined.mode === 'effect') {
    combined.summary = `${combined.config.layers.length} fused layers using source-supported events, median spectral features, shared dynamics, and combined pitch evidence.`;
  }
  return combined;
};
