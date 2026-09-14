import { describe, expect, it } from 'vitest';
import {
  generateFleet,
  MAX_VEHICLES,
  modelReferenceValue,
  NAMED_VEHICLES,
  VEHICLE_MODELS,
} from './vehicles.js';

describe('парк машин', () => {
  it('паспортные величины согласованы: снаряженная + номинал = полная масса', () => {
    for (const model of Object.values(VEHICLE_MODELS)) {
      expect(model.curbWeightKg + model.ratedPayloadKg).toBe(model.grossWeightKg);
      expect(modelReferenceValue(model, 'ratedPayload')).toBe(model.ratedPayloadKg);
      expect(modelReferenceValue(model, 'grossWeight')).toBe(model.grossWeightKg);
    }
  });

  it('генератор детерминирован: одинаковый seed дает одинаковый парк', () => {
    expect(generateFleet(40, 42)).toEqual(generateFleet(40, 42));
    expect(generateFleet(40, 42)).not.toEqual(generateFleet(40, 43));
  });

  it('первые три машины всегда именные', () => {
    const fleet = generateFleet(60, 7);
    expect(fleet.slice(0, 3)).toEqual(NAMED_VEHICLES);
  });

  it('число машин ограничено сверху и снизу', () => {
    expect(generateFleet(1, 1)).toHaveLength(3);
    expect(generateFleet(200, 1)).toHaveLength(MAX_VEHICLES);
    expect(generateFleet(17, 1)).toHaveLength(17);
  });

  it('идентификаторы и бортовые номера уникальны', () => {
    const fleet = generateFleet(MAX_VEHICLES, 2024);
    expect(new Set(fleet.map((vehicle) => vehicle.id)).size).toBe(fleet.length);
    expect(new Set(fleet.map((vehicle) => vehicle.sideNumber)).size).toBe(fleet.length);
    for (const vehicle of fleet) {
      expect(vehicle.id).toBe(`v-${vehicle.sideNumber}`);
      expect(VEHICLE_MODELS[vehicle.modelId]).toBeDefined();
      expect(vehicle.driver.phone).toMatch(/^\+7 913 450-\d{2}-\d{2}$/);
      expect(vehicle.plate).toMatch(/^\d{4} КЕ 42$/);
    }
  });

  it('рост парка не меняет уже существующие машины', () => {
    const small = generateFleet(10, 5);
    const big = generateFleet(20, 5);
    expect(big.slice(0, 10)).toEqual(small);
  });
});
