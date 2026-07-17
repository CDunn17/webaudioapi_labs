import { analysisAdapter, analysisEngineLabel } from './voice/analyzers';
import { frameRms } from './voice/dsp';
import { generateResult } from './voice/generators';
import { ProceduralPreview } from './voice/preview';
import type {
  AnalysisEngineId,
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

if (
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
  !(meydaCheckbox instanceof HTMLInputElement)
) {
  throw new Error('Voice Lab markup is missing required elements.');
}

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
    } else if (result.mode === 'beat') {
      addMetric(metrics, 'Tempo', `${result.config.bpm} BPM`);
      addMetric(metrics, 'Lanes', `${result.config.lanes.length}`);
      addMetric(metrics, 'Grid', `${result.config.stepCount} steps`);
      addMetric(
        metrics,
        'Hits',
        `${result.config.lanes.reduce((total, lane) => total + lane.steps.filter((step) => step > 0).length, 0)}`
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
    if (result.mode === 'beat') card.append(renderBeatLanes(result));
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

  for (const engine of engines) {
    const adapter = analysisAdapter(engine);
    if (adapter === undefined) continue;
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const features = await adapter.analyze(decodedRecording, selectedMode);
      generatedResults.push(generateResult(selectedMode, features));
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
window.addEventListener('pagehide', () => {
  cleanCaptureResources();
  preview.close();
  if (recordingUrl !== undefined) URL.revokeObjectURL(recordingUrl);
});

renderMode();
renderResults();
