/**
 * Иконки показателей, групп и статусов машины: inline-SVG, viewBox 0 0 24 24, цвет через
 * `currentColor`.
 *
 * Правила набора (этап 6): только контур (`fill="none"`, `stroke="currentColor"`), толщина 1,6,
 * скругленные концы и соединения, без встроенных цветов и `style`. Рисунок должен читаться
 * в 16 px, поэтому деталей не больше трех-четырех: узнаваемость важнее буквальности.
 * Точка рисуется отрезком нулевой длины (`h.01`) - со скругленным концом это кружок толщины
 * линии, и заливка не нужна.
 *
 * Структура данных финальная: справочники показателей и групп зовут `metricIcon` и
 * `metricGroupIcon` один раз при сборке и хранят строку.
 */

const OPEN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">';

function svg(...parts: string[]): string {
  return `${OPEN}${parts.join('')}</svg>`;
}

function path(d: string): string {
  return `<path d="${d}"/>`;
}

function circle(cx: number, cy: number, r: number): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Контур шестерни: зубья трапецией, чтобы в 16 px она не превращалась в звезду. */
function gear(cx: number, cy: number, outer: number, inner: number, teeth: number): string {
  const step = (Math.PI * 2) / teeth;
  const points: string[] = [];
  for (let i = 0; i < teeth; i += 1) {
    const a = i * step;
    const corners: [number, number][] = [
      [a - step * 0.3, inner],
      [a - step * 0.16, outer],
      [a + step * 0.16, outer],
      [a + step * 0.3, inner],
    ];
    for (const [angle, radius] of corners) {
      points.push(
        `${round1(cx + radius * Math.cos(angle))} ${round1(cy + radius * Math.sin(angle))}`,
      );
    }
  }
  return path(`M${points.join('L')}Z`);
}

/* ------------------------------------------------------------------ общие детали */

/** Термометр слева с колбой внизу. */
const THERMOMETER = path('M6 4.5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0Z') + path('M8 9v7.5');

/** Капля: центр по x, верх и высота. */
function drop(cx: number, top: number, height: number): string {
  const w = height * 0.36;
  const bottom = top + height;
  const bulge = bottom - w;
  return path(
    `M${cx} ${top}C${round1(cx - w * 0.6)} ${round1(top + height * 0.35)} ${round1(cx - w)} ${round1(bulge - w * 0.4)} ${round1(cx - w)} ${round1(bulge)}a${round1(w)} ${round1(w)} 0 0 0 ${round1(w * 2)} 0C${round1(cx + w)} ${round1(bulge - w * 0.4)} ${round1(cx + w * 0.6)} ${round1(top + height * 0.35)} ${cx} ${top}Z`,
  );
}

/** Тормозной диск со ступицей и суппортом внизу. */
const BRAKE_DISC = circle(12, 12, 6) + circle(12, 12, 2) + path('M9.5 16.5h5v3.5h-5Z');

/** Уголок в углу рамки: положение колеса. Верх - перед машины, лево - левый борт. */
const CORNER = {
  FRONT_LEFT: path('M3 7.5V3h4.5'),
  FRONT_RIGHT: path('M16.5 3H21v4.5'),
  REAR_LEFT: path('M3 16.5V21h4.5'),
  REAR_RIGHT: path('M16.5 21H21v-4.5'),
} as const;

/** Самосвал сбоку, кабина справа: кузов, кабина, рама, колеса. */
const TRUCK_BODY = path('M2.5 8h11l-1.5 7H4Z');
const TRUCK_BODY_RAISED = path('M3 15.5 11.5 6.5l2.3 1.8-7.3 8.2Z');
const TRUCK_BASE =
  path('M14.5 10.5h3.5l3 3.5v3h-6.5Z') +
  path('M3 17h11.5') +
  circle(6.5, 19, 2) +
  circle(17.5, 19, 2);
const TRUCK_LOAD = path('M4.5 8c1-2.5 2.8-3.5 4.5-3.5S12.5 5.5 13 8');
const MOTION_ARROW = path('M15.5 5h5.5M18.5 2.5 21 5l-2.5 2.5');

/** Манометр: циферблат, стрелка, штуцер снизу. */
const MANOMETER =
  circle(12, 10.5, 7) + path('M12 10.5l3.2-3.2M12 17.5v4M10 21.5h4') + path('M8 7.5h.01M12 6h.01');

/* ------------------------------------------------------------------ показатели */

const METRIC_ICONS: Record<string, string> = {
  // Тахометр: полный циферблат со стрелкой и делениями - в отличие от полукруглого спидометра.
  ENGINE_RPM: svg(
    circle(12, 12, 9),
    path('M12 12l4-4'),
    path('M12 5v1.5M5 12h1.5M17.5 12H19M7 7l1 1'),
    path('M12 12h.01'),
  ),
  ENGINE_COOLANT_TEMPERATURE: svg(
    THERMOMETER,
    path('M13 12c1.2 0 1.8-1 3-1s1.8 1 3 1 1.8-1 2.5-1'),
    path('M13 16.5c1.2 0 1.8-1 3-1s1.8 1 3 1 1.8-1 2.5-1'),
  ),
  ENGINE_OIL_PRESSURE: svg(MANOMETER),
  ENGINE_OIL_TEMPERATURE: svg(THERMOMETER, drop(17.5, 7, 10)),
  // Счетчик моточасов: окошки барабанного счетчика.
  ENGINE_HOURS: svg(
    '<rect x="2.5" y="7" width="19" height="10" rx="2"/>',
    path('M8.8 7v10M15.2 7v10'),
    path('M5.6 10.5v3M12 10.5v3M18.4 10.5v3'),
  ),
  // Кулиса коробки передач.
  TRANSMISSION_GEAR: svg(
    path('M6 6.5v11M12 6.5v11M18 6.5v5.5M6 12h12'),
    circle(6, 5, 1.5),
    circle(12, 5, 1.5),
    circle(18, 5, 1.5),
    circle(6, 19, 1.5),
    circle(12, 19, 1.5),
  ),
  TRANSMISSION_OIL_TEMPERATURE: svg(gear(9, 9, 6.5, 4.8, 8), circle(9, 9, 1.8), drop(18, 12, 9.5)),
  // Шестерня со стрелкой манометра вместо отверстия.
  TRANSMISSION_SYSTEM_PRESSURE: svg(gear(12, 12, 9, 7, 10), path('M12 12l2.8-2.8M12 12h.01')),
  BRAKE_TEMPERATURE_FRONT_LEFT: svg(BRAKE_DISC, CORNER.FRONT_LEFT),
  BRAKE_TEMPERATURE_FRONT_RIGHT: svg(BRAKE_DISC, CORNER.FRONT_RIGHT),
  BRAKE_TEMPERATURE_REAR_LEFT: svg(BRAKE_DISC, CORNER.REAR_LEFT),
  BRAKE_TEMPERATURE_REAR_RIGHT: svg(BRAKE_DISC, CORNER.REAR_RIGHT),
  // Капля с уровнем.
  FUEL_LEVEL: svg(drop(12, 2.5, 19), path('M6.6 14.5h10.8')),
  // Капля в движении: мгновенный расход.
  FUEL_INSTANT_CONSUMPTION: svg(drop(9, 3.5, 17), path('M16 9h5M17.5 13H21M16 17h5')),
  // Топливная колонка: накопленный расход.
  FUEL_TOTAL_CONSUMPTION: svg(
    path('M4 21V5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v16M2.5 21h12'),
    path('M6.5 7h4v4h-4Z'),
    path('M13 10h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V8.5L17.5 6'),
  ),
  // Кузов с грузом.
  CARGO_MASS: svg(
    path('M3 10.5h18l-2 7H5Z'),
    path('M6 10.5c1.2-3 3.3-4.5 6-4.5s4.8 1.5 6 4.5'),
    path('M7 20.5h.01M17 20.5h.01'),
  ),
  // Рама сверху: колеса только у той оси, чья нагрузка показана. Перед - сверху.
  FRONT_AXLE_LOAD: svg(
    path('M12 3.5v17M6.5 6h11M9 18h6'),
    '<rect x="2.5" y="3" width="4" height="6" rx="1.2"/>',
    '<rect x="17.5" y="3" width="4" height="6" rx="1.2"/>',
  ),
  REAR_AXLE_LOAD: svg(
    path('M12 3.5v17M9 6h6M6.5 18h11'),
    '<rect x="2.5" y="15" width="4" height="6" rx="1.2"/>',
    '<rect x="17.5" y="15" width="4" height="6" rx="1.2"/>',
  ),
  // Поднятый кузов с дугой угла.
  BODY_ANGLE: svg(
    path('M2.5 17h19'),
    path('M21 16 9 9.5l1.4-2.6 11.8 6.3Z'),
    path('M12.5 17a8.5 8.5 0 0 1 1.2-4.3'),
    path('M6 20h.01M18 20h.01'),
  ),
  // Спидометр: полукруглая шкала.
  POSITION_SPEED: svg(
    path('M3.5 17a8.5 8.5 0 1 1 17 0'),
    path('M12 17l4.2-4.8'),
    path('M12 8.5V10M6 11l1 1M18 11l-1 1'),
    path('M5 20.5h14'),
  ),
  // Компас.
  POSITION_HEADING: svg(circle(12, 12, 9), path('M12 6l2.5 6-2.5 6-2.5-6Z'), path('M9.5 12h5')),
  // Широта - параллели, долгота - меридиан.
  POSITION_LATITUDE: svg(circle(12, 12, 9), path('M3.8 8.5h16.4M3.8 15.5h16.4')),
  POSITION_LONGITUDE: svg(
    circle(12, 12, 9),
    path('M12 3c-2.8 2.6-4 5.6-4 9s1.2 6.4 4 9c2.8-2.6 4-5.6 4-9s-1.2-6.4-4-9Z'),
  ),
  VEHICLE_STATUS: svg(TRUCK_BODY, TRUCK_BASE),
  // Диск с тепловыми волнами: самый горячий тормоз.
  BRAKE_TEMPERATURE_MAX: svg(
    circle(12, 15, 6),
    circle(12, 15, 2),
    path('M8.5 6c.8-.9.8-1.6 0-2.5M12 6c.8-.9.8-1.6 0-2.5M15.5 6c.8-.9.8-1.6 0-2.5'),
  ),
  // Два диска и размах между ними.
  BRAKE_TEMPERATURE_SPREAD: svg(
    circle(7, 10, 4.5),
    circle(17, 10, 4.5),
    path('M7 10h.01M17 10h.01'),
    path('M5 19.5h14M7 17.5l-2 2 2 2M17 17.5l2 2-2 2'),
  ),
  // Кузов с грузом и шкала заполнения.
  PAYLOAD_RATIO: svg(
    path('M3 8.5h18l-2 6H5Z'),
    path('M6.5 8.5c1-2.4 3-3.5 5.5-3.5s4.5 1.1 5.5 3.5'),
    path('M3.5 19.5h17M3.5 18v3M20.5 18v3M15 17.5v4'),
  ),
  // Весы: развесовка по осям.
  FRONT_AXLE_SHARE: svg(
    path('M12 4v16M8 20h8M4.5 7h15'),
    path('M4.5 7 2 13a2.5 2.5 0 0 0 5 0Z'),
    path('M19.5 7 17 13a2.5 2.5 0 0 0 5 0Z'),
  ),
  // Часы и волны сигнала: давность последних данных.
  TIME_SINCE_LAST_DATA: svg(
    circle(9, 15, 6),
    path('M9 12v3l2 1.5'),
    path('M15 3a6 6 0 0 1 6 6M15 6.5A2.5 2.5 0 0 1 17.5 9'),
  ),
  // Гаечный ключ: время до обслуживания.
  HOURS_TO_SERVICE: svg(
    path(
      'M14.7 4.3a4.5 4.5 0 0 0-1.3 5.4L4.6 18.5a1.5 1.5 0 0 0 2.1 2.1l8.8-8.8a4.5 4.5 0 0 0 5.4-1.3l-2.6-.3-1.8-1.8-.3-2.6Z',
    ),
  ),
};

/* ------------------------------------------------------------------ группы */

const GROUP_ICONS: Record<string, string> = {
  // Блок двигателя.
  ENGINE: svg(
    path('M7 8h6l2 2h3v2h2.5v4H18v2h-4l-2 2H7Z'),
    path('M3.5 11v6M3.5 14H7'),
    path('M8.5 8V5h5M11 5v3'),
  ),
  DRIVELINE: svg(gear(12, 12, 9, 6.8, 9), circle(12, 12, 2.5)),
  // Канистра.
  FUEL: svg(
    path('M5 5.5h9l5 5V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1Z'),
    path('M8 5.5V3h4v2.5'),
    path('M9 12l6 6M15 12l-6 6'),
  ),
  // Гиря.
  LOAD: svg(path('M7 9.5h10l3 11H4Z'), path('M9.5 9.5a2.5 2.5 0 1 1 5 0')),
  // Метка на карте.
  POSITION: svg(
    path('M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.3 12 21 12 21Z'),
    circle(12, 10, 2.3),
  ),
  // Сигма: расчетные показатели.
  DERIVED: svg(path('M17.5 5H6.5l6 7-6 7h11')),
};

/* ------------------------------------------------------------------ статусы машины */

const STATUS_ICONS: Record<string, string> = {
  HAULING: svg(TRUCK_BODY, TRUCK_LOAD, TRUCK_BASE, MOTION_ARROW),
  RETURNING: svg(TRUCK_BODY, TRUCK_BASE, MOTION_ARROW),
  // Стрелка в кузов.
  LOADING: svg(TRUCK_BODY, TRUCK_BASE, path('M8 1.5v4.5M5.8 4 8 6.2 10.2 4')),
  // Поднятый кузов и сыплющийся груз.
  UNLOADING: svg(TRUCK_BODY_RAISED, TRUCK_BASE, path('M1.5 13h.01M2.5 10h.01')),
  // Выхлоп: двигатель работает, машина стоит.
  IDLING: svg(TRUCK_BODY, TRUCK_BASE, circle(17, 7, 1.3), circle(20, 3.8, 1.6)),
  // Знак стоянки.
  PARKED: svg(TRUCK_BODY, TRUCK_BASE, path('M17 8.5V2.5h2a1.7 1.7 0 0 1 0 3.4h-2')),
  // Перечеркнутый сигнал.
  NO_DATA: svg(
    TRUCK_BODY,
    TRUCK_BASE,
    path('M15.5 6.5a4.5 4.5 0 0 1 5.5 0M17 8.5a2 2 0 0 1 2.5 0M15 2.5l6.5 6.5'),
  ),
};

/** Рисунок на случай неизвестного идентификатора: круг с точкой. */
export const PLACEHOLDER_ICON = svg(circle(12, 12, 8), path('M12 12h.01'));

/** Иконка показателя по идентификатору. */
export function metricIcon(metricId: string): string {
  return METRIC_ICONS[metricId] ?? PLACEHOLDER_ICON;
}

/** Иконка группы показателей по идентификатору. */
export function metricGroupIcon(groupId: string): string {
  return GROUP_ICONS[groupId] ?? PLACEHOLDER_ICON;
}

/** Иконка статуса машины (`VehicleStatus`). */
export function vehicleStatusIcon(status: string): string {
  return STATUS_ICONS[status] ?? PLACEHOLDER_ICON;
}
