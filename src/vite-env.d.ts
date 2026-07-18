/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

declare module 'essentia.js/dist/essentia.js-core.es.js' {
  import Essentia from 'essentia.js/dist/core_api';
  export default Essentia;
}

declare module 'essentia.js/dist/essentia-wasm.web.js' {
  const createEssentiaModule: (options?: {
    locateFile?: (path: string) => string;
  }) => Promise<unknown>;
  export default createEssentiaModule;
}
