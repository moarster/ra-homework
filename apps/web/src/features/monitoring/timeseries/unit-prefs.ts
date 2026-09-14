/**
 * Выбранная единица отображения по показателям. Живет вне компонентов: график полотна
 * размонтируется при прокрутке (виртуализация), и выбор единицы не должен теряться вместе
 * с ним. Между машинами выбор тоже сохраняется - предпочтение пользователя, а не машины.
 */

import { getMetric, type MetricId, UNITS, type UnitId, unitsOfGroup } from '@ra/contracts';
import { useCallback, useSyncExternalStore } from 'react';

const selected = new Map<MetricId, UnitId>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function displayUnitOf(metricId: MetricId): UnitId {
  return selected.get(metricId) ?? getMetric(metricId).displayUnitId;
}

export function setDisplayUnit(metricId: MetricId, unitId: UnitId): void {
  selected.set(metricId, unitId);
  for (const listener of listeners) {
    listener();
  }
}

/** Альтернативные единицы показателя: вся группа единиц, если в ней больше одной. */
export function unitOptions(metricId: MetricId): UnitId[] {
  const group = UNITS[getMetric(metricId).unitId].groupId;
  const units = unitsOfGroup(group);
  return units.length > 1 ? units.map((unit) => unit.id) : [];
}

export function useDisplayUnit(metricId: MetricId): UnitId {
  const getSnapshot = useCallback(() => displayUnitOf(metricId), [metricId]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
