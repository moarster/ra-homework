/**
 * `GET /api/dictionaries` - все справочники одним ответом.
 *
 * Справочники неизменны в пределах версии сервера, поэтому ответ считается один раз,
 * отдается с ETag и разрешается кешировать надолго: это самый крупный ответ API
 * (иконки показателей - inline-SVG).
 */

import { createHash } from 'node:crypto';
import {
  ALARMS,
  type DictionariesResponse,
  METRIC_GROUPS,
  METRIC_IDS,
  METRIC_ORDER,
  METRICS,
  PIT_ROUTES,
  PIT_ZONES,
  SYSTEM_STATE,
  THRESHOLD_RULES,
  UNIT_GROUPS,
  UNITS,
  VEHICLE_MODELS,
  WARNINGS,
} from '@ra/contracts';
import type { FastifyInstance } from 'fastify';

function buildDictionaries(): DictionariesResponse {
  return {
    metricOrder: METRIC_ORDER,
    metrics: METRIC_IDS.map((id) => METRICS[id]),
    metricGroups: Object.values(METRIC_GROUPS),
    units: Object.values(UNITS),
    unitGroups: Object.values(UNIT_GROUPS),
    thresholds: THRESHOLD_RULES,
    flags: { ALARMS, WARNINGS, SYSTEM_STATE },
    vehicleModels: Object.values(VEHICLE_MODELS),
    routes: Object.values(PIT_ROUTES),
    zones: PIT_ZONES,
  };
}

export function registerDictionariesRoute(app: FastifyInstance): void {
  const payload = buildDictionaries();
  const body = JSON.stringify(payload);
  const etag = `"${createHash('sha1').update(body).digest('base64url')}"`;

  app.get('/api/dictionaries', (request, reply) => {
    void reply.header('cache-control', 'public, max-age=3600');
    void reply.header('etag', etag);
    if (request.headers['if-none-match'] === etag) {
      return reply.status(304).send();
    }
    return reply.type('application/json').send(body);
  });
}
