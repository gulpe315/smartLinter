/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import mkcert from 'vite-plugin-mkcert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { Plugin, ViteDevServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DEV_PAIRING_TOKEN = 'smartlinter-default-dev-token-secret-32b';

/**
 * Reads the native app's local pairing token only while starting Vite's dev server.
 * A missing, unreadable, or blank file must never prevent frontend development.
 */
function readDevPairingToken(): string {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    return DEFAULT_DEV_PAIRING_TOKEN;
  }

  try {
    const token = readFileSync(path.join(localAppData, 'SmartLinter', 'pairing_token.txt'), 'utf8').trim();
    return token || DEFAULT_DEV_PAIRING_TOKEN;
  } catch {
    return DEFAULT_DEV_PAIRING_TOKEN;
  }
}

const wordTaskpaneRoute: Plugin = {
  name: 'smartlinter-word-taskpane-route',
  configureServer(server: ViteDevServer) {
    server.middlewares.use(async (req, res, next) => {
      const pathname = req.url
        ? new URL(req.url, 'https://localhost').pathname
        : undefined;
      if (pathname !== '/word_taskpane.html') {
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
export default defineConfig(({ command }) => {
  // This value deliberately exists only in `vite serve`. Never set it for a
  // production build: doing so would embed a developer machine's secret in dist/.
  if (command === 'serve') {
    process.env.VITE_SMARTLINTER_DEV_TOKEN = readDevPairingToken();
  }

  return {
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
  };
});
