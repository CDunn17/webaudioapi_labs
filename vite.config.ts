import { defineConfig, type Plugin } from 'vite';
import packageConfig from './package.json';
import { voiceLibraryPlugin } from './vite/voiceLibraryPlugin';

import { cloudflare } from "@cloudflare/vite-plugin";

const SOURCE_REPOSITORY_URL = 'https://github.com/CDunn17/webaudioapi_labs';
const sourceRevision = [
  process.env.CF_PAGES_COMMIT_SHA,
  process.env.VERCEL_GIT_COMMIT_SHA,
  process.env.COMMIT_REF,
].find((value) => value !== undefined && /^[0-9a-f]{7,40}$/i.test(value));
const sourceCodeUrl = sourceRevision === undefined
  ? SOURCE_REPOSITORY_URL
  : `${SOURCE_REPOSITORY_URL}/tree/${sourceRevision}`;

const sourceCodeLinkPlugin = (): Plugin => ({
  name: 'source-code-link',
  transformIndexHtml(html) {
    return html.replaceAll('__SOURCE_CODE_URL__', sourceCodeUrl);
  },
});

export default defineConfig({
  plugins: [sourceCodeLinkPlugin(), voiceLibraryPlugin(), cloudflare()],
  define: {
    __APP_VERSION__: JSON.stringify(packageConfig.version),
  },
  build: {
    rollupOptions: {
      input: {
        index: 'index.html',
        audioLab: 'audio-lab.html',
        humLab: 'hum-lab.html',
        musicLab: 'music-lab.html',
      },
    },
  },
  server: {
    host: '127.0.0.1',
  },
});