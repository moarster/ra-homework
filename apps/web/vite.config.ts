/**
 * Сборка фронтенда. В режиме разработки `/api` и `/ws` проксируются на сервер,
 * поэтому приложение работает с одного источника и не зависит от CORS.
 */

import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Адрес сервера в разработке; совпадает с значением по умолчанию `apps/server`. */
const SERVER_ORIGIN = process.env.SERVER_ORIGIN ?? 'http://127.0.0.1:3001';

/**
 * Префикс публикации сборки: `BASE_PATH=/ra/` для `moarse.ru/ra/`. Должен совпадать
 * с `BASE_PATH` сервера. Для dev-сервера не задается: прокси ниже ждут корень.
 */
const BASE = `/${(process.env.BASE_PATH ?? '').replace(/^\/+|\/+$/g, '')}/`.replace('//', '/');

export default defineConfig({
  base: BASE,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: SERVER_ORIGIN, changeOrigin: true },
      '/ws': { target: SERVER_ORIGIN, changeOrigin: true, ws: true },
    },
  },
  build: {
    target: 'es2023',
    sourcemap: true,
  },
  // Воркер карты MapLibre запускается как модуль (`type: 'module'`): собираем его так же.
  worker: {
    format: 'es',
  },
});
