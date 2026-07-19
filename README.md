# Web Audio API Labs

Current iteration: **v0.0.2**. The Voice Lab header reads this value from `package.json` at build time.

Standalone Vite labs for experimenting with Web Audio sound effects and procedural music.

## Labs

- `audio-lab.html`: layered one-shot and sustained sound-effect editor.
- `music-lab.html`: procedural score and pulse-sequencing editor.
- `hum-lab.html`: Voice Lab experiment that turns vocal effects, beatboxing, and melodies into sample-free procedural configs. Recordings remain available for comparison playback, and pluggable Web Audio/local DSP and Meyda analyzers can be run side by side.

The lab presets live in `src/config/audio.ts` and `src/config/music.ts`. These files are local to this repo, so experiments here are not coupled to Edge of the Drift runtime code.

### Voice Lab generation

Voice Lab trims leading and trailing silence before analysis, then uses a separate short-hop envelope to retain internal rests, relative peaks, brightness, and pitch contour. Effect layers are hard-gated by measured active regions, and event layers keep their detected timing and local decay. Conservative resonator banks are used only when a strong, low-flatness impact supports ringing; generation no longer scatters inferred fragments between measured events. These timeline fields and primitives remain sample-free and deterministic.

Beat generation combines attack detection with nearby amplitude peaks, groups short peak regions by relative timbre, and derives each lane's tone/noise balance and each hit's level and decay from the recording. Hits retain their positions on the complete trimmed timeline, including the lead-in, and their tails stop at measured valleys. The estimated tempo grid is retained as a visual guide rather than used to quantize playback; silence does not create a fallback hit.

The Voice Lab analysis filter applies the same non-destructive start/end trim and minimum/maximum relative-level gate before either analysis engine runs. Original recording playback is unchanged.

Voice Lab can compare Web Audio/local DSP, Meyda, and lazily loaded Essentia.js analysis. Melody mode additionally offers Spotify Basic Pitch, whose local TensorFlow.js model produces note onset, duration, pitch, and velocity data. Melody notes stay on the shared analysis clock, are clipped to measured voiced regions, and retain note-local pitch-bend and gain curves; the combined result uses one coherent set of note boundaries rather than inventing consensus notes. The external model and WASM assets are bundled locally rather than fetched from a third-party service.

Beat results include an event-review stage. Users can add, remove, retime, and resize detected hits; events sharing a label are regrouped onto one digital voice. Suggested tone, decay, and volume values remain editable before previewing or copying the complete config, and the source can be re-analyzed without re-recording.

After creating an initial effect config, Voice Lab uses `OfflineAudioContext` to render a capped set of candidates, analyzes each render with the selected adapter, and keeps the closest feature match. Fitting changes timbre and layer balance without moving event timing, strongly penalizes energy in target silences, and also fits the fused final effect. If offline rendering is unavailable, it retains the initial generated config. Audio Lab uses the same renderer for preview and exposes the procedural primitive parameters for manual fine-tuning.

## Licensing

This is a non-commercial, open-source hackathon project. The original project code is made available under the BSD-3-Clause terms declared in `package.json`. Individual third-party dependencies retain their own licenses and copyright notices.

Voice Lab directly incorporates and distributes the Essentia.js JavaScript and WebAssembly runtime. Essentia.js is licensed under AGPL-3.0, so a combined Voice Lab build containing it is distributed subject to the AGPL-3.0 conditions. In particular:

- Users of a distributed or network-accessible Voice Lab build must be offered the complete corresponding source for the deployed version.
- That source must include the preferred source form, dependency lockfile, build configuration, and scripts needed to reproduce and modify the build.
- Essentia and AGPL notices must be preserved, and users must retain the AGPL rights to inspect, modify, and redistribute the covered combined work.
- A hosted version should provide a prominent link to the exact source revision used for the deployment.
- No additional terms may restrict rights granted by AGPL-3.0.

The original BSD-licensed portions remain available under BSD-3-Clause when used independently of the Essentia-powered combined build. The other labs do not incorporate Essentia and remain under their existing BSD-3-Clause terms.

Spotify Basic Pitch is licensed under Apache-2.0. Meyda is licensed under MIT. Their copyright, attribution, and license notices remain applicable within the combined distribution. BSD-3-Clause, Apache-2.0, and MIT components are compatible with distribution as part of the AGPL-3.0 Voice Lab combination, but their original notices must still be retained.

This project currently uses Essentia's analysis algorithms only; it does not use Essentia's separately licensed pretrained models. See the [Essentia.js license](https://github.com/MTG/essentia.js/blob/master/LICENSE), [Essentia licensing information](https://essentia.upf.edu/licensing_information.html), and [GNU AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html) for the governing terms.

## Local Development

Install dependencies:

```sh
npm install
```

## Versioning

The app version uses the standard SemVer value in `package.json` as its single source of truth. Vite injects that value into the Voice Lab version badge at build time, and npm keeps `package.json` and `package-lock.json` synchronized.

Use one of these commands when preparing a new version:

```sh
npm run version:patch       # 0.0.2 -> 0.0.3
npm run version:minor       # 0.0.2 -> 0.1.0
npm run version:major       # 0.0.2 -> 1.0.0
npm run version:prerelease  # 0.0.2 -> 0.0.3-beta.0
npm run version:show
```

These commands intentionally do not create a Git commit or tag. Commit the synchronized manifest changes with the related release, then add a Git tag separately when desired.

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
