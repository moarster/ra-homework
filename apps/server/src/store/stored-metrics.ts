/**
 * Состав показателей хранилища: 23 физических (приходят от источника) плюс 7 производных
 * (считает сервер). Производные хранятся наравне с физическими, потому что три из них
 * участвуют в светофоре и запрашиваются сериями (раздел 6 `SPEC.md`).
 *
 * Порядок: сначала `METRIC_ORDER` (индексы совпадают с компактным снапшотом), затем производные.
 */

import { DERIVED_METRIC_IDS, METRIC_ORDER, type MetricId } from '@ra/contracts';

export const STORED_METRICS: MetricId[] = [...METRIC_ORDER, ...DERIVED_METRIC_IDS];

export const STORED_METRIC_COUNT = STORED_METRICS.length;

export const STORED_METRIC_INDEX: Record<string, number> = STORED_METRICS.reduce<
  Record<string, number>
>((acc, id, index) => {
  acc[id] = index;
  return acc;
}, {});

/** Индекс показателя в буферах хранилища или -1, если показатель не хранится. */
export function storedMetricIndex(metric: MetricId): number {
  return STORED_METRIC_INDEX[metric] ?? -1;
}
