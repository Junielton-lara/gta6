import { defineConfig } from 'vite';

export default defineConfig({
  base: '/controller/',
  build: {
    target: ['es2017', 'chrome61', 'safari12'],
    cssTarget: ['chrome61', 'safari12'],
    sourcemap: true,
  },
});
