/**
 * Порядок и сводка парка для навигационного списка машин.
 *
 * Список отвечает на вопрос "какую машину смотреть", поэтому сверху те, что требуют внимания:
 * аварии, затем предупреждения, затем машины без связи, затем здоровые.
 */

import { SEVERITY, type Severity, type VehicleStatus } from '@ra/contracts';

export interface FleetEntry {
  id: string;
  sideNumber: string;
  severity: Severity;
  status: VehicleStatus;
}

export type FleetGroup = 'alarm' | 'warn' | 'grey' | 'ok';

const GROUP_RANK: Record<FleetGroup, number> = { alarm: 0, warn: 1, grey: 2, ok: 3 };

/** Статусы, при которых машина считается в работе: двигатель запущен и связь есть. */
const WORKING_STATUSES = new Set<VehicleStatus>([
  'HAULING',
  'RETURNING',
  'LOADING',
  'UNLOADING',
  'IDLING',
]);

/** Машина серая, если сервер не видит свежих годных данных: светофор ей не присвоить. */
export function isGrey(entry: Pick<FleetEntry, 'severity' | 'status'>): boolean {
  return entry.severity === SEVERITY.UNKNOWN || entry.status === 'NO_DATA';
}

export function fleetGroup(entry: Pick<FleetEntry, 'severity' | 'status'>): FleetGroup {
  if (isGrey(entry)) {
    return 'grey';
  }
  if (entry.severity === SEVERITY.ALARM) {
    return 'alarm';
  }
  return entry.severity === SEVERITY.WARN ? 'warn' : 'ok';
}

const sideNumberCollator = new Intl.Collator('ru', { numeric: true });

export function compareFleet(a: FleetEntry, b: FleetEntry): number {
  const byGroup = GROUP_RANK[fleetGroup(a)] - GROUP_RANK[fleetGroup(b)];
  return byGroup !== 0 ? byGroup : sideNumberCollator.compare(a.sideNumber, b.sideNumber);
}

export interface FleetCounts {
  total: number;
  working: number;
  alarms: number;
  warnings: number;
  noData: number;
}

export function fleetCounts(entries: readonly FleetEntry[]): FleetCounts {
  const counts: FleetCounts = {
    total: entries.length,
    working: 0,
    alarms: 0,
    warnings: 0,
    noData: 0,
  };
  for (const entry of entries) {
    const group = fleetGroup(entry);
    if (group === 'grey') {
      counts.noData += 1;
    } else if (group === 'alarm') {
      counts.alarms += 1;
    } else if (group === 'warn') {
      counts.warnings += 1;
    }
    if (group !== 'grey' && WORKING_STATUSES.has(entry.status)) {
      counts.working += 1;
    }
  }
  return counts;
}
