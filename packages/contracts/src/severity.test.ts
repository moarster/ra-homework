import { describe, expect, it } from 'vitest';
import type { FlagsTriple } from './flags.js';
import { ALARMS, codesToFlags, WARNINGS } from './flags.js';
import { type PointValues, pointSeverity, QUALITY } from './severity.js';

const vehicle = { modelId: 'BELAZ_75131' } as const;
const noFlags: FlagsTriple = [0, 0, 0];

function good(value: number) {
  return { value, quality: QUALITY.GOOD };
}

const healthy: PointValues = {
  ENGINE_RPM: good(1400),
  ENGINE_COOLANT_TEMPERATURE: good(88),
  ENGINE_OIL_PRESSURE: good(4.2),
  ENGINE_OIL_TEMPERATURE: good(95),
  TRANSMISSION_OIL_TEMPERATURE: good(90),
  TRANSMISSION_SYSTEM_PRESSURE: good(15),
  BRAKE_TEMPERATURE_FRONT_LEFT: good(120),
  BRAKE_TEMPERATURE_FRONT_RIGHT: good(118),
  BRAKE_TEMPERATURE_REAR_LEFT: good(130),
  BRAKE_TEMPERATURE_REAR_RIGHT: good(125),
  FUEL_LEVEL: good(60),
  CARGO_MASS: good(128_000),
  FRONT_AXLE_LOAD: good(75_000),
  POSITION_SPEED: good(22),
  BODY_ANGLE: good(0),
};

describe('светофор точки', () => {
  it('все в норме - зеленый', () => {
    expect(pointSeverity(healthy, noFlags, { vehicle })).toBe(0);
  });

  it('один желтый показатель - желтый', () => {
    const values: PointValues = { ...healthy, TRANSMISSION_OIL_TEMPERATURE: good(115) };
    expect(pointSeverity(values, noFlags, { vehicle })).toBe(1);
  });

  it('один красный показатель - красный', () => {
    const values: PointValues = { ...healthy, BRAKE_TEMPERATURE_REAR_LEFT: good(320) };
    expect(pointSeverity(values, noFlags, { vehicle })).toBe(2);
  });

  it('взведенное предупреждение дает желтый, авария - красный', () => {
    const warnings: FlagsTriple = [0, codesToFlags(['FUEL_LOW'], WARNINGS), 0];
    expect(pointSeverity(healthy, warnings, { vehicle })).toBe(1);
    const alarms: FlagsTriple = [codesToFlags(['FIRE_ALARM'], ALARMS), 0, 0];
    expect(pointSeverity(healthy, alarms, { vehicle })).toBe(2);
  });

  it('значения с качеством не GOOD в расчет не идут', () => {
    const values: PointValues = {
      ...healthy,
      BRAKE_TEMPERATURE_REAR_LEFT: { value: 900, quality: QUALITY.COMM_ERROR },
    };
    expect(pointSeverity(values, noFlags, { vehicle })).toBe(0);
  });

  it('нет ни одного годного значения - серый', () => {
    const values: PointValues = {
      ENGINE_RPM: { value: null, quality: QUALITY.NOT_AVAILABLE },
      POSITION_SPEED: { value: 10, quality: QUALITY.STALE },
    };
    expect(pointSeverity(values, noFlags, { vehicle })).toBe(3);
  });

  it('контекстные правила применяются до расчета: заглушенный двигатель', () => {
    const values: PointValues = {
      ENGINE_RPM: good(0),
      ENGINE_OIL_PRESSURE: good(0),
      ENGINE_COOLANT_TEMPERATURE: good(80),
      POSITION_SPEED: good(0),
    };
    expect(pointSeverity(values, noFlags, { vehicle })).toBe(0);
  });

  it('opts.metrics ограничивает расчет подмножеством показателей', () => {
    const values: PointValues = { ...healthy, BRAKE_TEMPERATURE_REAR_LEFT: good(320) };
    expect(
      pointSeverity(values, noFlags, { vehicle }, { metrics: ['ENGINE_COOLANT_TEMPERATURE'] }),
    ).toBe(0);
    expect(
      pointSeverity(values, noFlags, { vehicle }, { metrics: ['BRAKE_TEMPERATURE_REAR_LEFT'] }),
    ).toBe(2);
  });
});
