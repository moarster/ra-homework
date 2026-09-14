/**
 * Приоритет разбора целей под курсором: машина > флажок события > флажок монитора > хвост.
 *
 * Проверяется на нарочно совмещенных целях - все они ставятся в одну точку. Именно этот
 * случай и происходит на карте постоянно: машина стоит на голове своего хвоста, флажок
 * события - на точке этого же хвоста, монитор - тоже на точке хвоста.
 */

import { SEVERITY } from '@ra/contracts';
import { describe, expect, it } from 'vitest';
import type { VehicleTail } from '../data/tail-store.js';
import type { MapProjector, ScreenPoint } from '../provider/types.js';
import { OverlayRenderer, pickTarget, VEHICLE_HIT_RADIUS } from './renderer.js';

const T0 = 1_700_000_000;

/**
 * Проектор-заглушка: широта и долгота пересчитываются в пиксели один к одному. Настоящая
 * меркаторовская проекция здесь не нужна - проверяется разбор целей, а не картография.
 */
const projector: MapProjector = {
  width: 800,
  height: 600,
  zoom: 15,
  metersPerPixel: 1,
  project(lat: number, lon: number, out: ScreenPoint): ScreenPoint {
    out.x = lon;
    out.y = lat;
    return out;
  },
  unproject(x: number, y: number) {
    return { lat: y, lon: x };
  },
};

/** Хвост из трех точек, лежащих по горизонтали на y = 300. */
function tailAt(vehicleId: string, xs: number[]): VehicleTail {
  const count = xs.length;
  const tail: VehicleTail = {
    vehicleId,
    t: new Float64Array(xs.map((_, i) => T0 + i * 10)),
    lat: new Float64Array(xs.map(() => 300)),
    lon: new Float64Array(xs),
    heading: new Float64Array(count),
    sev: new Uint8Array(xs.map(() => SEVERITY.OK)),
    broken: new Uint8Array(count),
    count,
    marks: [],
  };
  return tail;
}

function tails(...items: VehicleTail[]): ReadonlyMap<string, VehicleTail> {
  return new Map(items.map((tail) => [tail.vehicleId, tail]));
}

/** Рендерер с расставленными вручную целями кадра. */
function rendererWith(options: {
  vehicles?: { vehicleId: string; x: number; y: number }[];
  marks?: { vehicleId: string; t: number; code: string; x: number; y: number }[];
  monitor?: { vehicleId: string; t: number; x: number; y: number };
}): OverlayRenderer {
  const renderer = new OverlayRenderer();
  for (const vehicle of options.vehicles ?? []) {
    renderer.vehicleHits.push(vehicle);
  }
  for (const mark of options.marks ?? []) {
    renderer.markHits.push({ ...mark, severity: SEVERITY.ALARM });
  }
  renderer.monitorHit = options.monitor ?? null;
  return renderer;
}

const pickAt = (
  renderer: OverlayRenderer,
  map: ReadonlyMap<string, VehicleTail>,
  x: number,
  y: number,
  selected: string | null = null,
) => pickTarget(renderer, map, projector, T0 - 1000, selected, x, y);

describe('приоритет целей под курсором', () => {
  const track = tails(tailAt('v-12', [400, 420, 440]));

  it('машина перебивает все остальное', () => {
    const renderer = rendererWith({
      vehicles: [{ vehicleId: 'v-12', x: 420, y: 300 }],
      marks: [{ vehicleId: 'v-12', t: T0 + 10, code: 'OVERLOAD', x: 420, y: 300 }],
      monitor: { vehicleId: 'v-12', t: T0 + 10, x: 420, y: 300 },
    });
    expect(pickAt(renderer, track, 420, 300)?.kind).toBe('vehicle');
  });

  it('без машины побеждает флажок события', () => {
    const renderer = rendererWith({
      marks: [{ vehicleId: 'v-12', t: T0 + 10, code: 'OVERLOAD', x: 420, y: 300 }],
      monitor: { vehicleId: 'v-12', t: T0 + 10, x: 420, y: 300 },
    });
    expect(pickAt(renderer, track, 420, 300)?.kind).toBe('mark');
  });

  it('без машины и события побеждает флажок монитора', () => {
    const renderer = rendererWith({ monitor: { vehicleId: 'v-12', t: T0 + 10, x: 420, y: 300 } });
    expect(pickAt(renderer, track, 420, 300)?.kind).toBe('monitor');
  });

  it('хвост подбирается последним', () => {
    const renderer = rendererWith({});
    const target = pickAt(renderer, track, 420, 300);
    expect(target?.kind).toBe('tail');
    expect(target?.vehicleId).toBe('v-12');
  });

  it('вдали от всего цели нет', () => {
    const renderer = rendererWith({ vehicles: [{ vehicleId: 'v-12', x: 420, y: 300 }] });
    expect(pickAt(renderer, track, 100, 100)).toBeNull();
  });
});

describe('притяжение курсора', () => {
  const track = tails(tailAt('v-12', [400, 420, 440]));

  /*
   * Смысл притяжения: попадать по машине, не наводясь на нее пиксель в пиксель. Радиус
   * заметно больше самой пиктограммы, поэтому промах в полтора десятка пикселей все еще
   * считается попаданием.
   */
  it('машина ловится с заметного промаха', () => {
    const renderer = rendererWith({ vehicles: [{ vehicleId: 'v-12', x: 420, y: 300 }] });
    expect(pickAt(renderer, track, 420 + VEHICLE_HIT_RADIUS - 2, 300 - 8)?.kind).toBe('vehicle');
    expect(VEHICLE_HIT_RADIUS).toBeGreaterThanOrEqual(20);
  });

  it('хвост ловится, когда курсор рядом с линией, а не строго на точке', () => {
    const renderer = rendererWith({});
    // Между двумя точками трека и на несколько пикселей в стороне от линии.
    expect(pickAt(renderer, track, 424, 306)?.kind).toBe('tail');
  });

  /*
   * На ближнем зуме соседние точки трека расходятся на сотни пикселей: точки трека стоят
   * через десятки метров. Если мерить расстояние до точек, а не до отрезка между ними,
   * сплошная нарисованная линия оказывается «дырявой» для курсора - навести можно только
   * на сами точки. Отсюда и проверка ровно посередине длинного отрезка.
   */
  it('хвост ловится посередине длинного отрезка, а не только у его концов', () => {
    const renderer = rendererWith({});
    const long = tails(tailAt('v-12', [0, 600]));
    expect(pickAt(renderer, long, 300, 300)?.kind).toBe('tail');
    expect(pickAt(renderer, long, 300, 305)?.kind).toBe('tail');
    // Поперек линии дальше радиуса - уже мимо.
    expect(pickAt(renderer, long, 300, 330)).toBeNull();
  });

  it('монитор встает на настоящую точку трека, а не на середину отрезка', () => {
    const renderer = rendererWith({});
    const long = tails(tailAt('v-12', [0, 600]));
    /** Время цели-хвоста: у остальных целей своего времени точки трека нет. */
    const tailTime = (x: number): number | null => {
      const target = pickAt(renderer, long, x, 300);
      return target?.kind === 'tail' ? target.t : null;
    };
    // Ближе к правому концу - берется время правой точки.
    expect(tailTime(590)).toBe(T0 + 10);
    // Ближе к левому - время левой.
    expect(tailTime(10)).toBe(T0);
  });
});

describe('скрытые хвосты курсор не ловят', () => {
  const track = tails(tailAt('v-12', [400, 420, 440]), tailAt('v-07', [600, 620, 640]));

  it('без выбора ловятся оба хвоста', () => {
    const renderer = rendererWith({});
    expect(pickAt(renderer, track, 420, 300)?.vehicleId).toBe('v-12');
    expect(pickAt(renderer, track, 620, 300)?.vehicleId).toBe('v-07');
  });

  it('при выбранной машине чужой хвост не ловится: его и не видно', () => {
    const renderer = rendererWith({});
    expect(pickAt(renderer, track, 420, 300, 'v-12')?.vehicleId).toBe('v-12');
    expect(pickAt(renderer, track, 620, 300, 'v-12')).toBeNull();
  });
});
