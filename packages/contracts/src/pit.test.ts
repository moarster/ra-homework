import { describe, expect, it } from 'vitest';
import {
  haversineMeters,
  PIT_BOUNDS,
  PIT_CENTER,
  PIT_ROUTES,
  PIT_ZONES,
  ROUTE_IDS,
  routeGradeAt,
  routeHeadingAt,
  routePositionAt,
  segmentLengthMeters,
} from './pit.js';

/**
 * Шаг разрежения маршрута из `pit.ts`. Дублируется здесь намеренно: это внутренняя
 * константа модуля, а тест проверяет именно соблюдение объявленного шага.
 */
const ROUTE_POINT_STEP_METERS = 75;

describe('карьер и маршруты', () => {
  /**
   * Проверки намеренно заданы диапазонами, а не точными числами. Осевые линии - рабочая
   * версия этапа 3, обведенная по спутниковому снимку; финальные полилинии готовит владелец
   * проекта к этапу 5, и тест обязан пережить их замену. Поэтому проверяется то, что должно
   * быть верно для любой корректной полилинии рудника, а не длины конкретной обводки.
   */
  it('маршруты правдоподобной длины и порядок длин соответствует разделу 4 CONTEXT.md', () => {
    const crusher = PIT_ROUTES.PIT_TO_CRUSHER.lengthMeters;
    const dump = PIT_ROUTES.PIT_TO_DUMP.lengthMeters;
    const upper = PIT_ROUTES.UPPER_BENCH.lengthMeters;

    // Все три маршрута укладываются в четырехкилометровую область карьера.
    for (const id of ROUTE_IDS) {
      expect(PIT_ROUTES[id].lengthMeters).toBeGreaterThan(800);
      expect(PIT_ROUTES[id].lengthMeters).toBeLessThan(6000);
    }
    // Верхний горизонт - короткий вспомогательный маршрут, он заметно короче рейсов из забоя.
    expect(upper).toBeLessThan(crusher);
    expect(upper).toBeLessThan(dump);
    // Отвал дальше ДСК: дорога к нему идет тем же выездом и расходится уже на поверхности.
    expect(dump).toBeGreaterThan(crusher);
  });

  it('перепады высот соответствуют разделу 4 CONTEXT.md', () => {
    expect(PIT_ROUTES.PIT_TO_CRUSHER.elevationGainMeters).toBeCloseTo(180, 0);
    expect(PIT_ROUTES.PIT_TO_DUMP.elevationGainMeters).toBeCloseTo(160, 0);
    expect(PIT_ROUTES.UPPER_BENCH.elevationGainMeters).toBeCloseTo(40, 0);
  });

  it('точки маршрута идут не реже шага разрежения', () => {
    for (const id of ROUTE_IDS) {
      const route = PIT_ROUTES[id];
      expect(route.points.length).toBeGreaterThan(10);
      for (let i = 0; i < route.points.length - 1; i += 1) {
        const length = segmentLengthMeters(route, i);
        expect(length).toBeGreaterThan(0);
        // Длиннее шага сегмент быть не может: разрежение делит каждый участок осевой линии.
        expect(length).toBeLessThanOrEqual(ROUTE_POINT_STEP_METERS + 0.5);
      }
    }
  });

  it('разрежение сохраняет длину: накопленные расстояния сходятся с суммой сегментов', () => {
    for (const id of ROUTE_IDS) {
      const route = PIT_ROUTES[id];
      expect(route.cumulativeMeters).toHaveLength(route.points.length);
      let total = 0;
      for (let i = 0; i < route.points.length - 1; i += 1) {
        total += segmentLengthMeters(route, i);
        expect(route.cumulativeMeters[i + 1] ?? 0).toBeCloseTo(total, 3);
      }
      expect(route.lengthMeters).toBeCloseTo(total, 3);
    }
  });

  /**
   * Раньше профиль проверялся на строгую монотонность. Реальный маршрут монотонным не бывает:
   * из забоя машина поднимается по уступам, а на поверхности рельеф уже не только вверх.
   * Смысл проверки - в отсутствии пилы, поэтому ограничивается уклон, а не знак.
   */
  it('профиль высот без пилы: уклон в пределах возможностей карьерной дороги', () => {
    for (const id of ROUTE_IDS) {
      const route = PIT_ROUTES[id];
      for (let distance = 0; distance < route.lengthMeters; distance += 25) {
        expect(Math.abs(routeGradeAt(route, distance))).toBeLessThan(12);
      }
    }
  });

  it('все точки маршрутов и зон лежат внутри границ области', () => {
    const [[south, west], [north, east]] = PIT_BOUNDS;
    const inside = (lat: number, lon: number) =>
      lat >= south && lat <= north && lon >= west && lon <= east;
    expect(inside(PIT_CENTER[0], PIT_CENTER[1])).toBe(true);
    for (const id of ROUTE_IDS) {
      for (const point of PIT_ROUTES[id].points) {
        expect(inside(point[0], point[1])).toBe(true);
      }
    }
    for (const zone of PIT_ZONES) {
      expect(inside(zone.center[0], zone.center[1])).toBe(true);
    }
  });

  it('зоны стоят на своих маршрутах', () => {
    const nearestDistance = (
      routeId: (typeof ROUTE_IDS)[number],
      center: [number, number],
    ): number => {
      let best = Number.POSITIVE_INFINITY;
      for (const point of PIT_ROUTES[routeId].points) {
        best = Math.min(best, haversineMeters(point, [center[0], center[1], 0]));
      }
      return best;
    };
    const zone = (id: string) => {
      const found = PIT_ZONES.find((item) => item.id === id);
      if (found === undefined) {
        throw new Error(`нет зоны ${id}`);
      }
      return found;
    };
    // Погрузка - на обоих рейсовых маршрутах, разгрузка - каждая на своем.
    expect(nearestDistance('PIT_TO_CRUSHER', zone('zone-loading').center)).toBeLessThan(60);
    expect(nearestDistance('PIT_TO_DUMP', zone('zone-loading').center)).toBeLessThan(60);
    expect(nearestDistance('PIT_TO_CRUSHER', zone('zone-crusher').center)).toBeLessThan(60);
    expect(nearestDistance('PIT_TO_DUMP', zone('zone-dump').center)).toBeLessThan(60);
  });

  it('интерполяция позиции по пройденному расстоянию', () => {
    const route = PIT_ROUTES.PIT_TO_CRUSHER;
    const start = routePositionAt(route, 0);
    const first = route.points[0];
    expect(start.lat).toBeCloseTo(first?.[0] ?? 0, 9);
    expect(start.lon).toBeCloseTo(first?.[1] ?? 0, 9);

    const end = routePositionAt(route, route.lengthMeters);
    const last = route.points[route.points.length - 1];
    expect(end.lat).toBeCloseTo(last?.[0] ?? 0, 9);
    expect(end.elevation).toBeCloseTo(last?.[2] ?? 0, 6);

    // Пройденное расстояние до интерполированной точки совпадает с запрошенным.
    const target = 1000;
    const position = routePositionAt(route, target);
    let travelled = 0;
    for (let i = 0; i < position.segmentIndex; i += 1) {
      travelled += segmentLengthMeters(route, i);
    }
    const from = route.points[position.segmentIndex];
    travelled +=
      from === undefined
        ? 0
        : haversineMeters(from, [position.lat, position.lon, position.elevation]);
    expect(travelled).toBeCloseTo(target, 0);

    // За границами маршрута позиция прижимается к концам.
    expect(routePositionAt(route, -100).lat).toBeCloseTo(first?.[0] ?? 0, 9);
    expect(routePositionAt(route, route.lengthMeters + 500).lat).toBeCloseTo(last?.[0] ?? 0, 9);
  });

  it('уклон положителен на подъеме из забоя и согласован с перепадом высот', () => {
    const route = PIT_ROUTES.PIT_TO_CRUSHER;
    // Внутрикарьерная часть - сплошной подъем по уступам.
    for (const distance of [100, 1000, 2000]) {
      expect(routeGradeAt(route, distance)).toBeGreaterThan(0);
    }
    // Средний уклон внутрикарьерной части: 180 м набора на подъеме.
    const average = (route.elevationGainMeters / route.lengthMeters) * 100;
    expect(average).toBeGreaterThan(3);
    expect(average).toBeLessThan(9);
  });

  it('курс лежит в диапазоне 0-360 и отражает направление движения', () => {
    for (const id of ROUTE_IDS) {
      const route = PIT_ROUTES[id];
      for (const distance of [0, 200, 700, route.lengthMeters]) {
        const heading = routeHeadingAt(route, distance);
        expect(heading).toBeGreaterThanOrEqual(0);
        expect(heading).toBeLessThan(360);
      }
    }
    // Верхний горизонт начинается с северо-западного борта и идет на восток к выезду.
    const upper = routeHeadingAt(PIT_ROUTES.UPPER_BENCH, 0);
    expect(upper).toBeGreaterThan(0);
    expect(upper).toBeLessThan(120);
  });

  it('в карьере есть все нужные зоны', () => {
    expect(PIT_ZONES.map((zone) => zone.kind).sort()).toEqual(
      ['FUEL_STATION', 'LOADING', 'PARKING', 'UNLOADING_CRUSHER', 'UNLOADING_DUMP'].sort(),
    );
  });
});
