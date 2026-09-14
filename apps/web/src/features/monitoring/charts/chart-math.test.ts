import { describe, expect, it } from 'vitest';
import {
  gearLabel,
  normativeZones,
  rangeWithZones,
  redlinePercent,
  redlineScale,
  zonesInUnit,
} from './chart-math.js';

describe('шкала "процент до красной зоны"', () => {
  it('ОЖ: ноль в начале зеленой зоны, сто процентов на границе красной', () => {
    const scale = redlineScale(normativeZones('ENGINE_COOLANT_TEMPERATURE', 'BELAZ_75131'));
    expect(scale).toEqual({ low: 75, warnFrom: 95, redFrom: 105 });
    expect(redlinePercent(scale as NonNullable<typeof scale>, 90)).toBeCloseTo(50);
  });

  it('тормоза: зеленая зона открыта снизу, шкала от нуля', () => {
    const scale = redlineScale(normativeZones('BRAKE_TEMPERATURE_MAX', 'BELAZ_75131'));
    expect(scale).toEqual({ low: 0, warnFrom: 200, redFrom: 300 });
    expect(redlinePercent(scale as NonNullable<typeof scale>, 150)).toBeCloseTo(50);
  });

  it('у показателя, опасного падением, шкалы нет', () => {
    expect(redlineScale(normativeZones('FUEL_LEVEL', 'BELAZ_75131'))).toBeNull();
  });
});

describe('диапазон оси', () => {
  it('подтягивает ближайшую границу зоны, чтобы фон норматива был виден', () => {
    const zones = normativeZones('BRAKE_TEMPERATURE_FRONT_LEFT', 'BELAZ_75131');
    const [lo, hi] = rangeWithZones(80, 120, zones);
    expect(hi).toBeGreaterThan(200);
    expect(hi).toBeLessThan(300);
    expect(lo).toBeLessThan(80);
  });

  it('без данных показывает сами зоны', () => {
    const [lo, hi] = rangeWithZones(null, null, normativeZones('POSITION_SPEED', 'BELAZ_75131'));
    expect(lo).toBeLessThan(30);
    expect(hi).toBeGreaterThan(40);
  });
});

describe('единицы и подписи', () => {
  it('зоны переводятся в единицу отображения', () => {
    const zones = zonesInUnit(
      normativeZones('ENGINE_COOLANT_TEMPERATURE', 'BELAZ_75131'),
      'ENGINE_COOLANT_TEMPERATURE',
      'FAHRENHEIT',
    );
    expect(zones.find((zone) => zone.severity === 2)?.from).toBeCloseTo(221);
  });

  it('относительные нормативы массы груза уже в килограммах модели', () => {
    const zones = normativeZones('CARGO_MASS', 'BELAZ_7555B');
    expect(zones.find((zone) => zone.severity === 2 && zone.to === null)?.from).toBe(66_000);
  });

  it('передача', () => {
    expect([gearLabel(-1), gearLabel(0), gearLabel(3), gearLabel(null)]).toEqual([
      'R',
      'N',
      '3',
      '-',
    ]);
  });
});
