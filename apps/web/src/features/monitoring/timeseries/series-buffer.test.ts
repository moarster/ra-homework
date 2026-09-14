import type { MetricId, PointValues, Series } from '@ra/contracts';
import { describe, expect, it } from 'vitest';
import { SeriesBuffer } from './series-buffer.js';

const METRICS: MetricId[] = ['ENGINE_COOLANT_TEMPERATURE', 'ENGINE_HOURS'];

function series(metric: MetricId, avg: (number | null)[], count: number[]): Series {
  return {
    vehicleId: 'v-12',
    metric,
    unit: 'CELSIUS',
    t0: 1000,
    avg,
    min: avg,
    max: avg,
    sev: avg.map(() => 0),
    count,
  };
}

function history(buffer: SeriesBuffer) {
  buffer.setHistory({
    to: 1040,
    step: 10,
    series: [
      series('ENGINE_COOLANT_TEMPERATURE', [80, null, 90, 92], [10, 0, 10, 3]),
      series('ENGINE_HOURS', [100, 100, 100.1, 100.1], [10, 0, 10, 3]),
    ],
  });
}

const point = (coolant: number | null, hours: number): PointValues => ({
  ENGINE_COOLANT_TEMPERATURE:
    coolant === null ? { value: null, quality: 2 } : { value: coolant, quality: 0 },
  ENGINE_HOURS: { value: hours, quality: 0 },
});

describe('буфер серий', () => {
  it('дыра истории остается дырой, а не нулем и не интерполяцией', () => {
    const buffer = new SeriesBuffer(METRICS, 60);
    history(buffer);
    expect(buffer.xs()).toEqual([1000, 1010, 1020, 1030]);
    expect(buffer.column('ENGINE_COOLANT_TEMPERATURE')?.avg).toEqual([80, null, 90, 92]);
    expect(buffer.valueAt('ENGINE_COOLANT_TEMPERATURE', 1015)).toBeNull();
  });

  it('тик до конца истории не учитывается, после - сворачивается в бакет того же шага', () => {
    const buffer = new SeriesBuffer(METRICS, 60);
    history(buffer);
    expect(buffer.appendValues(1035, point(99, 100.2))).toBe(false);
    expect(buffer.appendValues(1045, point(100, 100.2))).toBe(true);
    expect(buffer.xs()).toEqual([1000, 1010, 1020, 1030, 1040]);
    expect(buffer.appendValues(1048, point(110, 100.3))).toBe(true);
    const coolant = buffer.column('ENGINE_COOLANT_TEMPERATURE');
    expect(coolant?.avg[4]).toBe(105);
    expect(coolant?.min[4]).toBe(100);
    expect(coolant?.max[4]).toBe(110);
    // Счетчик сворачивается по правилу `last`, а не средним.
    expect(buffer.valueAt('ENGINE_HOURS', null)).toBe(100.3);
  });

  it('значение с плохим качеством не попадает в бакет', () => {
    const buffer = new SeriesBuffer(METRICS, 60);
    history(buffer);
    buffer.appendValues(1052, point(null, 100.4));
    expect(buffer.valueAt('ENGINE_COOLANT_TEMPERATURE', null)).toBeNull();
    expect(buffer.valueAt('ENGINE_HOURS', null)).toBe(100.4);
  });

  it('окно скользит: бакеты левее периода выбрасываются', () => {
    const buffer = new SeriesBuffer(METRICS, 60);
    history(buffer);
    buffer.appendValues(1085, point(95, 100.5));
    expect(buffer.window()).toEqual({ from: 1025, to: 1085 });
    expect(buffer.xs()).toEqual([1020, 1030, 1080]);
  });

  it('повторная история сохраняет живой хвост правее своего конца', () => {
    const buffer = new SeriesBuffer(METRICS, 600);
    history(buffer);
    buffer.appendValues(1055, point(101, 100.2));
    history(buffer);
    expect(buffer.xs()).toEqual([1000, 1010, 1020, 1030, 1050]);
    expect(buffer.valueAt('ENGINE_COOLANT_TEMPERATURE', null)).toBe(101);
  });

  it('поиск бакета по моменту', () => {
    const buffer = new SeriesBuffer(METRICS, 600);
    history(buffer);
    expect(buffer.indexAt(999)).toBe(-1);
    expect(buffer.indexAt(1000)).toBe(0);
    expect(buffer.indexAt(1029)).toBe(2);
    expect(buffer.indexAt(5000)).toBe(3);
    expect(buffer.indexAt(null)).toBe(3);
    expect(buffer.firstValue('ENGINE_HOURS')).toBe(100);
  });
});
