/**
 * Vite config for the Bucks Browser Wallet Chrome extension (Manifest V3).
 *
 * Multi-entry build:
 *   background  → service_worker (background/index.ts)
 *   content     → content script  (content/index.ts)
 *   inpage      → injected EIP-1193 provider (inpage/index.ts)
 *   popup       → extension popup  (popup/index.html)
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const isFirefox = process.env.BROWSER === 'firefox';

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },

  build: {
    outDir: isFirefox ? 'dist-firefox' : 'dist',
    emptyOutDir: true,
    sourcemap: false,
    minify: 'terser',

    rollupOptions: {
      input: {
        // Popup SPA
        popup: resolve(__dirname, 'src/popup/index.html'),
        // Background service worker
        background: resolve(__dirname, 'src/background/index.ts'),
        // Content script (injected into every page)
        content: resolve(__dirname, 'src/content/index.ts'),
        // Inpage provider script (injected by content script)
        inpage: resolve(__dirname, 'src/inpage/index.ts'),
      },

      output: {
        // Each entry produces a predictable filename so manifest.json can reference it.
        entryFileNames: (chunk) => {
          const map: Record<string, string> = {
            background: 'background.js',
            content:    'content.js',
            inpage:     'inpage.js',
          };
          return map[chunk.name] ?? `[name].[hash].js`;
        },
        chunkFileNames: 'chunks/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash][extname]',
      },
    },
  },
});
