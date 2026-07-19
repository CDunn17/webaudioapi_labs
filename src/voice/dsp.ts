import type { AutomationPoint } from '../config/audio';
import type { FrameFeatures, PitchPoint } from './types';

export const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[midpoint] ?? 0;
  return ((sorted[midpoint - 1] ?? 0) + (sorted[midpoint] ?? 0)) / 2;
};

export const mean = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

export const monoSamples = (buffer: AudioBuffer): Float32Array => {
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let index = 0; index < samples.length; index += 1) {
      mono[index] = (mono[index] ?? 0) + (samples[index] ?? 0) / buffer.numberOfChannels;
    }
  }
  return mono;
};

export const frameRms = (frame: Float32Array): number => {
  let energy = 0;
  for (const sample of frame) energy += sample * sample;
  return Math.sqrt(energy / Math.max(1, frame.length));
};

export const framePeak = (samples: Float32Array): number => {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak;
};

export const frameZcr = (frame: Float32Array): number => {
  let crossings = 0;
  for (let index = 1; index < frame.length; index += 1) {
    if (((frame[index] ?? 0) >= 0) !== ((frame[index - 1] ?? 0) >= 0)) crossings += 1;
  }
  return crossings / Math.max(1, frame.length - 1);
};

export type TrimmedSignal = {
  endMs: number;
  samples: Float32Array;
  startMs: number;
};

export const trimActiveRegion = (
  samples: Float32Array,
  sampleRate: number
): TrimmedSignal => {
  const windowSize = Math.max(64, Math.round(sampleRate * 0.01));
  const levels: number[] = [];
  for (let start = 0; start < samples.length; start += windowSize) {
    const frame = new Float32Array(windowSize);
    frame.set(samples.slice(start, Math.min(samples.length, start + windowSize)));
    levels.push(frameRms(frame));
  }
  const peakLevel = Math.max(0, ...levels);
  if (peakLevel < 0.002 || levels.length === 0) {
    return {
      endMs: (samples.length / sampleRate) * 1000,
      samples,
      startMs: 0,
    };
  }

  const edgeCount = Math.max(1, Math.min(12, Math.floor(levels.length / 5)));
  const noiseFloor = median([
    ...levels.slice(0, edgeCount),
    ...levels.slice(-edgeCount),
  ]);
  const startThreshold = Math.max(0.003, noiseFloor * 3.2, peakLevel * 0.015);
  const tailThreshold = Math.max(0.002, noiseFloor * 2.2, peakLevel * 0.006);
  const firstActive = levels.findIndex((level) => level >= startThreshold);
  let lastActive = -1;
  for (let index = levels.length - 1; index >= 0; index -= 1) {
    if ((levels[index] ?? 0) >= tailThreshold) {
      lastActive = index;
      break;
    }
  }
  if (firstActive < 0 || lastActive < firstActive) {
    return {
      endMs: (samples.length / sampleRate) * 1000,
      samples,
      startMs: 0,
    };
  }

  const preRollSamples = Math.round(sampleRate * 0.04);
  const postRollSamples = Math.round(sampleRate * 0.09);
  const startSample = Math.max(0, firstActive * windowSize - preRollSamples);
  const endSample = Math.min(
    samples.length,
    (lastActive + 1) * windowSize + postRollSamples
  );
  return {
    endMs: (endSample / sampleRate) * 1000,
    samples: samples.slice(startSample, endSample),
    startMs: (startSample / sampleRate) * 1000,
  };
};

export const smoothValues = (values: number[], radius = 1): number[] =>
  values.map((_, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length, index + radius + 1);
    return mean(values.slice(start, end));
  });

export const simplifyAutomationCurve = (
  points: AutomationPoint[],
  maximumPoints = 14
): AutomationPoint[] => {
  if (points.length <= maximumPoints) return points;
  const simplified = points.map((point) => ({ ...point }));
  const minimumValue = Math.min(...points.map((point) => point.value));
  const maximumValue = Math.max(...points.map((point) => point.value));
  const valueRange = Math.max(1e-9, maximumValue - minimumValue);

  while (simplified.length > maximumPoints) {
    let removeIndex = 1;
    let smallestError = Number.POSITIVE_INFINITY;
    for (let index = 1; index < simplified.length - 1; index += 1) {
      const previous = simplified[index - 1];
      const current = simplified[index];
      const next = simplified[index + 1];
      if (previous === undefined || current === undefined || next === undefined) continue;
      const timeRange = Math.max(1, next.timeMs - previous.timeMs);
      const progress = (current.timeMs - previous.timeMs) / timeRange;
      const interpolated = previous.value + (next.value - previous.value) * progress;
      const error = Math.abs(current.value - interpolated) / valueRange;
      if (error < smallestError) {
        smallestError = error;
        removeIndex = index;
      }
    }
    simplified.splice(removeIndex, 1);
  }
  return simplified;
};

const fftMagnitudes = (frame: Float32Array): Float32Array => {
  const size = frame.length;
  const real = new Float64Array(size);
  const imaginary = new Float64Array(size);

  for (let index = 0; index < size; index += 1) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1));
    real[index] = (frame[index] ?? 0) * window;
  }

  let target = 0;
  for (let index = 0; index < size; index += 1) {
    if (index < target) {
      const temporary = real[index] ?? 0;
      real[index] = real[target] ?? 0;
      real[target] = temporary;
    }
    let bit = size >> 1;
    while (target >= bit && bit > 0) {
      target -= bit;
      bit >>= 1;
    }
    target += bit;
  }

  for (let length = 2; length <= size; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const phaseReal = Math.cos(angle);
    const phaseImaginary = Math.sin(angle);
    for (let start = 0; start < size; start += length) {
      let rotationReal = 1;
      let rotationImaginary = 0;
      for (let offset = 0; offset < length / 2; offset += 1) {
        const even = start + offset;
        const odd = even + length / 2;
        const oddReal = (real[odd] ?? 0) * rotationReal - (imaginary[odd] ?? 0) * rotationImaginary;
        const oddImaginary = (real[odd] ?? 0) * rotationImaginary + (imaginary[odd] ?? 0) * rotationReal;
        const evenReal = real[even] ?? 0;
        const evenImaginary = imaginary[even] ?? 0;
        real[even] = evenReal + oddReal;
        imaginary[even] = evenImaginary + oddImaginary;
        real[odd] = evenReal - oddReal;
        imaginary[odd] = evenImaginary - oddImaginary;
        const nextReal = rotationReal * phaseReal - rotationImaginary * phaseImaginary;
        rotationImaginary = rotationReal * phaseImaginary + rotationImaginary * phaseReal;
        rotationReal = nextReal;
      }
    }
  }

  const magnitudes = new Float32Array(size / 2);
  for (let index = 0; index < magnitudes.length; index += 1) {
    magnitudes[index] = Math.hypot(real[index] ?? 0, imaginary[index] ?? 0);
  }
  return magnitudes;
};

export const spectralFeatures = (
  frame: Float32Array,
  sampleRate: number
): { centroidHz: number; flatness: number; rolloffHz: number } => {
  const magnitudes = fftMagnitudes(frame);
  let weighted = 0;
  let total = 0;
  let logTotal = 0;
  for (let index = 0; index < magnitudes.length; index += 1) {
    const magnitude = Math.max(0, magnitudes[index] ?? 0);
    weighted += index * magnitude;
    total += magnitude;
    logTotal += Math.log(Math.max(1e-12, magnitude));
  }
  if (total <= 1e-9) {
    return { centroidHz: 0, flatness: 0, rolloffHz: 0 };
  }
  const centroidBin = total > 0 ? weighted / total : 0;
  const arithmeticMean = total / Math.max(1, magnitudes.length);
  const geometricMean = Math.exp(logTotal / Math.max(1, magnitudes.length));
  const rolloffTarget = total * 0.85;
  let cumulative = 0;
  let rolloffBin = 0;
  for (let index = 0; index < magnitudes.length; index += 1) {
    cumulative += magnitudes[index] ?? 0;
    if (cumulative >= rolloffTarget) {
      rolloffBin = index;
      break;
    }
  }
  const binHz = sampleRate / frame.length;
  return {
    centroidHz: centroidBin * binHz,
    flatness: arithmeticMean > 0 ? clamp(geometricMean / arithmeticMean, 0, 1) : 0,
    rolloffHz: rolloffBin * binHz,
  };
};

export const detectOnsets = (frames: FrameFeatures[], minimumGapMs: number): number[] => {
  if (frames.length < 3) return [];
  const novelty = frames.map((frame, index) => {
    const previous = frames[index - 1];
    if (previous === undefined) return 0;
    const energyRise = Math.max(0, frame.rms - previous.rms) * 8;
    const brightnessRise = Math.max(0, frame.centroidHz - previous.centroidHz) / 12_000;
    return energyRise + brightnessRise;
  });
  const baseline = median(novelty);
  const deviation = median(novelty.map((value) => Math.abs(value - baseline)));
  const threshold = Math.max(0.018, baseline + deviation * 3.5);
  const onsets: number[] = [];

  for (let index = 1; index < novelty.length - 1; index += 1) {
    const value = novelty[index] ?? 0;
    const timeMs = frames[index]?.timeMs ?? 0;
    if (
      value >= threshold &&
      value >= (novelty[index - 1] ?? 0) &&
      value > (novelty[index + 1] ?? 0) &&
      (onsets.length === 0 || timeMs - (onsets[onsets.length - 1] ?? 0) >= minimumGapMs)
    ) {
      onsets.push(timeMs);
    }
  }

  const firstActive = frames.find((frame) => frame.rms > 0.018)?.timeMs;
  if (firstActive !== undefined && (onsets[0] === undefined || onsets[0] - firstActive > 80)) {
    onsets.unshift(firstActive);
  }
  return onsets;
};

// Use spectral/energy attacks to find quiet hits, then snap each attack to its
// nearby amplitude crest. This is deliberately more permissive than effect onset
// detection; the beat generator only needs event timing and relative timbre.
export const detectBeatPeaks = (frames: FrameFeatures[], minimumGapMs: number): number[] => {
  if (frames.length < 3) return [];
  // Each RMS frame is already a windowed average. Smoothing it again widened
  // vocal hits and raised the valleys between them.
  const levels = frames.map((frame) => frame.rms);
  const maximum = Math.max(0, ...levels);
  const sortedLevels = [...levels].sort((first, second) => first - second);
  const floor = sortedLevels[Math.floor((sortedLevels.length - 1) * 0.15)] ?? 0;
  const threshold = Math.max(1e-6, floor * 1.8, maximum * 0.025);
  const candidates: Array<{ level: number; timeMs: number }> = [];

  const attacks = detectOnsets(frames, Math.max(35, minimumGapMs * 0.7));
  for (const attack of attacks) {
    const region = frames
      .map((frame, index) => ({ index, timeMs: frame.timeMs }))
      .filter(({ timeMs }) => timeMs >= attack - 25 && timeMs <= attack + 75);
    const crestIndex = region.reduce(
      (best, item) => (levels[item.index] ?? 0) > (levels[best] ?? 0) ? item.index : best,
      region[0]?.index ?? 0
    );
    const level = levels[crestIndex] ?? 0;
    if (level >= threshold) {
      candidates.push({ level, timeMs: frames[crestIndex]?.timeMs ?? attack });
    }
  }

  // A strongly separated amplitude crest can be missed when its spectrum is
  // similar to the preceding hit, so include those crests as a second signal.
  for (let index = 1; index < levels.length - 1; index += 1) {
    const level = levels[index] ?? 0;
    const valley = Math.min(...levels.slice(Math.max(0, index - 3), index));
    if (level >= threshold && level > (levels[index - 1] ?? 0) && level >= (levels[index + 1] ?? 0) && level > valley * 1.12) {
      candidates.push({ level, timeMs: frames[index]?.timeMs ?? 0 });
    }
  }

  candidates.sort((first, second) => first.timeMs - second.timeMs);
  const peaks: typeof candidates = [];
  for (const candidate of candidates) {
    const previous = peaks[peaks.length - 1];
    if (previous === undefined || candidate.timeMs - previous.timeMs >= minimumGapMs) {
      peaks.push(candidate);
    } else if (candidate.level > previous.level) {
      peaks[peaks.length - 1] = candidate;
    }
  }
  return peaks.map((peak) => peak.timeMs);
};

const autocorrelationPitch = (
  frame: Float32Array,
  sampleRate: number,
  maximumFrequency: number
): { confidence: number; frequency: number } | undefined => {
  const rms = frameRms(frame);
  if (rms < 0.004) return undefined;
  const midpoint = Math.floor(frame.length / 2);
  const firstHalfRms = frameRms(frame.slice(0, midpoint));
  const secondHalfRms = frameRms(frame.slice(midpoint));
  const edgeSize = Math.max(32, Math.floor(frame.length / 8));
  const leadingEdgeRms = frameRms(frame.slice(0, edgeSize));
  const trailingEdgeRms = frameRms(frame.slice(-edgeSize));
  // A frame containing only an onset/tail fragment may fit several cycles of
  // an upper harmonic but not one full fundamental period. Leave that boundary
  // unpitched instead of creating a short octave note.
  if (
    Math.min(firstHalfRms, secondHalfRms) < rms * 0.3 ||
    Math.min(leadingEdgeRms, trailingEdgeRms) < rms * 0.5
  ) return undefined;
  const minimumLag = Math.max(2, Math.floor(sampleRate / maximumFrequency));
  // The shortest admissible period can sit between minimumLag and the next
  // sample. Measure one supporting lag below the candidate range so that peak
  // can still be interpolated without admitting an above-limit candidate.
  const correlationMinimumLag = Math.max(1, minimumLag - 1);
  const maximumLag = Math.min(Math.floor(sampleRate / 70), frame.length - 4);
  let bestLag = 0;
  let bestCorrelation = 0;
  const correlations = new Float64Array(maximumLag + 1);

  for (let lag = correlationMinimumLag; lag <= maximumLag; lag += 1) {
    let cross = 0;
    let firstEnergy = 0;
    let secondEnergy = 0;
    for (let index = 0; index < frame.length - lag; index += 2) {
      const first = frame[index] ?? 0;
      const second = frame[index + lag] ?? 0;
      cross += first * second;
      firstEnergy += first * first;
      secondEnergy += second * second;
    }
    const denominator = Math.sqrt(firstEnergy * secondEnergy);
    const correlation = denominator > 0 ? cross / denominator : 0;
    correlations[lag] = correlation;
    if (lag >= minimumLag && correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }
  if (bestLag === 0 || bestCorrelation < 0.58) return undefined;
  type CorrelationPeak = { lag: number; value: number };
  const interpolatedPeak = (lag: number): CorrelationPeak => {
    const center = Math.round(clamp(lag, minimumLag, maximumLag));
    const current = correlations[center] ?? 0;
    if (center <= correlationMinimumLag || center >= maximumLag) {
      return { lag: center, value: clamp(current, 0, 1) };
    }
    const previous = correlations[center - 1] ?? current;
    const next = correlations[center + 1] ?? current;
    const curvature = previous - 2 * current + next;
    if (curvature >= -1e-9) {
      return { lag: center, value: clamp(current, 0, 1) };
    }
    // A clean tone's autocorrelation peak is cosine-shaped. A parabola
    // underestimates very short (4--7 sample) periods enough to make a later
    // integer-aligned multiple look materially stronger. Fit that cosine when
    // its local samples support one, retaining the parabola for other shapes.
    const cosine = current > 1e-9
      ? clamp((previous + next) / (2 * current), -1, 1)
      : 1;
    const angularFrequency = Math.acos(cosine);
    const angularSine = Math.sin(angularFrequency);
    if (angularFrequency > 1e-6 && angularSine > 1e-6) {
      const cosineOffset = clamp(
        Math.atan2(next - previous, 2 * current * angularSine) / angularFrequency,
        -1,
        1
      );
      const cosineScale = Math.cos(angularFrequency * cosineOffset);
      const cosineValue = current / cosineScale;
      if (cosineScale > 1e-6 && Number.isFinite(cosineValue)) {
        return {
          lag: clamp(center + cosineOffset, minimumLag, maximumLag),
          value: clamp(cosineValue, 0, 1),
        };
      }
    }
    const offset = clamp(0.5 * (previous - next) / curvature, -1, 1);
    return {
      lag: clamp(center + offset, minimumLag, maximumLag),
      value: clamp(current - 0.25 * (previous - next) * offset, 0, 1),
    };
  };
  const strongestPeakNear = (center: number): CorrelationPeak => {
    let strongest: CorrelationPeak | undefined;
    for (
      let lag = Math.max(minimumLag, Math.floor(center) - 3);
      lag <= Math.min(maximumLag, Math.ceil(center) + 3);
      lag += 1
    ) {
      const correlation = correlations[lag] ?? 0;
      if (
        correlation < (correlations[Math.max(correlationMinimumLag, lag - 1)] ?? 0) ||
        correlation < (correlations[Math.min(maximumLag, lag + 1)] ?? 0)
      ) continue;
      const peak = interpolatedPeak(lag);
      if (strongest === undefined || peak.value > strongest.value) strongest = peak;
    }
    return strongest ?? interpolatedPeak(center);
  };
  // Multiples of the true period can have a marginally higher correlation and
  // previously pulled clean tones down by one or more octaves. Prefer the
  // earliest strong local peak near the global maximum.
  // A true period and its integer multiples are nearly tied for a clean tone.
  // A dominant upper harmonic can also create an early peak, but the matching
  // full-period multiple is materially stronger. Validate that relationship
  // explicitly instead of relying on one fixed near-maximum threshold. Compare
  // interpolated peak heights so short high-frequency periods are not penalized
  // merely because their first integer lag falls between samples.
  let selectedPeak = interpolatedPeak(bestLag);
  const nearMaximum = Math.max(0.58, selectedPeak.value * 0.9);
  for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
    const correlation = correlations[lag] ?? 0;
    if (
      correlation < (correlations[Math.max(correlationMinimumLag, lag - 1)] ?? 0) ||
      correlation < (correlations[Math.min(maximumLag, lag + 1)] ?? 0)
    ) continue;
    const peak = interpolatedPeak(lag);
    const materiallyStrongerMultiple = [2, 3, 4].some((multiple) => {
      const center = peak.lag * multiple;
      if (center > maximumLag) return false;
      return strongestPeakNear(center).value >= peak.value + 0.012;
    });
    if (
      peak.value >= nearMaximum &&
      !materiallyStrongerMultiple
    ) {
      selectedPeak = peak;
      break;
    }
  }
  return { confidence: selectedPeak.value, frequency: sampleRate / selectedPeak.lag };
};

export const detectPitchTrack = (
  samples: Float32Array,
  sampleRate: number,
  frameSize = 2048,
  hopSize = 2048,
  maximumFrequency = 720
): PitchPoint[] => {
  const points: PitchPoint[] = [];
  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    const detected = autocorrelationPitch(
      samples.slice(start, start + frameSize),
      sampleRate,
      maximumFrequency
    );
    if (detected === undefined) continue;
    points.push({
      confidence: detected.confidence,
      frequency: detected.frequency,
      timeMs: ((start + frameSize / 2) / sampleRate) * 1000,
    });
  }
  return points;
};
