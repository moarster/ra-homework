/** Выбор уровня хранилища, досворачивание до maxPoints, дыры и дозаливка. */

import { describe, expect, it } from 'vitest';
import { pickTier, querySeries } from '../store/query.js';
import { TIERS } from '../store/ring-buffer.js';
import { createStore, fillRange } from './helpers.js';

/** Виртуальное время начала тестового набора: круглое, чтобы бакеты были выровнены. */
const T0 = 1_700_000_000;

describe('выбор уровня хранилища', () => {
  it('период до 30 минут внутри окна сырых данных обслуживается уровнем raw', () => {
    const store = createStore();
    fillRange(store, T0, T0 + 1800, 'ENGINE_RPM', () => 1200);
    expect(pickTier(store, T0 + 600, T0 + 1200)).toBe('raw');
  });

  it('период до 6 часов обслуживается уровнем s10', () => {
    const store = createStore();
    fillRange(store, T0, T0 + 1800, 'ENGINE_RPM', () => 1200);
    expect(pickTier(store, T0 - 3 * 3600, T0 + 1800)).toBe('s10');
  });

  it('период больше 6 часов обслуживается минутным уровнем', () => {
    const store = createStore();
    fillRange(store, T0, T0 + 60, 'ENGINE_RPM', () => 1200);
    expect(pickTier(store, T0 - 12 * 3600, T0 + 60)).toBe('m1');
  });

  it('короткий период за пределами окна сырых данных уходит на более грубый уровень', () => {
    const store = createStore();
    // Окно сырых данных - 30 минут: час назад сырых данных уже нет.
    fillRange(store, T0, T0 + 1800, 'ENGINE_RPM', () => 1200);
    expect(pickTier(store, T0 - 3600, T0 - 3000)).toBe('s10');
  });
});

describe('досворачивание серий до maxPoints', () => {
  it('сохраняет экстремумы и максимальную степень отклонения', () => {
    const store = createStore();
    const spikeAt = T0 + 1234;
    fillRange(
      store,
      T0,
      T0 + 1800,
      'ENGINE_COOLANT_TEMPERATURE',
      (t) => (t === spikeAt ? 130 : 85),
      (t) => (t === spikeAt ? 2 : 0),
    );
    const response = querySeries(store, {
      vehicleIds: ['v-12'],
      metrics: ['ENGINE_COOLANT_TEMPERATURE'],
      from: T0,
      to: T0 + 1800,
      maxPoints: 10,
    });
    const series = response.series[0];
    expect(series).toBeDefined();
    expect(response.tier).toBe('raw');
    // 1800 сырых бакетов в 10 точек - шаг ответа 180 секунд.
    expect(response.step).toBe(180);
    expect(series?.avg.length).toBe(10);
    // Пик не исчез ни в максимуме, ни в степени отклонения.
    expect(Math.max(...(series?.max.map((v) => v ?? 0) ?? []))).toBe(130);
    expect(series?.sev).toContain(2);
    // Среднее при этом почти не сдвинулось: один выброс из 180 точек.
    const spikeBucket = Math.floor((spikeAt - T0) / 180);
    expect(series?.avg[spikeBucket] ?? 0).toBeGreaterThan(85);
    expect(series?.avg[spikeBucket] ?? 0).toBeLessThan(86);
  });

  it('за 12 часов при maxPoints = 1000 аварийные пики не исчезают', () => {
    const store = createStore();
    const span = 12 * 3600;
    const alarmFrom = T0 + 5 * 3600;
    const alarmTo = alarmFrom + 120;
    fillRange(
      store,
      T0,
      T0 + span,
      'ENGINE_COOLANT_TEMPERATURE',
      (t) => (t >= alarmFrom && t < alarmTo ? 112 : 88),
      (t) => (t >= alarmFrom && t < alarmTo ? 2 : 0),
    );
    const response = querySeries(store, {
      vehicleIds: ['v-12'],
      metrics: ['ENGINE_COOLANT_TEMPERATURE'],
      from: T0,
      to: T0 + span,
      maxPoints: 1000,
    });
    const series = response.series[0];
    expect(response.tier).toBe('m1');
    expect(series?.avg.length).toBeLessThanOrEqual(1000);
    // Две минуты аварии из двенадцати часов: в среднем их не видно, в sev и max - видно.
    const alarmPoints = series?.sev.filter((severity) => severity === 2).length ?? 0;
    expect(alarmPoints).toBeGreaterThan(0);
    expect(Math.max(...(series?.max.map((value) => value ?? 0) ?? []))).toBe(112);
    const alarmIndex = series?.sev.indexOf(2) ?? -1;
    expect(series?.avg[alarmIndex] ?? 0).toBeLessThan(112);
  });

  it('шаг ответа не меньше шага уровня', () => {
    const store = createStore();
    fillRange(store, T0, T0 + 1800, 'ENGINE_RPM', () => 1200);
    const response = querySeries(store, {
      vehicleIds: ['v-12'],
      metrics: ['ENGINE_RPM'],
      from: T0,
      to: T0 + 1800,
      maxPoints: 5000,
    });
    expect(response.step).toBe(TIERS.raw.stepSeconds);
    expect(response.series[0]?.avg.length).toBe(1800);
  });
});

describe('дыры и дозаливка', () => {
  it('дыра приходит как null и count = 0, интерполяции нет', () => {
    const store = createStore();
    fillRange(store, T0, T0 + 600, 'ENGINE_RPM', (t) =>
      t >= T0 + 200 && t < T0 + 400 ? null : 1200,
    );
    const response = querySeries(store, {
      vehicleIds: ['v-12'],
      metrics: ['ENGINE_RPM'],
      from: T0,
      to: T0 + 600,
      maxPoints: 600,
    });
    const series = response.series[0];
    expect(series?.avg[100]).toBe(1200);
    expect(series?.count[100]).toBe(1);
    expect(series?.avg[300]).toBeNull();
    expect(series?.count[300]).toBe(0);
    expect(series?.sev[300]).toBe(3);
  });

  it('дозаливка заполняет дыру и пересчитывает агрегаты уже закрытых бакетов', () => {
    const store = createStore();
    fillRange(store, T0, T0 + 600, 'ENGINE_RPM', (t) =>
      t >= T0 + 200 && t < T0 + 400 ? null : 1200,
    );
    const before = querySeries(store, {
      vehicleIds: ['v-12'],
      metrics: ['ENGINE_RPM'],
      from: T0 + 200,
      to: T0 + 400,
      maxPoints: 1,
    });
    expect(before.series[0]?.count[0]).toBe(0);

    // Запись задним числом: бакеты 10-секундного и минутного уровней уже закрыты.
    fillRange(store, T0 + 200, T0 + 400, 'ENGINE_RPM', () => 1500);
    const after = querySeries(store, {
      vehicleIds: ['v-12'],
      metrics: ['ENGINE_RPM'],
      from: T0 + 200,
      to: T0 + 400,
      maxPoints: 1,
    });
    expect(after.series[0]?.count[0]).toBe(200);
    expect(after.series[0]?.avg[0]).toBeCloseTo(1500, 5);
  });
});
