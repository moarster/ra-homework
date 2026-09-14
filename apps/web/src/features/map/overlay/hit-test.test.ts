/**
 * Попадание курсора по машине и по флажку. Геометрия здесь важнее, чем кажется: флажок
 * рисуется вверх от своей точки на треке, поэтому ловится он не по точке, а по древку -
 * иначе по нему нельзя было бы кликнуть там, где он нарисован.
 */

import { SEVERITY } from '@ra/contracts';
import { describe, expect, it } from 'vitest';
import {
  hitMark,
  hitMonitor,
  hitVehicle,
  MARK_HIT_RADIUS,
  type MarkHit,
  MONITOR_HIT_RADIUS,
  type MonitorHit,
  sameTarget,
  tailVisible,
  VEHICLE_HIT_RADIUS,
  type VehicleHit,
} from './renderer.js';

const vehicles: VehicleHit[] = [
  { vehicleId: 'v-12', x: 100, y: 100 },
  { vehicleId: 'v-07', x: 300, y: 100 },
];

const marks: MarkHit[] = [
  { vehicleId: 'v-12', t: 1, code: 'COOLANT_OVERHEAT', severity: SEVERITY.ALARM, x: 200, y: 200 },
];

describe('попадание по машине', () => {
  it('точное попадание', () => {
    expect(hitVehicle(vehicles, 100, 100)?.vehicleId).toBe('v-12');
  });

  it('попадание в пределах радиуса', () => {
    expect(hitVehicle(vehicles, 100 + VEHICLE_HIT_RADIUS - 1, 100)?.vehicleId).toBe('v-12');
  });

  it('за радиусом попадания нет', () => {
    expect(hitVehicle(vehicles, 100 + VEHICLE_HIT_RADIUS + 5, 100)).toBeNull();
    expect(hitVehicle([], 100, 100)).toBeNull();
  });

  it('из двух машин выбирается ближняя', () => {
    expect(hitVehicle(vehicles, 290, 100)?.vehicleId).toBe('v-07');
    expect(hitVehicle(vehicles, 110, 100)?.vehicleId).toBe('v-12');
  });
});

describe('попадание по флажку', () => {
  /*
   * Ключевая проверка: клик по нарисованному флажку - это клик выше его точки на треке.
   * Если ловить по самой точке, курсор будет попадать в трек, а не во флажок.
   */
  it('флажок ловится по древку, то есть выше своей точки', () => {
    expect(hitMark(marks, 200, 192)?.code).toBe('COOLANT_OVERHEAT');
    expect(hitMark(marks, 200, 200)?.code).toBe('COOLANT_OVERHEAT');
  });

  it('ниже своей точки флажок не ловится', () => {
    expect(hitMark(marks, 200, 200 + MARK_HIT_RADIUS + 2)).toBeNull();
  });

  it('в стороне от древка попадания нет', () => {
    expect(hitMark(marks, 200 + MARK_HIT_RADIUS + 2, 192)).toBeNull();
    expect(hitMark([], 200, 200)).toBeNull();
  });
});

describe('флажок монитора', () => {
  const monitor: MonitorHit = { vehicleId: 'v-12', t: 42, x: 400, y: 400 };

  it('ловится по древку', () => {
    expect(hitMonitor(monitor, 400, 392)?.t).toBe(42);
  });

  it('за радиусом и без монитора попадания нет', () => {
    expect(hitMonitor(monitor, 400 + MONITOR_HIT_RADIUS + 3, 392)).toBeNull();
    expect(hitMonitor(null, 400, 400)).toBeNull();
  });
});

describe('видимость хвостов', () => {
  /*
   * Когда машина выбрана, на карте остается только ее трек: иначе чужие хвосты вдоль той же
   * дороги не дают разглядеть тот, ради которого машину и выбрали.
   */
  it('без выбора видны все хвосты', () => {
    expect(tailVisible('v-12', null)).toBe(true);
    expect(tailVisible('v-07', null)).toBe(true);
  });

  it('с выбором виден только хвост выбранной машины', () => {
    expect(tailVisible('v-12', 'v-12')).toBe(true);
    expect(tailVisible('v-07', 'v-12')).toBe(false);
  });
});

describe('сравнение целей наведения', () => {
  it('одна и та же цель не считается новой', () => {
    expect(
      sameTarget({ kind: 'vehicle', vehicleId: 'v-12' }, { kind: 'vehicle', vehicleId: 'v-12' }),
    ).toBe(true);
    expect(sameTarget(null, null)).toBe(true);
  });

  it('разные цели различаются', () => {
    expect(
      sameTarget({ kind: 'vehicle', vehicleId: 'v-12' }, { kind: 'vehicle', vehicleId: 'v-07' }),
    ).toBe(false);
    expect(sameTarget({ kind: 'vehicle', vehicleId: 'v-12' }, null)).toBe(false);
    expect(
      sameTarget(
        { kind: 'monitor', vehicleId: 'v-12', t: 1 },
        { kind: 'monitor', vehicleId: 'v-12', t: 2 },
      ),
    ).toBe(false);
  });
});
