/** Раздача собранного фронта с порта сервера (docker-образ): статика, запасной index.html, API. */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIN_VEHICLES } from '@ra/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { ServerEnv } from '../env.js';

const INDEX = '<!doctype html><title>дашборд</title>';

let app: FastifyInstance;
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ra-static-'));
  await mkdir(join(dir, 'assets'));
  await writeFile(join(dir, 'index.html'), INDEX);
  await writeFile(join(dir, 'assets', 'app.js'), 'export const x = 1;');
  const env: ServerEnv = {
    port: 0,
    host: '127.0.0.1',
    logLevel: 'silent',
    prettyLogs: false,
    seed: 17,
    vehicleCount: MIN_VEHICLES,
    historySeconds: 600,
    timeScale: 1,
    chaos: 'NORMAL',
    corsOrigins: [],
    staticDir: dir,
    benchmark: false,
    basePath: '',
  };
  app = (await buildApp(env)).app;
});

afterAll(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

describe('статика фронта', () => {
  it('отдает файл с типом по расширению', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/javascript');
    expect(response.body).toBe('export const x = 1;');
    expect(response.headers['cache-control']).toContain('immutable');
  });

  it('корень и неизвестный путь отдают index.html, query не мешает', async () => {
    for (const url of ['/', '/?v=v-12&p=1h', '/vehicles/deep/link']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(200);
      expect(response.headers['content-type'], url).toContain('text/html');
      expect(response.body, url).toBe(INDEX);
      expect(response.headers['cache-control'], url).toBe('no-cache');
    }
  });

  it('API работает рядом со статикой, неизвестный маршрут API - JSON 404', async () => {
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    const missing = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('путь с выходом наверх не выпускает за пределы каталога', async () => {
    const response = await app.inject({ method: 'GET', url: '/%2e%2e/%2e%2e/etc/passwd' });
    expect(response.body).not.toContain('root:');
  });
});
