/**
 * Раздача собранного фронтенда с того же порта, что и API (docker-образ этапа 6).
 *
 * Своя маленькая реализация вместо `@fastify/static`: файлов десяток, кэширование не нужно
 * (прототип), а лишняя зависимость в рантайм-образе - лишняя. Неизвестный путь вне `/api`
 * отдает `index.html`: состояние экрана живет в query-параметрах, но прямая ссылка
 * на любой путь не должна давать 404.
 */

import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { notFound } from './errors.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export function registerStatic(app: FastifyInstance, dir: string): void {
  const root = resolve(dir);

  app.get('/*', async (request, reply) => {
    const pathname = decodeURIComponent(request.url.split('?')[0] ?? '/');
    if (pathname.startsWith('/api/') || pathname === '/ws') {
      throw notFound(`Маршрут не найден: ${request.method} ${pathname}`);
    }
    // Путь нормализуется и обязан остаться внутри каталога: `../` наружу не выпускает.
    const candidate = normalize(join(root, pathname));
    const inside = candidate === root || candidate.startsWith(root + sep);
    const file = inside && (await isFile(candidate)) ? candidate : join(root, 'index.html');
    const body = await readFile(file);
    return reply.type(MIME[extname(file)] ?? 'application/octet-stream').send(body);
  });
}
