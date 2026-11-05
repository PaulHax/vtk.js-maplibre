import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { rollupOptions: { input: { home: 'index.html', storm: 'storm/index.html', bikes: 'bikes/index.html' } } },
});
