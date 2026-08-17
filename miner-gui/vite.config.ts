import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],

  // The renderer lives at localhost:5174 in dev mode.
  server: { port: 5174 },

  // Output goes to dist/ — Electron main.js loads dist/index.html when packaged.
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
