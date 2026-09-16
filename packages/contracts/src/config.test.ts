import { describe, expect, it } from 'vitest';
import {
  clampTimeScale,
  maxTimeScaleFor,
  maxVehiclesForTimeScale,
  TIME_SCALE_LIMITS,
  TIME_SCALES,
} from './config.js';
import { MAX_VEHICLES, MIN_VEHICLES } from './vehicles.js';

describe('предел скорости времени по числу машин', () => {
  it('края заданы явно: минимум машин x300, максимум x2', () => {
    expect(maxTimeScaleFor(MIN_VEHICLES)).toBe(300);
    expect(maxTimeScaleFor(MAX_VEHICLES)).toBe(2);
  });

  it('предел не растет с числом машин и всегда есть в списке скоростей', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let count = MIN_VEHICLES; count <= MAX_VEHICLES; count += 1) {
      const max = maxTimeScaleFor(count);
      expect(max).toBeLessThanOrEqual(previous);
      expect(TIME_SCALES).toContain(max);
      previous = max;
    }
  });

  it('последняя полоса покрывает весь парк', () => {
    expect(TIME_SCALE_LIMITS.at(-1)?.maxVehicles).toBe(MAX_VEHICLES);
  });

  it('для скорости известно наибольшее допустимое число машин', () => {
    expect(maxVehiclesForTimeScale(300)).toBe(5);
    expect(maxVehiclesForTimeScale(1)).toBe(MAX_VEHICLES);
    for (const scale of TIME_SCALES) {
      expect(maxTimeScaleFor(maxVehiclesForTimeScale(scale))).toBeGreaterThanOrEqual(scale);
    }
  });

  it('скорость выше предела съезжает к пределу, ниже - не меняется', () => {
    expect(clampTimeScale(300, 12)).toBe(60);
    expect(clampTimeScale(5, 12)).toBe(5);
    expect(clampTimeScale(300, MAX_VEHICLES)).toBe(2);
  });
});
