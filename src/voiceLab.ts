import { analysisAdapter, analysisEngineLabel } from './voice/analyzers';
import { frameRms } from './voice/dsp';
import { fitEffectConfig } from './voice/fit';
import { generateResult } from './voice/generators';
import { ProceduralPreview } from './voice/preview';
import {
  VOICE_EDITOR_LOAD,
  VOICE_EDITOR_REQUEST,
  cloneConfig,
  isVoiceEditorResultMessage,
} from './voice/editorBridge';
import type {
  AnalysisEngineId,
  AudioFeatures,
  CreationMode,
  ProceduralResult,
  ResultEngineId,
} from './voice/types';

type ModeDetails = {
  guidance: string;
  limitMs: number;
  title: string;
};

type FilterViewport = {
  endSeconds: number;
  maxLevel: number;
  minLevel: number;
  startSeconds: number;
};

type FilterSnapshot = FilterViewport & {
  viewport: FilterViewport;
};

type ModeWorkspace = {
  captureMessage: string;
  decodedRecording: AudioBuffer | undefined;
  decodedRecordingPeak: number;
  filter: FilterSnapshot;
  generatedResults: ProceduralResult[];
  inputLabel: string;
  recordingBlob: Blob | undefined;
  resultStatus: string;
  resultsSummary: string;
};

type LibraryEntry = {
  createdAt: string;
  id: string;
  kind: 'config' | 'sample';
  mimeType?: string;
  mode: CreationMode;
  name: string;
};

type CompositionItemBase = {
  engine: ResultEngineId;
  id: string;
  label: string;
  startMs: number;
};

type CompositionItem =
  | (CompositionItemBase & {
      config: Extract<ProceduralResult, { mode: 'effect' }>['config'];
      mode: 'effect';
    })
  | (CompositionItemBase & {
      config: Extract<ProceduralResult, { mode: 'beat' }>['config'];
      mode: 'beat';
    })
  | (CompositionItemBase & {
      config: Extract<ProceduralResult, { mode: 'melody' }>['config'];
      mode: 'melody';
    });

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

const COMPOSITION_ZOOM_LEVELS = [40, 64, 96, 144, 216, 320];
const COMPOSITION_GAP_MS = 160;

const modeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-mode]'));
const appVersion = document.getElementById('app-version');
const recordButton = document.getElementById('record-button');
const stopButton = document.getElementById('stop-button');
const clearButton = document.getElementById('clear-button');
const analyzeButton = document.getElementById('analyze-button');
const recordingFile = document.getElementById('recording-file');
const recordingPlayback = document.getElementById('recording-playback');
const sampleSaveName = document.getElementById('sample-save-name');
const saveSampleButton = document.getElementById('save-sample');
const sampleLibrarySelect = document.getElementById('sample-library-select');
const loadSampleButton = document.getElementById('load-sample');
const configLibrarySelect = document.getElementById('config-library-select');
const loadConfigButton = document.getElementById('load-config');
const configFile = document.getElementById('config-file');
const refreshLibraryButton = document.getElementById('refresh-library');
const libraryMessage = document.getElementById('library-message');
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
const setFilterButton = document.getElementById('set-filter');
const resetFiltersButton = document.getElementById('reset-filters');
const filterVisual = document.getElementById('filter-visual');
const filterWaveform = document.getElementById('filter-waveform');
const filterSelection = document.getElementById('filter-selection');
const filterPlayhead = document.getElementById('filter-playhead');
const filterStartHandle = document.getElementById('filter-start-handle');
const filterEndHandle = document.getElementById('filter-end-handle');
const filterMinHandle = document.getElementById('filter-min-handle');
const filterMaxHandle = document.getElementById('filter-max-handle');
const previewModal = document.getElementById('preview-modal');
const previewModalTitle = document.getElementById('preview-modal-title');
const previewModalClose = document.getElementById('preview-modal-close');
const previewModalPlay = document.getElementById('preview-modal-play');
const previewModalStop = document.getElementById('preview-modal-stop');
const previewModalWaveform = document.getElementById('preview-modal-waveform');
const previewModalCanvas = document.getElementById('preview-modal-canvas');
const previewModalSelection = document.getElementById('preview-modal-selection');
const previewModalPlayhead = document.getElementById('preview-modal-playhead');
const previewModalTime = document.getElementById('preview-modal-time');
const previewModalAudio = document.getElementById('preview-modal-audio');
const previewOriginalAudio = document.getElementById('preview-original-audio');
const previewResultSelect = document.getElementById('preview-result-select');
const previewResultVolume = document.getElementById('preview-result-volume');
const previewResultMute = document.getElementById('preview-result-mute');
const previewOriginalEnabled = document.getElementById('preview-original-enabled');
const previewOriginalVolume = document.getElementById('preview-original-volume');
const previewOriginalMute = document.getElementById('preview-original-mute');
const configEditorModal = document.getElementById('config-editor-modal');
const configEditorKicker = document.getElementById('config-editor-kicker');
const configEditorTitle = document.getElementById('config-editor-title');
const configEditorClose = document.getElementById('config-editor-close');
const configEditorCancel = document.getElementById('config-editor-cancel');
const configEditorApply = document.getElementById('config-editor-apply');
const configEditorFrame = document.getElementById('config-editor-frame');
const configEditorStatus = document.getElementById('config-editor-status');

if (
  appVersion === null ||
  !(recordButton instanceof HTMLButtonElement) ||
  !(stopButton instanceof HTMLButtonElement) ||
  !(clearButton instanceof HTMLButtonElement) ||
  !(analyzeButton instanceof HTMLButtonElement) ||
  !(recordingFile instanceof HTMLInputElement) ||
  !(recordingPlayback instanceof HTMLAudioElement) ||
  !(sampleSaveName instanceof HTMLInputElement) ||
  !(saveSampleButton instanceof HTMLButtonElement) ||
  !(sampleLibrarySelect instanceof HTMLSelectElement) ||
  !(loadSampleButton instanceof HTMLButtonElement) ||
  !(configLibrarySelect instanceof HTMLSelectElement) ||
  !(loadConfigButton instanceof HTMLButtonElement) ||
  !(configFile instanceof HTMLInputElement) ||
  !(refreshLibraryButton instanceof HTMLButtonElement) ||
  !(libraryMessage instanceof HTMLOutputElement) ||
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
  !(setFilterButton instanceof HTMLButtonElement) ||
  !(resetFiltersButton instanceof HTMLButtonElement)
  || !(filterVisual instanceof HTMLDivElement)
  || !(filterWaveform instanceof HTMLCanvasElement)
  || !(filterSelection instanceof HTMLDivElement)
  || !(filterPlayhead instanceof HTMLDivElement)
  || !(filterStartHandle instanceof HTMLButtonElement)
  || !(filterEndHandle instanceof HTMLButtonElement)
  || !(filterMinHandle instanceof HTMLButtonElement)
  || !(filterMaxHandle instanceof HTMLButtonElement)
  || !(previewModal instanceof HTMLDivElement)
  || previewModalTitle === null
  || !(previewModalClose instanceof HTMLButtonElement)
  || !(previewModalPlay instanceof HTMLButtonElement)
  || !(previewModalStop instanceof HTMLButtonElement)
  || !(previewModalWaveform instanceof HTMLDivElement)
  || !(previewModalCanvas instanceof HTMLCanvasElement)
  || !(previewModalSelection instanceof HTMLDivElement)
  || !(previewModalPlayhead instanceof HTMLDivElement)
  || previewModalTime === null
  || !(previewModalAudio instanceof HTMLAudioElement)
  || !(previewOriginalAudio instanceof HTMLAudioElement)
  || !(previewResultSelect instanceof HTMLSelectElement)
  || !(previewResultVolume instanceof HTMLInputElement)
  || !(previewResultMute instanceof HTMLInputElement)
  || !(previewOriginalEnabled instanceof HTMLInputElement)
  || !(previewOriginalVolume instanceof HTMLInputElement)
  || !(previewOriginalMute instanceof HTMLInputElement)
  || !(configEditorModal instanceof HTMLDivElement)
  || configEditorKicker === null
  || configEditorTitle === null
  || !(configEditorClose instanceof HTMLButtonElement)
  || !(configEditorCancel instanceof HTMLButtonElement)
  || !(configEditorApply instanceof HTMLButtonElement)
  || !(configEditorFrame instanceof HTMLIFrameElement)
  || !(configEditorStatus instanceof HTMLOutputElement)
) {
  throw new Error('Voice Lab markup is missing required elements.');
}

appVersion.textContent = `v${__APP_VERSION__}`;

let selectedMode: CreationMode = 'effect';
let decodedRecording: AudioBuffer | undefined;
let decodedRecordingPeak = 1;
let recordingBlob: Blob | undefined;
let recordingSourceLabel = 'Microphone';
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
let compositionItems: CompositionItem[] = [];
let compositionScrollLeft = 0;
let compositionZoomIndex = 2;
let activePreviewEngine: ResultEngineId | undefined;
let previewElapsedMs = 0;
let previewRunId = 0;
let originalOverlayTimer: number | undefined;
let originalOverlayToken = 0;
let recordingPlayheadFrame: number | undefined;
let filterViewport: FilterViewport = {
  endSeconds: 0,
  maxLevel: 100,
  minLevel: 0,
  startSeconds: 0,
};
let sampleLibraryEntries: LibraryEntry[] = [];
let configLibraryEntries: LibraryEntry[] = [];
let analysisRunId = 0;
let editingResult: ProceduralResult | undefined;
let editorRequestId = 0;
const preview = new ProceduralPreview(previewModalAudio);

const emptyWorkspace = (): ModeWorkspace => ({
  captureMessage: '',
  decodedRecording: undefined,
  decodedRecordingPeak: 1,
  filter: {
    endSeconds: 0,
    maxLevel: 100,
    minLevel: 0,
    startSeconds: 0,
    viewport: { endSeconds: 0, maxLevel: 100, minLevel: 0, startSeconds: 0 },
  },
  generatedResults: [],
  inputLabel: 'Microphone',
  recordingBlob: undefined,
  resultStatus: 'Waiting',
  resultsSummary: 'Record or choose audio to compare generated configs.',
});

const modeWorkspaces: Record<CreationMode, ModeWorkspace> = {
  beat: emptyWorkspace(),
  effect: emptyWorkspace(),
  melody: emptyWorkspace(),
};

const renderPreviewModalWaveform = (): void => {
  if (previewModal.hidden) return;
  const bounds = previewModalWaveform.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  previewModalCanvas.width = Math.max(1, Math.round(bounds.width * ratio));
  previewModalCanvas.height = Math.max(1, Math.round(bounds.height * ratio));
  const context = previewModalCanvas.getContext('2d');
  if (context !== null) {
    context.clearRect(0, 0, previewModalCanvas.width, previewModalCanvas.height);
    context.drawImage(
      filterWaveform,
      0,
      0,
      previewModalCanvas.width,
      previewModalCanvas.height
    );
  }
  const timeSpan = filterViewport.endSeconds - filterViewport.startSeconds;
  const start = timeSpan > 0
    ? (filterNumber(filterStartInput, filterViewport.startSeconds) - filterViewport.startSeconds) / timeSpan * 100
    : 0;
  const end = timeSpan > 0
    ? (filterNumber(filterEndInput, filterViewport.endSeconds) - filterViewport.startSeconds) / timeSpan * 100
    : 100;
  previewModalSelection.style.left = `${Math.max(0, start)}%`;
  previewModalSelection.style.width = `${Math.max(0, Math.min(100, end) - Math.max(0, start))}%`;
};

const cancelOriginalOverlay = (): void => {
  originalOverlayToken += 1;
  if (originalOverlayTimer !== undefined) window.clearTimeout(originalOverlayTimer);
  originalOverlayTimer = undefined;
  previewOriginalAudio.pause();
};

const stopPreviewAudio = (): void => {
  previewRunId += 1;
  cancelOriginalOverlay();
  preview.stop();
};

const stopRecordingPlayhead = (): void => {
  if (recordingPlayheadFrame !== undefined) {
    window.cancelAnimationFrame(recordingPlayheadFrame);
    recordingPlayheadFrame = undefined;
  }
  if (activePreviewEngine === undefined) filterPlayhead.classList.remove('is-playing');
};

const updateRecordingPlayhead = (): void => {
  recordingPlayheadFrame = undefined;
  if (recordingPlayback.paused || recordingPlayback.ended) {
    stopRecordingPlayhead();
    return;
  }
  const duration = decodedRecording?.duration ?? recordingPlayback.duration;
  if (Number.isFinite(duration) && duration > 0) {
    const timeSpan = filterViewport.endSeconds - filterViewport.startSeconds;
    const positionPercent = timeSpan > 0
      ? (recordingPlayback.currentTime - filterViewport.startSeconds) / timeSpan * 100
      : recordingPlayback.currentTime / duration * 100;
    filterPlayhead.style.left = `${Math.max(0, Math.min(100, positionPercent))}%`;
    filterPlayhead.classList.add('is-playing');
  }
  recordingPlayheadFrame = window.requestAnimationFrame(updateRecordingPlayhead);
};

const startRecordingPlayhead = (): void => {
  stopRecordingPlayhead();
  updateRecordingPlayhead();
};

const stopPreviewPlayback = (): void => {
  stopPreviewAudio();
  activePreviewEngine = undefined;
  previewElapsedMs = 0;
  previewModalTime.textContent = '0.0s';
  previewModalPlayhead.style.left = '0%';
  filterPlayhead.classList.remove('is-playing');
  updatePreviewButtons();
};

const closePreviewModal = (): void => {
  stopPreviewPlayback();
  previewModal.hidden = true;
};

const closeConfigEditor = (): void => {
  configEditorModal.hidden = true;
  configEditorFrame.src = 'about:blank';
  configEditorStatus.value = '';
  configEditorApply.disabled = false;
  editingResult = undefined;
};

const sendConfigToEditor = (): void => {
  if (editingResult === undefined) return;
  configEditorFrame.contentWindow?.postMessage(
    {
      config: cloneConfig(editingResult.config),
      mode: editingResult.mode,
      type: VOICE_EDITOR_LOAD,
    },
    window.location.origin
  );
};

const openConfigEditor = (result: ProceduralResult): void => {
  closePreviewModal();
  editingResult = result;
  configEditorKicker.textContent = result.mode === 'melody' ? 'Music Lab' : 'Audio Lab';
  configEditorTitle.textContent = `Edit ${analysisEngineLabel(result.engine)} ${result.mode}`;
  configEditorStatus.value = 'Loading editor…';
  configEditorApply.disabled = true;
  configEditorModal.hidden = false;
  configEditorFrame.src = result.mode === 'melody'
    ? '/music-lab.html?embed=voice'
    : '/audio-lab.html?embed=voice';
};

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

const resetFilterViewport = (): void => {
  filterViewport = {
    endSeconds: decodedRecording?.duration ?? 0,
    maxLevel: 100,
    minLevel: 0,
    startSeconds: 0,
  };
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
      const startSample = Math.max(
        0,
        Math.floor(filterViewport.startSeconds * decodedRecording.sampleRate)
      );
      const endSample = Math.min(
        decodedRecording.length,
        Math.ceil(filterViewport.endSeconds * decodedRecording.sampleRate)
      );
      const samplesPerPixel = Math.max(1, endSample - startSample) / width;
      const levelSpan = Math.max(1, filterViewport.maxLevel - filterViewport.minLevel);
      context.fillStyle = 'rgba(174, 189, 208, 0.7)';
      for (let x = 0; x < width; x += 1) {
        const from = Math.floor(startSample + x * samplesPerPixel);
        const to = Math.min(endSample, Math.ceil(startSample + (x + 1) * samplesPerPixel));
        let peak = 0;
        for (let channel = 0; channel < decodedRecording.numberOfChannels; channel += 1) {
          const data = decodedRecording.getChannelData(channel);
          for (let index = from; index < to; index += 1) peak = Math.max(peak, Math.abs(data[index] ?? 0));
        }
        const peakLevel = Math.min(100, peak / decodedRecordingPeak * 100);
        const normalizedPeak = Math.max(
          0,
          Math.min(1, (peakLevel - filterViewport.minLevel) / levelSpan)
        );
        context.fillRect(x, height - normalizedPeak * height, 1, normalizedPeak * height);
      }
    }
  }
  const timeSpan = filterViewport.endSeconds - filterViewport.startSeconds;
  const levelSpan = filterViewport.maxLevel - filterViewport.minLevel;
  const start = timeSpan > 0 ? Math.max(0, Math.min(1,
    (filterNumber(filterStartInput, filterViewport.startSeconds) - filterViewport.startSeconds) / timeSpan
  )) : 0;
  const end = timeSpan > 0 ? Math.max(start, Math.min(1,
    (filterNumber(filterEndInput, filterViewport.endSeconds) - filterViewport.startSeconds) / timeSpan
  )) : 1;
  const min = levelSpan > 0 ? Math.max(0, Math.min(1,
    (filterNumber(filterMinLevelInput, filterViewport.minLevel) - filterViewport.minLevel) / levelSpan
  )) : 0;
  const max = levelSpan > 0 ? Math.max(min, Math.min(1,
    (filterNumber(filterMaxLevelInput, filterViewport.maxLevel) - filterViewport.minLevel) / levelSpan
  )) : 1;
  filterStartHandle.style.left = `${start * 100}%`;
  filterEndHandle.style.left = `${end * 100}%`;
  filterMinHandle.style.top = `${(1 - min) * 100}%`;
  filterMaxHandle.style.top = `${(1 - max) * 100}%`;
  filterSelection.style.left = `${start * 100}%`;
  filterSelection.style.width = `${(end - start) * 100}%`;
  filterSelection.style.top = `${(1 - max) * 100}%`;
  filterSelection.style.height = `${(max - min) * 100}%`;
  filterStartHandle.setAttribute('aria-valuemin', filterViewport.startSeconds.toFixed(2));
  filterStartHandle.setAttribute('aria-valuemax', filterViewport.endSeconds.toFixed(2));
  filterEndHandle.setAttribute('aria-valuemin', filterViewport.startSeconds.toFixed(2));
  filterEndHandle.setAttribute('aria-valuemax', filterViewport.endSeconds.toFixed(2));
  filterMinHandle.setAttribute('aria-valuemin', `${filterViewport.minLevel}`);
  filterMinHandle.setAttribute('aria-valuemax', `${filterViewport.maxLevel}`);
  filterMaxHandle.setAttribute('aria-valuemin', `${filterViewport.minLevel}`);
  filterMaxHandle.setAttribute('aria-valuemax', `${filterViewport.maxLevel}`);
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
  const vertical = Math.max(0, Math.min(1, 1 - (clientY - bounds.top) / bounds.height));
  const time = filterViewport.startSeconds
    + horizontal * (filterViewport.endSeconds - filterViewport.startSeconds);
  const level = filterViewport.minLevel
    + vertical * (filterViewport.maxLevel - filterViewport.minLevel);
  const start = filterNumber(filterStartInput, 0);
  const end = filterNumber(filterEndInput, decodedRecording.duration);
  const min = filterNumber(filterMinLevelInput, 0);
  const max = filterNumber(filterMaxLevelInput, 100);
  if (name === 'start') filterStartInput.value = Math.min(end, time).toFixed(2);
  if (name === 'end') filterEndInput.value = Math.max(start, time).toFixed(2);
  if (name === 'min') filterMinLevelInput.value = `${Math.round(Math.min(max, level))}`;
  if (name === 'max') filterMaxLevelInput.value = `${Math.round(Math.max(min, level))}`;
  renderFilterVisual();
};

const markFilterChanged = (): void => {
  generatedResults = [];
  stopPreviewAudio();
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
  const timeSpan = Math.max(Number.EPSILON, filterViewport.endSeconds - filterViewport.startSeconds);
  const levelSpan = Math.max(Number.EPSILON, filterViewport.maxLevel - filterViewport.minLevel);
  return {
    clientX: bounds.left + ((value - filterViewport.startSeconds) / timeSpan) * bounds.width,
    clientY: bounds.top + (1 - (value - filterViewport.minLevel) / levelSpan) * bounds.height,
  };
}

const resetAnalysisFilters = (): void => {
  const duration = decodedRecording?.duration ?? 0;
  resetFilterViewport();
  filterStartInput.value = '0';
  filterStartInput.max = duration.toFixed(2);
  filterEndInput.value = duration.toFixed(2);
  filterEndInput.max = duration.toFixed(2);
  filterMinLevelInput.value = '0';
  filterMaxLevelInput.value = '100';
  filterStartHandle.setAttribute('aria-valuemax', duration.toFixed(2));
  filterEndHandle.setAttribute('aria-valuemax', duration.toFixed(2));
  setFilterButton.disabled = decodedRecording === undefined;
  renderFilterVisual();
};

const setAnalysisFilter = (): void => {
  if (decodedRecording === undefined) return;
  const startSeconds = Math.max(0, Math.min(
    decodedRecording.duration,
    filterNumber(filterStartInput, 0)
  ));
  const endSeconds = Math.max(startSeconds, Math.min(
    decodedRecording.duration,
    filterNumber(filterEndInput, decodedRecording.duration)
  ));
  const minLevel = Math.max(0, Math.min(100, filterNumber(filterMinLevelInput, 0)));
  const maxLevel = Math.max(minLevel, Math.min(100, filterNumber(filterMaxLevelInput, 100)));
  if (endSeconds <= startSeconds || maxLevel <= minLevel) {
    captureMessage.value = 'Choose a time span and level range before setting the filter.';
    return;
  }
  filterViewport = { endSeconds, maxLevel, minLevel, startSeconds };
  renderFilterVisual();
  renderPreviewModalWaveform();
  captureMessage.value = 'Filter set. The selected time and level range now fills the preview.';
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

const currentFilterSnapshot = (): FilterSnapshot => ({
  endSeconds: filterNumber(filterEndInput, decodedRecording?.duration ?? 0),
  maxLevel: filterNumber(filterMaxLevelInput, 100),
  minLevel: filterNumber(filterMinLevelInput, 0),
  startSeconds: filterNumber(filterStartInput, 0),
  viewport: { ...filterViewport },
});

const saveActiveWorkspace = (): void => {
  modeWorkspaces[selectedMode] = {
    captureMessage: captureMessage.value,
    decodedRecording,
    decodedRecordingPeak,
    filter: currentFilterSnapshot(),
    generatedResults,
    inputLabel: recordingSourceLabel,
    recordingBlob,
    resultStatus: resultStatus.textContent ?? 'Waiting',
    resultsSummary: resultsSummary.textContent ?? '',
  };
};

const restoreWorkspace = (mode: CreationMode): void => {
  analysisRunId += 1;
  recordingPlayback.pause();
  stopRecordingPlayhead();
  stopPreviewAudio();
  activePreviewEngine = undefined;
  if (recordingUrl !== undefined) URL.revokeObjectURL(recordingUrl);
  recordingUrl = undefined;

  selectedMode = mode;
  const workspace = modeWorkspaces[mode];
  decodedRecording = workspace.decodedRecording;
  decodedRecordingPeak = workspace.decodedRecordingPeak;
  recordingBlob = workspace.recordingBlob;
  recordingSourceLabel = workspace.inputLabel;
  generatedResults = workspace.generatedResults;
  filterViewport = { ...workspace.filter.viewport };
  filterStartInput.value = `${workspace.filter.startSeconds}`;
  filterEndInput.value = `${workspace.filter.endSeconds}`;
  filterMinLevelInput.value = `${workspace.filter.minLevel}`;
  filterMaxLevelInput.value = `${workspace.filter.maxLevel}`;
  const duration = decodedRecording?.duration ?? 0;
  filterStartInput.max = duration.toFixed(2);
  filterEndInput.max = duration.toFixed(2);
  filterStartHandle.setAttribute('aria-valuemax', duration.toFixed(2));
  filterEndHandle.setAttribute('aria-valuemax', duration.toFixed(2));

  recordingFile.value = '';
  sampleSaveName.value = '';
  if (recordingBlob !== undefined) {
    recordingUrl = URL.createObjectURL(recordingBlob);
    recordingPlayback.src = recordingUrl;
    recordingPlayback.hidden = false;
  } else {
    recordingPlayback.removeAttribute('src');
    recordingPlayback.hidden = true;
  }
  inputKind.textContent = recordingSourceLabel;
  captureTime.textContent = decodedRecording === undefined ? '0.0s' : `${duration.toFixed(1)}s`;
  captureMessage.value = workspace.captureMessage;
  setCaptureStatus('Ready');
  setResultStatus(workspace.resultStatus);
  resultsSummary.textContent = workspace.resultsSummary;
  analyzeButton.disabled = decodedRecording === undefined;
  setFilterButton.disabled = decodedRecording === undefined;
  saveSampleButton.disabled = recordingBlob === undefined;
  renderMode();
  renderFilterVisual();
  renderResults();
  void refreshLibrary();
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

const setModeButtonsDisabled = (disabled: boolean): void => {
  for (const button of modeButtons) button.disabled = disabled;
};

const emptyResults = (message: string): void => {
  voiceResults.replaceChildren(renderFinalComposition());
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

const libraryUrl = (
  kind: LibraryEntry['kind'],
  mode: CreationMode,
  id?: string,
  name?: string
): string => {
  const path = `/api/voice-library/${kind}/${mode}${id === undefined ? '' : `/${encodeURIComponent(id)}`}`;
  return name === undefined ? path : `${path}?name=${encodeURIComponent(name)}`;
};

const responseError = async (response: Response): Promise<string> => {
  try {
    const body = await response.json() as { error?: string };
    return body.error ?? `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
};

const fillLibrarySelect = (
  select: HTMLSelectElement,
  entries: LibraryEntry[],
  emptyLabel: string
): void => {
  const options = entries.map((entry) => {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = entry.name;
    return option;
  });
  if (options.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = emptyLabel;
    options.push(option);
  }
  select.replaceChildren(...options);
};

const refreshLibrary = async (): Promise<void> => {
  const mode = selectedMode;
  refreshLibraryButton.disabled = true;
  try {
    const [sampleResponse, configResponse] = await Promise.all([
      fetch(libraryUrl('sample', mode)),
      fetch(libraryUrl('config', mode)),
    ]);
    if (!sampleResponse.ok) throw new Error(await responseError(sampleResponse));
    if (!configResponse.ok) throw new Error(await responseError(configResponse));
    const samples = await sampleResponse.json() as LibraryEntry[];
    const configs = await configResponse.json() as LibraryEntry[];
    if (mode !== selectedMode) return;
    sampleLibraryEntries = samples;
    configLibraryEntries = configs;
    fillLibrarySelect(sampleLibrarySelect, samples, 'No saved samples');
    fillLibrarySelect(configLibrarySelect, configs, 'No saved configs');
    loadSampleButton.disabled = samples.length === 0;
    loadConfigButton.disabled = configs.length === 0;
    libraryMessage.value = `${samples.length} sample${samples.length === 1 ? '' : 's'} and ${configs.length} config${configs.length === 1 ? '' : 's'} saved for this mode.`;
  } catch (error) {
    sampleLibraryEntries = [];
    configLibraryEntries = [];
    fillLibrarySelect(sampleLibrarySelect, [], 'Local library unavailable');
    fillLibrarySelect(configLibrarySelect, [], 'Local library unavailable');
    loadSampleButton.disabled = true;
    loadConfigButton.disabled = true;
    const message = error instanceof Error ? error.message : String(error);
    libraryMessage.value = `Local library unavailable: ${message}`;
  } finally {
    refreshLibraryButton.disabled = false;
  }
};

const saveCurrentSample = async (): Promise<void> => {
  if (recordingBlob === undefined) return;
  const mode = selectedMode;
  const sample = recordingBlob;
  const name = sampleSaveName.value.trim();
  if (name.length === 0) {
    libraryMessage.value = 'Enter a sample name before saving.';
    sampleSaveName.focus();
    return;
  }
  saveSampleButton.disabled = true;
  try {
    const response = await fetch(libraryUrl('sample', mode, undefined, name), {
      body: sample,
      headers: { 'Content-Type': sample.type || 'application/octet-stream' },
      method: 'POST',
    });
    if (!response.ok) throw new Error(await responseError(response));
    if (mode === selectedMode) {
      await refreshLibrary();
      libraryMessage.value = `Saved “${name}” for ${mode} mode.`;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    libraryMessage.value = `Could not save the sample: ${message}`;
  } finally {
    saveSampleButton.disabled = recordingBlob === undefined;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const configMatchesMode = (value: unknown, mode: CreationMode): boolean => {
  if (!isRecord(value)) return false;
  if (mode === 'effect') return Array.isArray(value.layers);
  if (mode === 'beat') return Array.isArray(value.lanes) && typeof value.durationMs === 'number';
  return Array.isArray(value.notes) && typeof value.durationMs === 'number';
};

const configDurationMs = (mode: CreationMode, config: Record<string, unknown>): number => {
  if (mode !== 'effect') {
    return typeof config.durationMs === 'number' && Number.isFinite(config.durationMs)
      ? Math.max(0, config.durationMs)
      : 0;
  }
  const layers = Array.isArray(config.layers) ? config.layers : [];
  return layers.reduce((duration, layer) => {
    if (!isRecord(layer) || !isRecord(layer.sound)) return duration;
    const startMs = typeof layer.startMs === 'number' ? layer.startMs : 0;
    const layerDuration = typeof layer.sound.durationMs === 'number' ? layer.sound.durationMs : 0;
    return Math.max(duration, startMs + layerDuration);
  }, 0);
};

const emptyFeatures = (durationMs: number): AudioFeatures => ({
  activityRegions: durationMs > 0 ? [{ endMs: durationMs, peak: 1, startMs: 0 }] : [],
  amplitudeCurve: [],
  brightnessCurve: [],
  centroidHz: 0,
  durationMs,
  engine: 'combined',
  flatness: 0,
  frames: [],
  onsetTimesMs: [],
  peak: 0,
  pitch: [],
  pitchCurve: [],
  rms: 0,
  rolloffHz: 0,
  sampleRate: decodedRecording?.sampleRate ?? 44_100,
  sourceEndMs: durationMs,
  sourceStartMs: 0,
  zcr: 0,
});

const loadedResult = (value: unknown, label: string): ProceduralResult => {
  if (!isRecord(value)) throw new Error('The config file must contain a JSON object.');
  const wrappedResult = isRecord(value.result) ? value.result : value;
  const declaredMode = typeof value.mode === 'string'
    ? value.mode
    : typeof wrappedResult.mode === 'string' ? wrappedResult.mode : selectedMode;
  if (declaredMode !== selectedMode) {
    throw new Error(`This is a ${declaredMode} config. Switch to that mode before loading it.`);
  }
  const config = isRecord(wrappedResult.config) ? wrappedResult.config : wrappedResult;
  if (!configMatchesMode(config, selectedMode)) {
    throw new Error(`The file does not contain a valid ${selectedMode} config.`);
  }
  const durationMs = configDurationMs(selectedMode, config);
  const common = {
    engine: 'combined' as const,
    features: emptyFeatures(durationMs),
    summary: `Loaded config: ${label}`,
  };
  if (selectedMode === 'effect') {
    return { ...common, config: config as Extract<ProceduralResult, { mode: 'effect' }>['config'], mode: 'effect' };
  }
  if (selectedMode === 'beat') {
    return { ...common, config: config as Extract<ProceduralResult, { mode: 'beat' }>['config'], mode: 'beat' };
  }
  return { ...common, config: config as Extract<ProceduralResult, { mode: 'melody' }>['config'], mode: 'melody' };
};

const installLoadedConfig = (value: unknown, label: string): void => {
  stopPreviewPlayback();
  generatedResults = [loadedResult(value, label)];
  setResultStatus('Loaded');
  resultsSummary.textContent = `${label} is active in ${selectedMode} mode.`;
  captureMessage.value = 'Loaded config ready to preview or edit.';
  renderResults();
  saveActiveWorkspace();
};

const saveConfigToLibrary = async (result: ProceduralResult): Promise<void> => {
  const mode = selectedMode;
  const suggested = `${mode}-${analysisEngineLabel(result.engine)}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const name = window.prompt('Save config as', suggested)?.trim();
  if (name === undefined || name.length === 0) return;
  try {
    const response = await fetch(libraryUrl('config', mode, undefined, name), {
      body: JSON.stringify({
        config: result.config,
        mode: result.mode,
        originalEngine: result.engine,
        version: 1,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!response.ok) throw new Error(await responseError(response));
    if (mode === selectedMode) {
      await refreshLibrary();
      libraryMessage.value = `Saved config “${name}” for ${mode} mode.`;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    libraryMessage.value = `Could not save the config: ${message}`;
  }
};

const loadSavedSample = async (): Promise<void> => {
  const mode = selectedMode;
  const entry = sampleLibraryEntries.find((candidate) => candidate.id === sampleLibrarySelect.value);
  if (entry === undefined) return;
  loadSampleButton.disabled = true;
  try {
    const response = await fetch(libraryUrl('sample', mode, entry.id));
    if (!response.ok) throw new Error(await responseError(response));
    if (mode !== selectedMode) return;
    await decodeRecording(await response.blob(), `Saved sample: ${entry.name}`);
    sampleSaveName.value = entry.name;
    libraryMessage.value = `Loaded sample “${entry.name}”.`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    libraryMessage.value = `Could not load the sample: ${message}`;
  } finally {
    loadSampleButton.disabled = sampleLibraryEntries.length === 0;
  }
};

const loadSavedConfig = async (): Promise<void> => {
  const mode = selectedMode;
  const entry = configLibraryEntries.find((candidate) => candidate.id === configLibrarySelect.value);
  if (entry === undefined) return;
  loadConfigButton.disabled = true;
  try {
    const response = await fetch(libraryUrl('config', mode, entry.id));
    if (!response.ok) throw new Error(await responseError(response));
    if (mode !== selectedMode) return;
    installLoadedConfig(await response.json(), entry.name);
    libraryMessage.value = `Loaded config “${entry.name}”.`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    libraryMessage.value = `Could not load the config: ${message}`;
  } finally {
    loadConfigButton.disabled = configLibraryEntries.length === 0;
  }
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
    button.textContent = button.dataset.previewEngine === activePreviewEngine ? 'Stop preview' : 'Preview audio';
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
  const viewportStartMs = filterViewport.startSeconds * 1000;
  const viewportDurationMs = (filterViewport.endSeconds - filterViewport.startSeconds) * 1000;
  const positionPercent = viewportDurationMs > 0
    ? (positionMs - viewportStartMs) / viewportDurationMs * 100
    : positionMs / (duration * 1000) * 100;
  filterPlayhead.style.left = `${Math.max(0, Math.min(100, positionPercent))}%`;
  filterPlayhead.classList.add('is-playing');
  previewModalPlayhead.style.left = `${Math.max(0, Math.min(100, positionPercent))}%`;
  previewModalTime.textContent = `${(Math.max(0, elapsedMs) / 1000).toFixed(1)}s`;
};

const playOriginalOverlay = (
  result: ProceduralResult,
  elapsedMs = 0,
  delayMs = 0
): void => {
  cancelOriginalOverlay();
  const overlayToken = originalOverlayToken;
  if (!previewOriginalEnabled.checked || recordingUrl === undefined) {
    return;
  }
  const duration = decodedRecording?.duration ?? 0;
  const startSeconds = filterNumber(filterStartInput, 0)
    + Math.max(0, result.features.sourceStartMs + elapsedMs) / 1000;
  previewOriginalAudio.pause();
  previewOriginalAudio.currentTime = Math.max(0, Math.min(duration, startSeconds));
  const startPlayback = (): void => {
    originalOverlayTimer = undefined;
    if (overlayToken !== originalOverlayToken || !previewOriginalEnabled.checked) return;
    void previewOriginalAudio.play().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      captureMessage.value = `Original recording preview failed: ${message}`;
    });
  };
  if (delayMs > 0) originalOverlayTimer = window.setTimeout(startPlayback, delayMs);
  else startPlayback();
};

const startModalResult = (result: ProceduralResult): void => {
  stopPreviewAudio();
  const runId = previewRunId;
  recordingPlayback.pause();
  activePreviewEngine = result.engine;
  previewResultSelect.value = result.engine;
  previewModalTitle.textContent = analysisEngineLabel(result.engine);
  previewModalTime.textContent = '0.0s';
  previewModalPlayhead.style.left = '0%';
  updatePreviewButtons();
  const playCycle = (): void => {
    if (runId !== previewRunId || activePreviewEngine !== result.engine) return;
    cancelOriginalOverlay();
    previewElapsedMs = 0;
    void preview.play(
      result,
      (elapsedMs) => {
        previewElapsedMs = elapsedMs;
        updateFilterPlayhead(result, elapsedMs);
      },
      playCycle,
      (leadMs) => playOriginalOverlay(result, 0, leadMs)
    ).catch((error: unknown) => {
      stopPreviewPlayback();
      const message = error instanceof Error ? error.message : String(error);
      captureMessage.value = `${analysisEngineLabel(result.engine)} preview failed: ${message}`;
    });
  };
  playCycle();
};

const openPreviewModal = (result: ProceduralResult): void => {
  previewResultSelect.replaceChildren(...generatedResults.map((candidate) => {
    const option = document.createElement('option');
    option.value = candidate.engine;
    option.textContent = analysisEngineLabel(candidate.engine);
    return option;
  }));
  previewOriginalEnabled.disabled = recordingUrl === undefined;
  if (recordingUrl !== undefined && previewOriginalAudio.src !== recordingUrl) {
    previewOriginalAudio.src = recordingUrl;
  }
  previewModal.hidden = false;
  window.requestAnimationFrame(renderPreviewModalWaveform);
  startModalResult(result);
};

const compositionItemDurationMs = (item: CompositionItem): number =>
  configDurationMs(item.mode, item.config as unknown as Record<string, unknown>);

const compositionDurationMs = (): number => compositionItems.reduce(
  (duration, item) => Math.max(duration, item.startMs + compositionItemDurationMs(item)),
  0
);

const serializedComposition = (): Record<string, unknown> => ({
  durationMs: compositionDurationMs(),
  items: compositionItems.map((item) => ({
    config: cloneConfig(item.config),
    durationMs: compositionItemDurationMs(item),
    id: item.id,
    label: item.label,
    mode: item.mode,
    sourceEngine: item.engine,
    startMs: item.startMs,
  })),
  version: 1,
});

const compositionConfigText = (): string =>
  `export const FINAL_COMPOSITION = ${JSON.stringify(serializedComposition(), null, 2)};`;

const addResultToComposition = (result: ProceduralResult): void => {
  const startMs = compositionItems.length === 0
    ? 0
    : compositionDurationMs() + COMPOSITION_GAP_MS;
  const base = {
    engine: result.engine,
    id: crypto.randomUUID(),
    label: `${analysisEngineLabel(result.engine)} ${result.mode}`,
    startMs,
  };
  if (result.mode === 'effect') {
    compositionItems.push({ ...base, config: cloneConfig(result.config), mode: 'effect' });
  } else if (result.mode === 'beat') {
    compositionItems.push({ ...base, config: cloneConfig(result.config), mode: 'beat' });
  } else {
    compositionItems.push({ ...base, config: cloneConfig(result.config), mode: 'melody' });
  }
  captureMessage.value = `Added ${analysisEngineLabel(result.engine)} ${result.mode} to the final composition.`;
  renderResults();
};

const copyComposition = (): void => {
  const text = compositionConfigText();
  void navigator.clipboard.writeText(text).then(
    () => {
      captureMessage.value = 'Copied the final composition config.';
    },
    () => {
      captureMessage.value = text;
    }
  );
};

const saveComposition = (): void => {
  const name = window.prompt('Save composition as', 'final-composition')?.trim();
  if (name === undefined || name.length === 0) return;
  const safeName = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
    || 'final-composition';
  const blob = new Blob([JSON.stringify(serializedComposition(), null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.download = `${safeName}.json`;
  anchor.href = url;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  captureMessage.value = `Saved ${safeName}.json.`;
};

const renderFinalComposition = (): HTMLElement => {
  const card = document.createElement('article');
  card.className = 'voice-result-card final-composition-card';
  const header = document.createElement('div');
  header.className = 'voice-result-header';
  const heading = document.createElement('div');
  const title = document.createElement('h3');
  const summary = document.createElement('p');
  const badge = document.createElement('span');
  title.textContent = 'Final composition';
  summary.textContent = compositionItems.length === 0
    ? 'Add generated effects, beats, and melodies from any mode.'
    : `${compositionItems.length} item${compositionItems.length === 1 ? '' : 's'} · ${(compositionDurationMs() / 1000).toFixed(2)}s`;
  badge.className = 'sound-kind';
  badge.textContent = 'Composition';
  heading.append(title, summary);
  header.append(heading, badge);

  const toolbar = document.createElement('div');
  toolbar.className = 'composition-toolbar';
  const scrollLeft = document.createElement('button');
  const scrollRight = document.createElement('button');
  const zoomOut = document.createElement('button');
  const zoomIn = document.createElement('button');
  const zoomLabel = document.createElement('span');
  const copy = document.createElement('button');
  const save = document.createElement('button');
  for (const button of [scrollLeft, scrollRight, zoomOut, zoomIn, copy, save]) {
    button.className = 'secondary-button';
    button.type = 'button';
  }
  scrollLeft.textContent = '← Scroll';
  scrollRight.textContent = 'Scroll →';
  scrollLeft.setAttribute('aria-label', 'Scroll composition left');
  scrollRight.setAttribute('aria-label', 'Scroll composition right');
  zoomOut.textContent = '−';
  zoomIn.textContent = '+';
  zoomOut.setAttribute('aria-label', 'Zoom out');
  zoomIn.setAttribute('aria-label', 'Zoom in');
  zoomOut.disabled = compositionZoomIndex === 0;
  zoomIn.disabled = compositionZoomIndex === COMPOSITION_ZOOM_LEVELS.length - 1;
  zoomLabel.className = 'composition-zoom-label';
  zoomLabel.textContent = `${COMPOSITION_ZOOM_LEVELS[compositionZoomIndex] ?? 96} px/s`;
  copy.textContent = 'Copy config';
  save.textContent = 'Save config';
  copy.disabled = compositionItems.length === 0;
  save.disabled = compositionItems.length === 0;
  copy.addEventListener('click', copyComposition);
  save.addEventListener('click', saveComposition);
  toolbar.append(scrollLeft, scrollRight, zoomOut, zoomLabel, zoomIn, copy, save);

  const timelineShell = document.createElement('div');
  timelineShell.className = 'composition-timeline-shell';
  const labels = document.createElement('div');
  labels.className = 'composition-lane-labels';
  const rulerSpacer = document.createElement('span');
  rulerSpacer.textContent = 'Time';
  labels.append(rulerSpacer);
  for (const mode of ['effect', 'beat', 'melody'] as const) {
    const label = document.createElement('strong');
    label.textContent = mode === 'beat' ? 'Beat' : mode[0]?.toUpperCase() + mode.slice(1);
    labels.append(label);
  }
  const viewport = document.createElement('div');
  viewport.className = 'composition-timeline-viewport';
  const surface = document.createElement('div');
  surface.className = 'composition-timeline-surface';
  const pixelsPerSecond = COMPOSITION_ZOOM_LEVELS[compositionZoomIndex] ?? 96;
  const displayDurationMs = Math.max(5_000, compositionDurationMs() + 500);
  surface.style.width = `${Math.max(720, displayDurationMs / 1000 * pixelsPerSecond)}px`;

  const ruler = document.createElement('div');
  ruler.className = 'composition-ruler';
  const tickIntervalSeconds = pixelsPerSecond < 60 ? 2 : pixelsPerSecond > 200 ? 0.5 : 1;
  const tickCount = Math.min(400, Math.ceil(displayDurationMs / 1000 / tickIntervalSeconds));
  for (let index = 0; index <= tickCount; index += 1) {
    const seconds = index * tickIntervalSeconds;
    const tick = document.createElement('span');
    tick.style.left = `${seconds * pixelsPerSecond}px`;
    tick.textContent = `${seconds}s`;
    ruler.append(tick);
  }
  surface.append(ruler);

  const laneIndexes: Record<CreationMode, number> = { effect: 0, beat: 1, melody: 2 };
  for (const mode of ['effect', 'beat', 'melody'] as const) {
    const lane = document.createElement('div');
    lane.className = 'composition-lane';
    lane.style.top = `${30 + laneIndexes[mode] * 58}px`;
    surface.append(lane);
  }
  for (const item of compositionItems) {
    const block = document.createElement('div');
    const durationMs = compositionItemDurationMs(item);
    block.className = `composition-item composition-item-${item.mode}`;
    block.style.left = `${item.startMs / 1000 * pixelsPerSecond}px`;
    block.style.top = `${34 + laneIndexes[item.mode] * 58}px`;
    block.style.width = `${Math.max(52, durationMs / 1000 * pixelsPerSecond)}px`;
    block.title = `${item.label}, ${(item.startMs / 1000).toFixed(2)}s–${((item.startMs + durationMs) / 1000).toFixed(2)}s`;
    const blockLabel = document.createElement('span');
    blockLabel.textContent = item.label;
    block.append(blockLabel);
    surface.append(block);
  }
  viewport.append(surface);
  timelineShell.append(labels, viewport);

  viewport.addEventListener('scroll', () => {
    compositionScrollLeft = viewport.scrollLeft;
  });
  scrollLeft.addEventListener('click', () => {
    viewport.scrollBy({ behavior: 'smooth', left: -Math.max(240, viewport.clientWidth * 0.75) });
  });
  scrollRight.addEventListener('click', () => {
    viewport.scrollBy({ behavior: 'smooth', left: Math.max(240, viewport.clientWidth * 0.75) });
  });
  const changeZoom = (direction: -1 | 1): void => {
    const previousZoom = COMPOSITION_ZOOM_LEVELS[compositionZoomIndex] ?? 96;
    compositionZoomIndex = Math.max(
      0,
      Math.min(COMPOSITION_ZOOM_LEVELS.length - 1, compositionZoomIndex + direction)
    );
    const nextZoom = COMPOSITION_ZOOM_LEVELS[compositionZoomIndex] ?? 96;
    compositionScrollLeft = viewport.scrollLeft * nextZoom / previousZoom;
    renderResults();
  };
  zoomOut.addEventListener('click', () => changeZoom(-1));
  zoomIn.addEventListener('click', () => changeZoom(1));
  window.requestAnimationFrame(() => {
    viewport.scrollLeft = compositionScrollLeft;
  });

  const items = document.createElement('div');
  items.className = 'composition-item-list';
  if (compositionItems.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'The composition is empty. Use “Add to composition” on a result card.';
    items.append(empty);
  }
  for (const item of compositionItems) {
    const row = document.createElement('div');
    row.className = 'composition-item-row';
    const color = document.createElement('span');
    color.className = `composition-item-color composition-item-${item.mode}`;
    const name = document.createElement('strong');
    name.textContent = item.label;
    const mode = document.createElement('span');
    mode.textContent = item.mode;
    const startLabel = document.createElement('label');
    const startText = document.createElement('span');
    const start = document.createElement('input');
    startText.textContent = 'Start (s)';
    start.type = 'number';
    start.min = '0';
    start.max = '3600';
    start.step = '0.01';
    start.value = `${item.startMs / 1000}`;
    start.addEventListener('change', () => {
      const value = Number(start.value);
      if (!Number.isFinite(value)) return;
      item.startMs = Math.max(0, value * 1000);
      renderResults();
    });
    startLabel.append(startText, start);
    const remove = document.createElement('button');
    remove.className = 'secondary-button';
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      compositionItems = compositionItems.filter((candidate) => candidate.id !== item.id);
      renderResults();
    });
    row.append(color, name, mode, startLabel, remove);
    items.append(row);
  }

  card.append(header, toolbar, timelineShell, items);
  return card;
};

const renderResults = (): void => {
  voiceResults.replaceChildren(renderFinalComposition());
  if (generatedResults.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'voice-empty-state';
    empty.textContent = 'Record or choose audio, then generate at least one procedural result.';
    voiceResults.append(empty);
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
    previewButton.textContent = 'Preview audio';
    previewButton.disabled = result.mode === 'melody' && result.config.notes.length === 0;
    previewButton.addEventListener('click', () => {
      openPreviewModal(result);
    });
    const editButton = document.createElement('button');
    editButton.className = 'secondary-button';
    editButton.type = 'button';
    editButton.textContent = 'Edit';
    editButton.addEventListener('click', () => {
      openConfigEditor(result);
    });
    const addToCompositionButton = document.createElement('button');
    addToCompositionButton.className = 'secondary-button';
    addToCompositionButton.type = 'button';
    addToCompositionButton.textContent = 'Add to composition';
    addToCompositionButton.addEventListener('click', () => {
      addResultToComposition(result);
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
    const saveConfigButton = document.createElement('button');
    saveConfigButton.className = 'secondary-button';
    saveConfigButton.type = 'button';
    saveConfigButton.textContent = 'Save config';
    saveConfigButton.addEventListener('click', () => {
      void saveConfigToLibrary(result);
    });
    const config = document.createElement('pre');
    config.className = 'config-preview';
    config.hidden = true;
    config.textContent = formatConfig(result);
    const viewConfigButton = document.createElement('button');
    viewConfigButton.className = 'secondary-button';
    viewConfigButton.type = 'button';
    viewConfigButton.textContent = 'View config';
    viewConfigButton.setAttribute('aria-expanded', 'false');
    viewConfigButton.addEventListener('click', () => {
      config.hidden = !config.hidden;
      viewConfigButton.textContent = config.hidden ? 'View config' : 'Hide config';
      viewConfigButton.setAttribute('aria-expanded', `${!config.hidden}`);
    });
    actions.append(
      previewButton,
      editButton,
      addToCompositionButton,
      viewConfigButton,
      copyButton,
      saveConfigButton
    );

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
  const runId = analysisRunId + 1;
  analysisRunId = runId;
  const mode = selectedMode;
  stopPreviewAudio();
  activePreviewEngine = undefined;
  decodedRecording = undefined;
  decodedRecordingPeak = 1;
  generatedResults = [];
  renderResults();
  if (recordingUrl !== undefined) URL.revokeObjectURL(recordingUrl);
  recordingBlob = blob;
  recordingSourceLabel = sourceLabel;
  recordingUrl = URL.createObjectURL(blob);
  recordingPlayback.src = recordingUrl;
  recordingPlayback.hidden = false;
  inputKind.textContent = sourceLabel;
  analyzeButton.disabled = true;
  recordButton.disabled = true;
  saveSampleButton.disabled = true;
  setModeButtonsDisabled(true);
  setCaptureStatus('Decoding');
  captureMessage.value = '';

  const context = new AudioContext();
  try {
    const recording = await context.decodeAudioData(await blob.arrayBuffer());
    if (runId !== analysisRunId || mode !== selectedMode) return;
    decodedRecording = recording;
    decodedRecordingPeak = recordingPeak(decodedRecording);
    resetAnalysisFilters();
    captureTime.textContent = `${decodedRecording.duration.toFixed(1)}s`;
    analyzeButton.disabled = false;
    saveSampleButton.disabled = false;
    setCaptureStatus('Ready');
    captureMessage.value = 'Recording ready. Generate one or both procedural interpretations.';
    saveActiveWorkspace();
  } catch {
    if (runId !== analysisRunId || mode !== selectedMode) return;
    decodedRecording = undefined;
    decodedRecordingPeak = 1;
    analyzeButton.disabled = true;
    setCaptureStatus('Unsupported');
    captureMessage.value = 'This browser could not decode that audio format.';
  } finally {
    await context.close().catch(() => undefined);
    if (runId === analysisRunId && mode === selectedMode) {
      recordButton.disabled = false;
      setModeButtonsDisabled(false);
    }
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
    stopPreviewAudio();
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
    setModeButtonsDisabled(true);
    setCaptureStatus('Recording');
  } catch {
    cleanCaptureResources();
    recorder = undefined;
    recordButton.disabled = false;
    stopButton.disabled = true;
    setModeButtonsDisabled(false);
    setCaptureStatus('Blocked');
    captureMessage.value = 'Microphone permission was not available.';
  }
};

const generateConfigs = async (): Promise<void> => {
  if (decodedRecording === undefined) return;
  const runId = analysisRunId + 1;
  analysisRunId = runId;
  const mode = selectedMode;
  const engines = selectedEngines();
  if (engines.length === 0) {
    captureMessage.value = 'Select at least one analysis engine.';
    return;
  }
  stopPreviewAudio();
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
      const features = await adapter.analyze(analysisRecording, mode);
      if (runId !== analysisRunId || mode !== selectedMode) return;
      const result = generateResult(mode, features);
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
          if (runId !== analysisRunId || mode !== selectedMode) return;
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
      if (runId !== analysisRunId || mode !== selectedMode) return;
      const message = error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'message' in error
          ? String(error.message)
          : String(error || 'Unknown analysis error');
      captureMessage.value = `${adapter.label} could not analyze this recording: ${message}`;
    }
  }
  if (runId !== analysisRunId || mode !== selectedMode) return;
  analyzeButton.disabled = false;
  setResultStatus(generatedResults.length > 0 ? 'Generated' : 'Try again');
  resultsSummary.textContent = generatedResults.length > 1
    ? 'Compare the analysis results, then add the versions you want to the final composition.'
    : 'Preview, edit, or add the generated sound to the final composition.';
  renderResults();
  saveActiveWorkspace();
};

const clearRecording = (): void => {
  analysisRunId += 1;
  if (recorder?.state === 'recording') {
    discardStoppedRecording = true;
    recorder.stop();
  }
  cleanCaptureResources();
  stopRecordingPlayhead();
  stopPreviewAudio();
  activePreviewEngine = undefined;
  decodedRecording = undefined;
  decodedRecordingPeak = 1;
  recordingBlob = undefined;
  recordingSourceLabel = 'Microphone';
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
  saveSampleButton.disabled = true;
  recordButton.disabled = false;
  stopButton.disabled = true;
  setModeButtonsDisabled(false);
  setCaptureStatus('Ready');
  setResultStatus('Waiting');
  resultsSummary.textContent = 'Record or choose audio to compare generated configs.';
  renderResults();
  saveActiveWorkspace();
};

for (const button of modeButtons) {
  button.addEventListener('click', () => {
    const mode = button.dataset.mode;
    if (mode !== 'effect' && mode !== 'beat' && mode !== 'melody') return;
    if (mode === selectedMode) return;
    if (recorder?.state === 'recording') {
      captureMessage.value = 'Stop the current recording before switching modes.';
      return;
    }
    saveActiveWorkspace();
    restoreWorkspace(mode);
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
saveSampleButton.addEventListener('click', () => {
  void saveCurrentSample();
});
loadSampleButton.addEventListener('click', () => {
  void loadSavedSample();
});
loadConfigButton.addEventListener('click', () => {
  void loadSavedConfig();
});
configFile.addEventListener('change', () => {
  const file = configFile.files?.[0];
  if (file === undefined) return;
  const mode = selectedMode;
  void file.text().then((text) => {
    try {
      if (mode !== selectedMode) return;
      installLoadedConfig(JSON.parse(text), file.name);
      libraryMessage.value = `Imported config “${file.name}”.`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      libraryMessage.value = `Could not import the config: ${message}`;
    } finally {
      configFile.value = '';
    }
  });
});
refreshLibraryButton.addEventListener('click', () => {
  void refreshLibrary();
});
recordingPlayback.addEventListener('play', () => {
  stopPreviewAudio();
  activePreviewEngine = undefined;
  updatePreviewButtons();
  startRecordingPlayhead();
});
recordingPlayback.addEventListener('pause', stopRecordingPlayhead);
recordingPlayback.addEventListener('ended', stopRecordingPlayhead);
recordingPlayback.addEventListener('emptied', stopRecordingPlayhead);
setFilterButton.addEventListener('click', setAnalysisFilter);
resetFiltersButton.addEventListener('click', () => {
  resetAnalysisFilters();
  if (decodedRecording !== undefined) markFilterChanged();
  captureMessage.value = decodedRecording === undefined
    ? ''
    : 'Analysis filter reset. Generate configs to apply it.';
});
previewModalClose.addEventListener('click', closePreviewModal);
previewModalPlay.addEventListener('click', () => {
  const result = generatedResults.find((candidate) => candidate.engine === previewResultSelect.value);
  if (result !== undefined) startModalResult(result);
});
previewModalStop.addEventListener('click', stopPreviewPlayback);
previewResultSelect.addEventListener('change', () => {
  const result = generatedResults.find((candidate) => candidate.engine === previewResultSelect.value);
  if (result !== undefined) startModalResult(result);
});
previewResultVolume.addEventListener('input', () => {
  previewModalAudio.volume = Number(previewResultVolume.value);
});
previewResultMute.addEventListener('change', () => {
  previewModalAudio.muted = previewResultMute.checked;
});
previewOriginalEnabled.addEventListener('change', () => {
  const result = generatedResults.find((candidate) => candidate.engine === previewResultSelect.value);
  if (previewOriginalEnabled.checked && result !== undefined && activePreviewEngine !== undefined) {
    playOriginalOverlay(result, previewElapsedMs);
  } else {
    cancelOriginalOverlay();
  }
});
previewOriginalVolume.addEventListener('input', () => {
  previewOriginalAudio.volume = Number(previewOriginalVolume.value);
});
previewOriginalMute.addEventListener('change', () => {
  previewOriginalAudio.muted = previewOriginalMute.checked;
});
previewModal.addEventListener('click', (event) => {
  if (event.target === previewModal) closePreviewModal();
});
configEditorFrame.addEventListener('load', () => {
  if (editingResult === undefined || configEditorModal.hidden) return;
  sendConfigToEditor();
  configEditorStatus.value = 'Editor ready.';
  configEditorApply.disabled = false;
});
configEditorClose.addEventListener('click', closeConfigEditor);
configEditorCancel.addEventListener('click', closeConfigEditor);
configEditorApply.addEventListener('click', () => {
  if (editingResult === undefined) return;
  editorRequestId += 1;
  configEditorApply.disabled = true;
  configEditorStatus.value = 'Applying changes…';
  configEditorFrame.contentWindow?.postMessage(
    { requestId: editorRequestId, type: VOICE_EDITOR_REQUEST },
    window.location.origin
  );
});
configEditorModal.addEventListener('click', (event) => {
  if (event.target === configEditorModal) closeConfigEditor();
});
window.addEventListener('message', (event) => {
  if (
    event.origin !== window.location.origin ||
    event.source !== configEditorFrame.contentWindow ||
    !isVoiceEditorResultMessage(event.data) ||
    event.data.requestId !== editorRequestId ||
    editingResult === undefined ||
    event.data.mode !== editingResult.mode ||
    !configMatchesMode(event.data.config, editingResult.mode)
  ) return;

  if (editingResult.mode === 'effect' && event.data.mode === 'effect') {
    editingResult.config = cloneConfig(event.data.config) as Extract<ProceduralResult, { mode: 'effect' }>['config'];
  } else if (editingResult.mode === 'beat' && event.data.mode === 'beat') {
    editingResult.config = cloneConfig(event.data.config) as Extract<ProceduralResult, { mode: 'beat' }>['config'];
  } else if (editingResult.mode === 'melody' && event.data.mode === 'melody') {
    editingResult.config = cloneConfig(event.data.config) as Extract<ProceduralResult, { mode: 'melody' }>['config'];
  } else {
    return;
  }

  const editorName = editingResult.mode === 'melody' ? 'Music Lab' : 'Audio Lab';
  captureMessage.value = `${analysisEngineLabel(editingResult.engine)} config updated in ${editorName}.`;
  renderResults();
  saveActiveWorkspace();
  closeConfigEditor();
});
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!configEditorModal.hidden) closeConfigEditor();
  else if (!previewModal.hidden) closePreviewModal();
});
for (const input of [filterStartInput, filterEndInput, filterMinLevelInput, filterMaxLevelInput]) {
  input.addEventListener('input', renderFilterVisual);
  input.addEventListener('change', () => {
    renderFilterVisual();
    markFilterChanged();
  });
}
new ResizeObserver(renderFilterVisual).observe(filterVisual);
new ResizeObserver(renderPreviewModalWaveform).observe(previewModalWaveform);
previewModalAudio.volume = Number(previewResultVolume.value);
previewModalAudio.muted = previewResultMute.checked;
previewOriginalAudio.volume = Number(previewOriginalVolume.value);
previewOriginalAudio.muted = previewOriginalMute.checked;
window.addEventListener('pagehide', () => {
  cleanCaptureResources();
  stopRecordingPlayhead();
  preview.close();
  if (recordingUrl !== undefined) URL.revokeObjectURL(recordingUrl);
});

renderMode();
renderResults();
renderFilterVisual();
void refreshLibrary();
