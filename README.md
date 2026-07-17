# Web Audio API Labs

Standalone Vite labs for experimenting with Web Audio sound effects and procedural music.

## Labs

- `audio-lab.html`: layered one-shot and sustained sound-effect editor.
- `music-lab.html`: procedural score and pulse-sequencing editor.
- `hum-lab.html`: Voice Lab experiment that turns vocal effects, beatboxing, and melodies into sample-free procedural configs. Recordings remain available for comparison playback, and pluggable Web Audio/local DSP and Meyda analyzers can be run side by side.

The lab presets live in `src/config/audio.ts` and `src/config/music.ts`. These files are local to this repo, so experiments here are not coupled to Edge of the Drift runtime code.

### Voice Lab generation

Voice Lab trims leading and trailing silence before analysis, retains simplified amplitude, brightness, and pitch curves, and represents effect onsets as independently timed procedural layers. These timeline fields are optional, so existing Audio Lab configurations remain valid.

Remaining generation TODOs:

- Add resonator-bank and stochastic impulse-cluster primitives for inharmonic materials such as glass and metal.
- Add an `OfflineAudioContext` render-and-fit loop that iteratively compares generated feature curves with the source recording.

## Local Development

Install dependencies:

```sh
npm install
```

Run the labs:

```sh
npm run dev
```

Open:

- `http://127.0.0.1:5173/`
- `http://127.0.0.1:5173/audio-lab.html`
- `http://127.0.0.1:5173/music-lab.html`
- `http://127.0.0.1:5173/hum-lab.html`

## Verification

```sh
npm run type-check
npm run lint
npm run build
```
