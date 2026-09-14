/**
 * Реестр показателей: 23 физических (приходят с борта) и 7 производных (считаются сервером).
 *
 * Состав и смысл - разделы 6.1 и 6.2 `CONTEXT.md`, поля записи - раздел 3 `SPEC.md`.
 * Нормативы вынесены в `thresholds.ts`, формулы производных - в `derived.ts`.
 */

import { metricIcon } from './icons.js';
import type { MetricGroupId } from './metric-groups.js';
import { type FormatOptions, formatValue, type UnitId } from './units.js';

export type MetricKind = 'instant' | 'counter' | 'state' | 'coordinate' | 'derived';

export type MetricAggregation = 'avg' | 'last' | 'max' | 'sum';

export type WorseDirection = 'up' | 'down' | 'both' | 'none';

/** Паспортная величина модели, от которой считается норматив в процентах. */
export type RelativeBase = 'ratedPayload' | 'grossWeight';

export type PhysicalMetricId =
  | 'ENGINE_RPM'
  | 'ENGINE_COOLANT_TEMPERATURE'
  | 'ENGINE_OIL_PRESSURE'
  | 'ENGINE_OIL_TEMPERATURE'
  | 'ENGINE_HOURS'
  | 'TRANSMISSION_GEAR'
  | 'TRANSMISSION_OIL_TEMPERATURE'
  | 'TRANSMISSION_SYSTEM_PRESSURE'
  | 'BRAKE_TEMPERATURE_FRONT_LEFT'
  | 'BRAKE_TEMPERATURE_FRONT_RIGHT'
  | 'BRAKE_TEMPERATURE_REAR_LEFT'
  | 'BRAKE_TEMPERATURE_REAR_RIGHT'
  | 'FUEL_LEVEL'
  | 'FUEL_INSTANT_CONSUMPTION'
  | 'FUEL_TOTAL_CONSUMPTION'
  | 'CARGO_MASS'
  | 'FRONT_AXLE_LOAD'
  | 'REAR_AXLE_LOAD'
  | 'BODY_ANGLE'
  | 'POSITION_SPEED'
  | 'POSITION_HEADING'
  | 'POSITION_LATITUDE'
  | 'POSITION_LONGITUDE';

export type DerivedMetricId =
  | 'VEHICLE_STATUS'
  | 'BRAKE_TEMPERATURE_MAX'
  | 'BRAKE_TEMPERATURE_SPREAD'
  | 'PAYLOAD_RATIO'
  | 'FRONT_AXLE_SHARE'
  | 'TIME_SINCE_LAST_DATA'
  | 'HOURS_TO_SERVICE';

export type MetricId = PhysicalMetricId | DerivedMetricId;

export interface MetricDef {
  id: MetricId;
  groupId: MetricGroupId;
  /** Полное название на русском. */
  name: string;
  /** Короткое название для плашек и осей. */
  shortName: string;
  /** Единица хранения (базовая для группы). */
  unitId: UnitId;
  /** Единица отображения по умолчанию. */
  displayUnitId: UnitId;
  precision: number;
  kind: MetricKind;
  worseDirection: WorseDirection;
  /** Участвует ли в расчете светофора (раздел 7 `CONTEXT.md`). */
  severityRelevant: boolean;
  /** Частота опроса: видна на графиках ступеньками, часть реализма. */
  sampleRateHz: 1 | 0.2;
  /** Как сворачивать значения в бакет при агрегации. */
  aggregation: MetricAggregation;
  /** Нормативы задаются в процентах от паспортной величины модели. */
  relativeTo?: RelativeBase;
  /** Из чего считается производный показатель. */
  derivedFrom?: MetricId[];
  /** Порядок на плашке списка машин (раздел 9.1 `CONTEXT.md`), если показывается. */
  card?: number;
  /** inline-SVG, viewBox 0 0 24 24, currentColor. */
  icon: string;
  /**
   * Адрес первого Modbus-регистра. Не бизнес-семантика, нужен для диагностики и достоверности.
   * Блоки по группам: двигатель с 40001, трансмиссия с 40101, топливо с 40201,
   * груз с 40301, позиционирование с 40401; шаг 2 регистра на значение.
   */
  registerAddress?: number;
}

export const METRICS: Record<MetricId, MetricDef> = {
  // --- Двигатель -------------------------------------------------------------------------
  ENGINE_RPM: {
    id: 'ENGINE_RPM',
    groupId: 'ENGINE',
    name: 'Обороты двигателя',
    shortName: 'Обороты',
    unitId: 'RPM',
    displayUnitId: 'RPM',
    precision: 0,
    kind: 'instant',
    worseDirection: 'up',
    severityRelevant: true,
    sampleRateHz: 1,
    aggregation: 'avg',
    icon: metricIcon('ENGINE_RPM'),
    registerAddress: 40001,
  },
  ENGINE_COOLANT_TEMPERATURE: {
    id: 'ENGINE_COOLANT_TEMPERATURE',
    groupId: 'ENGINE',
    name: 'Температура охлаждающей жидкости',
    shortName: 'Темп. ОЖ',
    unitId: 'CELSIUS',
    displayUnitId: 'CELSIUS',
    precision: 1,
    kind: 'instant',
    worseDirection: 'up',
    severityRelevant: true,
    sampleRateHz: 1,
    aggregation: 'avg',
    card: 3,
    icon: metricIcon('ENGINE_COOLANT_TEMPERATURE'),
    registerAddress: 40003,
  },
  ENGINE_OIL_PRESSURE: {
    id: 'ENGINE_OIL_PRESSURE',
    groupId: 'ENGINE',
    name: 'Давление масла двигателя',
    shortName: 'Давл. масла',
    unitId: 'BAR',
    displayUnitId: 'BAR',
    precision: 1,
    kind: 'instant',
    worseDirection: 'down',
    severityRelevant: true,
    sampleRateHz: 1,
    aggregation: 'avg',
    card: 6,
    icon: metricIcon('ENGINE_OIL_PRESSURE'),
    registerAddress: 40005,
  },
  ENGINE_OIL_TEMPERATURE: {
    id: 'ENGINE_OIL_TEMPERATURE',
    groupId: 'ENGINE',
    name: 'Температура масла двигателя',
    shortName: 'Темп. масла дв.',
    unitId: 'CELSIUS',
    displayUnitId: 'CELSIUS',
    precision: 1,
    kind: 'instant',
    worseDirection: 'up',
    severityRelevant: true,
    sampleRateHz: 1,
    aggregation: 'avg',
    icon: metricIcon('ENGINE_OIL_TEMPERATURE'),
    registerAddress: 40007,
  },
  ENGINE_HOURS: {
    id: 'ENGINE_HOURS',
    groupId: 'ENGINE',
    name: 'Наработка двигателя',
    shortName: 'Моточасы',
    unitId: 'HOUR',
    displayUnitId: 'HOUR',
    precision: 1,
    kind: 'counter',
    worseDirection: 'none',
    severityRelevant: false,
    sampleRateHz: 1,
    aggregation: 'last',
    icon: metricIcon('ENGINE_HOURS'),
    registerAddress: 40009,
  },
  // --- Трансмиссия и ходовая -------------------------------------------------------------
  TRANSMISSION_GEAR: {
    id: 'TRANSMISSION_GEAR',
    groupId: 'DRIVELINE',
    name: 'Включенная передача',
    shortName: 'Передача',
    unitId: 'GEAR',
    displayUnitId: 'GEAR',
    precision: 0,
    kind: 'state',
    worseDirection: 'none',
    severityRelevant: false,
    sampleRateHz: 1,
    aggregation: 'last',
    icon: metricIcon('TRANSMISSION_GEAR'),
    registerAddress: 40101,
  },
  TRANSMISSION_OIL_TEMPERATURE: {
    id: 'TRANSMISSION_OIL_TEMPERATURE',
    groupId: 'DRIVELINE',
    name: 'Температура масла трансмиссии',
    shortName: 'Темп. трансм.',
    unitId: 'CELSIUS',
    displayUnitId: 'CELSIUS',
    precision: 1,
    kind: 'instant',
    worseDirection: 'up',
    severityRelevant: true,
    sampleRateHz: 1,
    aggregation: 'avg',
    card: 4,
    icon: metricIcon('TRANSMISSION_OIL_TEMPERATURE'),
    registerAddress: 40103,
  },
  TRANSMISSION_SYSTEM_PRESSURE: {
    id: 'TRANSMISSION_SYSTEM_PRESSURE',
    groupId: 'DRIVELINE',
    name: 'Давление в системе трансмиссии',
    shortName: 'Давл. трансм.',
    unitId: 'BAR',
    displayUnitId: 'BAR',
    precision: 1,
    kind: 'instant',
    worseDirection: 'down',
    severityRelevant: true,
    sampleRateHz: 1,
    aggregation: 'avg',
    icon: metricIcon('TRANSMISSION_SYSTEM_PRESSURE'),
    registerAddress: 40105,
  },
  BRAKE_TEMPERATURE_FRONT_LEFT: {
    id: 'BRAKE_TEMPERATURE_FRONT_LEFT',
    groupId: 'DRIVELINE',
    name: 'Температура тормоза переднего левого',
    shortName: 'Тормоз ПЛ',
    unitId: 'CELSIUS',
    displayUnitId: 'CELSIUS',
    precision: 0,
    kind: 'instant',
    worseDirection: 'up',
    severityRelevant: true,
    sampleRateHz: 1,
    aggregation: 'max',
    icon: metricIcon('BRAKE_TEMPERATURE_FRONT_LEFT'),
    registerAddress: 40107,
  },
  BRAKE_TEMPERATURE_FRONT_RIGHT: {
    id: 'BRAKE_TEMPERATURE_FRONT_RIGHT',
    groupId: 'DRIVELINE',
    name: 'Температура тормоза переднего правого',
    shortName: 'Тормоз ПП',
    unitId: 'CELSIUS',
    displayUnitId: 'CELSIUS',
    precision: 0,
    kind: 'instant',
    worseDirection: 'up',
    severityRelevant: true,
    sampleRateHz: 1,
    aggregation: 'max',
    icon: metricIcon('BRAKE_TEMPERATURE_FRONT_RIGHT'),
    registerAddress: 40109,
  },
  BRAKE_TEMPERATURE_REAR_LEFT: {
    id: 'BRAKE_TEMPERATURE_REAR_LEFT',
    groupId: 'DRIVELINE',
    name: 'Температура тормоза заднего левого',
    shortName: 'Тормоз ЗЛ',
    unitId: 'CELSIUS',
    displayUnitId: 'CELSIUS',
    precision: 0,
    kind: 'instant',
    worseDirection: 'up',
    severityRelevant: true,
    sampleRateHz: 1,
    aggregation: 'max',
    icon: metricIcon('BRAKE_TEMPERATURE_REAR_LEFT'),
    registerAddress: 40111,
  },
  BRAKE_TEMPERATURE_REAR_RIGHT: {
    id: 'BRAKE_TEMPERATURE_REAR_RIGHT',
    groupId: 'DRIVELINE',
    name: 'Температура тормоза заднего правого',
    shortName: 'Тормоз ЗП',
    unitId: 'CELSIUS',
    displayUnitId: 'CELSIUS',
    precision: 0,
    kind: 'instant',
    worseDirection: 'up',
    severityRelevant: true,
    sampleRateHz: 1,
    aggregation: 'max',
    icon: metricIcon('BRAKE_TEMPERATURE_REAR_RIGHT'),
    registerAddress: 40113,
  },
  // --- Топливо ---------------------------------------------------------------------------
  FUEL_LEVEL: {
    id: 'FUEL_LEVEL',
    groupId: 'FUEL',
    name: 'Уровень топлива',
    shortName: 'Топливо',
    unitId: 'PERCENT',
    displayUnitId: 'PERCENT',
    precision: 0,
    kind: 'instant',
    worseDirection: 'down',
    severityRelevant: true,
    sampleRateHz: 0.2,
    aggregation: 'avg',
    card: 7,
    icon: metricIcon('FUEL_LEVEL'),
    registerAddress: 40201,
  },
  FUEL_INSTANT_CONSUMPTION: {
    id: 'FUEL_INSTANT_CONSUMPTION',
    groupId: 'FUEL',
    name: 'Мгновенный расход топлива',
    shortName: 'Расход',
    unitId: 'LITERS_PER_HOUR',
    displayUnitId: 'LITERS_PER_HOUR',
    precision: 1,
    kind: 'instant',
    // Зон нет: показатель ценен в сравнении с режимом работы, а не сам по себе.
    worseDirection: 'none',
    severityRelevant: false,
    sampleRateHz: 0.2,
    aggregation: 'avg',
    icon: metricIcon('FUEL_INSTANT_CONSUMPTION'),
    registerAddress: 40203,
  },
  FUEL_TOTAL_CONSUMPTION: {
    id: 'FUEL_TOTAL_CONSUMPTION',
    groupId: 'FUEL',
    name: 'Суммарный расход топлива',
    shortName: 'Расход всего',
    unitId: 'LITER',
    displayUnitId: 'LITER',
    precision: 0,
    kind: 'counter',
    worseDirection: 'none',
    severityRelevant: false,
    sampleRateHz: 0.2,
    aggregation: 'last',
    icon: metricIcon('FUEL_TOTAL_CONSUMPTION'),
    registerAddress: 40205,
  },
  // --- Груз и оси ------------------------------------------------------------------------
  CARGO_MASS: {
    id: 'CARGO_MASS',
    groupId: 'LOAD',
    name: 'Масса груза',
    shortName: 'Груз',
    unitId: 'KILOGRAM',
    displayUnitId: 'TONNE',
    precision: 1,
    kind: 'instant',
    worseDirection: 'both',
    severityRelevant: true,
    sampleRateHz: 0.2,
    aggregation: 'avg',
    relativeTo: 'ratedPayload',
    icon: metricIcon('CARGO_MASS'),
    registerAddress: 40301,
  },
  FRONT_AXLE_LOAD: {
    id: 'FRONT_AXLE_LOAD',
    groupId: 'LOAD',
    name: 'Нагрузка на переднюю ось',
    shortName: 'Перед. ось',
    unitId: 'KILOGRAM',
    displayUnitId: 'TONNE',
    precision: 1,
    kind: 'instant',
    worseDirection: 'both',
    severityRelevant: true,
    sampleRateHz: 0.2,
    aggregation: 'avg',
    relativeTo: 'grossWeight',
    icon: metricIcon('FRONT_AXLE_LOAD'),
    registerAddress: 40303,
  },
  REAR_AXLE_LOAD: {
    id: 'REAR_AXLE_LOAD',
    groupId: 'LOAD',
    name: 'Нагрузка на заднюю ось',
    shortName: 'Задн. ось',
    unitId: 'KILOGRAM',
    displayUnitId: 'TONNE',
    precision: 1,
    kind: 'instant',
    worseDirection: 'both',
    /**
     * В светофоре не участвует: по разделу 6.1 `CONTEXT.md` задняя ось считается вместе
     * с передней, желтых и красных зон у нее нет. Перекос ловится показателями
     * FRONT_AXLE_LOAD и FRONT_AXLE_SHARE.
     */
    severityRelevant: false,
    sampleRateHz: 0.2,
    aggregation: 'avg',
    relativeTo: 'grossWeight',
    icon: metricIcon('REAR_AXLE_LOAD'),
    registerAddress: 40305,
  },
  BODY_ANGLE: {
    id: 'BODY_ANGLE',
    groupId: 'LOAD',
    name: 'Угол подъема платформы',
    shortName: 'Угол кузова',
    unitId: 'DEGREE',
    displayUnitId: 'DEGREE',
    precision: 0,
    kind: 'instant',
    worseDirection: 'up',
    severityRelevant: true,
    sampleRateHz: 0.2,
    aggregation: 'max',
    icon: metricIcon('BODY_ANGLE'),
    registerAddress: 40307,
  },
  // --- Позиционирование ------------------------------------------------------------------
  POSITION_SPEED: {
    id: 'POSITION_SPEED',
    groupId: 'POSITION',
    name: 'Скорость',
    shortName: 'Скорость',
    unitId: 'KILOMETERS_PER_HOUR',
    displayUnitId: 'KILOMETERS_PER_HOUR',
    precision: 0,
    kind: 'instant',
    worseDirection: 'up',
    severityRelevant: true,
    sampleRateHz: 1,
    aggregation: 'avg',
    // Первый показатель плашки - вместе со статусом машины (раздел 9.1 `CONTEXT.md`).
    card: 1,
    icon: metricIcon('POSITION_SPEED'),
    registerAddress: 40401,
  },
  POSITION_HEADING: {
    id: 'POSITION_HEADING',
    groupId: 'POSITION',
    name: 'Курс',
    shortName: 'Курс',
    unitId: 'DEGREE',
    displayUnitId: 'DEGREE',
    precision: 0,
    kind: 'instant',
    worseDirection: 'none',
    severityRelevant: false,
    sampleRateHz: 1,
    aggregation: 'last',
    icon: metricIcon('POSITION_HEADING'),
    registerAddress: 40403,
  },
  POSITION_LATITUDE: {
    id: 'POSITION_LATITUDE',
    groupId: 'POSITION',
    name: 'Широта',
    shortName: 'Широта',
    unitId: 'DEGREE_LATITUDE',
    displayUnitId: 'DEGREE_LATITUDE',
    precision: 6,
    kind: 'coordinate',
    worseDirection: 'none',
    severityRelevant: false,
    sampleRateHz: 1,
    aggregation: 'last',
    icon: metricIcon('POSITION_LATITUDE'),
    registerAddress: 40405,
  },
  POSITION_LONGITUDE: {
    id: 'POSITION_LONGITUDE',
    groupId: 'POSITION',
    name: 'Долгота',
    shortName: 'Долгота',
    unitId: 'DEGREE_LONGITUDE',
    displayUnitId: 'DEGREE_LONGITUDE',
    precision: 6,
    kind: 'coordinate',
    worseDirection: 'none',
    severityRelevant: false,
    sampleRateHz: 1,
    aggregation: 'last',
    icon: metricIcon('POSITION_LONGITUDE'),
    registerAddress: 40407,
  },
  // --- Производные -----------------------------------------------------------------------
  VEHICLE_STATUS: {
    id: 'VEHICLE_STATUS',
    groupId: 'DERIVED',
    name: 'Статус машины',
    shortName: 'Статус',
    unitId: 'STATE_CODE',
    displayUnitId: 'STATE_CODE',
    precision: 0,
    kind: 'derived',
    worseDirection: 'none',
    severityRelevant: false,
    sampleRateHz: 1,
    aggregation: 'last',
    derivedFrom: ['POSITION_SPEED', 'CARGO_MASS', 'BODY_ANGLE', 'ENGINE_RPM'],
    icon: metricIcon('VEHICLE_STATUS'),
  },
  BRAKE_TEMPERATURE_MAX: {
    id: 'BRAKE_TEMPERATURE_MAX',
    groupId: 'DERIVED',
    name: 'Максимальная температура тормозов',
    shortName: 'Тормоза max',
    unitId: 'CELSIUS',
    displayUnitId: 'CELSIUS',
    precision: 0,
    kind: 'derived',
    worseDirection: 'up',
    // В светофоре не участвует, чтобы не считать тормоза дважды: они уже учтены по четырем колесам.
    severityRelevant: false,
    sampleRateHz: 1,
    aggregation: 'max',
    derivedFrom: [
      'BRAKE_TEMPERATURE_FRONT_LEFT',
      'BRAKE_TEMPERATURE_FRONT_RIGHT',
      'BRAKE_TEMPERATURE_REAR_LEFT',
      'BRAKE_TEMPERATURE_REAR_RIGHT',
    ],
    card: 5,
    icon: metricIcon('BRAKE_TEMPERATURE_MAX'),
  },
  BRAKE_TEMPERATURE_SPREAD: {
    id: 'BRAKE_TEMPERATURE_SPREAD',
    groupId: 'DERIVED',
    name: 'Разброс температур тормозов',
    shortName: 'Разброс торм.',
    unitId: 'CELSIUS',
    displayUnitId: 'CELSIUS',
    precision: 0,
    kind: 'derived',
    worseDirection: 'up',
    // Несет отдельный смысл (подклинивший механизм), поэтому в светофоре участвует.
    severityRelevant: true,
    sampleRateHz: 1,
    aggregation: 'max',
    derivedFrom: [
      'BRAKE_TEMPERATURE_FRONT_LEFT',
      'BRAKE_TEMPERATURE_FRONT_RIGHT',
      'BRAKE_TEMPERATURE_REAR_LEFT',
      'BRAKE_TEMPERATURE_REAR_RIGHT',
    ],
    icon: metricIcon('BRAKE_TEMPERATURE_SPREAD'),
  },
  PAYLOAD_RATIO: {
    id: 'PAYLOAD_RATIO',
    groupId: 'DERIVED',
    name: 'Загрузка от номинала',
    shortName: 'Загрузка',
    unitId: 'PERCENT',
    displayUnitId: 'PERCENT',
    precision: 0,
    kind: 'derived',
    worseDirection: 'both',
    // Дубликат CARGO_MASS в процентах: в светофоре участвует сам CARGO_MASS.
    severityRelevant: false,
    sampleRateHz: 0.2,
    aggregation: 'avg',
    derivedFrom: ['CARGO_MASS'],
    card: 2,
    icon: metricIcon('PAYLOAD_RATIO'),
  },
  FRONT_AXLE_SHARE: {
    id: 'FRONT_AXLE_SHARE',
    groupId: 'DERIVED',
    name: 'Доля нагрузки на переднюю ось',
    shortName: 'Доля перед. оси',
    unitId: 'PERCENT',
    displayUnitId: 'PERCENT',
    precision: 1,
    kind: 'derived',
    worseDirection: 'both',
    // Дубликат FRONT_AXLE_LOAD в процентах: в светофоре участвует сам FRONT_AXLE_LOAD.
    severityRelevant: false,
    sampleRateHz: 0.2,
    aggregation: 'avg',
    derivedFrom: ['FRONT_AXLE_LOAD', 'REAR_AXLE_LOAD'],
    icon: metricIcon('FRONT_AXLE_SHARE'),
  },
  TIME_SINCE_LAST_DATA: {
    id: 'TIME_SINCE_LAST_DATA',
    groupId: 'DERIVED',
    name: 'Время без связи',
    shortName: 'Без связи',
    unitId: 'MINUTE',
    displayUnitId: 'MINUTE',
    precision: 0,
    kind: 'derived',
    worseDirection: 'up',
    severityRelevant: true,
    sampleRateHz: 1,
    aggregation: 'max',
    derivedFrom: [],
    icon: metricIcon('TIME_SINCE_LAST_DATA'),
  },
  HOURS_TO_SERVICE: {
    id: 'HOURS_TO_SERVICE',
    groupId: 'DERIVED',
    name: 'Часов до ближайшего ТО',
    shortName: 'До ТО',
    unitId: 'HOUR',
    displayUnitId: 'HOUR',
    precision: 0,
    kind: 'derived',
    worseDirection: 'down',
    severityRelevant: true,
    sampleRateHz: 1,
    aggregation: 'last',
    derivedFrom: ['ENGINE_HOURS'],
    icon: metricIcon('HOURS_TO_SERVICE'),
  },
};

/**
 * Порядок физических показателей в компактных массивах транспорта
 * (`VehicleSnapshot.v` и `VehicleSnapshot.q`).
 * Менять нельзя без версии API.
 */
export const METRIC_ORDER: PhysicalMetricId[] = [
  'ENGINE_RPM',
  'ENGINE_COOLANT_TEMPERATURE',
  'ENGINE_OIL_PRESSURE',
  'ENGINE_OIL_TEMPERATURE',
  'ENGINE_HOURS',
  'TRANSMISSION_GEAR',
  'TRANSMISSION_OIL_TEMPERATURE',
  'TRANSMISSION_SYSTEM_PRESSURE',
  'BRAKE_TEMPERATURE_FRONT_LEFT',
  'BRAKE_TEMPERATURE_FRONT_RIGHT',
  'BRAKE_TEMPERATURE_REAR_LEFT',
  'BRAKE_TEMPERATURE_REAR_RIGHT',
  'FUEL_LEVEL',
  'FUEL_INSTANT_CONSUMPTION',
  'FUEL_TOTAL_CONSUMPTION',
  'CARGO_MASS',
  'FRONT_AXLE_LOAD',
  'REAR_AXLE_LOAD',
  'BODY_ANGLE',
  'POSITION_SPEED',
  'POSITION_HEADING',
  'POSITION_LATITUDE',
  'POSITION_LONGITUDE',
];

/** Индекс показателя в компактных массивах. */
export const METRIC_INDEX: Record<PhysicalMetricId, number> = METRIC_ORDER.reduce(
  (acc, id, index) => {
    acc[id] = index;
    return acc;
  },
  {} as Record<PhysicalMetricId, number>,
);

export const METRIC_IDS: MetricId[] = Object.keys(METRICS) as MetricId[];

export const PHYSICAL_METRIC_IDS: PhysicalMetricId[] = METRIC_ORDER;

export const DERIVED_METRIC_IDS: DerivedMetricId[] = METRIC_IDS.filter(
  (id): id is DerivedMetricId => METRICS[id].kind === 'derived',
);

/** Показатели плашки машины в порядке приоритета (раздел 9.1 `CONTEXT.md`). */
export const CARD_METRIC_IDS: MetricId[] = METRIC_IDS.filter(
  (id) => METRICS[id].card !== undefined,
).sort((a, b) => (METRICS[a].card ?? 0) - (METRICS[b].card ?? 0));

/** Показатели, участвующие в светофоре. */
export const SEVERITY_METRIC_IDS: MetricId[] = METRIC_IDS.filter(
  (id) => METRICS[id].severityRelevant,
);

export function getMetric(id: MetricId): MetricDef {
  return METRICS[id];
}

export function isMetricId(value: string): value is MetricId {
  return Object.hasOwn(METRICS, value);
}

export function isPhysicalMetricId(value: string): value is PhysicalMetricId {
  return isMetricId(value) && METRICS[value].kind !== 'derived';
}

/** Значение показателя в базовой единице -> строка для интерфейса. */
export function formatMetricValue(
  value: number | null | undefined,
  metricId: MetricId,
  options: FormatOptions = {},
): string {
  return formatValue(value, METRICS[metricId], options);
}
