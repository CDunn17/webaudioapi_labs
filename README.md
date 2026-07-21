# Web Audio API Labs

**Version 0.1.1 · OpenAI Build Week 2026 · Developer Tools**

Web Audio API Labs turns sound ideas into editable, sample-free Web Audio
configurations. It gives web, game, and audio developers three connected
workbenches for designing sound effects, procedural music, and voice-inspired
audio directly in the browser.

The central idea is simple: describing a sound with sliders can be slow, while
making the sound with your voice is immediate. Voice Lab uses a recording as a
reference, extracts its timing and spectral features, and produces a
deterministic synthesis recipe. The recording is not shipped with the result.
The generated configuration can be auditioned, edited, copied, downloaded, and
combined with other results.

Live demo:
[audiolabs.dunnstock.workers.dev](https://audiolabs.dunnstock.workers.dev)

Video walkthrough:
[youtu.be/LD3Jqg8CqYk](https://youtu.be/LD3Jqg8CqYk)

Source repository:
[github.com/CDunn17/webaudioapi_labs](https://github.com/CDunn17/webaudioapi_labs)

## What you can do

### Audio Lab

- Start from editable one-shot and sustained sound-effect presets.
- Layer oscillators, noise, filters, envelopes, modulation, and timed events.
- Preview changes immediately and copy the resulting procedural config.
- Use the same embedded editor that Voice Lab opens for generated effects and
  beatbox results.

### Music Lab

- Build looping procedural scores with sections, notes, rhythm, intensity, and
  synth controls.
- Start from included examples, then reshape the arrangement and timbre.
- Preview and copy the score config without relying on recorded music.
- Edit Voice Lab melody results on the same note timeline.

### Voice Lab

- Record or import a sound effect, beatbox pattern, or hummed melody.
- Apply a non-destructive time and level filter before analysis.
- Compare local Web Audio/DSP, Meyda, Essentia.js, and Spotify Basic Pitch
  analysis paths where applicable.
- Generate multiple sample-free candidates while retaining measured timing,
  internal rests, dynamics, and pitch movement.
- Open any result in an embedded Audio Lab or Music Lab editor.
- Assemble effect, beat, and melody results on one final composition timeline.
- Copy configs or download the final composition as JSON.

## Why it matters

Procedural audio is compact, responsive, and editable, but authoring it often
requires translating an intuitive sound into unfamiliar synthesis parameters.
These labs shorten that loop. A developer can perform an idea, inspect what the
analysis heard, compare generated interpretations, and then refine the result
with ordinary Web Audio controls.

The intended audience is developers and technical sound designers who need
custom interface sounds, game effects, rhythmic material, ambience, or musical
ideas without adding recorded assets to a project.

## Quick start

### Requirements

- Node.js `^20.19.0` or `>=22.12.0`, as required by the installed Vite version.
- A current desktop browser with Web Audio API support.
- `MediaRecorder` and microphone access for live Voice Lab recording. An audio
  file can be imported when microphone capture is unavailable.
- Headphones or speakers. Start at a low device volume before previewing audio.

A current Chromium-based desktop browser is recommended for judging because it
provides the most consistent combination of Web Audio, `MediaRecorder`,
microphone permission, WebAssembly, and local model support. Microphone capture
requires `localhost` or a secure HTTPS origin.

### Install and run

```sh
git clone https://github.com/CDunn17/webaudioapi_labs.git
cd webaudioapi_labs
npm ci
npm run dev
```

Open the landing page at `http://127.0.0.1:5173/`, or open a lab directly:

- `http://127.0.0.1:5173/audio-lab.html`
- `http://127.0.0.1:5173/music-lab.html`
- `http://127.0.0.1:5173/hum-lab.html`

Vite will print a different port if `5173` is already occupied. Allow
microphone access when the browser prompts for it.

### Production build

```sh
npm run build
npm run preview
```

The production files are written to `dist/`. The app does not require an
account, cloud database, or OpenAI API key at runtime.

## Suggested judge walkthrough

1. Open the [live demo](https://audiolabs.dunnstock.workers.dev) and select
   **Voice Lab**.
2. Choose **Sound effect**, record a short vocal effect or import an audio file,
   and select **Generate configs**.
3. Compare the generated candidates with the original recording and open a
   result in the embedded editor.
4. Change one or two synthesis parameters, apply the edit, and add the result
   to the final composition.
5. Switch to **Beat / beatboxing** or **Melody** to see how the same workflow
   preserves mode-specific timing and pitch information.
6. Return to the landing page and open **Audio Lab** or **Music Lab** to inspect
   the standalone authoring tools and included presets.

The complete Voice Lab path is the best demonstration of the project. Audio
Lab and Music Lab also work independently and do not require microphone access.

## Development with GPT-5.6

GPT-5.6 in Codex was used throughout the Build Week implementation. The main
sessions relevant to the submission are:

- `019f7739-dd50-7b60-8c03-21309518d8ca` — July 18, `gpt-5.6-sol` with ultra
  reasoning. This was the main audio-fidelity pass across local DSP, Meyda,
  Essentia.js, and Basic Pitch. It covered timing, rests, dynamics, pitch,
  cross-sample-rate behavior, and a 38-case cross-engine fixture matrix.
- `019f81f4-cd97-7fd1-8dcd-7ed30a4eee8d` — July 20, `gpt-5.6-sol` with high
  reasoning. This covered final debugging, recording-state review, README
  cleanup, and submission preparation.

Codex was used to trace the Voice Lab capture, analysis, generation, fitting,
preview, and editor paths; implement coordinated TypeScript, HTML, and CSS
changes; compare analyzer behavior; and run TypeScript, ESLint, fixture, and
production-build checks.

I set the product direction and the constraints used during those passes: keep
the output procedural and sample-free, preserve measured timing and silence,
show the analyzer-specific results, and keep every generated config editable.
The dated Git history records the resulting code changes, while the session IDs
identify the associated Codex transcripts.

## Technical design

The project is a TypeScript multi-page application built with Vite. Web Audio
API nodes synthesize every preview and `OfflineAudioContext` renders bounded
candidates for analysis and fitting. There is no application framework and no
runtime service dependency for the core labs.

Relevant areas of the repository:

- `src/config/`: built-in Audio Lab and Music Lab presets.
- `src/audioLab.ts`: effect, voice, event, and beat editing and rendering.
- `src/musicLab.ts`: score editing and procedural music playback.
- `src/voiceLab.ts`: Voice Lab state, capture, analysis orchestration, results,
  embedded editing, and final composition.
- `src/voice/`: DSP, analyzers, generators, fitting, preview, effect rendering,
  shared types, and the editor bridge.
- `vite/voiceLibraryPlugin.ts`: development-only local sample/config library.

### Voice Lab generation

Voice Lab trims leading and trailing silence before analysis, then uses a
separate short-hop envelope to retain internal rests, relative peaks,
brightness, and pitch contour. Effect layers are hard-gated by measured active
regions, and event layers keep their detected timing and local decay.
Conservative resonator banks are used only when a strong, low-flatness impact
supports ringing.

Beat generation combines attack detection with nearby amplitude peaks, groups
short peak regions by relative timbre, and derives each lane's tone/noise
balance and each hit's level and decay from the recording. Hits retain their
positions on the complete trimmed timeline, including the lead-in, and their
tails stop at measured valleys. The estimated tempo grid is a visual guide; it
does not quantize playback or create fallback hits from silence.

The analysis filter applies the same non-destructive start/end trim and
minimum/maximum relative-level gate before each analysis engine runs. Original
recording playback is unchanged.

Voice Lab can compare Web Audio/local DSP, Meyda, and lazily loaded Essentia.js
analysis. Melody mode additionally offers Spotify Basic Pitch, whose bundled
TensorFlow.js model produces note onset, duration, pitch, and velocity data.
Melody notes stay on the shared analysis clock, are clipped to measured voiced
regions, and retain note-local pitch-bend and gain curves. The external model
and WebAssembly assets are bundled locally rather than fetched from a third
party at runtime.

After creating an initial effect config, Voice Lab uses `OfflineAudioContext`
to render a capped set of candidates, analyzes each render with the selected
adapter, and keeps the closest feature match. Fitting changes timbre and layer
balance without moving event timing and strongly penalizes energy in target
silences. If offline rendering is unavailable, Voice Lab retains the initial
generated config.

## Data and privacy

- Microphone access is requested only after the user selects **Record**.
- Recordings and analysis results remain in browser memory during the session.
- The app does not upload recordings to OpenAI or another hosted analysis
  service.
- Users can explicitly import local audio/config files and download generated
  JSON.
- When running the Vite development server, users can explicitly save samples
  and configs to `.voice-lab-library/` on their own machine. That directory is
  gitignored.

## Current limitations

- Generated configs are heuristic interpretations, not exact audio
  reconstructions. The comparison and editing tools are part of the intended
  workflow.
- Browser decoding and recording-format support vary. File import is the
  fallback when a microphone or recording format is unavailable.
- Spotify Basic Pitch and Essentia.js add model and WebAssembly assets to the
  first relevant load.
- The repository-backed mode library is provided by the Vite development
  server. Its panel and save actions are hidden in production builds. Core
  recording, audio-file import, analysis, generation, editing, playback,
  copying, and downloading remain browser-side.
- The project is designed primarily for desktop use; small-screen layouts are
  supported, but audio-authoring workflows are easier with a larger display.

## Verification

```sh
npm run type-check
npm run lint
npm run build
```

These commands perform a TypeScript check, run ESLint over the application and
Vite plugin, and create the production bundle.

## Versioning

`package.json` is the single source of truth for the application version. Vite
injects it into the Voice Lab version badge at build time, and npm keeps
`package.json` and `package-lock.json` synchronized.

```sh
npm run version:patch       # 0.1.1 -> 0.1.2
npm run version:minor       # 0.1.1 -> 0.2.0
npm run version:major       # 0.1.1 -> 1.0.0
npm run version:prerelease  # 0.1.1 -> 0.1.2-beta.0
npm run version:show
```

These commands do not create a Git commit or tag. Commit the synchronized
manifest changes with the related release, then add a Git tag separately if
desired.

## Licensing

The original project code is made available under the BSD-3-Clause terms
declared in `package.json`. Third-party dependencies retain their respective
licenses and copyright notices.

Voice Lab directly incorporates and distributes the Essentia.js JavaScript and
WebAssembly runtime. Essentia.js is licensed under AGPL-3.0, so distribution or
network access to a combined Voice Lab build must comply with the applicable
AGPL-3.0 conditions. Corresponding source for a deployed version should include
the preferred source form, dependency lockfile, build configuration, scripts,
and preserved license notices, with a prominent link to the exact deployed
source revision.

The original BSD-licensed portions remain available under BSD-3-Clause when
used independently of the Essentia-powered combined build. Spotify Basic Pitch
is licensed under Apache-2.0, and Meyda is licensed under MIT. Their attribution
and license requirements continue to apply.

This project uses Essentia's analysis algorithms and does not use Essentia's
separately licensed pretrained models. See the
[Essentia.js license](https://github.com/MTG/essentia.js/blob/master/LICENSE),
[Essentia licensing information](https://essentia.upf.edu/licensing_information.html),
and [GNU AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html) for additional
information.
