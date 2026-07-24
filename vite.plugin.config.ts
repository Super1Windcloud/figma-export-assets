import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist/plugin',
    emptyOutDir: false,
    lib: {
      entry: 'src/plugin.ts',
      formats: ['iife'],
      name: 'ExportFigmaAssets',
      fileName: () => 'main.js',
    },
    minify: false,
  },
});
