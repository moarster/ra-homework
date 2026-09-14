/**
 * Тесты фронтенда. Здесь проверяется чистая логика области карты: сборка хвостов трека,
 * затухание кометы и правило аварии "нет данных". Компоненты и цикл отрисовки не тестируются -
 * им нужен настоящий canvas и настоящая карта, а это уже проверка глазами на живом стенде.
 */

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
