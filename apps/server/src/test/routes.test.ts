/** Маршруты API через inject: контракты ответов, валидация параметров, формат ошибок. */

import {
  APP_CONFIG,
  latestResponseSchema,
  METRIC_ORDER,
  MIN_VEHICLES,
  seriesResponseSchema,
  simStateSchema,
  trackResponseSchema,
  vehicleSummaryResponseSchema,
} from '@ra/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { ServerEnv } from '../env.js';
import type { SimEngine } from '../sim/engine.js';

const env: ServerEnv = {
  port: 0,
  host: '127.0.0.1',
  logLevel: 'silent',
  prettyLogs: false,
  seed: 17,
  vehicleCount: MIN_VEHICLES,
  historySeconds: 1800,
  corsOrigins: ['http://localhost:5173'],
};

let app: FastifyInstance;
let engine: SimEngine;

beforeAll(async () => {
  const built = await buildApp(env);
  app = built.app;
  engine = built.engine;
  // Часы останавливаются: тесты не должны зависеть от реального времени.
  engine.clock.stop();
});

afterAll(async () => {
  await app.close();
});

describe('справочники и конфигурация', () => {
  it('GET /api/config отдает конфигурацию приложения', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/config' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(JSON.parse(JSON.stringify(APP_CONFIG)));
  });

  it('GET /api/dictionaries кешируется по ETag', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/dictionaries' });
    expect(first.statusCode).toBe(200);
    const etag = first.headers.etag;
    expect(etag).toBeTruthy();
    expect(first.headers['cache-control']).toContain('max-age');
    const second = await app.inject({
      method: 'GET',
      url: '/api/dictionaries',
      headers: { 'if-none-match': String(etag) },
    });
    expect(second.statusCode).toBe(304);
  });

  it('GET /api/vehicles отдает три именные машины', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/vehicles' });
    const body = response.json<{ vehicles: { id: string }[] }>();
    expect(body.vehicles.map((vehicle) => vehicle.id)).toEqual(['v-12', 'v-07', 'v-21']);
  });

  it('GET /api/health отдает состояние сервера', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    const body = response.json<{ vehicles: number; memory: { storeBytes: number } }>();
    expect(body.vehicles).toBe(MIN_VEHICLES);
    expect(body.memory.storeBytes).toBeGreaterThan(0);
  });
});

describe('телеметрия', () => {
  it('GET /api/telemetry/latest соответствует схеме контракта', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/telemetry/latest' });
    const parsed = latestResponseSchema.safeParse(response.json());
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.snapshots[0]?.v.length).toBe(METRIC_ORDER.length);
  });

  it('GET /api/telemetry/series без параметра metrics отдает все показатели светофора', async () => {
    const to = engine.simTime;
    const response = await app.inject({
      method: 'GET',
      url: `/api/telemetry/series?vehicleIds=v-12&from=${to - 600}&to=${to}&maxPoints=100`,
    });
    const parsed = seriesResponseSchema.safeParse(response.json());
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    expect(parsed.data.series.length).toBeGreaterThan(5);
    expect(parsed.data.series.every((series) => series.avg.length <= 100)).toBe(true);
  });

  it('GET /api/telemetry/track отдает трек в границах карьера', async () => {
    const to = engine.simTime;
    const response = await app.inject({
      method: 'GET',
      url: `/api/telemetry/track?from=${to - 600}&to=${to}&maxPoints=200`,
    });
    const parsed = trackResponseSchema.safeParse(response.json());
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    expect(parsed.data.tracks.length).toBe(MIN_VEHICLES);
    const [[south, west], [north, east]] = APP_CONFIG.pit.bounds;
    for (const track of parsed.data.tracks) {
      for (const [, lat, lon] of track.points) {
        expect(lat).toBeGreaterThan(south);
        expect(lat).toBeLessThan(north);
        expect(lon).toBeGreaterThan(west);
        expect(lon).toBeLessThan(east);
      }
    }
  });

  it('GET /api/vehicles/:id/summary соответствует схеме контракта', async () => {
    const to = engine.simTime;
    const response = await app.inject({
      method: 'GET',
      url: `/api/vehicles/v-12/summary?from=${to - 1800}&to=${to}`,
    });
    expect(vehicleSummaryResponseSchema.safeParse(response.json()).success).toBe(true);
  });
});

describe('валидация и ошибки', () => {
  it('период без обязательных параметров отклоняется с кодом INVALID_QUERY', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/telemetry/series' });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('INVALID_QUERY');
  });

  it('неизвестный показатель отклоняется', async () => {
    const to = engine.simTime;
    const response = await app.inject({
      method: 'GET',
      url: `/api/telemetry/series?metrics=NO_SUCH_METRIC&from=${to - 60}&to=${to}`,
    });
    expect(response.statusCode).toBe(400);
  });

  it('неизвестная машина отклоняется с кодом UNKNOWN_VEHICLE', async () => {
    const to = engine.simTime;
    const response = await app.inject({
      method: 'GET',
      url: `/api/telemetry/series?vehicleIds=v-999&from=${to - 60}&to=${to}`,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('UNKNOWN_VEHICLE');
  });

  it('перевернутый период отклоняется с кодом INVALID_PERIOD', async () => {
    const to = engine.simTime;
    const response = await app.inject({
      method: 'GET',
      url: `/api/telemetry/series?from=${to}&to=${to - 60}`,
    });
    expect(response.json<{ error: { code: string } }>().error.code).toBe('INVALID_PERIOD');
  });

  it('сводка по неизвестной машине отдает 404', async () => {
    const to = engine.simTime;
    const response = await app.inject({
      method: 'GET',
      url: `/api/vehicles/v-999/summary?from=${to - 60}&to=${to}`,
    });
    expect(response.statusCode).toBe(404);
  });

  it('несуществующий маршрут отдает 404 в общем формате ошибки', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
  });
});

describe('управление симуляцией', () => {
  it('GET /api/sim отдает состояние симуляции', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/sim' });
    expect(simStateSchema.safeParse(response.json()).success).toBe(true);
  });

  it('POST /api/sim меняет параметры и возвращает новое состояние', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/sim',
      payload: { timeScale: 10, chaos: 'MESSY' },
    });
    const body = response.json<{ timeScale: number; chaos: string }>();
    expect(body.timeScale).toBe(10);
    expect(body.chaos).toBe('MESSY');
  });

  it('POST /api/sim отклоняет недопустимую скорость времени и число машин', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/sim', payload: { timeScale: 7 } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json<{ error: { code: string } }>().error.code).toBe('INVALID_TIME_SCALE');
    const tooMany = await app.inject({
      method: 'POST',
      url: '/api/sim',
      payload: { vehicleCount: 100 },
    });
    expect(tooMany.json<{ error: { code: string } }>().error.code).toBe('INVALID_VEHICLE_COUNT');
  });
});
