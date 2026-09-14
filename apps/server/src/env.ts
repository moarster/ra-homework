/** Параметры запуска сервера. Все берутся из окружения и имеют разумные значения по умолчанию. */

import { MIN_VEHICLES } from '@ra/contracts';

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
  /** Разрешенные источники для CORS: dev-сервер Vite. */
  corsOrigins: string[];
}

/** Глубина предыстории по умолчанию - 12 часов (раздел 9 `SPEC.md`). */
const DEFAULT_HISTORY_SECONDS = 12 * 3600;

export function readEnv(): ServerEnv {
  const nodeEnv = stringFromEnv('NODE_ENV', 'development');
  return {
    port: intFromEnv('PORT', 3001),
    host: stringFromEnv('HOST', '0.0.0.0'),
    logLevel: stringFromEnv('LOG_LEVEL', nodeEnv === 'production' ? 'info' : 'debug'),
    prettyLogs: nodeEnv !== 'production' && stringFromEnv('LOG_PRETTY', '1') !== '0',
    seed: intFromEnv('SIM_SEED', 20_260_913),
    vehicleCount: intFromEnv('SIM_VEHICLES', MIN_VEHICLES),
    historySeconds: intFromEnv('SIM_HISTORY_SECONDS', DEFAULT_HISTORY_SECONDS),
    corsOrigins: stringFromEnv('CORS_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  };
}
