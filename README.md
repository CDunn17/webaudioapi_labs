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

Voice Lab can compare Web Audio/local DSP, Meyda, and lazily loaded Essentia.js analysis. Melody mode additionally offers Spotify Basic Pitch, whose local TensorFlow.js model produces note onset, duration, pitch, and velocity data. The external model and WASM assets are bundled locally rather than fetched from a third-party service.

Beat results include an event-review stage. Users can add, remove, retime, and resize detected hits; events sharing a label are regrouped onto one digital voice. Suggested tone, decay, and volume values remain editable before previewing or copying the complete config, and the source can be re-analyzed without re-recording.

After creating an initial effect config, Voice Lab uses `OfflineAudioContext` to render a capped set of candidates, analyzes each render with the selected Web Audio/local DSP or Meyda adapter, and keeps the closest feature match. If offline rendering is unavailable, it retains the initial generated config. Audio Lab uses the same renderer for preview and exposes the new primitive parameters for manual fine-tuning.

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
