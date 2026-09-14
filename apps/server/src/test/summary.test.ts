/** Расчет сводки на подготовленном наборе данных. */

import { QUALITY, VEHICLE_MODELS } from '@ra/contracts';
import { describe, expect, it } from 'vitest';
import { EventJournal } from '../events/journal.js';
import { storedMetricIndex } from '../store/stored-metrics.js';
import { buildSummary } from '../summary/summary.js';
import { createStore, TEST_VEHICLE } from './helpers.js';

const T0 = 1_700_000_000;
const CYCLE = 900;
const CYCLES = 2;
const SPAN = CYCLE * CYCLES;
const RATED = VEHICLE_MODELS[TEST_VEHICLE.modelId].ratedPayloadKg;

/**
 * Два полных рейса подряд. Каждый рейс: 300 с движения груженым по 20 км/ч,
 * 60 с разгрузки с поднятой платформой, 300 с движения порожним по 25 км/ч,
 * 240 с холостого хода. Двигатель работает все время.
 */
function seed() {
  const store = createStore();
  const write = (t: number, metric: string, value: number): void => {
    store.writeSample(0, storedMetricIndex(metric as never), value, QUALITY.GOOD, 0);
    void t;
  };
  for (let t = T0; t < T0 + SPAN; t += 1) {
    const phase = (t - T0) % CYCLE;
    const loaded = phase < 360;
    const speed = phase < 300 ? 20 : phase < 360 ? 0 : phase < 660 ? 25 : 0;
    const angle = phase >= 300 && phase < 360 ? 45 : 0;
    store.openTime(0, t);
    write(t, 'ENGINE_RPM', 1200);
    write(t, 'POSITION_SPEED', speed);
    write(t, 'BODY_ANGLE', angle);
    write(t, 'CARGO_MASS', loaded ? RATED : 0);
    write(t, 'PAYLOAD_RATIO', loaded ? 100 : 0);
    write(t, 'ENGINE_HOURS', 100 + (t - T0) / 3600);
    write(t, 'FUEL_TOTAL_CONSUMPTION', 1000 + ((t - T0) / SPAN) * 100);
  }
  return store;
}

describe('сводка по машине', () => {
  const store = seed();
  const summary = buildSummary(store, new EventJournal(), TEST_VEHICLE.id, T0, T0 + SPAN);

  it('считает рейсы по переходу угла кузова через порог разгрузки при наличии груза', () => {
    expect(summary.trips).toBe(CYCLES);
  });

  it('считает тоннаж и среднюю загрузку', () => {
    expect(summary.tonnes).toBeCloseTo((RATED * CYCLES) / 1000, 1);
    expect(summary.avgPayloadPercent).toBeCloseTo(100, 1);
  });

  it('считает моточасы и топливо за период по приросту счетчиков', () => {
    // Счетчик наработки идет с шагом одна секунда: прирост за период - полчаса.
    expect(summary.engineHours).toBeCloseTo(SPAN / 3600, 2);
    expect(summary.fuelLiters).toBeCloseTo(100, 0);
    expect(summary.fuelPerHour).toBeCloseTo(200, 0);
    expect(summary.fuelPerTonne).toBeCloseTo(100 / ((RATED * CYCLES) / 1000), 2);
  });

  it('считает пробег, среднюю и максимальную скорость по движению', () => {
    const metersPerCycle = (300 * 20 * 1000) / 3600 + (300 * 25 * 1000) / 3600;
    expect(summary.distanceKm).toBeCloseTo((metersPerCycle * CYCLES) / 1000, 1);
    expect(summary.maxSpeedKmh).toBe(25);
    expect(summary.avgSpeedKmh).toBeCloseTo(22.5, 1);
  });

  it('считает долю холостого хода от времени работы двигателя', () => {
    // Стоянка с работающим двигателем: 60 с разгрузки и 240 с простоя на рейс.
    expect(summary.idlePercent).toBeCloseTo((300 * CYCLES * 100) / SPAN, 1);
  });

  it('без событий КТГ равен ста процентам, разрывов связи нет', () => {
    expect(summary.availabilityPercent).toBe(100);
    expect(summary.noDataMinutes).toBe(0);
    expect(summary.noDataGaps).toBe(0);
    expect(summary.hasData).toBe(true);
  });

  it('КТГ уменьшается на время активных аварий, интервалы не считаются дважды', () => {
    const journal = new EventJournal();
    journal.add({
      vehicleId: TEST_VEHICLE.id,
      source: 'alarmBit',
      code: 'COOLANT_OVERHEAT',
      severity: 2,
      title: 'Перегрев',
      startedAt: T0,
      endedAt: T0 + 900,
    });
    journal.add({
      vehicleId: TEST_VEHICLE.id,
      source: 'alarmBit',
      code: 'BRAKE_OVERHEAT',
      severity: 2,
      title: 'Перегрев тормозов',
      startedAt: T0 + 300,
      endedAt: T0 + 600,
    });
    journal.add({
      vehicleId: TEST_VEHICLE.id,
      source: 'warningBit',
      code: 'FUEL_LOW',
      severity: 1,
      title: 'Низкий уровень топлива',
      startedAt: T0,
      endedAt: T0 + 1800,
    });
    const withEvents = buildSummary(store, journal, TEST_VEHICLE.id, T0, T0 + SPAN);
    // Аварии перекрываются: вычитается 900 секунд из 1800, предупреждение КТГ не трогает.
    expect(withEvents.availabilityPercent).toBeCloseTo(50, 2);
    expect(withEvents.eventStats.length).toBe(3);
    expect(withEvents.eventStats[0]?.severity).toBe(2);
  });

  it('период без данных отдает hasData = false', () => {
    const empty = buildSummary(store, new EventJournal(), TEST_VEHICLE.id, T0 - 7200, T0 - 3600);
    expect(empty.hasData).toBe(false);
    expect(empty.trips).toBe(0);
  });
});
