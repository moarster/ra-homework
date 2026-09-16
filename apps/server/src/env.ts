/** Параметры запуска сервера. Все берутся из окружения и имеют разумные значения по умолчанию. */

import { CHAOS_LEVELS, type ChaosLevel, MIN_VEHICLES, TIME_SCALES } from '@ra/contracts';
import { normalizeBasePath } from './base-path.js';

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringFromEnv(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? fallback : raw;
}

export interface ServerEnv {
  port: number;
  host: string;
  logLevel: string;
  /** Красивый вывод логов: включен в разработке. */
  prettyLogs: boolean;
  /** Seed симуляции: одинаковый seed дает одинаковый прогон. */
  seed: number;
  /** Число машин на старте. */
  vehicleCount: number;
  /** Глубина предыстории, секунды. */
  historySeconds: number;
  /** Скорость времени на старте: одна из `TIME_SCALES`. */
  timeScale: number;
  /** Мера хаоса на старте. */
  chaos: ChaosLevel;
  /** Разрешенные источники для CORS: dev-сервер Vite. */
  corsOrigins: string[];
  /**
   * Каталог собранного фронтенда. Если задан, сервер отдает статику на своем порту
   * (так работает docker-образ); в разработке фронт отдает Vite.
   */
  staticDir: string | null;
  /**
   * Префикс публикации за обратным прокси: `/ra` для `moarse.ru/ra`, пустая строка -
   * корень. Должен совпадать с `BASE_PATH`, с которым собран фронтенд.
   */
  basePath: string;
  /**
   * Режим замера (`scripts/benchmark.ts`): разрешает скорости времени вне `TIME_SCALES`,
   * чтобы проверить, есть ли запас выше допустимого списка.
   */
  benchmark: boolean;
}

/** Глубина предыстории по умолчанию - 12 часов (раздел 9 `SPEC.md`). */
const DEFAULT_HISTORY_SECONDS = 12 * 3600;

export function readEnv(): ServerEnv {
  const nodeEnv = stringFromEnv('NODE_ENV', 'development');
  const timeScale = intFromEnv('SIM_TIME_SCALE', 1);
  const chaos = stringFromEnv('SIM_CHAOS', 'NORMAL');
  const staticDir = stringFromEnv('STATIC_DIR', '');
  return {
    port: intFromEnv('PORT', 3001),
    host: stringFromEnv('HOST', '0.0.0.0'),
    logLevel: stringFromEnv('LOG_LEVEL', nodeEnv === 'production' ? 'info' : 'debug'),
    prettyLogs: nodeEnv !== 'production' && stringFromEnv('LOG_PRETTY', '1') !== '0',
    seed: intFromEnv('SIM_SEED', 20_260_913),
    vehicleCount: intFromEnv('SIM_VEHICLES', MIN_VEHICLES),
    historySeconds: intFromEnv('SIM_HISTORY_SECONDS', DEFAULT_HISTORY_SECONDS),
    // Недопустимое значение не валит запуск, а откатывается к значению по умолчанию.
    timeScale: TIME_SCALES.includes(timeScale) ? timeScale : 1,
    chaos: CHAOS_LEVELS.find((level) => level.id === chaos)?.id ?? 'NORMAL',
    corsOrigins: stringFromEnv('CORS_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    staticDir: staticDir === '' ? null : staticDir,
    basePath: normalizeBasePath(stringFromEnv('BASE_PATH', '')),
    benchmark: stringFromEnv('SIM_BENCHMARK', '0') === '1',
  };
}
