/**
 * Журнал событий в памяти за 24 часа с индексом по машине и времени (раздел 5 задания этапа).
 *
 * События хранятся объектами, а не в типизированных массивах: их порядки величин другие -
 * десятки в час на парк против десятков тысяч значений в секунду.
 */

import type { Severity, TelemetryEvent } from '@ra/contracts';

/** Глубина журнала, секунды. */
export const EVENT_RETENTION_SECONDS = 24 * 3600;

export interface EventQuery {
  vehicleIds?: string[];
  from: number;
  to: number;
  /** Оставить только события этой степени. */
  severity?: 1 | 2;
  limit: number;
}

export class EventJournal {
  /** Все события в порядке открытия. */
  private events: TelemetryEvent[] = [];
  private byVehicle = new Map<string, TelemetryEvent[]>();
  private sequence = 0;

  add(event: Omit<TelemetryEvent, 'id'>): TelemetryEvent {
    this.sequence += 1;
    const stored: TelemetryEvent = { ...event, id: `${event.vehicleId}-${this.sequence}` };
    this.events.push(stored);
    const list = this.byVehicle.get(stored.vehicleId);
    if (list === undefined) {
      this.byVehicle.set(stored.vehicleId, [stored]);
    } else {
      list.push(stored);
    }
    return stored;
  }

  /** События машины в порядке открытия. */
  forVehicle(vehicleId: string): TelemetryEvent[] {
    return this.byVehicle.get(vehicleId) ?? [];
  }

  get size(): number {
    return this.events.length;
  }

  /** События, пересекающиеся с периодом. Активные события считаются идущими до конца периода. */
  query(input: EventQuery): TelemetryEvent[] {
    const vehicleFilter = input.vehicleIds === undefined ? null : new Set(input.vehicleIds);
    const result: TelemetryEvent[] = [];
    for (const event of this.events) {
      if (vehicleFilter !== null && !vehicleFilter.has(event.vehicleId)) {
        continue;
      }
      if (input.severity !== undefined && event.severity !== input.severity) {
        continue;
      }
      if (event.startedAt > input.to) {
        continue;
      }
      if (event.endedAt !== null && event.endedAt < input.from) {
        continue;
      }
      result.push(event);
    }
    // Свежие события сверху: так их читает журнал в интерфейсе.
    result.sort((a, b) => b.startedAt - a.startedAt);
    return result.slice(0, input.limit);
  }

  /** Убрать события, целиком ушедшие за глубину хранения. */
  prune(simTimeSec: number): void {
    const horizon = simTimeSec - EVENT_RETENTION_SECONDS;
    if (this.events.length === 0 || (this.events[0]?.startedAt ?? 0) >= horizon) {
      return;
    }
    const keep = (event: TelemetryEvent): boolean =>
      event.endedAt === null || event.endedAt >= horizon;
    this.events = this.events.filter(keep);
    for (const [vehicleId, list] of this.byVehicle) {
      this.byVehicle.set(vehicleId, list.filter(keep));
    }
  }

  /** Убрать машину из журнала целиком: она выведена из парка. */
  removeVehicle(vehicleId: string): void {
    this.byVehicle.delete(vehicleId);
    this.events = this.events.filter((event) => event.vehicleId !== vehicleId);
  }

  /** Худшая степень активного события машины на момент времени. */
  worstActiveSeverity(vehicleId: string, timeSec: number): Severity {
    let worst: Severity = 0;
    for (const event of this.forVehicle(vehicleId)) {
      if (event.startedAt > timeSec) {
        continue;
      }
      if (event.endedAt !== null && event.endedAt < timeSec) {
        continue;
      }
      if (event.severity > worst) {
        worst = event.severity;
      }
    }
    return worst;
  }
}
