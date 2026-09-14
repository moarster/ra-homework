/** Все ручки API одного вида: функция, которой можно дать `AbortSignal`. */

import {
  appConfigSchema,
  dictionariesResponseSchema,
  eventsResponseSchema,
  latestResponseSchema,
  type MetricId,
  type SimPatch,
  seriesResponseSchema,
  simStateSchema,
  trackResponseSchema,
  vehicleSummaryResponseSchema,
  vehiclesResponseSchema,
} from '@ra/contracts';
import { request } from './client.js';

/** Окно периода: все запросы телеметрии опираются на него. */
export interface TimeWindow {
  from: number;
  to: number;
}

export interface SeriesParams extends TimeWindow {
  vehicleIds?: readonly string[];
  metrics?: readonly MetricId[];
  maxPoints?: number;
}

export interface TrackParams extends TimeWindow {
  vehicleIds?: readonly string[];
  maxPoints?: number;
  /** Светофор трека только по этим показателям (режим "только по отслеживаемым"). */
  severityMetrics?: readonly MetricId[];
}

export interface EventsParams extends TimeWindow {
  vehicleIds?: readonly string[];
  severity?: 1 | 2;
  limit?: number;
}

export const api = {
  getConfig: (signal?: AbortSignal) =>
    request('/config', appConfigSchema, signal !== undefined ? { signal } : {}),

  getDictionaries: (signal?: AbortSignal) =>
    request('/dictionaries', dictionariesResponseSchema, signal !== undefined ? { signal } : {}),

  getVehicles: (signal?: AbortSignal) =>
    request('/vehicles', vehiclesResponseSchema, signal !== undefined ? { signal } : {}),

  getLatest: (signal?: AbortSignal) =>
    request('/telemetry/latest', latestResponseSchema, signal !== undefined ? { signal } : {}),

  getSeries: (params: SeriesParams, signal?: AbortSignal) =>
    request('/telemetry/series', seriesResponseSchema, {
      params: {
        from: params.from,
        to: params.to,
        vehicleIds: params.vehicleIds,
        metrics: params.metrics,
        maxPoints: params.maxPoints,
      },
      ...(signal !== undefined ? { signal } : {}),
    }),

  getTrack: (params: TrackParams, signal?: AbortSignal) =>
    request('/telemetry/track', trackResponseSchema, {
      params: {
        from: params.from,
        to: params.to,
        vehicleIds: params.vehicleIds,
        maxPoints: params.maxPoints,
        severityMetrics: params.severityMetrics,
      },
      ...(signal !== undefined ? { signal } : {}),
    }),

  getEvents: (params: EventsParams, signal?: AbortSignal) =>
    request('/events', eventsResponseSchema, {
      params: {
        from: params.from,
        to: params.to,
        vehicleIds: params.vehicleIds,
        severity: params.severity,
        limit: params.limit,
      },
      ...(signal !== undefined ? { signal } : {}),
    }),

  getSummary: (vehicleId: string, window: TimeWindow, signal?: AbortSignal) =>
    request(`/vehicles/${encodeURIComponent(vehicleId)}/summary`, vehicleSummaryResponseSchema, {
      params: { from: window.from, to: window.to },
      ...(signal !== undefined ? { signal } : {}),
    }),

  getSim: (signal?: AbortSignal) =>
    request('/sim', simStateSchema, signal !== undefined ? { signal } : {}),

  setSim: (patch: SimPatch, signal?: AbortSignal) =>
    request('/sim', simStateSchema, {
      method: 'POST',
      body: patch,
      ...(signal !== undefined ? { signal } : {}),
    }),
};
