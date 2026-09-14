import { describe, expect, it } from 'vitest';
import { convert, formatValue, fromBase, toBase, UNIT_GROUPS, UNIT_IDS, UNITS } from './units.js';

describe('справочник единиц', () => {
  it('у каждой группы базовая единица принадлежит этой же группе и не преобразует значение', () => {
    for (const group of Object.values(UNIT_GROUPS)) {
      const base = UNITS[group.baseUnitId];
      expect(base.groupId).toBe(group.id);
      expect(base.factor).toBe(1);
      expect(base.offset).toBe(0);
    }
  });

  it('круговая конвертация base -> unit -> base возвращает исходное значение', () => {
    for (const unitId of UNIT_IDS) {
      for (const value of [-40, 0, 1, 37.5, 1234.25]) {
        expect(toBase(fromBase(value, unitId), unitId)).toBeCloseTo(value, 6);
      }
    }
  });

  it('температурные крайние точки: 0 C = 32 F = 273,15 K', () => {
    expect(convert(0, 'CELSIUS', 'FAHRENHEIT')).toBeCloseTo(32, 10);
    expect(convert(0, 'CELSIUS', 'KELVIN')).toBeCloseTo(273.15, 10);
    expect(convert(32, 'FAHRENHEIT', 'CELSIUS')).toBeCloseTo(0, 10);
    expect(convert(273.15, 'KELVIN', 'CELSIUS')).toBeCloseTo(0, 10);
    expect(convert(100, 'CELSIUS', 'FAHRENHEIT')).toBeCloseTo(212, 10);
    expect(convert(-40, 'CELSIUS', 'FAHRENHEIT')).toBeCloseTo(-40, 10);
  });

  it('конвертирует внутри прочих групп', () => {
    expect(convert(1000, 'KILOGRAM', 'TONNE')).toBeCloseTo(1, 10);
    expect(convert(1, 'BAR', 'KPA')).toBeCloseTo(100, 10);
    expect(convert(36, 'KILOMETERS_PER_HOUR', 'METERS_PER_SECOND')).toBeCloseTo(10, 10);
    expect(convert(1, 'HOUR', 'SECOND')).toBeCloseTo(3600, 10);
  });

  it('смешивание групп - ошибка времени выполнения', () => {
    const from: 'CELSIUS' = 'CELSIUS';
    const to = 'BAR' as 'CELSIUS';
    expect(() => convert(10, from, to)).toThrowError(/разные группы единиц/);
  });
});

describe('formatValue', () => {
  it('пишет значение с русским разделителем и символом единицы', () => {
    expect(formatValue(87.45, 'CELSIUS')).toBe('87,5 C');
    expect(formatValue(2100, 'RPM')).toBe('2 100 об/мин');
    expect(formatValue(-3.5, 'CELSIUS')).toBe('-3,5 C');
  });

  it('переводит значение в запрошенную единицу', () => {
    expect(formatValue(130_000, 'KILOGRAM', { unitId: 'TONNE', precision: 1 })).toBe('130,0 т');
  });

  it('уважает настройки вывода', () => {
    expect(formatValue(2100, 'RPM', { grouping: false })).toBe('2100 об/мин');
    expect(formatValue(2100, 'RPM', { withUnit: false })).toBe('2 100');
    expect(formatValue(null, 'RPM')).toBe('-');
    expect(formatValue(null, 'RPM', { nullText: 'нет данных' })).toBe('нет данных');
  });

  it('принимает описание показателя вместо единицы', () => {
    expect(formatValue(95_000, { unitId: 'KILOGRAM', displayUnitId: 'TONNE', precision: 1 })).toBe(
      '95,0 т',
    );
  });
});
