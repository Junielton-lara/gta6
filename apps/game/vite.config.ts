import { defineConfig } from 'vite';

// Navegadores de Android TV costumam ter WebView antigo: compila para ES2017.
export default defineConfig({
  base: '/tv/',
  build: {
    target: ['es2017', 'chrome61', 'safari12'],
    cssTarget: ['chrome61', 'safari12'],
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
