/**
 * События телеметрии: свертка взведенных битов и выходов за нормативы в интервалы
 * (раздел 5.4 `SPEC.md`) плюс каталог серверных событий (раздел 8 `CONTEXT.md`).
 */

import { ALARMS, findFlag, WARNINGS } from './flags.js';
import { isMetricId, METRICS, type MetricId } from './metrics.js';
import type { Severity } from './severity.js';

export type EventSource = 'alarmBit' | 'warningBit' | 'threshold' | 'server';

export interface TelemetryEvent {
  id: string;
  vehicleId: string;
  source: EventSource;
  /** 'COOLANT_OVERHEAT' | 'THRESHOLD:ENGINE_OIL_PRESSURE' | 'NO_DATA' */
  code: string;
  metric?: MetricId;
  /** 1 предупреждение, 2 авария. */
  severity: 1 | 2;
  /** Человекочитаемое название на русском. */
  title: string;
  startedAt: number;
  /** null - событие активно. */
  endedAt: number | null;
  peakValue?: number;
  peakAt?: number;
}

export type ServerEventCode = 'NO_DATA' | 'DATA_BACKFILLED' | 'FUEL_THEFT_SUSPECTED';

export interface ServerEventDef {
  code: ServerEventCode;
  /** Название на русском. */
  name: string;
  /** Условие возникновения - для документации и подсказок. */
  condition: string;
  /** 2 авария, 1 предупреждение, 0 информация. */
  severity: Severity;
}

/** События, которые порождает бэкенд: с борта они не приходят. */
export const SERVER_EVENTS: Record<ServerEventCode, ServerEventDef> = {
  NO_DATA: {
    code: 'NO_DATA',
    name: 'Нет данных с машины',
    condition: 'нет данных дольше 40 минут',
    severity: 2,
  },
  DATA_BACKFILLED: {
    code: 'DATA_BACKFILLED',
    name: 'Дозалит накопленный буфер',
    condition: 'пришел накопленный буфер после провала связи',
    severity: 0,
  },
  FUEL_THEFT_SUSPECTED: {
    code: 'FUEL_THEFT_SUSPECTED',
    name: 'Подозрение на слив топлива',
    condition: 'падение уровня топлива более 5% при заглушенном двигателе',
    severity: 1,
  },
};

export const SERVER_EVENT_CODES: ServerEventCode[] = Object.keys(
  SERVER_EVENTS,
) as ServerEventCode[];

/** Префикс кода события, порожденного выходом показателя за норматив. */
export const THRESHOLD_EVENT_PREFIX = 'THRESHOLD:';

export function thresholdEventCode(metric: MetricId): string {
  return `${THRESHOLD_EVENT_PREFIX}${metric}`;
}

/** Показатель, к которому относится событие норматива, если код такого вида. */
export function metricFromEventCode(code: string): string | null {
  return code.startsWith(THRESHOLD_EVENT_PREFIX) ? code.slice(THRESHOLD_EVENT_PREFIX.length) : null;
}

/** Название события на русском по источнику и коду. */
export function eventTitle(source: EventSource, code: string): string {
  switch (source) {
    case 'alarmBit':
      return findFlag(code, ALARMS)?.name ?? code;
    case 'warningBit':
      return findFlag(code, WARNINGS)?.name ?? code;
    case 'threshold': {
      const metric = metricFromEventCode(code);
      if (metric !== null && Object.hasOwn(METRICS, metric)) {
        return `Выход за норматив: ${METRICS[metric as MetricId].name}`;
      }
      return `Выход за норматив: ${code}`;
    }
    case 'server':
      return Object.hasOwn(SERVER_EVENTS, code)
        ? SERVER_EVENTS[code as ServerEventCode].name
        : code;
  }
}

/**
 * Показатель, на графике которого видно событие бита или серверное событие. Нужен переходу
 * из сводки событий к нужному графику полотна. У части битов своего показателя нет
 * (пожарная сигнализация, давление рулевого) - для них перехода к графику нет.
 */
export const EVENT_METRICS: Record<string, MetricId> = {
  // Аварии
  OIL_PRESSURE_CRITICAL: 'ENGINE_OIL_PRESSURE',
  COOLANT_OVERHEAT: 'ENGINE_COOLANT_TEMPERATURE',
  TRANSMISSION_OVERHEAT: 'TRANSMISSION_OIL_TEMPERATURE',
  BRAKE_OVERHEAT: 'BRAKE_TEMPERATURE_MAX',
  OVERLOAD: 'CARGO_MASS',
  BODY_UP_WHILE_MOVING: 'BODY_ANGLE',
  ENGINE_EMERGENCY_STOP: 'ENGINE_RPM',
  FUEL_CRITICAL: 'FUEL_LEVEL',
  // Предупреждения
  COOLANT_TEMP_HIGH: 'ENGINE_COOLANT_TEMPERATURE',
  TRANSMISSION_TEMP_HIGH: 'TRANSMISSION_OIL_TEMPERATURE',
  OIL_PRESSURE_LOW: 'ENGINE_OIL_PRESSURE',
  FUEL_LOW: 'FUEL_LEVEL',
  OVERSPEED: 'POSITION_SPEED',
  PAYLOAD_OUT_OF_RANGE: 'PAYLOAD_RATIO',
  EXCESSIVE_IDLING: 'ENGINE_RPM',
  SERVICE_DUE: 'HOURS_TO_SERVICE',
  // Серверные
  NO_DATA: 'TIME_SINCE_LAST_DATA',
  FUEL_THEFT_SUSPECTED: 'FUEL_LEVEL',
};

/** Показатель события: явный из события, из кода норматива или из каталога битов. */
export function eventMetric(code: string, metric?: MetricId): MetricId | null {
  if (metric !== undefined) {
    return metric;
  }
  const fromThreshold = metricFromEventCode(code);
  if (fromThreshold !== null) {
    return isMetricId(fromThreshold) ? fromThreshold : null;
  }
  return Object.hasOwn(EVENT_METRICS, code) ? (EVENT_METRICS[code] ?? null) : null;
}
