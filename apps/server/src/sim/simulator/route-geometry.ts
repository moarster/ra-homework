/**
 * Геометрия маршрута для движения в коридоре.
 *
 * Полилиния переводится в локальные метры вокруг центра карьера (x - на восток, y - на
 * север) один раз: в горячем цикле нет ни гаверсинуса, ни объектов. Позиция машины - точка на
 * полилинии по пройденному расстоянию плюс смещение вдоль нормали. Нормаль в вершинах
 * усреднена по соседним сегментам и интерполируется вдоль сегмента, поэтому на изломах
 * трек не прыгает. Расстояние опубликованной точки до полилинии никогда не больше модуля
 * смещения: точка на полилинии, от которой оно отложено, всегда рядом.
 *
 * Работает с любыми корректными полилиниями: высота в точках не обязательна.
 */

import {
  PIT_CENTER,
  PIT_METERS_PER_DEGREE_LATITUDE,
  PIT_METERS_PER_DEGREE_LONGITUDE,
  type PitZoneKind,
  zonesOfKind,
} from '@ra/contracts';

export interface RouteGeometry {
  lengthM: number;
  pointCount: number;
  x: Float64Array;
  y: Float64Array;
  /** Накопленное расстояние до вершины, м. */
  cum: Float64Array;
  /** Единичное направление сегмента. */
  dirX: Float64Array;
  dirY: Float64Array;
  /** Единичная нормаль в вершине (вправо по ходу от начала маршрута). */
  normalX: Float64Array;
  normalY: Float64Array;
  /** Уклон сегмента в направлении от начала маршрута, проценты. */
  grade: Float64Array;
  /** Есть ли в точках перепад высоты. */
  hasElevation: boolean;
  /** Зона разгрузки у конца маршрута. Начало маршрута - всегда забой. */
  endZone: PitZoneKind;
}

export function toLocalX(lon: number): number {
  return (lon - PIT_CENTER[1]) * PIT_METERS_PER_DEGREE_LONGITUDE;
}

export function toLocalY(lat: number): number {
  return (lat - PIT_CENTER[0]) * PIT_METERS_PER_DEGREE_LATITUDE;
}

export function toLongitude(x: number): number {
  return PIT_CENTER[1] + x / PIT_METERS_PER_DEGREE_LONGITUDE;
}

export function toLatitude(y: number): number {
  return PIT_CENTER[0] + y / PIT_METERS_PER_DEGREE_LATITUDE;
}

/** Точки `[lat, lon]` или `[lat, lon, elevation]`. */
export function buildRouteGeometry(points: readonly (readonly number[])[]): RouteGeometry {
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (const point of points) {
    const lat = point[0] ?? PIT_CENTER[0];
    const lon = point[1] ?? PIT_CENTER[1];
    const x = toLocalX(lon);
    const y = toLocalY(lat);
    const px = xs[xs.length - 1];
    const py = ys[ys.length - 1];
    // Совпадающие соседние точки дают сегмент нулевой длины без направления.
    if (px !== undefined && py !== undefined && Math.hypot(x - px, y - py) < 0.01) {
      continue;
    }
    xs.push(x);
    ys.push(y);
    zs.push(point[2] ?? 0);
  }
  if (xs.length < 2) {
    throw new Error('маршрут должен содержать хотя бы две различные точки');
  }
  const n = xs.length;
  const geometry: RouteGeometry = {
    lengthM: 0,
    pointCount: n,
    x: Float64Array.from(xs),
    y: Float64Array.from(ys),
    cum: new Float64Array(n),
    dirX: new Float64Array(n - 1),
    dirY: new Float64Array(n - 1),
    normalX: new Float64Array(n),
    normalY: new Float64Array(n),
    grade: new Float64Array(n - 1),
    hasElevation: false,
    endZone: 'UNLOADING_CRUSHER',
  };
  let total = 0;
  for (let i = 0; i < n - 1; i += 1) {
    const dx = (xs[i + 1] ?? 0) - (xs[i] ?? 0);
    const dy = (ys[i + 1] ?? 0) - (ys[i] ?? 0);
    const length = Math.hypot(dx, dy);
    geometry.dirX[i] = dx / length;
    geometry.dirY[i] = dy / length;
    const rise = (zs[i + 1] ?? 0) - (zs[i] ?? 0);
    geometry.grade[i] = (rise / length) * 100;
    if (rise !== 0) {
      geometry.hasElevation = true;
    }
    total += length;
    geometry.cum[i + 1] = total;
  }
  geometry.lengthM = total;

  // Нормаль вправо по ходу: (dy, -dx). В вершине - биссектриса соседних нормалей.
  for (let i = 0; i < n; i += 1) {
    const prev = Math.max(0, i - 1);
    const next = Math.min(n - 2, i);
    let nx = (geometry.dirY[prev] ?? 0) + (geometry.dirY[next] ?? 0);
    let ny = -(geometry.dirX[prev] ?? 0) - (geometry.dirX[next] ?? 0);
    let length = Math.hypot(nx, ny);
    // Разворот на 180 градусов: биссектриса вырождается, берем нормаль входящего сегмента.
    if (length < 0.2) {
      nx = geometry.dirY[prev] ?? 0;
      ny = -(geometry.dirX[prev] ?? 0);
      length = 1;
    }
    geometry.normalX[i] = nx / length;
    geometry.normalY[i] = ny / length;
  }

  geometry.endZone = nearestUnloadingZone(xs[n - 1] ?? 0, ys[n - 1] ?? 0);
  return geometry;
}

function nearestUnloadingZone(x: number, y: number): PitZoneKind {
  let best: PitZoneKind = 'UNLOADING_CRUSHER';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const zone of [...zonesOfKind('UNLOADING_CRUSHER'), ...zonesOfKind('UNLOADING_DUMP')]) {
    const distance = Math.hypot(toLocalX(zone.center[1]) - x, toLocalY(zone.center[0]) - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = zone.kind;
    }
  }
  return best;
}

/** Индекс сегмента по пройденному расстоянию (двоичный поиск). */
export function segmentAt(route: RouteGeometry, s: number): number {
  const cum = route.cum;
  let lo = 0;
  let hi = route.pointCount - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((cum[mid] ?? 0) <= s) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

/**
 * Точка на расстоянии `s` со смещением `lateral` вправо от направления маршрута.
 * Пишет x и y в `out[0]`, `out[1]`, возвращает индекс сегмента.
 */
export function positionAt(
  route: RouteGeometry,
  s: number,
  lateral: number,
  out: Float64Array,
): number {
  const distance = s < 0 ? 0 : s > route.lengthM ? route.lengthM : s;
  const i = segmentAt(route, distance);
  const start = route.cum[i] ?? 0;
  const length = (route.cum[i + 1] ?? start) - start;
  const f = length > 0 ? (distance - start) / length : 0;
  const dirX = route.dirX[i] ?? 0;
  const dirY = route.dirY[i] ?? 0;
  let nx = (route.normalX[i] ?? 0) * (1 - f) + (route.normalX[i + 1] ?? 0) * f;
  let ny = (route.normalY[i] ?? 0) * (1 - f) + (route.normalY[i + 1] ?? 0) * f;
  const norm = Math.hypot(nx, ny);
  if (norm < 1e-3) {
    nx = dirY;
    ny = -dirX;
  } else {
    nx /= norm;
    ny /= norm;
  }
  out[0] = (route.x[i] ?? 0) + dirX * (distance - start) + nx * lateral;
  out[1] = (route.y[i] ?? 0) + dirY * (distance - start) + ny * lateral;
  return i;
}

/** Половина ширины коридора в точке маршрута: у концов (зоны) шире, плавный переход. */
export function halfWidthAt(
  route: RouteGeometry,
  s: number,
  roadHalfWidth: number,
  zoneHalfWidth: number,
  zoneExtent: number,
  blendDistance: number,
): number {
  const fromEnd = Math.min(s, route.lengthM - s);
  if (fromEnd <= zoneExtent) {
    return zoneHalfWidth;
  }
  if (fromEnd >= blendDistance) {
    return roadHalfWidth;
  }
  const k = (fromEnd - zoneExtent) / (blendDistance - zoneExtent);
  return zoneHalfWidth + (roadHalfWidth - zoneHalfWidth) * k;
}

/** Расстояние от точки до полилинии, м, и пройденное расстояние ближайшей точки. */
export function distanceToRoute(
  route: RouteGeometry,
  x: number,
  y: number,
): { distance: number; s: number } {
  let best = Number.POSITIVE_INFINITY;
  let bestS = 0;
  for (let i = 0; i < route.pointCount - 1; i += 1) {
    const ax = route.x[i] ?? 0;
    const ay = route.y[i] ?? 0;
    const length = (route.cum[i + 1] ?? 0) - (route.cum[i] ?? 0);
    const dirX = route.dirX[i] ?? 0;
    const dirY = route.dirY[i] ?? 0;
    const along = Math.min(length, Math.max(0, (x - ax) * dirX + (y - ay) * dirY));
    const distance = Math.hypot(x - (ax + dirX * along), y - (ay + dirY * along));
    if (distance < best) {
      best = distance;
      bestS = (route.cum[i] ?? 0) + along;
    }
  }
  return { distance: best, s: bestS };
}
