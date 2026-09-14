/** `GET /api/config` - конфигурация приложения (раздел 7 `SPEC.md`). */

import { APP_CONFIG } from '@ra/contracts';
import type { FastifyInstance } from 'fastify';

export function registerConfigRoute(app: FastifyInstance): void {
  app.get('/api/config', () => APP_CONFIG);
}
