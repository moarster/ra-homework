import { describe, expect, it } from 'vitest';
import {
  CARD_METRIC_IDS,
  DERIVED_METRIC_IDS,
  formatMetricValue,
  METRIC_IDS,
  METRIC_INDEX,
  METRIC_ORDER,
  METRICS,
} from './metrics.js';
import { UNITS } from './units.js';

describe('реестр показателей', () => {
  it('содержит 23 физических и 7 производных показателей', () => {
    expect(METRIC_ORDER).toHaveLength(23);
    expect(DERIVED_METRIC_IDS).toHaveLength(7);
    expect(METRIC_IDS).toHaveLength(30);
  });

  it('METRIC_ORDER без дублей, все показатели существуют и не производные', () => {
    expect(new Set(METRIC_ORDER).size).toBe(METRIC_ORDER.length);
    for (const [index, id] of METRIC_ORDER.entries()) {
      expect(METRICS[id]).toBeDefined();
      expect(METRICS[id].kind).not.toBe('derived');
      expect(METRIC_INDEX[id]).toBe(index);
    }
  });

  it('у каждой записи согласованы единицы и заполнена частота опроса', () => {
    for (const id of METRIC_IDS) {
      const metric = METRICS[id];
      expect(UNITS[metric.unitId].groupId).toBe(UNITS[metric.displayUnitId].groupId);
      expect([1, 0.2]).toContain(metric.sampleRateHz);
      expect(metric.icon).toContain('<svg viewBox="0 0 24 24"');
      expect(metric.icon).toContain('stroke="currentColor"');
    }
  });

  it('адреса регистров уникальны и заполнены только у физических показателей', () => {
    const addresses = METRIC_IDS.map((id) => METRICS[id].registerAddress).filter(
      (address): address is number => address !== undefined,
    );
    expect(addresses).toHaveLength(METRIC_ORDER.length);
    expect(new Set(addresses).size).toBe(addresses.length);
    for (const id of DERIVED_METRIC_IDS) {
      expect(METRICS[id].registerAddress).toBeUndefined();
    }
  });

  it('на плашке 7 показателей в порядке приоритета из раздела 9.1 CONTEXT.md', () => {
    expect(CARD_METRIC_IDS).toEqual([
      'POSITION_SPEED',
      'PAYLOAD_RATIO',
      'ENGINE_COOLANT_TEMPERATURE',
      'TRANSMISSION_OIL_TEMPERATURE',
      'BRAKE_TEMPERATURE_MAX',
      'ENGINE_OIL_PRESSURE',
      'FUEL_LEVEL',
    ]);
  });

  it('форматирует значение показателя в единице отображения', () => {
    expect(formatMetricValue(130_000, 'CARGO_MASS')).toBe('130,0 т');
    expect(formatMetricValue(87.4, 'ENGINE_COOLANT_TEMPERATURE')).toBe('87,4 C');
  });
});
