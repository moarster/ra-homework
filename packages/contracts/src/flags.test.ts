import { describe, expect, it } from 'vitest';
import {
  ALARMS,
  codesToFlags,
  decodeFlags,
  flagsToCodes,
  isBitSet,
  isStateSet,
  SYSTEM_STATE,
  WARNINGS,
} from './flags.js';

describe('битовые поля', () => {
  it('каталоги соответствуют разделу 8 CONTEXT.md', () => {
    expect(ALARMS).toHaveLength(11);
    expect(WARNINGS).toHaveLength(12);
    expect(SYSTEM_STATE).toHaveLength(10);
    for (const catalog of [ALARMS, WARNINGS, SYSTEM_STATE]) {
      expect(catalog.map((flag) => flag.bit)).toEqual(catalog.map((_, index) => index));
      expect(new Set(catalog.map((flag) => flag.code)).size).toBe(catalog.length);
    }
    expect(ALARMS.every((flag) => flag.severity === 2)).toBe(true);
    expect(WARNINGS.every((flag) => flag.severity === 1)).toBe(true);
    expect(SYSTEM_STATE.every((flag) => flag.severity === 0)).toBe(true);
  });

  it('декодирует взведенные биты', () => {
    const value = 0b101;
    expect(isBitSet(value, 0)).toBe(true);
    expect(isBitSet(value, 1)).toBe(false);
    expect(decodeFlags(value, ALARMS).map((flag) => flag.bit)).toEqual([0, 2]);
    expect(flagsToCodes(value, ALARMS)).toEqual(['OIL_PRESSURE_CRITICAL', 'TRANSMISSION_OVERHEAT']);
  });

  it('кодирование и декодирование обратимы', () => {
    const codes = ['COOLANT_TEMP_HIGH', 'OVERSPEED', 'SERVICE_DUE'];
    const value = codesToFlags(codes, WARNINGS);
    expect(flagsToCodes(value, WARNINGS).sort()).toEqual([...codes].sort());
  });

  it('проверяет состояние систем по коду', () => {
    const state = codesToFlags(['ENGINE_RUNNING', 'LOADED'], SYSTEM_STATE);
    expect(isStateSet(state, 'ENGINE_RUNNING')).toBe(true);
    expect(isStateSet(state, 'BODY_RAISED')).toBe(false);
  });
});
