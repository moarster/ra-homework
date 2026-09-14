/**
 * Сводка по машине за период (раздел 9.3 `CONTEXT.md`).
 *
 * Считается из хранилища и журнала событий по колоночным сериям: уровень выбирается тем же
 * правилом, что и для обычного запроса серий, поэтому за сутки сводка считается по минутным
 * агрегатам, а за пятнадцать минут - по сырым данным.
 */

import {
  DERIVED_RULES,
  type MetricId,
  type Series,
  type TelemetryEvent,
  type VehicleSummaryResponse,
} from '@ra/contracts';
import type { EventJournal } from '../events/journal.js';
import { querySeries } from '../store/query.js';
import type { TelemetryStore } from '../store/tiered-store.js';

/** Показатели, нужные сводке. */
export const SUMMARY_METRICS: MetricId[] = [
  'POSITION_SPEED',
  'ENGINE_RPM',
  'ENGINE_HOURS',
  'FUEL_TOTAL_CONSUMPTION',
  'CARGO_MASS',
  'BODY_ANGLE',
  'PAYLOAD_RATIO',
];

/** Обороты, выше которых двигатель считается работающим. */
const ENGINE_ON_RPM = 200;

interface SeriesMap {
  step: number;
  byMetric: Map<MetricId, Series>;
}

function loadSeries(store: TelemetryStore, vehicleId: string, from: number, to: number): SeriesMap {
  // maxPoints берется с запасом: сводке нужна полная разрешающая способность уровня.
  const response = querySeries(store, {
    vehicleIds: [vehicleId],
    metrics: SUMMARY_METRICS,
    from,
    to,
    maxPoints: 5000,
  });
  const byMetric = new Map<MetricId, Series>();
  for (const series of response.series) {
    byMetric.set(series.metric, series);
  }
  return { step: response.step, byMetric };
}

function first(series: Series | undefined): number | null {
  if (series === undefined) {
    return null;
  }
  for (let i = 0; i < series.avg.length; i += 1) {
    if ((series.count[i] ?? 0) > 0) {
      return series.avg[i] ?? null;
    }
  }
  return null;
}

function last(series: Series | undefined): number | null {
  if (series === undefined) {
    return null;
  }
  for (let i = series.avg.length - 1; i >= 0; i -= 1) {
    if ((series.count[i] ?? 0) > 0) {
      return series.avg[i] ?? null;
    }
  }
  return null;
}

/**
 * Рейсы и вывезенный тоннаж.
 *
 * Алгоритм: рейс считается выполненным в момент начала разгрузки - когда угол платформы
 * переходит через порог подъема (3 градуса, `DERIVED_RULES.bodyRaisedAngleDeg`) при наличии
 * груза (не меньше 20% номинала). Именно переход, а не сам факт поднятой платформы: иначе
 * одна разгрузка длиной в полторы минуты дала бы десятки рейсов. Тоннаж рейса берется как
 * масса груза в момент перехода - после подъема платформы груз уже уходит в приемный бункер.
 *
 * Ограничение: на минутных агрегатах порог проверяется по максимуму угла в бакете, поэтому
 * две разгрузки внутри одной минуты сольются в один рейс. За сутки это погрешность около
 * процента, за смену - меньше.
 */
function countTrips(series: SeriesMap): { trips: number; tonnes: number; payloadSum: number } {
  const angle = series.byMetric.get('BODY_ANGLE');
  const cargo = series.byMetric.get('CARGO_MASS');
  const ratio = series.byMetric.get('PAYLOAD_RATIO');
  if (angle === undefined) {
    return { trips: 0, tonnes: 0, payloadSum: 0 };
  }
  let trips = 0;
  let tonnes = 0;
  let payloadSum = 0;
  let raised = false;
  for (let i = 0; i < angle.max.length; i += 1) {
    if ((angle.count[i] ?? 0) === 0) {
      continue;
    }
    const value = angle.max[i] ?? 0;
    const isRaised = value > DERIVED_RULES.bodyRaisedAngleDeg;
    if (isRaised && !raised) {
      const payloadPercent = ratio?.max[i] ?? null;
      const mass = cargo?.max[i] ?? null;
      if (payloadPercent !== null && payloadPercent >= DERIVED_RULES.loadedPayloadRatioPercent) {
        trips += 1;
        tonnes += (mass ?? 0) / 1000;
        payloadSum += payloadPercent;
      }
    }
    raised = isRaised;
  }
  return { trips, tonnes, payloadSum };
}

/** Статистика событий периода по типам: число срабатываний и суммарная длительность. */
function eventStats(
  events: TelemetryEvent[],
  from: number,
  to: number,
): VehicleSummaryResponse['eventStats'] {
  const byCode = new Map<string, VehicleSummaryResponse['eventStats'][number]>();
  for (const event of events) {
    const overlapFrom = Math.max(event.startedAt, from);
    const overlapTo = Math.min(event.endedAt ?? to, to);
    const seconds = Math.max(0, overlapTo - overlapFrom);
    const existing = byCode.get(event.code);
    if (existing === undefined) {
      byCode.set(event.code, {
        code: event.code,
        title: event.title,
        severity: event.severity,
        count: 1,
        totalSeconds: seconds,
        firstAt: event.startedAt,
        ...(event.metric === undefined ? {} : { metric: event.metric }),
      });
      continue;
    }
    existing.count += 1;
    existing.totalSeconds += seconds;
    existing.firstAt = Math.min(existing.firstAt, event.startedAt);
  }
  return Array.from(byCode.values()).sort((a, b) => b.severity - a.severity || b.count - a.count);
}

/** КТГ за период: доля времени без активных аварий. */
function availability(events: TelemetryEvent[], from: number, to: number): number | null {
  const span = to - from;
  if (span <= 0) {
    return null;
  }
  // Интервалы аварий объединяются: две одновременные аварии не отнимают время дважды.
  const intervals = events
    .filter((event) => event.severity === 2)
    .map((event): [number, number] => [
      Math.max(event.startedAt, from),
      Math.min(event.endedAt ?? to, to),
    ])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let cursor = from;
  for (const [start, end] of intervals) {
    if (end <= cursor) {
      continue;
    }
    covered += end - Math.max(start, cursor);
    cursor = Math.max(cursor, end);
  }
  return Math.max(0, Math.min(100, ((span - covered) / span) * 100));
}

export function buildSummary(
  store: TelemetryStore,
  journal: EventJournal,
  vehicleId: string,
  from: number,
  to: number,
): VehicleSummaryResponse {
  const entry = store.require(vehicleId);
  const series = loadSeries(store, vehicleId, from, to);
  const speed = series.byMetric.get('POSITION_SPEED');
  const rpm = series.byMetric.get('ENGINE_RPM');
  const step = series.step;

  let goodSeconds = 0;
  let missingSeconds = 0;
  let gaps = 0;
  let inGap = false;
  let engineOnSeconds = 0;
  let idleSeconds = 0;
  let movingSeconds = 0;
  let distanceMeters = 0;
  let maxSpeed: number | null = null;
  let lastGoodAt: number | null = null;

  const length = speed?.avg.length ?? 0;
  for (let i = 0; i < length; i += 1) {
    const count = speed?.count[i] ?? 0;
    const bucketStart = (speed?.t0 ?? from) + i * step;
    // Показатель скорости опрашивается раз в секунду, поэтому число годных точек в бакете -
    // это и есть число секунд со связью.
    if (count === 0) {
      missingSeconds += step;
      if (!inGap) {
        gaps += 1;
        inGap = true;
      }
      continue;
    }
    inGap = false;
    goodSeconds += count;
    missingSeconds += Math.max(0, step - count);
    lastGoodAt = Math.min(to, bucketStart + step - 1);
    const avgSpeed = speed?.avg[i] ?? 0;
    const bucketMax = speed?.max[i] ?? null;
    if (bucketMax !== null && (maxSpeed === null || bucketMax > maxSpeed)) {
      maxSpeed = bucketMax;
    }
    distanceMeters += ((avgSpeed * 1000) / 3600) * count;
    const engineOn = (rpm?.avg[i] ?? 0) > ENGINE_ON_RPM;
    if (engineOn) {
      engineOnSeconds += count;
      if (avgSpeed < DERIVED_RULES.movingSpeedKmh) {
        idleSeconds += count;
      }
    }
    if (avgSpeed >= DERIVED_RULES.movingSpeedKmh) {
      movingSeconds += count;
    }
  }

  const { trips, tonnes, payloadSum } = countTrips(series);
  const hoursFirst = first(series.byMetric.get('ENGINE_HOURS'));
  const hoursLast = last(series.byMetric.get('ENGINE_HOURS'));
  const fuelFirst = first(series.byMetric.get('FUEL_TOTAL_CONSUMPTION'));
  const fuelLast = last(series.byMetric.get('FUEL_TOTAL_CONSUMPTION'));
  const engineHours =
    hoursFirst === null || hoursLast === null ? 0 : Math.max(0, hoursLast - hoursFirst);
  const fuelLiters =
    fuelFirst === null || fuelLast === null ? 0 : Math.max(0, fuelLast - fuelFirst);
  const events = journal.query({ vehicleIds: [vehicleId], from, to, limit: 5000 });
  const distanceKm = distanceMeters / 1000;

  return {
    vehicleId,
    from,
    to,
    hasData: goodSeconds > 0,
    lastGoodAt: goodSeconds > 0 ? (lastGoodAt ?? entry.latest.lastGoodAt) : entry.latest.lastGoodAt,
    trips,
    tonnes: round(tonnes, 1),
    avgPayloadPercent: trips === 0 ? null : round(payloadSum / trips, 1),
    engineHours: round(engineHours, 2),
    idlePercent: engineOnSeconds === 0 ? null : round((idleSeconds / engineOnSeconds) * 100, 1),
    fuelLiters: round(fuelLiters, 1),
    fuelPerHour: engineHours <= 0 ? null : round(fuelLiters / engineHours, 1),
    fuelPerTonne: tonnes <= 0 ? null : round(fuelLiters / tonnes, 2),
    distanceKm: round(distanceKm, 2),
    avgSpeedKmh: movingSeconds === 0 ? null : round((distanceMeters / movingSeconds) * 3.6, 1),
    maxSpeedKmh: maxSpeed === null ? null : round(maxSpeed, 1),
    noDataMinutes: round(missingSeconds / 60, 1),
    noDataGaps: gaps,
    availabilityPercent: round(availability(events, from, to) ?? 0, 2),
    eventStats: eventStats(events, from, to),
  };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
