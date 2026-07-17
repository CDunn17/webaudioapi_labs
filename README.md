# Web Audio API Labs

Current iteration: **v0.0.2**. The Voice Lab header reads this value from `package.json` at build time.

Standalone Vite labs for experimenting with Web Audio sound effects and procedural music.

## Labs

- `audio-lab.html`: layered one-shot and sustained sound-effect editor.
- `music-lab.html`: procedural score and pulse-sequencing editor.
- `hum-lab.html`: Voice Lab experiment that turns vocal effects, beatboxing, and melodies into sample-free procedural configs. Recordings remain available for comparison playback, and pluggable Web Audio/local DSP and Meyda analyzers can be run side by side.

The lab presets live in `src/config/audio.ts` and `src/config/music.ts`. These files are local to this repo, so experiments here are not coupled to Edge of the Drift runtime code.

### Voice Lab generation

Voice Lab trims leading and trailing silence before analysis, retains simplified amplitude, brightness, and pitch curves, and represents effect onsets as independently timed procedural layers. Effect generation can add resonator banks for inharmonic ringing and seeded impulse clusters for debris, shards, and secondary impacts. These timeline fields and primitives remain sample-free and deterministic.

Beat generation combines attack detection with nearby amplitude peaks, groups short peak regions by relative timbre, and previews simple low/mid/high tones at the recorded relative times. The estimated tempo grid is retained as a visual guide rather than used to quantize playback.

The Voice Lab analysis filter applies the same non-destructive start/end trim and minimum/maximum relative-level gate before either analysis engine runs. Original recording playback is unchanged.

Beat results include an event-review stage. Users can add, remove, retime, and resize detected hits; events sharing a label are regrouped onto one digital voice. Suggested tone, decay, and volume values remain editable before previewing or copying the complete config, and the source can be re-analyzed without re-recording.

After creating an initial effect config, Voice Lab uses `OfflineAudioContext` to render a capped set of candidates, analyzes each render with the selected Web Audio/local DSP or Meyda adapter, and keeps the closest feature match. If offline rendering is unavailable, it retains the initial generated config. Audio Lab uses the same renderer for preview and exposes the new primitive parameters for manual fine-tuning.

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
