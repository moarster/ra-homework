/** Общие помощники тестов: синтетические данные прямо в хранилище. */

import { NAMED_VEHICLES, QUALITY, type Quality, type Severity } from '@ra/contracts';
import { storedMetricIndex } from '../store/stored-metrics.js';
import { TelemetryStore } from '../store/tiered-store.js';

export const TEST_VEHICLE = NAMED_VEHICLES[0] as (typeof NAMED_VEHICLES)[number];

/** Хранилище с одной машиной. */
export function createStore(): TelemetryStore {
  const store = new TelemetryStore();
  store.setVehicles([TEST_VEHICLE]);
  return store;
}

export interface WriteOptions {
  quality?: Quality;
  severity?: Severity;
}

/** Записать значение одного показателя на секунду. */
export function writeAt(
  store: TelemetryStore,
  timeSec: number,
  metric: string,
  value: number,
  options: WriteOptions = {},
): void {
  store.openTime(0, timeSec);
  store.writeSample(
    0,
    storedMetricIndex(metric as never),
    value,
    options.quality ?? QUALITY.GOOD,
    options.severity ?? 0,
  );
}

/** Заполнить период значением от функции: удобно для проверки сверток. */
export function fillRange(
  store: TelemetryStore,
  from: number,
  to: number,
  metric: string,
  value: (t: number) => number | null,
  severity: (t: number) => Severity = () => 0,
): void {
  for (let t = from; t < to; t += 1) {
    const v = value(t);
    store.openTime(0, t);
    if (v === null) {
      continue;
    }
    store.writeSample(0, storedMetricIndex(metric as never), v, QUALITY.GOOD, severity(t));
  }
}
