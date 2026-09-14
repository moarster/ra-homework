/**
 * Маршруты телеметрии: последние снапшоты, серии и треки (раздел 7 `SPEC.md`).
 */

import {
  type LatestResponse,
  type MetricId,
  SEVERITY_METRIC_IDS,
  seriesQuerySchema,
  trackQuerySchema,
} from '@ra/contracts';
import type { FastifyInstance } from 'fastify';
import { parseQuery } from '../errors.js';
import { querySeries, queryTrack, type TrackMarkInput } from '../store/query.js';
import { checkPeriod, type RouteContext, resolveVehicleIds } from './context.js';

/** Показатели по умолчанию для серий: все, участвующие в светофоре. */
const DEFAULT_SERIES_METRICS: MetricId[] = SEVERITY_METRIC_IDS;

export function registerTelemetryRoutes(app: FastifyInstance, context: RouteContext): void {
  app.get('/api/telemetry/latest', (): LatestResponse => {
    return {
      t: context.engine.simTime,
      snapshots: context.engine.snapshots(),
    };
  });

  app.get('/api/telemetry/series', (request) => {
    const query = parseQuery(seriesQuerySchema, request.query);
    checkPeriod(query.from, query.to);
    const vehicleIds = resolveVehicleIds(context, query.vehicleIds);
    const metrics = query.metrics ?? DEFAULT_SERIES_METRICS;
    return querySeries(context.engine.store, {
      vehicleIds,
      metrics,
      from: query.from,
      to: query.to,
      maxPoints: query.maxPoints,
    });
  });

  app.get('/api/telemetry/track', (request) => {
    const query = parseQuery(trackQuerySchema, request.query);
    checkPeriod(query.from, query.to);
    const vehicleIds = resolveVehicleIds(context, query.vehicleIds);
    return queryTrack(context.engine.store, {
      vehicleIds,
      from: query.from,
      to: query.to,
      maxPoints: query.maxPoints,
      ...(query.severityMetrics === undefined ? {} : { severityMetrics: query.severityMetrics }),
      marks: collectMarks(context, vehicleIds, query.from, query.to),
    });
  });
}

/**
 * Флажки на треке: точки срабатывания битов аварий и предупреждений.
 *
 * Биты не хранятся посекундно - вместо этого моменты их срабатывания берутся из журнала
 * событий, а координаты подставляются из кольца позиций. Так флажок всегда соответствует
 * событию в журнале, и посекундная история битов не занимает память.
 */
function collectMarks(
  context: RouteContext,
  vehicleIds: string[],
  from: number,
  to: number,
): TrackMarkInput[] {
  const marks: TrackMarkInput[] = [];
  for (const vehicleId of vehicleIds) {
    for (const event of context.engine.journal.forVehicle(vehicleId)) {
      if (event.source !== 'alarmBit' && event.source !== 'warningBit') {
        continue;
      }
      if (event.startedAt < from || event.startedAt > to) {
        continue;
      }
      marks.push({
        vehicleId,
        t: event.startedAt,
        code: event.code,
        severity: event.severity,
      });
    }
  }
  return marks;
}
