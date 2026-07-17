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
const filterStartInput = document.getElementById('filter-start');
const filterEndInput = document.getElementById('filter-end');
const filterMinLevelInput = document.getElementById('filter-min-level');
const filterMaxLevelInput = document.getElementById('filter-max-level');
const resetFiltersButton = document.getElementById('reset-filters');

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
  !(filterStartInput instanceof HTMLInputElement) ||
  !(filterEndInput instanceof HTMLInputElement) ||
  !(filterMinLevelInput instanceof HTMLInputElement) ||
  !(filterMaxLevelInput instanceof HTMLInputElement) ||
  !(resetFiltersButton instanceof HTMLButtonElement)
) {
  throw new Error('Voice Lab markup is missing required elements.');
}

appVersion.textContent = `v${__APP_VERSION__}`;

let selectedMode: CreationMode = 'effect';
let decodedRecording: AudioBuffer | undefined;
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

const resetAnalysisFilters = (): void => {
  const duration = decodedRecording?.duration ?? 0;
  filterStartInput.value = '0';
  filterStartInput.max = duration.toFixed(2);
  filterEndInput.value = duration.toFixed(2);
  filterEndInput.max = duration.toFixed(2);
  filterMinLevelInput.value = '0';
  filterMaxLevelInput.value = '100';
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
      void preview.play(result, () => {
        activePreviewEngine = undefined;
        updatePreviewButtons();
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
    resetAnalysisFilters();
    captureTime.textContent = `${decodedRecording.duration.toFixed(1)}s`;
    analyzeButton.disabled = false;
    setCaptureStatus('Ready');
    captureMessage.value = 'Recording ready. Generate one or both procedural interpretations.';
  } catch {
    decodedRecording = undefined;
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
      const message = error instanceof Error ? error.message : 'Unknown analysis error';
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
  input.addEventListener('change', () => {
    generatedResults = [];
    preview.stop();
    activePreviewEngine = undefined;
    renderResults();
    setResultStatus('Filter changed');
    captureMessage.value = 'Generate configs to apply the analysis filter.';
  });
}
window.addEventListener('pagehide', () => {
  cleanCaptureResources();
  preview.close();
  if (recordingUrl !== undefined) URL.revokeObjectURL(recordingUrl);
});

renderMode();
renderResults();
