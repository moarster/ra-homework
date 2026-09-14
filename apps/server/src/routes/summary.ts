/** `GET /api/vehicles/:id/summary` - сводка по машине за период (раздел 9.3 `CONTEXT.md`). */

import { summaryQuerySchema } from '@ra/contracts';
import type { FastifyInstance } from 'fastify';
import { notFound, parseQuery } from '../errors.js';
import { buildSummary } from '../summary/summary.js';
import { checkPeriod, type RouteContext } from './context.js';

export function registerSummaryRoute(app: FastifyInstance, context: RouteContext): void {
  app.get<{ Params: { id: string } }>('/api/vehicles/:id/summary', (request) => {
    const query = parseQuery(summaryQuerySchema, request.query);
    checkPeriod(query.from, query.to);
    const vehicleId = request.params.id;
    if (context.engine.store.get(vehicleId) === undefined) {
      throw notFound(`машина не найдена: ${vehicleId}`, 'UNKNOWN_VEHICLE');
    }
    return buildSummary(
      context.engine.store,
      context.engine.journal,
      vehicleId,
      query.from,
      query.to,
    );
  });
}
