/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import mkcert from 'vite-plugin-mkcert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import type { Plugin, ViteDevServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const wordTaskpaneRoute: Plugin = {
  name: 'smartlinter-word-taskpane-route',
  configureServer(server: ViteDevServer) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url !== '/word_taskpane.html') {
        next();
        return;
      }

      try {
        // Do not rewrite req.url here. Connect and Vite cache request-path parsing
        // during the middleware chain; mutating it after parsing can leave the
        // request in an inconsistent state and wedge the HTTPS server.
        const taskpanePath = path.resolve(__dirname, 'plugins/word/word_taskpane.html');
        const source = await readFile(taskpanePath, 'utf8');
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(source);
      } catch (error) {
        next(error);
      }
    });
  },
};

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  // Certificate generation is needed only for the HTTPS development server.
  // Keeping it out of `vite build` makes the multi-page production build
  // independent of a developer's local certificate store.
  plugins: [react(), tailwindcss(), wordTaskpaneRoute, ...(command === 'serve' ? [mkcert()] : [])],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    https: true,
    watch: {
      ignored: ['**/src-tauri/**', '**/target/**'],
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    include: ['src/**/__tests__/**/*.{test,spec}.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        wordTaskpane: path.resolve(__dirname, 'plugins/word/word_taskpane.html'),
      },
    },
  },
}));
