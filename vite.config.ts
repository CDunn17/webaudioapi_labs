import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: 'index.html',
        audioLab: 'audio-lab.html',
        musicLab: 'music-lab.html',
      },
    },
  },
  server: {
    host: '127.0.0.1',
  },
});
