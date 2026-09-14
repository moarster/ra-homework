import { describe, expect, it } from 'vitest';
import { DUTY_MODE_RULES } from './config.js';
import { dutyMode, fullLoadFuelLitersPerHour } from './derived.js';

/** Двигатель БелАЗ-75131. */
const POWER_KW = 1715;
const HIGH_FUEL = fullLoadFuelLitersPerHour(POWER_KW) * DUTY_MODE_RULES.highFuelShare;

describe('режим работы', () => {
  it('высокие обороты, низкая скорость и высокий расход - работа внатяг', () => {
    expect(
      dutyMode({ rpm: 1900, speedKmh: 6, fuelLitersPerHour: HIGH_FUEL, enginePowerKw: POWER_KW }),
    ).toBe('LUGGING');
  });

  it('без высокого расхода внатяг не считается: например, прогазовка на стоянке', () => {
    expect(
      dutyMode({ rpm: 1900, speedKmh: 0, fuelLitersPerHour: 40, enginePowerKw: POWER_KW }),
    ).toBe('NORMAL');
    expect(
      dutyMode({ rpm: 1900, speedKmh: 0, fuelLitersPerHour: null, enginePowerKw: POWER_KW }),
    ).toBe('NORMAL');
  });

  it('низкие обороты при высокой скорости - накат', () => {
    expect(
      dutyMode({ rpm: 700, speedKmh: 32, fuelLitersPerHour: 20, enginePowerKw: POWER_KW }),
    ).toBe('COASTING');
  });

  it('без оборотов или скорости режим не определить', () => {
    expect(
      dutyMode({ rpm: null, speedKmh: 30, fuelLitersPerHour: 20, enginePowerKw: POWER_KW }),
    ).toBe('UNKNOWN');
  });
});
