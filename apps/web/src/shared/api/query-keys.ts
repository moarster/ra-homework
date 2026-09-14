/** Ключи кеша TanStack Query. Все в одном месте, чтобы инвалидация не промахивалась. */

import type { MetricId } from '@ra/contracts';

export const queryKeys = {
  config: ['config'] as const,
  dictionaries: ['dictionaries'] as const,
  vehicles: ['vehicles'] as const,
  latest: ['latest'] as const,
  sim: ['sim'] as const,
  series: (
    vehicleIds: readonly string[] | undefined,
    metrics: readonly MetricId[] | undefined,
    from: number,
    to: number,
  ) => ['series', vehicleIds ?? 'all', metrics ?? 'all', from, to] as const,
  track: (
    vehicleIds: readonly string[] | undefined,
    from: number,
    to: number,
    severityMetrics: readonly MetricId[] | undefined,
  ) => ['track', vehicleIds ?? 'all', from, to, severityMetrics ?? 'all'] as const,
  events: (
    vehicleIds: readonly string[] | undefined,
    from: number,
    to: number,
    severity: 1 | 2 | undefined,
  ) => ['events', vehicleIds ?? 'all', from, to, severity ?? 'all'] as const,
  summary: (vehicleId: string, from: number, to: number) =>
    ['summary', vehicleId, from, to] as const,
};

/** Семейства ключей телеметрии: то, что надо сбросить при `backfill`. */
export const telemetryKeyPrefixes = ['series', 'track', 'events', 'summary'] as const;
