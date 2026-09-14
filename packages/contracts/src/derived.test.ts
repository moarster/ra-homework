import { describe, expect, it } from 'vitest';
import {
  brakeTemperatureMax,
  brakeTemperatureSpread,
  frontAxleShare,
  hoursToService,
  payloadRatio,
  timeSinceLastData,
  type VehicleStatusInput,
  vehicleStatus,
} from './derived.js';

const base: VehicleStatusInput = {
  hasData: true,
  engineRunning: true,
  speedKmh: 0,
  cargoMassKg: 0,
  ratedPayloadKg: 130_000,
  bodyAngleDeg: 0,
  zoneKind: null,
};

describe('статус машины', () => {
  it('NO_DATA - нет свежих данных', () => {
    expect(vehicleStatus({ ...base, hasData: false, speedKmh: 20 })).toBe('NO_DATA');
  });

  it('PARKED - двигатель заглушен', () => {
    expect(vehicleStatus({ ...base, engineRunning: false })).toBe('PARKED');
  });

  it('HAULING - движение с грузом', () => {
    expect(vehicleStatus({ ...base, speedKmh: 18, cargoMassKg: 120_000 })).toBe('HAULING');
  });

  it('RETURNING - движение порожним', () => {
    expect(vehicleStatus({ ...base, speedKmh: 25, cargoMassKg: 500 })).toBe('RETURNING');
  });

  it('UNLOADING - стоит с поднятой платформой', () => {
    expect(vehicleStatus({ ...base, bodyAngleDeg: 42 })).toBe('UNLOADING');
  });

  it('LOADING - стоит в забое', () => {
    expect(vehicleStatus({ ...base, zoneKind: 'LOADING' })).toBe('LOADING');
  });

  it('IDLING - двигатель работает, машина стоит вне забоя', () => {
    expect(vehicleStatus({ ...base, zoneKind: 'PARKING' })).toBe('IDLING');
  });
});

describe('производные показатели', () => {
  it('максимум и разброс температур тормозов', () => {
    expect(brakeTemperatureMax([180, 210, null, 195])).toBe(210);
    expect(brakeTemperatureSpread([180, 210, null, 195])).toBe(30);
    expect(brakeTemperatureMax([null, null])).toBeNull();
    expect(brakeTemperatureSpread([null, null])).toBeNull();
  });

  it('загрузка в процентах от номинала', () => {
    expect(payloadRatio(130_000, 130_000)).toBeCloseTo(100, 10);
    expect(payloadRatio(143_000, 130_000)).toBeCloseTo(110, 10);
    expect(payloadRatio(null, 130_000)).toBeNull();
    expect(payloadRatio(1000, 0)).toBeNull();
  });

  it('доля передней оси', () => {
    expect(frontAxleShare(70_000, 140_000)).toBeCloseTo(33.3333, 3);
    expect(frontAxleShare(0, 0)).toBeNull();
    expect(frontAxleShare(null, 100)).toBeNull();
  });

  it('время без связи в минутах', () => {
    expect(timeSinceLastData(1000, 700)).toBeCloseTo(5, 10);
    expect(timeSinceLastData(1000, 1200)).toBe(0);
    expect(timeSinceLastData(1000, null)).toBeNull();
  });

  it('часов до ближайшего кратного 250 моточасов', () => {
    expect(hoursToService(18_400)).toBeCloseTo(100, 10);
    expect(hoursToService(18_500)).toBe(0);
    expect(hoursToService(18_495)).toBeCloseTo(5, 10);
    expect(hoursToService(null)).toBeNull();
  });
});
