/**
 * `GET /api/health` - время работы, число машин, объем занятой памяти и текущее виртуальное
 * время. Используется и для демонстрации, и для нагрузочного скрипта этапа 6.
 */

import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './context.js';

export function registerHealthRoute(app: FastifyInstance, context: RouteContext): void {
  app.get('/api/health', () => context.engine.health());
}
