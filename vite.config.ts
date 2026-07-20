import { defineConfig } from 'vite';
import packageConfig from './package.json';
import { voiceLibraryPlugin } from './vite/voiceLibraryPlugin';

export default defineConfig({
  plugins: [voiceLibraryPlugin()],
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
