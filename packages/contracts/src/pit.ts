/**
 * Карьер: центр, границы, зум, часовой пояс, технологические маршруты и зоны.
 */

export type RouteId = 'PIT_TO_CRUSHER' | 'PIT_TO_DUMP' | 'UPPER_BENCH';

export type PitZoneKind =
  | 'LOADING'
  | 'UNLOADING_CRUSHER'
  | 'UNLOADING_DUMP'
  | 'PARKING'
  | 'FUEL_STATION';

/** Точка маршрута: широта, долгота, высота над уровнем моря в метрах. */
export type RoutePoint = [lat: number, lon: number, elevation: number];

export const PIT_TIMEZONE = 'Asia/Novokuznetsk';

/** Геометрический центр чаши карьера по спутниковому снимку. */
export const PIT_CENTER: [number, number] = [55.00585, 88.45964];

/**
 * Половина стороны области в метрах: квадрат примерно 4,4 x 4,4 км вокруг центра.
 * Чуть больше четырех километров раздела 4 `CONTEXT.md`, потому что чаша карьера смещена
 * к югу относительно отвалов и промплощадки: ровно четырехкилометровый квадрат вокруг центра
 * чаши отрезал бы северный отвал.
 */
const PIT_HALF_SIDE_METERS = 2200;

const METERS_PER_DEGREE_LATITUDE = 111_320;

function metersPerDegreeLongitude(latitudeDeg: number): number {
  return METERS_PER_DEGREE_LATITUDE * Math.cos((latitudeDeg * Math.PI) / 180);
}

/** Смещение от центра карьера в метрах (x - на восток, y - на север) -> координаты. */
export function offsetToLatLon(xMeters: number, yMeters: number): [number, number] {
  const lat = PIT_CENTER[0] + yMeters / METERS_PER_DEGREE_LATITUDE;
  const lon = PIT_CENTER[1] + xMeters / metersPerDegreeLongitude(PIT_CENTER[0]);
  return [round6(lat), round6(lon)];
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Границы области: [[юг, запад], [север, восток]]. Выйти за них нельзя. */
export const PIT_BOUNDS: [[number, number], [number, number]] = [
  offsetToLatLon(-PIT_HALF_SIDE_METERS, -PIT_HALF_SIDE_METERS),
  offsetToLatLon(PIT_HALF_SIDE_METERS, PIT_HALF_SIDE_METERS),
];

/**
 * Коридор движения вокруг осевой линии маршрута, метры в каждую сторону (раздел 4 `CONTEXT.md`).
 * Машины не едут строго по осевой: иначе треки всех машин лягут в одну линию.
 */
export const ROUTE_CORRIDOR_HALF_WIDTH_METERS = 6;

/** Коридор в зонах погрузки и разгрузки шире: там машины маневрируют. */
export const ZONE_CORRIDOR_HALF_WIDTH_METERS = 15;

/** Типовая погрешность ГНСС на объекте, метры (среднеквадратичная). */
export const GNSS_NOISE_METERS = 2.5;

export const PIT_MIN_ZOOM = 13;
export const PIT_MAX_ZOOM = 18;

/**
 * Стартовый зум. В разделе 4 `CONTEXT.md` стояло 15, но выверка по снимку это не подтвердила:
 * на 15-м зуме в левую область шириной около 800 px попадает всего полкилометра, и карта
 * открывается на голом борту уступа - ни дорог, ни машин в поле зрения. На 14-м видно чашу
 * с главным съездом и работающими машинами, то есть ровно то, ради чего карта открывается.
 * Весь карьер вместе с отвалами по-прежнему виден на минимальном 13-м.
 */
export const PIT_DEFAULT_ZOOM = 14;

/** Летние условия объекта: влияют на базовую температуру ОЖ в симуляторе. */
export const PIT_AMBIENT_TEMPERATURE_C = 22;

/** Шаг разрежения маршрута: точки ставятся примерно через это расстояние. */
const ROUTE_POINT_STEP_METERS = 75;

/**
 * Осевые линии маршрутов: [широта, долгота], обведены по технологическим дорогам рудника
 * на спутниковом снимке. Число точек произвольное и шаг между ними неравномерный -
 * `buildRoute` приводит линию к равномерному шагу сам.
 */
const ROUTE_CENTERLINES: Record<RouteId, [number, number][]> = {
  // Забой на нижнем горизонте -> подъем по уступам восточного борта -> выезд -> корпуса ДСК.
  PIT_TO_CRUSHER: [
    [55.00007, 88.459353],
    [55.000253, 88.461129],
    [55.000088, 88.464178],
    [55.000306, 88.465134],
    [55.001559, 88.467789],
    [55.00162, 88.469398],
    [55.001828, 88.470126],
    [55.00277, 88.471409],
    [55.00354, 88.471817],
    [55.006505, 88.471913],
    [55.011309, 88.472523],
    [55.012226, 88.472303],
    [55.012888, 88.471787],
    [55.013832, 88.470695],
    [55.014597, 88.469094],
    [55.01469, 88.46836],
    [55.016663, 88.465195],
    [55.017846, 88.46191],
    [55.018116, 88.461933],
    [55.018277, 88.462251],
    [55.018255, 88.462889],
    [55.017933, 88.464398],
    [55.018055, 88.464671],
    [55.018234, 88.464482],
  ],
  // Тот же забой и тот же подъем до выезда -> дальше на северный отвал вскрышных пород.
  PIT_TO_DUMP: [
    [55.00007, 88.459353],
    [55.000253, 88.461129],
    [55.000088, 88.464178],
    [55.000306, 88.465134],
    [55.001559, 88.467789],
    [55.00162, 88.469398],
    [55.001828, 88.470126],
    [55.00277, 88.471409],
    [55.00354, 88.471817],
    [55.006505, 88.471913],
    [55.011309, 88.472523],
    [55.012226, 88.472303],
    [55.012888, 88.471787],
    [55.013832, 88.470695],
    [55.014597, 88.469094],
    [55.01469, 88.46836],
    [55.016663, 88.465195],
    [55.017846, 88.46191],
    [55.018116, 88.461933],
    [55.018277, 88.462251],
    [55.018255, 88.462889],
    [55.017933, 88.464398],
    [55.018055, 88.464671],
    [55.018399, 88.464269],
    [55.019612, 88.462054],
    [55.019708, 88.460522],
    [55.019469, 88.459057],
    [55.019282, 88.458526],
    [55.018141, 88.457028],
    [55.017292, 88.455393],
    [55.01753, 88.455391],
    [55.018735, 88.456356],
    [55.021961, 88.456349],
    [55.023657, 88.455909],
    [55.023892, 88.454892],
  ],
  // Короткий маршрут по верхнему горизонту: с северо-западного борта к выезду у ДСК.
  UPPER_BENCH: [
    [55.015722, 88.447857],
    [55.016115, 88.449578],
    [55.016225, 88.452703],
    [55.017005, 88.454839],
    [55.018141, 88.457028],
    [55.019282, 88.458526],
    [55.019634, 88.459793],
    [55.019708, 88.460522],
    [55.019612, 88.462054],
    [55.018399, 88.464269],
    [55.018055, 88.464671],
    [55.017933, 88.464398],
    [55.01816, 88.46348],
  ],
};

/**
 * Профиль высот маршрута: доля пройденной длины -> высота над уровнем моря, метры.
 * Доли, а не метры, чтобы профиль пережил замену осевой линии на финальную.
 *
 * Излом у маршрутов из забоя приходится на выезд из карьера: до него идет подъем по уступам
 * (180 м на внутрикарьерной части, раздел 4 `CONTEXT.md`), после - рельеф поверхности.
 */
const ROUTE_ELEVATION_PROFILES: Record<RouteId, [fraction: number, elevation: number][]> = {
  PIT_TO_CRUSHER: [
    [0, 660],
    [0.84, 840],
    [1, 840],
  ],
  PIT_TO_DUMP: [
    [0, 660],
    [0.562, 840],
    [1, 820],
  ],
  UPPER_BENCH: [
    [0, 800],
    [1, 840],
  ],
};

const ROUTE_NAMES: Record<RouteId, string> = {
  PIT_TO_CRUSHER: 'Забой - ДСК',
  PIT_TO_DUMP: 'Забой - северный отвал',
  UPPER_BENCH: 'Верхний горизонт',
};

export interface PitRoute {
  id: RouteId;
  /** Название на русском. */
  name: string;
  /** Полилиния: точка примерно каждые 50-100 метров. */
  points: RoutePoint[];
  /** Накопленное расстояние от начала маршрута до каждой точки, метры. */
  cumulativeMeters: number[];
  /** Полная длина маршрута, метры. */
  lengthMeters: number;
  /** Суммарный набор высоты от начала к концу, метры. */
  elevationGainMeters: number;
}

const EARTH_RADIUS_METERS = 6_371_008.8;

/** Расстояние между двумя точками по поверхности, метры. */
export function haversineMeters(a: RoutePoint, b: RoutePoint): number {
  const toRad = Math.PI / 180;
  const lat1 = a[0] * toRad;
  const lat2 = b[0] * toRad;
  const dLat = lat2 - lat1;
  const dLon = (b[1] - a[1]) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Длина сегмента маршрута между точками index и index + 1, метры. */
export function segmentLengthMeters(route: PitRoute, index: number): number {
  const from = route.points[index];
  const to = route.points[index + 1];
  if (from === undefined || to === undefined) {
    return 0;
  }
  return haversineMeters(from, to);
}

/** Расстояние между двумя точками осевой линии, метры. */
function centerlineDistance(a: [number, number], b: [number, number]): number {
  return haversineMeters([a[0], a[1], 0], [b[0], b[1], 0]);
}

/**
 * Разрежение осевой линии: каждый исходный сегмент делится на равные части не длиннее
 * `stepMeters`. Обведенная по снимку дорога идет то густыми точками на серпантине, то
 * редкими на прямой, и без разрежения прямые остались бы одним сегментом в полкилометра.
 *
 * Делим именно по сегментам, а не выборкой через равные расстояния по всей длине: выборка
 * срезала бы углы на серпантинах восточного борта (хорда между двумя точками, лежащими по
 * разные стороны шпильки, заметно короче дуги), и маршрут терял бы и форму, и длину. Здесь
 * все исходные вершины остаются на месте, поэтому геометрия и длина сохраняются точно,
 * а результат не зависит от того, сколько точек было в исходной линии.
 */
function resample(centerline: [number, number][], stepMeters: number): [number, number][] {
  if (centerline.length < 2) {
    return centerline.map((point) => [point[0], point[1]]);
  }
  const result: [number, number][] = [];
  for (let i = 0; i < centerline.length - 1; i += 1) {
    const from = centerline[i] as [number, number];
    const to = centerline[i + 1] as [number, number];
    const parts = Math.max(1, Math.ceil(centerlineDistance(from, to) / stepMeters));
    for (let p = 0; p < parts; p += 1) {
      const k = p / parts;
      result.push([from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k]);
    }
  }
  const last = centerline[centerline.length - 1] as [number, number];
  result.push([last[0], last[1]]);
  return result;
}

/** Высота по профилю на доле длины маршрута. */
function elevationAtFraction(profile: [number, number][], fraction: number): number {
  const first = profile[0];
  if (first === undefined) {
    return 0;
  }
  if (fraction <= first[0]) {
    return first[1];
  }
  for (let i = 1; i < profile.length; i += 1) {
    const from = profile[i - 1] as [number, number];
    const to = profile[i] as [number, number];
    if (fraction <= to[0]) {
      const span = to[0] - from[0];
      const k = span > 0 ? (fraction - from[0]) / span : 0;
      return from[1] + (to[1] - from[1]) * k;
    }
  }
  return (profile[profile.length - 1] as [number, number])[1];
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function buildRoute(id: RouteId): PitRoute {
  const line = resample(ROUTE_CENTERLINES[id], ROUTE_POINT_STEP_METERS);

  // Сначала длины, потом высоты: высота точки зависит от ее доли в полной длине.
  const cumulativeMeters: number[] = [0];
  let total = 0;
  for (let i = 0; i < line.length - 1; i += 1) {
    const from = line[i] as [number, number];
    const to = line[i + 1] as [number, number];
    total += centerlineDistance(from, to);
    cumulativeMeters.push(total);
  }

  const profile = ROUTE_ELEVATION_PROFILES[id];
  const points: RoutePoint[] = line.map((point, index) => {
    const fraction = total > 0 ? (cumulativeMeters[index] ?? 0) / total : 0;
    return [point[0], point[1], round1(elevationAtFraction(profile, fraction))];
  });

  const first = points[0];
  const last = points[points.length - 1];
  const gain = first !== undefined && last !== undefined ? last[2] - first[2] : 0;
  return {
    id,
    name: ROUTE_NAMES[id],
    points,
    cumulativeMeters,
    lengthMeters: total,
    elevationGainMeters: round1(gain),
  };
}

export const PIT_ROUTES: Record<RouteId, PitRoute> = {
  PIT_TO_CRUSHER: buildRoute('PIT_TO_CRUSHER'),
  PIT_TO_DUMP: buildRoute('PIT_TO_DUMP'),
  UPPER_BENCH: buildRoute('UPPER_BENCH'),
};

export const ROUTE_IDS: RouteId[] = Object.keys(PIT_ROUTES) as RouteId[];

export interface RoutePosition {
  lat: number;
  lon: number;
  elevation: number;
  /** Индекс сегмента, внутри которого находится точка. */
  segmentIndex: number;
  /** Положение внутри сегмента, 0..1. */
  segmentFraction: number;
}

function clampDistance(route: PitRoute, distanceMeters: number): number {
  if (!Number.isFinite(distanceMeters)) {
    return 0;
  }
  return Math.min(Math.max(distanceMeters, 0), route.lengthMeters);
}

/** Индекс сегмента, на который попадает пройденное расстояние (двоичный поиск). */
function findSegment(route: PitRoute, distanceMeters: number): number {
  const cum = route.cumulativeMeters;
  let lo = 0;
  let hi = cum.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((cum[mid] ?? 0) <= distanceMeters) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return Math.max(0, lo);
}

/** Позиция на маршруте по пройденному расстоянию. */
export function routePositionAt(route: PitRoute, distanceMeters: number): RoutePosition {
  const distance = clampDistance(route, distanceMeters);
  const index = findSegment(route, distance);
  const from = route.points[index];
  const to = route.points[index + 1] ?? from;
  const segmentStart = route.cumulativeMeters[index] ?? 0;
  const segmentLength = (route.cumulativeMeters[index + 1] ?? segmentStart) - segmentStart;
  const fraction = segmentLength > 0 ? (distance - segmentStart) / segmentLength : 0;
  if (from === undefined || to === undefined) {
    return {
      lat: PIT_CENTER[0],
      lon: PIT_CENTER[1],
      elevation: 0,
      segmentIndex: 0,
      segmentFraction: 0,
    };
  }
  return {
    lat: from[0] + (to[0] - from[0]) * fraction,
    lon: from[1] + (to[1] - from[1]) * fraction,
    elevation: from[2] + (to[2] - from[2]) * fraction,
    segmentIndex: index,
    segmentFraction: fraction,
  };
}

/**
 * Уклон в точке маршрута, проценты: положительный на подъеме, отрицательный на спуске.
 * Это основной вход физической модели симулятора.
 */
export function routeGradeAt(route: PitRoute, distanceMeters: number): number {
  const index = findSegment(route, clampDistance(route, distanceMeters));
  const from = route.points[index];
  const to = route.points[index + 1];
  if (from === undefined || to === undefined) {
    return 0;
  }
  const run = haversineMeters(from, to);
  if (run === 0) {
    return 0;
  }
  return ((to[2] - from[2]) / run) * 100;
}

/** Курс в точке маршрута, градусы от севера по часовой стрелке. */
export function routeHeadingAt(route: PitRoute, distanceMeters: number): number {
  const index = findSegment(route, clampDistance(route, distanceMeters));
  const from = route.points[index];
  const to = route.points[index + 1] ?? from;
  if (from === undefined || to === undefined) {
    return 0;
  }
  const toRad = Math.PI / 180;
  const lat1 = from[0] * toRad;
  const lat2 = to[0] * toRad;
  const dLon = (to[1] - from[1]) * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export interface PitZone {
  id: string;
  kind: PitZoneKind;
  /** Название на русском. */
  name: string;
  center: [number, number];
  radiusMeters: number;
  /** Штатная длительность стоянки в зоне, секунды (раздел 4 `CONTEXT.md`). */
  dwellSeconds: [min: number, max: number];
}

/** Зоны привязаны к объектам, опознанным на снимке (см. заголовок файла). */
export const PIT_ZONES: PitZone[] = [
  {
    id: 'zone-loading',
    kind: 'LOADING',
    name: 'Забой (погрузка)',
    center: [55.00007, 88.459353],
    radiusMeters: 60,
    dwellSeconds: [120, 240],
  },
  {
    id: 'zone-crusher',
    kind: 'UNLOADING_CRUSHER',
    name: 'ДСК (разгрузка руды)',
    center: [55.018234, 88.464482],
    radiusMeters: 50,
    dwellSeconds: [60, 120],
  },
  {
    id: 'zone-dump',
    kind: 'UNLOADING_DUMP',
    name: 'Северный отвал (разгрузка вскрыши)',
    center: [55.023892, 88.454892],
    radiusMeters: 50,
    dwellSeconds: [60, 120],
  },
  {
    id: 'zone-parking',
    kind: 'PARKING',
    name: 'Стоянка и пересменка',
    center: [55.01982, 88.47636],
    radiusMeters: 80,
    dwellSeconds: [600, 3600],
  },
  {
    id: 'zone-fuel',
    kind: 'FUEL_STATION',
    name: 'Заправка',
    center: [55.0203, 88.4745],
    radiusMeters: 40,
    dwellSeconds: [600, 1200],
  },
];

/** Виды зон в фиксированном порядке: используется для компактного кодирования зоны. */
export const PIT_ZONE_KINDS: PitZoneKind[] = [
  'LOADING',
  'UNLOADING_CRUSHER',
  'UNLOADING_DUMP',
  'PARKING',
  'FUEL_STATION',
];

/** Метров на градус долготы на широте карьера - для перевода смещений в коридоре. */
export const PIT_METERS_PER_DEGREE_LONGITUDE = metersPerDegreeLongitude(PIT_CENTER[0]);

export const PIT_METERS_PER_DEGREE_LATITUDE = METERS_PER_DEGREE_LATITUDE;

export function getRoute(id: RouteId): PitRoute {
  return PIT_ROUTES[id];
}

/** Зоны указанного вида. */
export function zonesOfKind(kind: PitZoneKind): PitZone[] {
  return PIT_ZONES.filter((zone) => zone.kind === kind);
}
