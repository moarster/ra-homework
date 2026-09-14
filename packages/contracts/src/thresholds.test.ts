import { describe, expect, it } from 'vitest';
import type { ThresholdVehicle } from './thresholds.js';
import { metricSeverity, resolveThreshold, zoneSeverity } from './thresholds.js';

const belaz75131: ThresholdVehicle = { modelId: 'BELAZ_75131' };
const belaz7555b: ThresholdVehicle = { modelId: 'BELAZ_7555B' };

describe('разрешение нормативов', () => {
  it('границы зон: from включается, to не включается', () => {
    const ctx = { rpm: 1500 };
    expect(metricSeverity('ENGINE_COOLANT_TEMPERATURE', 94.9, belaz75131, ctx)).toBe(0);
    expect(metricSeverity('ENGINE_COOLANT_TEMPERATURE', 95, belaz75131, ctx)).toBe(1);
    expect(metricSeverity('ENGINE_COOLANT_TEMPERATURE', 104.9, belaz75131, ctx)).toBe(1);
    expect(metricSeverity('ENGINE_COOLANT_TEMPERATURE', 105, belaz75131, ctx)).toBe(2);
  });

  it('значение вне всех зон считается нормой', () => {
    expect(metricSeverity('ENGINE_COOLANT_TEMPERATURE', 40, belaz75131, { rpm: 1500 })).toBe(0);
    expect(zoneSeverity([{ from: 10, to: 20, severity: 2 }], 5)).toBe(0);
  });

  it('давление масла: рабочие зоны при оборотах выше 1000', () => {
    const ctx = { rpm: 1500 };
    expect(metricSeverity('ENGINE_OIL_PRESSURE', 3.5, belaz75131, ctx)).toBe(0);
    expect(metricSeverity('ENGINE_OIL_PRESSURE', 2.5, belaz75131, ctx)).toBe(1);
    expect(metricSeverity('ENGINE_OIL_PRESSURE', 1.9, belaz75131, ctx)).toBe(2);
  });

  it('давление масла: пониженные зоны на холостом ходу', () => {
    const ctx = { rpm: 700 };
    expect(metricSeverity('ENGINE_OIL_PRESSURE', 1.5, belaz75131, ctx)).toBe(0);
    expect(metricSeverity('ENGINE_OIL_PRESSURE', 1.0, belaz75131, ctx)).toBe(1);
    expect(metricSeverity('ENGINE_OIL_PRESSURE', 0.7, belaz75131, ctx)).toBe(2);
  });

  it('давление масла: при заглушенном двигателе показатель исключен из светофора', () => {
    const resolved = resolveThreshold('ENGINE_OIL_PRESSURE', belaz75131, { rpm: 0 });
    expect(resolved?.excludeFromSeverity).toBe(true);
    expect(metricSeverity('ENGINE_OIL_PRESSURE', 0, belaz75131, { rpm: 0 })).toBe(0);
  });

  it('тормоза: на длительной стоянке пороги ниже', () => {
    expect(metricSeverity('BRAKE_TEMPERATURE_FRONT_LEFT', 150, belaz75131, {})).toBe(0);
    expect(
      metricSeverity('BRAKE_TEMPERATURE_FRONT_LEFT', 150, belaz75131, { stoppedSeconds: 601 }),
    ).toBe(1);
    expect(
      metricSeverity('BRAKE_TEMPERATURE_FRONT_LEFT', 250, belaz75131, { stoppedSeconds: 601 }),
    ).toBe(2);
    // Ровно 10 минут - это еще не "дольше 10 минут".
    expect(
      metricSeverity('BRAKE_TEMPERATURE_FRONT_LEFT', 150, belaz75131, { stoppedSeconds: 600 }),
    ).toBe(0);
  });

  it('угол кузова: авария только при движении', () => {
    expect(metricSeverity('BODY_ANGLE', 45, belaz75131, { speedKmh: 0 })).toBe(0);
    expect(metricSeverity('BODY_ANGLE', 6, belaz75131, { speedKmh: 3 })).toBe(0);
    expect(metricSeverity('BODY_ANGLE', 6, belaz75131, { speedKmh: 3.5 })).toBe(2);
    expect(metricSeverity('BODY_ANGLE', 4, belaz75131, { speedKmh: 10 })).toBe(0);
  });

  it('относительные нормативы считаются от паспортных величин модели', () => {
    // 130 т против 55 т: одна и та же масса груза попадает в разные зоны.
    expect(metricSeverity('CARGO_MASS', 130_000, belaz75131, {})).toBe(0);
    expect(metricSeverity('CARGO_MASS', 130_000, belaz7555b, {})).toBe(2);
    expect(metricSeverity('CARGO_MASS', 55_000, belaz7555b, {})).toBe(0);
    expect(metricSeverity('CARGO_MASS', 45_000, belaz7555b, {})).toBe(2);

    const resolved = resolveThreshold('CARGO_MASS', belaz7555b, {});
    // 95% от 55 т = 52,25 т - нижняя граница зеленой зоны.
    expect(resolved?.zones[2]?.from).toBeCloseTo(52_250, 6);
  });

  it('передняя ось нормируется от полной массы модели', () => {
    // 30% от 236 т = 70,8 т.
    expect(metricSeverity('FRONT_AXLE_LOAD', 75_000, belaz75131, {})).toBe(0);
    expect(metricSeverity('FRONT_AXLE_LOAD', 68_000, belaz75131, {})).toBe(1);
    expect(metricSeverity('FRONT_AXLE_LOAD', 60_000, belaz75131, {})).toBe(2);
  });

  it('показатель без нормативов не имеет правила', () => {
    expect(resolveThreshold('POSITION_HEADING', belaz75131, {})).toBeNull();
    expect(metricSeverity('POSITION_HEADING', 180, belaz75131, {})).toBe(0);
  });

  it('отсутствующее значение дает степень "нет данных"', () => {
    expect(metricSeverity('ENGINE_RPM', null, belaz75131, {})).toBe(3);
  });
});
