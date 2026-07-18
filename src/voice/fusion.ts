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

const overlap = (first: MelodyNote, second: MelodyNote): boolean => {
  const firstEnd = first.startMs + first.durationMs;
  const secondEnd = second.startMs + second.durationMs;
  return first.startMs <= secondEnd + 80 && second.startMs <= firstEnd + 80;
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

const supportingNotes = (results: MelodyResult[], anchor: MelodyNote) =>
  results.flatMap((result) => result.config.notes
    .filter((note) => overlap(anchor, note))
    .map((note) => ({ engine: result.engine, note })));

const amplitudeNear = (result: MelodyResult, timeMs: number): number => {
  const point = [...result.features.amplitudeCurve].sort(
    (first, second) => Math.abs(first.timeMs - timeMs) - Math.abs(second.timeMs - timeMs)
  )[0];
  return clamp(point?.value ?? 0.7, 0, 1);
};

const combinedNote = (results: MelodyResult[], anchor: MelodyNote): MelodyNote => {
  const support = supportingNotes(results, anchor);
  const values = support.length > 0 ? support : [{ engine: 'combined' as const, note: anchor }];
  const midpoint = anchor.startMs + anchor.durationMs / 2;
  const dynamics = mean(results.map((result) => amplitudeNear(result, midpoint)));
  return {
    durationMs: Math.max(20, Math.round(weightedMedian(values.map(({ engine, note }) => ({
      value: note.durationMs,
      weight: ENGINE_WEIGHT[engine],
    }))))),
    midi: Math.round(weightedMedian(values.map(({ engine, note }) => ({
      value: note.midi,
      weight: ENGINE_WEIGHT[engine],
    })))),
    startMs: Math.max(0, Math.round(weightedMedian(values.map(({ engine, note }) => ({
      value: note.startMs,
      weight: ENGINE_WEIGHT[engine],
    }))))),
    velocity: clamp(mean(values.map(({ note }) => note.velocity)) * 0.7 + dynamics * 0.3, 0.05, 1),
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
  for (const result of results) {
    for (const note of result.config.notes) {
      if (anchors.some((anchor) => overlap(anchor, note))) continue;
      const engineSupport = new Set(
        supportingNotes(results, note).map(({ engine }) => engine)
      );
      if (engineSupport.size >= 2) anchors.push(note);
    }
  }
  const notes = anchors
    .map((anchor) => combinedNote(results, anchor))
    .sort((first, second) => first.startMs - second.startMs)
    .slice(0, 64);
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
    pitch: results.flatMap((result) => result.features.pitch),
    rolloffHz: median(results.map((result) => result.features.rolloffHz)),
    transcribedNotes: notes,
    zcr: median(results.map((result) => result.features.zcr)),
  };
  return {
    config: {
      filterFrequency: timbreSource.config.filterFrequency,
      masterVolume: clamp(mean(results.map((result) => result.config.masterVolume)), 0.1, 0.8),
      notes,
      oscillatorType: timbreSource.config.oscillatorType,
    },
    engine: 'combined',
    features,
    mode: 'melody',
    summary: `${notes.length} consensus notes using ${source.engine === 'basicPitch' ? 'Basic Pitch' : source.engine} boundaries, confidence-weighted pitch, and ${timbreSource.engine} timbre.`,
  };
};

const consensusOnsets = (results: ProceduralResult[]): number[] => {
  const tolerance = results[0]?.mode === 'beat' ? 85 : 50;
  const events = results.flatMap((result) => result.features.onsetTimesMs.map((time) => ({
    engine: result.engine,
    time,
  }))).sort((first, second) => first.time - second.time);
  const clusters: typeof events[] = [];
  for (const event of events) {
    const cluster = clusters[clusters.length - 1];
    if (cluster === undefined || event.time - (cluster[cluster.length - 1]?.time ?? 0) > tolerance) {
      clusters.push([event]);
    } else {
      cluster.push(event);
    }
  }
  const consensus = clusters
    .filter((cluster) => new Set(cluster.map((event) => event.engine)).size >= 2)
    .map((cluster) => Math.round(median(cluster.map((event) => event.time))));
  if (consensus.length > 0) return consensus;
  return [...results].sort(
    (first, second) => second.features.onsetTimesMs.length - first.features.onsetTimesMs.length
  )[0]?.features.onsetTimesMs ?? [];
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
    pitch: results.flatMap((result) => result.features.pitch),
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
    combined.summary = `${combined.features.onsetTimesMs.length} consensus hits with Meyda timbre and cross-engine timing. Thresholds require support from at least two engines when available.`;
  } else if (combined.mode === 'effect') {
    combined.summary = `${combined.config.layers.length} fused layers using consensus events, median spectral features, shared dynamics, and combined pitch evidence.`;
  }
  return combined;
};
