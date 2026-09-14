/**
 * Единицы измерения: группы, определения единиц, конвертация и форматирование.
 *
 * Модель намеренно минимальная (раздел 2 `SPEC.md`): единица принадлежит ровно одной группе,
 * у группы есть базовая единица - та, в которой данные приходят с борта и хранятся на сервере.
 * Пересчет линейный:
 *
 *   value_in_unit = value_in_base * factor + offset
 *
 * Этого достаточно для всех наших групп, включая температуру (Цельсий - Фаренгейт - Кельвин).
 * Конвертация между разными группами запрещена и типами, и проверкой во время выполнения.
 */

/**
 * Состав групп единиц. Первая единица в каждой строке - базовая (см. `UNIT_GROUPS`).
 *
 * Группа `STATE` добавлена сверх минимального состава из `SPEC.md`: она нужна показателю
 * `VEHICLE_STATUS`, у которого физической единицы нет, но поле `unitId` в реестре обязательно.
 */
export interface UnitGroupUnits {
  TEMPERATURE: 'CELSIUS' | 'FAHRENHEIT' | 'KELVIN';
  PRESSURE: 'BAR' | 'KPA' | 'PSI';
  MASS: 'KILOGRAM' | 'TONNE' | 'POUND';
  VOLUME: 'LITER' | 'CUBIC_METER' | 'GALLON';
  SPEED: 'KILOMETERS_PER_HOUR' | 'METERS_PER_SECOND' | 'MPH';
  FLOW: 'LITERS_PER_HOUR';
  ANGLE: 'DEGREE';
  TIME: 'HOUR' | 'MINUTE' | 'SECOND';
  RATIO: 'PERCENT';
  ROTATION: 'RPM';
  GEAR: 'GEAR';
  COORDINATE: 'DEGREE_LATITUDE' | 'DEGREE_LONGITUDE';
  STATE: 'STATE_CODE';
}

export type UnitGroupId = keyof UnitGroupUnits;

export type UnitId = UnitGroupUnits[UnitGroupId];

/** Все единицы указанной группы. */
export type UnitIdOfGroup<G extends UnitGroupId> = UnitGroupUnits[G];

/** Группа, которой принадлежит единица. */
export type GroupOfUnit<U extends UnitId> = {
  [G in UnitGroupId]: U extends UnitGroupUnits[G] ? G : never;
}[UnitGroupId];

export interface UnitGroupDef {
  id: UnitGroupId;
  /** Название группы на русском. */
  name: string;
  /** Единица, в которой приходят и хранятся данные. */
  baseUnitId: UnitId;
}

export interface UnitDef {
  id: UnitId;
  groupId: UnitGroupId;
  /** Символ для подписи значения. */
  symbol: string;
  /** Полное название на русском. */
  name: string;
  /** value_in_unit = value_in_base * factor + offset */
  factor: number;
  offset: number;
  /** Знаков после запятой по умолчанию. */
  precision: number;
}

export const UNIT_GROUPS: Record<UnitGroupId, UnitGroupDef> = {
  TEMPERATURE: { id: 'TEMPERATURE', name: 'Температура', baseUnitId: 'CELSIUS' },
  PRESSURE: { id: 'PRESSURE', name: 'Давление', baseUnitId: 'BAR' },
  MASS: { id: 'MASS', name: 'Масса', baseUnitId: 'KILOGRAM' },
  VOLUME: { id: 'VOLUME', name: 'Объем', baseUnitId: 'LITER' },
  SPEED: { id: 'SPEED', name: 'Скорость', baseUnitId: 'KILOMETERS_PER_HOUR' },
  FLOW: { id: 'FLOW', name: 'Расход', baseUnitId: 'LITERS_PER_HOUR' },
  ANGLE: { id: 'ANGLE', name: 'Угол', baseUnitId: 'DEGREE' },
  TIME: { id: 'TIME', name: 'Время', baseUnitId: 'HOUR' },
  RATIO: { id: 'RATIO', name: 'Доля', baseUnitId: 'PERCENT' },
  ROTATION: { id: 'ROTATION', name: 'Частота вращения', baseUnitId: 'RPM' },
  GEAR: { id: 'GEAR', name: 'Передача', baseUnitId: 'GEAR' },
  COORDINATE: { id: 'COORDINATE', name: 'Координата', baseUnitId: 'DEGREE_LATITUDE' },
  STATE: { id: 'STATE', name: 'Состояние', baseUnitId: 'STATE_CODE' },
};

export const UNITS: Record<UnitId, UnitDef> = {
  // Температура
  CELSIUS: {
    id: 'CELSIUS',
    groupId: 'TEMPERATURE',
    symbol: 'C',
    name: 'градус Цельсия',
    factor: 1,
    offset: 0,
    precision: 1,
  },
  FAHRENHEIT: {
    id: 'FAHRENHEIT',
    groupId: 'TEMPERATURE',
    symbol: 'F',
    name: 'градус Фаренгейта',
    factor: 1.8,
    offset: 32,
    precision: 1,
  },
  KELVIN: {
    id: 'KELVIN',
    groupId: 'TEMPERATURE',
    symbol: 'K',
    name: 'кельвин',
    factor: 1,
    offset: 273.15,
    precision: 1,
  },
  // Давление
  BAR: {
    id: 'BAR',
    groupId: 'PRESSURE',
    symbol: 'бар',
    name: 'бар',
    factor: 1,
    offset: 0,
    precision: 2,
  },
  KPA: {
    id: 'KPA',
    groupId: 'PRESSURE',
    symbol: 'кПа',
    name: 'килопаскаль',
    factor: 100,
    offset: 0,
    precision: 0,
  },
  PSI: {
    id: 'PSI',
    groupId: 'PRESSURE',
    symbol: 'psi',
    name: 'фунт на квадратный дюйм',
    factor: 14.503773773,
    offset: 0,
    precision: 1,
  },
  // Масса
  KILOGRAM: {
    id: 'KILOGRAM',
    groupId: 'MASS',
    symbol: 'кг',
    name: 'килограмм',
    factor: 1,
    offset: 0,
    precision: 0,
  },
  TONNE: {
    id: 'TONNE',
    groupId: 'MASS',
    symbol: 'т',
    name: 'тонна',
    factor: 0.001,
    offset: 0,
    precision: 1,
  },
  POUND: {
    id: 'POUND',
    groupId: 'MASS',
    symbol: 'фунт',
    name: 'фунт',
    factor: 2.2046226218,
    offset: 0,
    precision: 0,
  },
  // Объем
  LITER: {
    id: 'LITER',
    groupId: 'VOLUME',
    symbol: 'л',
    name: 'литр',
    factor: 1,
    offset: 0,
    precision: 0,
  },
  CUBIC_METER: {
    id: 'CUBIC_METER',
    groupId: 'VOLUME',
    symbol: 'м3',
    name: 'кубический метр',
    factor: 0.001,
    offset: 0,
    precision: 2,
  },
  GALLON: {
    id: 'GALLON',
    groupId: 'VOLUME',
    symbol: 'гал',
    name: 'галлон США',
    factor: 0.2641720524,
    offset: 0,
    precision: 0,
  },
  // Скорость
  KILOMETERS_PER_HOUR: {
    id: 'KILOMETERS_PER_HOUR',
    groupId: 'SPEED',
    symbol: 'км/ч',
    name: 'километр в час',
    factor: 1,
    offset: 0,
    precision: 1,
  },
  METERS_PER_SECOND: {
    id: 'METERS_PER_SECOND',
    groupId: 'SPEED',
    symbol: 'м/с',
    name: 'метр в секунду',
    factor: 1 / 3.6,
    offset: 0,
    precision: 1,
  },
  MPH: {
    id: 'MPH',
    groupId: 'SPEED',
    symbol: 'миль/ч',
    name: 'миля в час',
    factor: 0.6213711922,
    offset: 0,
    precision: 1,
  },
  // Расход
  LITERS_PER_HOUR: {
    id: 'LITERS_PER_HOUR',
    groupId: 'FLOW',
    symbol: 'л/ч',
    name: 'литр в час',
    factor: 1,
    offset: 0,
    precision: 1,
  },
  // Угол
  DEGREE: {
    id: 'DEGREE',
    groupId: 'ANGLE',
    symbol: 'град',
    name: 'градус',
    factor: 1,
    offset: 0,
    precision: 1,
  },
  // Время
  HOUR: {
    id: 'HOUR',
    groupId: 'TIME',
    symbol: 'ч',
    name: 'час',
    factor: 1,
    offset: 0,
    precision: 1,
  },
  MINUTE: {
    id: 'MINUTE',
    groupId: 'TIME',
    symbol: 'мин',
    name: 'минута',
    factor: 60,
    offset: 0,
    precision: 0,
  },
  SECOND: {
    id: 'SECOND',
    groupId: 'TIME',
    symbol: 'с',
    name: 'секунда',
    factor: 3600,
    offset: 0,
    precision: 0,
  },
  // Доля
  PERCENT: {
    id: 'PERCENT',
    groupId: 'RATIO',
    symbol: '%',
    name: 'процент',
    factor: 1,
    offset: 0,
    precision: 1,
  },
  // Частота вращения
  RPM: {
    id: 'RPM',
    groupId: 'ROTATION',
    symbol: 'об/мин',
    name: 'оборот в минуту',
    factor: 1,
    offset: 0,
    precision: 0,
  },
  // Передача
  GEAR: {
    id: 'GEAR',
    groupId: 'GEAR',
    symbol: '',
    name: 'номер передачи',
    factor: 1,
    offset: 0,
    precision: 0,
  },
  // Координаты
  DEGREE_LATITUDE: {
    id: 'DEGREE_LATITUDE',
    groupId: 'COORDINATE',
    symbol: 'град с.ш.',
    name: 'градус широты',
    factor: 1,
    offset: 0,
    precision: 6,
  },
  DEGREE_LONGITUDE: {
    id: 'DEGREE_LONGITUDE',
    groupId: 'COORDINATE',
    symbol: 'град в.д.',
    name: 'градус долготы',
    factor: 1,
    offset: 0,
    precision: 6,
  },
  // Состояние
  STATE_CODE: {
    id: 'STATE_CODE',
    groupId: 'STATE',
    symbol: '',
    name: 'код состояния',
    factor: 1,
    offset: 0,
    precision: 0,
  },
};

export const UNIT_IDS: UnitId[] = Object.keys(UNITS) as UnitId[];

export function getUnit(id: UnitId): UnitDef {
  return UNITS[id];
}

export function getUnitGroup(id: UnitGroupId): UnitGroupDef {
  return UNIT_GROUPS[id];
}

/** Единицы одной группы. */
export function unitsOfGroup(groupId: UnitGroupId): UnitDef[] {
  return UNIT_IDS.map((id) => UNITS[id]).filter((unit) => unit.groupId === groupId);
}

/** Из базовой единицы группы в указанную. */
export function fromBase(value: number, unitId: UnitId): number {
  const unit = UNITS[unitId];
  return value * unit.factor + unit.offset;
}

/** Из указанной единицы в базовую единицу группы. */
export function toBase(value: number, unitId: UnitId): number {
  const unit = UNITS[unitId];
  return (value - unit.offset) / unit.factor;
}

/**
 * Конвертация внутри одной группы. Между группами конвертировать нельзя:
 * типы это запрещают, а на случай данных из внешнего мира есть проверка во время выполнения.
 */
export function convert<U extends UnitId>(
  value: number,
  from: U,
  to: UnitIdOfGroup<GroupOfUnit<U>>,
): number {
  const fromUnit = UNITS[from];
  const toUnit = UNITS[to as UnitId];
  if (fromUnit.groupId !== toUnit.groupId) {
    throw new Error(
      `Нельзя конвертировать ${fromUnit.name} (группа ${fromUnit.groupId}) в ${toUnit.name} (группа ${toUnit.groupId}): разные группы единиц`,
    );
  }
  return fromBase(toBase(value, from), to as UnitId);
}

/** Минимум, который нужен `formatValue` от показателя: во что переводить и с какой точностью. */
export interface UnitFormatSpec {
  /** Единица хранения значения (базовая для группы). */
  unitId: UnitId;
  /** Единица отображения по умолчанию. */
  displayUnitId: UnitId;
  precision: number;
}

export interface FormatOptions {
  /** Переопределить единицу отображения. */
  unitId?: UnitId;
  /** Переопределить число знаков после запятой. */
  precision?: number;
  /** Добавлять символ единицы (по умолчанию да). */
  withUnit?: boolean;
  /** Разделять разряды пробелом (по умолчанию да). */
  grouping?: boolean;
  /** Чем заменить отсутствующее значение. */
  nullText?: string;
}

/** Разделители по-русски: запятая в дробной части, пробел между разрядами и перед единицей. */
const DECIMAL_SEPARATOR = ',';
const GROUP_SEPARATOR = ' ';
const DEFAULT_NULL_TEXT = '-';

function formatNumber(value: number, precision: number, grouping: boolean): string {
  const fixed = Math.abs(value).toFixed(precision);
  const dot = fixed.indexOf('.');
  const intPart = dot === -1 ? fixed : fixed.slice(0, dot);
  const fracPart = dot === -1 ? '' : fixed.slice(dot + 1);
  const groupedInt = grouping ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR) : intPart;
  const sign = value < 0 && Number.parseFloat(fixed) !== 0 ? '-' : '';
  return fracPart.length > 0
    ? `${sign}${groupedInt}${DECIMAL_SEPARATOR}${fracPart}`
    : `${sign}${groupedInt}`;
}

/**
 * Значение в базовой единице -> строка для интерфейса.
 *
 * Вторым аргументом принимается либо идентификатор единицы, либо описание показателя
 * (`MetricDef` подходит структурно - см. `formatMetricValue` в `metrics.ts`).
 */
export function formatValue(
  value: number | null | undefined,
  unitOrSpec: UnitId | UnitFormatSpec,
  options: FormatOptions = {},
): string {
  const spec: UnitFormatSpec =
    typeof unitOrSpec === 'string'
      ? { unitId: unitOrSpec, displayUnitId: unitOrSpec, precision: UNITS[unitOrSpec].precision }
      : unitOrSpec;
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return options.nullText ?? DEFAULT_NULL_TEXT;
  }
  const targetUnitId = options.unitId ?? spec.displayUnitId;
  const target = UNITS[targetUnitId];
  const source = UNITS[spec.unitId];
  if (source.groupId !== target.groupId) {
    throw new Error(
      `Нельзя отформатировать значение в ${source.name} как ${target.name}: разные группы единиц`,
    );
  }
  const converted = fromBase(toBase(value, spec.unitId), targetUnitId);
  const precision =
    options.precision ?? (targetUnitId === spec.displayUnitId ? spec.precision : target.precision);
  const text = formatNumber(converted, precision, options.grouping ?? true);
  const withUnit = options.withUnit ?? true;
  return withUnit && target.symbol.length > 0 ? `${text} ${target.symbol}` : text;
}
