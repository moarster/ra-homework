/** `GET /api/events` - события за период с фильтрами (раздел 7 `SPEC.md`). */

import { type EventsResponse, eventsQuerySchema } from '@ra/contracts';
import type { FastifyInstance } from 'fastify';
import { parseQuery } from '../errors.js';
import { checkPeriod, type RouteContext, resolveVehicleIds } from './context.js';

export function registerEventsRoute(app: FastifyInstance, context: RouteContext): void {
  app.get('/api/events', (request): EventsResponse => {
    const query = parseQuery(eventsQuerySchema, request.query);
    checkPeriod(query.from, query.to);
    const vehicleIds = resolveVehicleIds(context, query.vehicleIds);
    return {
      events: context.engine.journal.query({
        vehicleIds,
        from: query.from,
        to: query.to,
        ...(query.severity === undefined ? {} : { severity: query.severity as 1 | 2 }),
        limit: query.limit,
      }),
    };
  });
}
