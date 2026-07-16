# Web Audio API Labs

Standalone Vite labs for experimenting with Web Audio sound effects and procedural music.

## Labs

- `audio-lab.html`: layered one-shot and sustained sound-effect editor.
- `music-lab.html`: procedural score and pulse-sequencing editor.

The lab presets live in `src/config/audio.ts` and `src/config/music.ts`. These files are local to this repo, so experiments here are not coupled to Edge of the Drift runtime code.

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

## Verification

```sh
npm run type-check
npm run lint
npm run build
```
