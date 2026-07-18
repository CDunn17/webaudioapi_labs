import { analysisAdapter, analysisEngineLabel } from './voice/analyzers';
import { frameRms } from './voice/dsp';
import { fitEffectConfig } from './voice/fit';
import { generateResult } from './voice/generators';
import { ProceduralPreview } from './voice/preview';
import type {
  AnalysisEngineId,
  BeatConfig,
  BeatLane,
  CreationMode,
  ProceduralResult,
} from './voice/types';

type ModeDetails = {
  guidance: string;
  limitMs: number;
  title: string;
};

const MODE_DETAILS: Record<CreationMode, ModeDetails> = {
  effect: {
    guidance: 'Make the sound once, including its attack and full decay.',
    limitMs: 4_000,
    title: 'Record an effect',
  },
  beat: {
    guidance: 'Perform a short repeating pattern with clearly separated vocal hits.',
    limitMs: 12_000,
    title: 'Record a beat',
  },
  melody: {
    guidance: 'Hum one clear lead line without simultaneous percussion or harmony.',
    limitMs: 16_000,
    title: 'Record a melody',
  },
};

const modeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-mode]'));
const appVersion = document.getElementById('app-version');
const recordButton = document.getElementById('record-button');
const stopButton = document.getElementById('stop-button');
const clearButton = document.getElementById('clear-button');
const analyzeButton = document.getElementById('analyze-button');
const recordingFile = document.getElementById('recording-file');
const recordingPlayback = document.getElementById('recording-playback');
const captureTitle = document.getElementById('capture-title');
const captureGuidance = document.getElementById('capture-guidance');
const captureStatus = document.getElementById('capture-status');
const captureTime = document.getElementById('capture-time');
const inputKind = document.getElementById('input-kind');
const captureLimit = document.getElementById('capture-limit');
const levelFill = document.getElementById('level-fill');
const captureMessage = document.getElementById('capture-message');
const resultStatus = document.getElementById('result-status');
const resultsSummary = document.getElementById('results-summary');
const voiceResults = document.getElementById('voice-results');
const webAudioCheckbox = document.getElementById('engine-web-audio');
const meydaCheckbox = document.getElementById('engine-meyda');
const essentiaCheckbox = document.getElementById('engine-essentia');
const basicPitchCheckbox = document.getElementById('engine-basic-pitch');
const basicPitchOption = document.getElementById('engine-basic-pitch-option');
const filterStartInput = document.getElementById('filter-start');
const filterEndInput = document.getElementById('filter-end');
const filterMinLevelInput = document.getElementById('filter-min-level');
const filterMaxLevelInput = document.getElementById('filter-max-level');
const resetFiltersButton = document.getElementById('reset-filters');
const filterVisual = document.getElementById('filter-visual');
const filterWaveform = document.getElementById('filter-waveform');
const filterSelection = document.getElementById('filter-selection');
const filterPlayhead = document.getElementById('filter-playhead');
const filterStartHandle = document.getElementById('filter-start-handle');
const filterEndHandle = document.getElementById('filter-end-handle');
const filterMinHandle = document.getElementById('filter-min-handle');
const filterMaxHandle = document.getElementById('filter-max-handle');

if (
  appVersion === null ||
  !(recordButton instanceof HTMLButtonElement) ||
  !(stopButton instanceof HTMLButtonElement) ||
  !(clearButton instanceof HTMLButtonElement) ||
  !(analyzeButton instanceof HTMLButtonElement) ||
  !(recordingFile instanceof HTMLInputElement) ||
  !(recordingPlayback instanceof HTMLAudioElement) ||
  captureTitle === null ||
  captureGuidance === null ||
  captureStatus === null ||
  captureTime === null ||
  inputKind === null ||
  captureLimit === null ||
  levelFill === null ||
  !(captureMessage instanceof HTMLOutputElement) ||
  resultStatus === null ||
  resultsSummary === null ||
  voiceResults === null ||
  !(webAudioCheckbox instanceof HTMLInputElement) ||
  !(meydaCheckbox instanceof HTMLInputElement) ||
  !(essentiaCheckbox instanceof HTMLInputElement) ||
  !(basicPitchCheckbox instanceof HTMLInputElement) ||
  !(basicPitchOption instanceof HTMLLabelElement) ||
  !(filterStartInput instanceof HTMLInputElement) ||
  !(filterEndInput instanceof HTMLInputElement) ||
  !(filterMinLevelInput instanceof HTMLInputElement) ||
  !(filterMaxLevelInput instanceof HTMLInputElement) ||
  !(resetFiltersButton instanceof HTMLButtonElement)
  || !(filterVisual instanceof HTMLDivElement)
  || !(filterWaveform instanceof HTMLCanvasElement)
  || !(filterSelection instanceof HTMLDivElement)
  || !(filterPlayhead instanceof HTMLDivElement)
  || !(filterStartHandle instanceof HTMLButtonElement)
  || !(filterEndHandle instanceof HTMLButtonElement)
  || !(filterMinHandle instanceof HTMLButtonElement)
  || !(filterMaxHandle instanceof HTMLButtonElement)
) {
  throw new Error('Voice Lab markup is missing required elements.');
}

appVersion.textContent = `v${__APP_VERSION__}`;

let selectedMode: CreationMode = 'effect';
let decodedRecording: AudioBuffer | undefined;
let decodedRecordingPeak = 1;
let recordingUrl: string | undefined;
let recorder: MediaRecorder | undefined;
let recordingChunks: Blob[] = [];
let discardStoppedRecording = false;
let mediaStream: MediaStream | undefined;
let captureContext: AudioContext | undefined;
let captureAnalyser: AnalyserNode | undefined;
let captureInterval: number | undefined;
let limitTimer: number | undefined;
let captureStartedAt = 0;
let generatedResults: ProceduralResult[] = [];
let activePreviewEngine: AnalysisEngineId | undefined;
const preview = new ProceduralPreview();

const filterHandles = {
  end: filterEndHandle,
  max: filterMaxHandle,
  min: filterMinHandle,
  start: filterStartHandle,
};

const filterNumber = (input: HTMLInputElement, fallback: number): number => {
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
};

const recordingPeak = (recording: AudioBuffer): number => {
  let peak = 0;
  for (let channel = 0; channel < recording.numberOfChannels; channel += 1) {
    const data = recording.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      peak = Math.max(peak, Math.abs(data[index] ?? 0));
    }
  }
  return Math.max(peak, Number.EPSILON);
};

const renderFilterVisual = (): void => {
  const bounds = filterVisual.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(bounds.width));
  const height = Math.max(1, Math.round(bounds.height));
  filterWaveform.width = Math.round(width * ratio);
  filterWaveform.height = Math.round(height * ratio);
  const context = filterWaveform.getContext('2d');
  if (context !== null) {
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);
    context.strokeStyle = 'rgba(190, 216, 218, 0.1)';
    context.beginPath();
    for (let line = 1; line < 4; line += 1) {
      const y = (height * line) / 4;
      context.moveTo(0, y);
      context.lineTo(width, y);
    }
    context.stroke();
    if (decodedRecording !== undefined) {
      const samplesPerPixel = decodedRecording.length / width;
      context.fillStyle = 'rgba(174, 189, 208, 0.7)';
      for (let x = 0; x < width; x += 1) {
        const from = Math.floor(x * samplesPerPixel);
        const to = Math.min(decodedRecording.length, Math.ceil((x + 1) * samplesPerPixel));
        let peak = 0;
        for (let channel = 0; channel < decodedRecording.numberOfChannels; channel += 1) {
          const data = decodedRecording.getChannelData(channel);
          for (let index = from; index < to; index += 1) peak = Math.max(peak, Math.abs(data[index] ?? 0));
        }
        const normalizedPeak = Math.min(1, peak / decodedRecordingPeak);
        context.fillRect(x, height - normalizedPeak * height, 1, normalizedPeak * height);
      }
    }
  }
  const duration = decodedRecording?.duration ?? 0;
  const start = duration > 0 ? Math.max(0, Math.min(1, filterNumber(filterStartInput, 0) / duration)) : 0;
  const end = duration > 0 ? Math.max(start, Math.min(1, filterNumber(filterEndInput, duration) / duration)) : 1;
  const min = Math.max(0, Math.min(100, filterNumber(filterMinLevelInput, 0)));
  const max = Math.max(min, Math.min(100, filterNumber(filterMaxLevelInput, 100)));
  filterStartHandle.style.left = `${start * 100}%`;
  filterEndHandle.style.left = `${end * 100}%`;
  filterMinHandle.style.top = `${100 - min}%`;
  filterMaxHandle.style.top = `${100 - max}%`;
  filterSelection.style.left = `${start * 100}%`;
  filterSelection.style.width = `${(end - start) * 100}%`;
  filterSelection.style.top = `${100 - max}%`;
  filterSelection.style.height = `${max - min}%`;
  filterStartHandle.setAttribute('aria-valuenow', filterStartInput.value);
  filterEndHandle.setAttribute('aria-valuenow', filterEndInput.value);
  filterMinHandle.setAttribute('aria-valuenow', filterMinLevelInput.value);
  filterMaxHandle.setAttribute('aria-valuenow', filterMaxLevelInput.value);
};

type FilterHandleName = keyof typeof filterHandles;

const setFilterFromPosition = (name: FilterHandleName, clientX: number, clientY: number): void => {
  if (decodedRecording === undefined) return;
  const bounds = filterVisual.getBoundingClientRect();
  const horizontal = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
  const vertical = Math.max(0, Math.min(100, 100 - ((clientY - bounds.top) / bounds.height) * 100));
  const start = filterNumber(filterStartInput, 0);
  const end = filterNumber(filterEndInput, decodedRecording.duration);
  const min = filterNumber(filterMinLevelInput, 0);
  const max = filterNumber(filterMaxLevelInput, 100);
  if (name === 'start') filterStartInput.value = Math.min(end, horizontal * decodedRecording.duration).toFixed(2);
  if (name === 'end') filterEndInput.value = Math.max(start, horizontal * decodedRecording.duration).toFixed(2);
  if (name === 'min') filterMinLevelInput.value = `${Math.round(Math.min(max, vertical))}`;
  if (name === 'max') filterMaxLevelInput.value = `${Math.round(Math.max(min, vertical))}`;
  renderFilterVisual();
};

const markFilterChanged = (): void => {
  generatedResults = [];
  preview.stop();
  activePreviewEngine = undefined;
  renderResults();
  setResultStatus('Filter changed');
  captureMessage.value = 'Generate configs to apply the analysis filter.';
};

for (const [name, handle] of Object.entries(filterHandles) as [FilterHandleName, HTMLButtonElement][]) {
  const isTime = name === 'start' || name === 'end';
  handle.setAttribute('role', 'slider');
  handle.setAttribute('aria-valuemin', '0');
  handle.setAttribute('aria-valuemax', isTime ? '0' : '100');
  handle.addEventListener('pointerdown', (event) => {
    handle.setPointerCapture(event.pointerId);
    setFilterFromPosition(name, event.clientX, event.clientY);
  });
  handle.addEventListener('pointermove', (event) => {
    if (handle.hasPointerCapture(event.pointerId)) setFilterFromPosition(name, event.clientX, event.clientY);
  });
  handle.addEventListener('pointerup', (event) => {
    if (!handle.hasPointerCapture(event.pointerId)) return;
    handle.releasePointerCapture(event.pointerId);
    markFilterChanged();
  });
  handle.addEventListener('keydown', (event) => {
    const direction = event.key === 'ArrowRight' || event.key === 'ArrowUp'
      ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0;
    if (direction === 0 || decodedRecording === undefined) return;
    event.preventDefault();
    const input = name === 'start' ? filterStartInput
      : name === 'end' ? filterEndInput
        : name === 'min' ? filterMinLevelInput : filterMaxLevelInput;
    const step = isTime ? 0.1 : 1;
    const next = filterNumber(input, 0) + direction * step;
    const x = boundsForKeyboard(next, filterVisual);
    setFilterFromPosition(name, x.clientX, x.clientY);
    markFilterChanged();
  });
}

function boundsForKeyboard(value: number, visual: HTMLDivElement): { clientX: number; clientY: number } {
  const bounds = visual.getBoundingClientRect();
  const duration = decodedRecording?.duration ?? 1;
  return {
    clientX: bounds.left + (value / duration) * bounds.width,
    clientY: bounds.top + (1 - value / 100) * bounds.height,
  };
}

const resetAnalysisFilters = (): void => {
  const duration = decodedRecording?.duration ?? 0;
  filterStartInput.value = '0';
  filterStartInput.max = duration.toFixed(2);
  filterEndInput.value = duration.toFixed(2);
  filterEndInput.max = duration.toFixed(2);
  filterMinLevelInput.value = '0';
  filterMaxLevelInput.value = '100';
  filterStartHandle.setAttribute('aria-valuemax', duration.toFixed(2));
  filterEndHandle.setAttribute('aria-valuemax', duration.toFixed(2));
  renderFilterVisual();
};

const filteredRecording = (source: AudioBuffer): AudioBuffer => {
  const clampedNumber = (input: HTMLInputElement, fallback: number): number => {
    const value = Number(input.value);
    return Number.isFinite(value) ? value : fallback;
  };
  const sampleDuration = 1 / source.sampleRate;
  const startSeconds = Math.max(0, Math.min(source.duration - sampleDuration, clampedNumber(filterStartInput, 0)));
  const endSeconds = Math.max(startSeconds + 1 / source.sampleRate, Math.min(
    source.duration,
    clampedNumber(filterEndInput, source.duration)
  ));
  const minimumLevel = Math.max(0, Math.min(1, clampedNumber(filterMinLevelInput, 0) / 100));
  const maximumLevel = Math.max(minimumLevel, Math.min(1, clampedNumber(filterMaxLevelInput, 100) / 100));
  const startSample = Math.floor(startSeconds * source.sampleRate);
  const endSample = Math.max(startSample + 1, Math.ceil(endSeconds * source.sampleRate));
  const length = endSample - startSample;
  const output = new AudioBuffer({
    length,
    numberOfChannels: source.numberOfChannels,
    sampleRate: source.sampleRate,
  });
  let peak = 0;
  for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
    const input = source.getChannelData(channel);
    for (let index = startSample; index < endSample; index += 1) {
      peak = Math.max(peak, Math.abs(input[index] ?? 0));
    }
  }
  const envelopeCoefficient = Math.exp(-1 / (source.sampleRate * 0.012));
  const gainCoefficient = Math.exp(-1 / (source.sampleRate * 0.003));
  let envelope = 0;
  let gain = 0;
  for (let index = 0; index < length; index += 1) {
    let magnitude = 0;
    for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
      magnitude = Math.max(magnitude, Math.abs(source.getChannelData(channel)[startSample + index] ?? 0));
    }
    envelope = Math.max(magnitude, envelope * envelopeCoefficient);
    const normalizedLevel = peak > 0 ? envelope / peak : 0;
    const targetGain = normalizedLevel >= minimumLevel && normalizedLevel <= maximumLevel ? 1 : 0;
    gain = targetGain + (gain - targetGain) * gainCoefficient;
    for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
      output.getChannelData(channel)[index] = (source.getChannelData(channel)[startSample + index] ?? 0) * gain;
    }
  }
  return output;
};

const setCaptureStatus = (value: string): void => {
  captureStatus.textContent = value;
};

const setResultStatus = (value: string): void => {
  resultStatus.textContent = value;
};

const renderMode = (): void => {
  const details = MODE_DETAILS[selectedMode];
  captureTitle.textContent = details.title;
  captureGuidance.textContent = details.guidance;
  captureLimit.textContent = `${details.limitMs / 1000}s`;
  const isMelody = selectedMode === 'melody';
  basicPitchCheckbox.disabled = !isMelody;
  basicPitchOption.hidden = !isMelody;
  analyzeButton.textContent = selectedMode === 'effect'
    ? 'Generate effect configs'
    : selectedMode === 'beat' ? 'Generate beat configs' : 'Generate melody configs';
  for (const button of modeButtons) {
    const isSelected = button.dataset.mode === selectedMode;
    button.classList.toggle('is-active', isSelected);
    button.setAttribute('aria-checked', `${isSelected}`);
  }
};

const emptyResults = (message: string): void => {
  voiceResults.replaceChildren();
  const empty = document.createElement('div');
  empty.className = 'voice-empty-state';
  empty.textContent = message;
  voiceResults.append(empty);
};

const selectedEngines = (): AnalysisEngineId[] => {
  const engines: AnalysisEngineId[] = [];
  if (webAudioCheckbox.checked) engines.push('webAudio');
  if (meydaCheckbox.checked) engines.push('meyda');
  if (essentiaCheckbox.checked) engines.push('essentia');
  if (selectedMode === 'melody' && basicPitchCheckbox.checked) engines.push('basicPitch');
  return engines;
};

const formatConfig = (result: ProceduralResult): string => {
  const name =
    result.mode === 'effect'
      ? 'GENERATED_EFFECT'
      : result.mode === 'beat'
        ? 'GENERATED_BEAT'
        : 'GENERATED_MELODY';
  return `export const ${name} = ${JSON.stringify(result.config, null, 2)};`;
};

const addMetric = (container: HTMLElement, label: string, value: string): void => {
  const item = document.createElement('div');
  const labelElement = document.createElement('span');
  const valueElement = document.createElement('strong');
  labelElement.textContent = label;
  valueElement.textContent = value;
  item.append(labelElement, valueElement);
  container.append(item);
};

const renderBeatLanes = (result: Extract<ProceduralResult, { mode: 'beat' }>): HTMLElement => {
  const lanes = document.createElement('div');
  lanes.className = 'beat-lanes';
  for (const lane of result.config.lanes) {
    const row = document.createElement('div');
    row.className = 'beat-lane';
    row.style.setProperty('--beat-step-count', `${result.config.stepCount}`);
    const label = document.createElement('strong');
    label.textContent = lane.label;
    row.append(label);
    lane.steps.forEach((velocity) => {
      const hit = document.createElement('span');
      hit.className = 'beat-hit';
      hit.classList.toggle('is-on', velocity > 0);
      hit.title = velocity > 0 ? `Velocity ${velocity.toFixed(2)}` : 'Empty step';
      row.append(hit);
    });
    lanes.append(row);
  }
  return lanes;
};

const rebuildBeatGroups = (config: BeatConfig): void => {
  const stepMs = 60_000 / config.bpm / config.stepsPerBeat;
  const groups = new Map<string, BeatLane>();
  for (const lane of config.lanes) {
    for (const hit of lane.hits) {
      const label = hit.label.trim() || 'Unlabeled';
      hit.label = label;
      let group = groups.get(label.toLocaleLowerCase());
      if (group === undefined) {
        group = {
          hits: [],
          label,
          steps: Array.from({ length: config.stepCount }, () => 0),
          voice: { ...lane.voice },
        };
        groups.set(label.toLocaleLowerCase(), group);
      }
      group.hits.push(hit);
      const step = Math.round(hit.startMs / stepMs) % config.stepCount;
      group.steps[step] = Math.max(group.steps[step] ?? 0, hit.velocity);
    }
  }
  config.lanes = [...groups.values()].map((lane) => ({
    ...lane,
    hits: lane.hits.sort((first, second) => first.startMs - second.startMs),
  }));
};

const numberEditor = (
  value: number,
  minimum: number,
  maximum: number,
  step: number,
  onChange: (value: number) => void
): HTMLInputElement => {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = `${minimum}`;
  input.max = `${maximum}`;
  input.step = `${step}`;
  input.value = `${value}`;
  input.addEventListener('change', () => {
    const parsed = Number(input.value);
    if (Number.isFinite(parsed)) onChange(Math.max(minimum, Math.min(maximum, parsed)));
  });
  return input;
};

const renderBeatEditor = (
  result: Extract<ProceduralResult, { mode: 'beat' }>
): HTMLElement => {
  const editor = document.createElement('section');
  editor.className = 'beat-event-editor';
  const heading = document.createElement('div');
  heading.className = 'beat-editor-heading';
  const headingText = document.createElement('div');
  const title = document.createElement('strong');
  const guidance = document.createElement('p');
  title.textContent = 'Review events and suggested sounds';
  guidance.textContent = 'Events with the same label use exactly the same digital sound.';
  headingText.append(title, guidance);
  const reanalyze = document.createElement('button');
  reanalyze.className = 'secondary-button';
  reanalyze.type = 'button';
  reanalyze.textContent = 'Re-analyze recording';
  reanalyze.addEventListener('click', () => void generateConfigs());
  const headingActions = document.createElement('div');
  headingActions.className = 'transport-row';
  const addEvent = document.createElement('button');
  addEvent.className = 'secondary-button';
  addEvent.type = 'button';
  addEvent.textContent = 'Add event';
  addEvent.addEventListener('click', () => {
    const lane = result.config.lanes[0];
    if (lane === undefined) return;
    lane.hits.push({
      label: lane.label,
      startMs: Math.max(0, result.config.durationMs - 260),
      velocity: 0.7,
    });
    rebuildBeatGroups(result.config);
    renderResults();
  });
  headingActions.append(addEvent, reanalyze);
  heading.append(headingText, headingActions);
  editor.append(heading);

  const timing = document.createElement('div');
  timing.className = 'beat-timing-editor';
  const subdivisionLabel = document.createElement('label');
  subdivisionLabel.textContent = 'Grid divisions per beat';
  const subdivision = document.createElement('select');
  for (const value of [1, 2, 4, 8]) {
    const option = document.createElement('option');
    option.value = `${value}`;
    option.textContent = `${value}`;
    option.selected = value === result.config.stepsPerBeat;
    subdivision.append(option);
  }
  subdivisionLabel.append(subdivision);
  const strengthLabel = document.createElement('label');
  strengthLabel.textContent = 'Timing correction (%)';
  const strength = numberEditor(50, 0, 100, 5, () => undefined);
  strengthLabel.append(strength);
  const applyTiming = document.createElement('button');
  applyTiming.className = 'secondary-button';
  applyTiming.type = 'button';
  applyTiming.textContent = 'Apply timing';
  applyTiming.addEventListener('click', () => {
    const divisions = Number(subdivision.value);
    const correction = Number(strength.value) / 100;
    const gridMs = 60_000 / result.config.bpm / divisions;
    result.config.stepsPerBeat = divisions;
    for (const lane of result.config.lanes) {
      for (const hit of lane.hits) {
        const target = Math.round(hit.startMs / gridMs) * gridMs;
        hit.startMs += (target - hit.startMs) * correction;
      }
    }
    rebuildBeatGroups(result.config);
    renderResults();
  });
  timing.append(subdivisionLabel, strengthLabel, applyTiming);
  editor.append(timing);

  const sounds = document.createElement('div');
  sounds.className = 'suggested-sounds';
  for (const lane of result.config.lanes) {
    const sound = document.createElement('div');
    sound.className = 'suggested-sound';
    const soundTitle = document.createElement('strong');
    soundTitle.textContent = `${lane.label} suggestion`;
    const fields = document.createElement('div');
    fields.className = 'beat-editor-fields';
    const addField = (label: string, input: HTMLInputElement): void => {
      const wrapper = document.createElement('label');
      wrapper.append(label, input);
      fields.append(wrapper);
    };
    addField('Tone (Hz)', numberEditor(lane.voice.frequency, 40, 2_000, 1, (value) => {
      lane.voice.frequency = value;
      renderResults();
    }));
    addField('Decay (ms)', numberEditor(lane.voice.decayMs, 20, 500, 5, (value) => {
      lane.voice.decayMs = value;
      renderResults();
    }));
    addField('Volume', numberEditor(lane.voice.volume, 0.01, 1, 0.01, (value) => {
      lane.voice.volume = value;
      renderResults();
    }));
    sound.append(soundTitle, fields);
    sounds.append(sound);
  }
  editor.append(sounds);

  const events = document.createElement('div');
  events.className = 'beat-events';
  const orderedEvents = result.config.lanes.flatMap((lane) =>
    lane.hits.map((hit) => ({ hit, lane }))
  ).sort((first, second) => first.hit.startMs - second.hit.startMs);
  orderedEvents.forEach(({ hit, lane }, index) => {
    const row = document.createElement('div');
    row.className = 'beat-event-row';
    const eventNumber = document.createElement('strong');
    eventNumber.textContent = `${index + 1}`;
    const label = document.createElement('input');
    label.value = hit.label;
    label.setAttribute('aria-label', `Event ${index + 1} sound label`);
    label.addEventListener('change', () => {
      hit.label = label.value;
      rebuildBeatGroups(result.config);
      renderResults();
    });
    const time = numberEditor(hit.startMs, 0, result.config.durationMs, 1, (value) => {
      hit.startMs = value;
      rebuildBeatGroups(result.config);
      renderResults();
    });
    time.setAttribute('aria-label', `Event ${index + 1} time in milliseconds`);
    const velocity = numberEditor(hit.velocity, 0.05, 1, 0.05, (value) => {
      hit.velocity = value;
      rebuildBeatGroups(result.config);
      renderResults();
    });
    velocity.setAttribute('aria-label', `Event ${index + 1} velocity`);
    const remove = document.createElement('button');
    remove.className = 'secondary-button';
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.disabled = orderedEvents.length <= 1;
    remove.addEventListener('click', () => {
      lane.hits = lane.hits.filter((candidate) => candidate !== hit);
      rebuildBeatGroups(result.config);
      renderResults();
    });
    row.append(eventNumber, label, time, velocity, remove);
    events.append(row);
  });
  editor.append(events);
  return editor;
};

const updatePreviewButtons = (): void => {
  document.querySelectorAll<HTMLButtonElement>('[data-preview-engine]').forEach((button) => {
    button.textContent = button.dataset.previewEngine === activePreviewEngine ? 'Stop preview' : 'Preview config';
  });
  if (activePreviewEngine === undefined) {
    filterPlayhead.classList.remove('is-playing');
  }
};

const updateFilterPlayhead = (result: ProceduralResult, elapsedMs: number): void => {
  const duration = decodedRecording?.duration ?? 0;
  if (duration <= 0 || activePreviewEngine !== result.engine) return;
  const selectedStartMs = filterNumber(filterStartInput, 0) * 1000;
  const selectedEndMs = filterNumber(filterEndInput, duration) * 1000;
  const sourceOffsetMs = Math.max(0, result.features.sourceStartMs);
  const positionMs = Math.min(
    selectedEndMs,
    selectedStartMs + sourceOffsetMs + Math.max(0, elapsedMs)
  );
  const positionPercent = positionMs / (duration * 1000) * 100;
  filterPlayhead.style.left = `${Math.max(0, Math.min(100, positionPercent))}%`;
  filterPlayhead.classList.add('is-playing');
};

const renderResults = (): void => {
  voiceResults.replaceChildren();
  if (generatedResults.length === 0) {
    emptyResults('Record or choose audio, then generate at least one procedural result.');
    return;
  }

  for (const result of generatedResults) {
    const card = document.createElement('article');
    card.className = 'voice-result-card';
    const header = document.createElement('div');
    header.className = 'voice-result-header';
    const heading = document.createElement('div');
    const title = document.createElement('h3');
    const summary = document.createElement('p');
    const badge = document.createElement('span');
    title.textContent = analysisEngineLabel(result.engine);
    summary.textContent = result.summary;
    badge.className = 'sound-kind';
    badge.textContent = result.mode;
    heading.append(title, summary);
    header.append(heading, badge);

    const metrics = document.createElement('div');
    metrics.className = 'voice-result-metrics';
    if (result.mode === 'effect') {
      addMetric(metrics, 'Layers', `${result.config.layers.length}`);
      addMetric(metrics, 'Active duration', `${(result.features.durationMs / 1000).toFixed(2)}s`);
      addMetric(metrics, 'Brightness', `${Math.round(result.features.centroidHz)} Hz`);
      addMetric(metrics, 'Onsets', `${result.features.onsetTimesMs.length}`);
      if (result.fit !== undefined) {
        addMetric(metrics, 'Render fit', `${Math.round(result.fit.improvement * 100)}% closer`);
      }
    } else if (result.mode === 'beat') {
      addMetric(metrics, 'Tempo', `${result.config.bpm} BPM`);
      addMetric(metrics, 'Lanes', `${result.config.lanes.length}`);
      addMetric(metrics, 'Grid', `${result.config.stepCount} steps`);
      addMetric(
        metrics,
        'Hits',
        `${result.config.lanes.reduce((total, lane) => total + lane.hits.length, 0)}`
      );
    } else {
      addMetric(metrics, 'Notes', `${result.config.notes.length}`);
      addMetric(metrics, 'Waveform', result.config.oscillatorType);
      addMetric(metrics, 'Voiced frames', `${result.features.pitch.length}`);
      addMetric(metrics, 'Filter', `${result.config.filterFrequency} Hz`);
    }

    const actions = document.createElement('div');
    actions.className = 'transport-row';
    const previewButton = document.createElement('button');
    previewButton.className = 'primary-button';
    previewButton.dataset.previewEngine = result.engine;
    previewButton.type = 'button';
    previewButton.textContent = 'Preview config';
    previewButton.disabled = result.mode === 'melody' && result.config.notes.length === 0;
    previewButton.addEventListener('click', () => {
      if (activePreviewEngine === result.engine) {
        preview.stop();
        activePreviewEngine = undefined;
        updatePreviewButtons();
        return;
      }
      recordingPlayback.pause();
      activePreviewEngine = result.engine;
      updatePreviewButtons();
      void preview.play(result, (elapsedMs) => {
        updateFilterPlayhead(result, elapsedMs);
      }).catch((error: unknown) => {
        preview.stop();
        activePreviewEngine = undefined;
        updatePreviewButtons();
        const message = error instanceof Error ? error.message : String(error);
        captureMessage.value = `${analysisEngineLabel(result.engine)} preview failed: ${message}`;
      });
    });
    const copyButton = document.createElement('button');
    copyButton.className = 'secondary-button';
    copyButton.type = 'button';
    copyButton.textContent = 'Copy config';
    copyButton.addEventListener('click', () => {
      const text = formatConfig(result);
      void navigator.clipboard.writeText(text).then(
        () => {
          captureMessage.value = `Copied the ${analysisEngineLabel(result.engine)} config.`;
        },
        () => {
          captureMessage.value = text;
        }
      );
    });
    actions.append(previewButton, copyButton);

    const config = document.createElement('pre');
    config.className = 'config-preview';
    config.textContent = formatConfig(result);
    card.append(header, metrics);
    if (result.mode === 'beat') card.append(renderBeatLanes(result), renderBeatEditor(result));
    card.append(actions, config);
    voiceResults.append(card);
  }
  updatePreviewButtons();
};

const cleanCaptureResources = (): void => {
  if (captureInterval !== undefined) window.clearInterval(captureInterval);
  if (limitTimer !== undefined) window.clearTimeout(limitTimer);
  captureInterval = undefined;
  limitTimer = undefined;
  captureAnalyser?.disconnect();
  captureAnalyser = undefined;
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = undefined;
  const context = captureContext;
  captureContext = undefined;
  if (context !== undefined && context.state !== 'closed') {
    void context.close().catch(() => undefined);
  }
  levelFill.style.width = '0%';
};

const decodeRecording = async (blob: Blob, sourceLabel: string): Promise<void> => {
  preview.stop();
  activePreviewEngine = undefined;
  generatedResults = [];
  renderResults();
  if (recordingUrl !== undefined) URL.revokeObjectURL(recordingUrl);
  recordingUrl = URL.createObjectURL(blob);
  recordingPlayback.src = recordingUrl;
  recordingPlayback.hidden = false;
  inputKind.textContent = sourceLabel;
  analyzeButton.disabled = true;
  setCaptureStatus('Decoding');
  captureMessage.value = '';

  const context = new AudioContext();
  try {
    decodedRecording = await context.decodeAudioData(await blob.arrayBuffer());
    decodedRecordingPeak = recordingPeak(decodedRecording);
    resetAnalysisFilters();
    captureTime.textContent = `${decodedRecording.duration.toFixed(1)}s`;
    analyzeButton.disabled = false;
    setCaptureStatus('Ready');
    captureMessage.value = 'Recording ready. Generate one or both procedural interpretations.';
  } catch {
    decodedRecording = undefined;
    decodedRecordingPeak = 1;
    setCaptureStatus('Unsupported');
    captureMessage.value = 'This browser could not decode that audio format.';
  } finally {
    await context.close().catch(() => undefined);
  }
};

const stopRecording = (): void => {
  if (recorder?.state === 'recording') recorder.stop();
  recordButton.disabled = false;
  stopButton.disabled = true;
  setCaptureStatus('Processing');
};

const updateCaptureMeter = (): void => {
  if (captureAnalyser === undefined) return;
  const data = new Float32Array(captureAnalyser.fftSize);
  captureAnalyser.getFloatTimeDomainData(data);
  levelFill.style.width = `${Math.min(100, frameRms(data) * 650)}%`;
  captureTime.textContent = `${((performance.now() - captureStartedAt) / 1000).toFixed(1)}s`;
};

const startRecording = async (): Promise<void> => {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    setCaptureStatus('Unavailable');
    captureMessage.value = 'Microphone recording is not available in this browser.';
    return;
  }
  try {
    preview.stop();
    recordingPlayback.pause();
    generatedResults = [];
    renderResults();
    captureMessage.value = '';
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { autoGainControl: false, echoCancellation: false, noiseSuppression: false },
    });
    captureContext = new AudioContext();
    const source = captureContext.createMediaStreamSource(mediaStream);
    captureAnalyser = captureContext.createAnalyser();
    captureAnalyser.fftSize = 2048;
    source.connect(captureAnalyser);
    const preferredMime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((type) =>
      MediaRecorder.isTypeSupported(type)
    );
    recorder = preferredMime === undefined
      ? new MediaRecorder(mediaStream)
      : new MediaRecorder(mediaStream, { mimeType: preferredMime });
    discardStoppedRecording = false;
    recordingChunks = [];
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) recordingChunks.push(event.data);
    });
    recorder.addEventListener('stop', () => {
      const blob = new Blob(recordingChunks, { type: recorder?.mimeType || 'audio/webm' });
      cleanCaptureResources();
      recorder = undefined;
      if (discardStoppedRecording) {
        discardStoppedRecording = false;
        return;
      }
      void decodeRecording(blob, 'Microphone');
    }, { once: true });
    recorder.start(100);
    captureStartedAt = performance.now();
    captureInterval = window.setInterval(updateCaptureMeter, 70);
    limitTimer = window.setTimeout(stopRecording, MODE_DETAILS[selectedMode].limitMs);
    recordButton.disabled = true;
    stopButton.disabled = false;
    setCaptureStatus('Recording');
  } catch {
    cleanCaptureResources();
    recorder = undefined;
    recordButton.disabled = false;
    stopButton.disabled = true;
    setCaptureStatus('Blocked');
    captureMessage.value = 'Microphone permission was not available.';
  }
};

const generateConfigs = async (): Promise<void> => {
  if (decodedRecording === undefined) return;
  const engines = selectedEngines();
  if (engines.length === 0) {
    captureMessage.value = 'Select at least one analysis engine.';
    return;
  }
  preview.stop();
  activePreviewEngine = undefined;
  generatedResults = [];
  analyzeButton.disabled = true;
  setResultStatus('Analyzing');
  resultsSummary.textContent = 'Extracting features and fitting procedural parameters…';
  emptyResults('Analyzing the recording…');
  captureMessage.value = '';
  const analysisRecording = filteredRecording(decodedRecording);

  for (const engine of engines) {
    const adapter = analysisAdapter(engine);
    if (adapter === undefined) continue;
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const features = await adapter.analyze(analysisRecording, selectedMode);
      const result = generateResult(selectedMode, features);
      if (result.mode === 'effect') {
        try {
          setResultStatus('Fitting');
          const fitted = await fitEffectConfig(
            result.config,
            features,
            adapter,
            (completed, total) => {
              resultsSummary.textContent = `${adapter.label}: fitting procedural render ${completed}/${total}…`;
            }
          );
          const improvement = fitted.initialLoss > 0
            ? Math.max(0, 1 - fitted.finalLoss / fitted.initialLoss)
            : 0;
          result.config = fitted.config;
          result.fit = {
            candidateCount: fitted.candidateCount,
            finalLoss: fitted.finalLoss,
            improvement,
          };
          result.summary += ` Render fitting evaluated ${fitted.candidateCount} candidates.`;
        } catch {
          captureMessage.value = `${adapter.label} generated a config, but offline fitting was unavailable.`;
        }
      }
      generatedResults.push(result);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'message' in error
          ? String(error.message)
          : String(error || 'Unknown analysis error');
      captureMessage.value = `${adapter.label} could not analyze this recording: ${message}`;
    }
  }
  analyzeButton.disabled = false;
  setResultStatus(generatedResults.length > 0 ? 'Generated' : 'Try again');
  resultsSummary.textContent = generatedResults.length > 1
    ? 'Compare how each open-source analysis engine shaped the procedural result.'
    : 'Preview the generated sound and copy its editable configuration.';
  renderResults();
};

const clearRecording = (): void => {
  if (recorder?.state === 'recording') {
    discardStoppedRecording = true;
    recorder.stop();
  }
  cleanCaptureResources();
  preview.stop();
  activePreviewEngine = undefined;
  decodedRecording = undefined;
  decodedRecordingPeak = 1;
  resetAnalysisFilters();
  generatedResults = [];
  if (recordingUrl !== undefined) URL.revokeObjectURL(recordingUrl);
  recordingUrl = undefined;
  recordingPlayback.removeAttribute('src');
  recordingPlayback.hidden = true;
  recordingFile.value = '';
  captureTime.textContent = '0.0s';
  inputKind.textContent = 'Microphone';
  captureMessage.value = '';
  analyzeButton.disabled = true;
  recordButton.disabled = false;
  stopButton.disabled = true;
  setCaptureStatus('Ready');
  setResultStatus('Waiting');
  resultsSummary.textContent = 'Record or choose audio to compare generated configs.';
  renderResults();
};

for (const button of modeButtons) {
  button.addEventListener('click', () => {
    const mode = button.dataset.mode;
    if (mode !== 'effect' && mode !== 'beat' && mode !== 'melody') return;
    selectedMode = mode;
    generatedResults = [];
    preview.stop();
    activePreviewEngine = undefined;
    renderMode();
    renderResults();
    setResultStatus('Waiting');
    resultsSummary.textContent = decodedRecording === undefined
      ? 'Record or choose audio to compare generated configs.'
      : `The recording is ready to reinterpret as a ${mode}.`;
  });
}

recordButton.addEventListener('click', () => {
  void startRecording();
});
stopButton.addEventListener('click', stopRecording);
clearButton.addEventListener('click', clearRecording);
analyzeButton.addEventListener('click', () => {
  void generateConfigs();
});
recordingFile.addEventListener('change', () => {
  const file = recordingFile.files?.[0];
  if (file !== undefined) void decodeRecording(file, 'Audio file');
});
recordingPlayback.addEventListener('play', () => {
  preview.stop();
  activePreviewEngine = undefined;
  updatePreviewButtons();
});
resetFiltersButton.addEventListener('click', () => {
  resetAnalysisFilters();
  captureMessage.value = decodedRecording === undefined
    ? ''
    : 'Analysis filter reset. Generate configs to apply it.';
});
for (const input of [filterStartInput, filterEndInput, filterMinLevelInput, filterMaxLevelInput]) {
  input.addEventListener('input', renderFilterVisual);
  input.addEventListener('change', () => {
    renderFilterVisual();
    markFilterChanged();
  });
}
new ResizeObserver(renderFilterVisual).observe(filterVisual);
window.addEventListener('pagehide', () => {
  cleanCaptureResources();
  preview.close();
  if (recordingUrl !== undefined) URL.revokeObjectURL(recordingUrl);
});

renderMode();
renderResults();
renderFilterVisual();
