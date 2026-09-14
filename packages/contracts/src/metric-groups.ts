/** Группы показателей: раздел 6 `CONTEXT.md`, поля - раздел 3 `SPEC.md`. */

import { metricGroupIcon } from './icons.js';

export type MetricGroupId = 'ENGINE' | 'DRIVELINE' | 'FUEL' | 'LOAD' | 'POSITION' | 'DERIVED';

export interface MetricGroupDef {
  id: MetricGroupId;
  /** Название на русском. */
  name: string;
  /** Порядок сортировки в интерфейсе. */
  order: number;
  /** inline-SVG, viewBox 0 0 24 24, currentColor. */
  icon: string;
}

export const METRIC_GROUPS: Record<MetricGroupId, MetricGroupDef> = {
  ENGINE: { id: 'ENGINE', name: 'Двигатель', order: 1, icon: metricGroupIcon('ENGINE') },
  DRIVELINE: {
    id: 'DRIVELINE',
    name: 'Трансмиссия и ходовая',
    order: 2,
    icon: metricGroupIcon('DRIVELINE'),
  },
  FUEL: { id: 'FUEL', name: 'Топливо', order: 3, icon: metricGroupIcon('FUEL') },
  LOAD: { id: 'LOAD', name: 'Груз и оси', order: 4, icon: metricGroupIcon('LOAD') },
  POSITION: {
    id: 'POSITION',
    name: 'Позиционирование',
    order: 5,
    icon: metricGroupIcon('POSITION'),
  },
  DERIVED: {
    id: 'DERIVED',
    name: 'Производные показатели',
    order: 6,
    icon: metricGroupIcon('DERIVED'),
  },
};

export const METRIC_GROUP_IDS: MetricGroupId[] = (
  Object.keys(METRIC_GROUPS) as MetricGroupId[]
).sort((a, b) => METRIC_GROUPS[a].order - METRIC_GROUPS[b].order);
