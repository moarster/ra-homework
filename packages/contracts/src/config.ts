/**
 * Конфигурация приложения (раздел 7 `SPEC.md`) и числовые правила, на которые опираются
 * чистые функции контрактов. Любое магическое число проекта живет здесь или в справочниках.
 */

import { CARD_METRIC_IDS, type MetricId } from './metrics.js';
import {
  PIT_BOUNDS,
  PIT_CENTER,
  PIT_DEFAULT_ZOOM,
  PIT_MAX_ZOOM,
  PIT_MIN_ZOOM,
  PIT_TIMEZONE,
} from './pit.js';
import { MAX_VEHICLES } from './vehicles.js';

export type PeriodId = '5m' | '15m' | '1h' | '3h' | '6h' | '12h' | '24h';

export interface PeriodDef {
  id: PeriodId;
  /** Подпись на русском. */
  label: string;
  seconds: number;
}

export const PERIODS: PeriodDef[] = [
  { id: '5m', label: '5 минут', seconds: 300 },
  { id: '15m', label: '15 минут', seconds: 900 },
  { id: '1h', label: '1 час', seconds: 3600 },
  { id: '3h', label: '3 часа', seconds: 10_800 },
  { id: '6h', label: '6 часов', seconds: 21_600 },
  { id: '12h', label: '12 часов', seconds: 43_200 },
  { id: '24h', label: '24 часа', seconds: 86_400 },
];

export const DEFAULT_PERIOD_ID: PeriodId = '1h';

export type ChartId = 'BRAKE_SYMMETRY' | 'LOAD_BALANCE' | 'THERMAL_STATE' | 'DUTY_MODE';

export interface ChartDef {
  id: ChartId;
  /** Название на русском. */
  name: string;
  /** Что показывает - подсказка в интерфейсе. */
  description: string;
  metrics: MetricId[];
}

/** Сравнительные чарты страницы машины (раздел 9.2 `CONTEXT.md`). */
export const COMPARATIVE_CHARTS: ChartDef[] = [
  {
    id: 'BRAKE_SYMMETRY',
    name: 'Тормозная симметрия',
    description: 'Четыре тормоза с зонами норматива и разбросом: общий перегрев и подклинивание',
    metrics: [
      'BRAKE_TEMPERATURE_FRONT_LEFT',
      'BRAKE_TEMPERATURE_FRONT_RIGHT',
      'BRAKE_TEMPERATURE_REAR_LEFT',
      'BRAKE_TEMPERATURE_REAR_RIGHT',
      'BRAKE_TEMPERATURE_SPREAD',
    ],
  },
  {
    id: 'LOAD_BALANCE',
    name: 'Развесовка и загрузка',
    description: 'Масса груза относительно номинала и распределение по осям',
    metrics: [
      'CARGO_MASS',
      'PAYLOAD_RATIO',
      'FRONT_AXLE_LOAD',
      'REAR_AXLE_LOAD',
      'FRONT_AXLE_SHARE',
    ],
  },
  {
    id: 'THERMAL_STATE',
    name: 'Тепловое состояние систем',
    description: 'ОЖ, масло двигателя, масло трансмиссии и тормоза в процентах до красной зоны',
    metrics: [
      'ENGINE_COOLANT_TEMPERATURE',
      'ENGINE_OIL_TEMPERATURE',
      'TRANSMISSION_OIL_TEMPERATURE',
      'BRAKE_TEMPERATURE_MAX',
    ],
  },
  {
    id: 'DUTY_MODE',
    name: 'Режим работы',
    description: 'Обороты, скорость, передача и расход: работа внатяг, накат, неверная передача',
    metrics: ['ENGINE_RPM', 'POSITION_SPEED', 'TRANSMISSION_GEAR', 'FUEL_INSTANT_CONSUMPTION'],
  },
];

export type ChaosLevel = 'NORMAL' | 'MESSY' | 'UGLY' | 'CHAOS';

export interface ChaosLevelDef {
  id: ChaosLevel;
  /** Название на русском. */
  name: string;
  /** Событий на машину за 12-часовую смену. */
  intensity: number;
  /** Разрешены ли наложения двух сценариев. */
  allowOverlap: boolean;
}

/** Мера хаоса (раздел 10 `CONTEXT.md`). */
export const CHAOS_LEVELS: ChaosLevelDef[] = [
  { id: 'NORMAL', name: 'Норма', intensity: 0.5, allowOverlap: false },
  { id: 'MESSY', name: 'Бардак', intensity: 2, allowOverlap: false },
  { id: 'UGLY', name: 'Безобразие', intensity: 6, allowOverlap: true },
  { id: 'CHAOS', name: 'Хаос', intensity: 15, allowOverlap: true },
];

/** Допустимые скорости течения виртуального времени. */
export const TIME_SCALES: number[] = [1, 2, 5, 10, 30, 60];

/** Нет данных дольше этого времени - серверная авария NO_DATA. */
export const NO_DATA_ALARM_MINUTES = 40;

export interface AppConfig {
  timezone: string;
  pit: {
    center: [number, number];
    bounds: [[number, number], [number, number]];
    minZoom: number;
    maxZoom: number;
    defaultZoom: number;
  };
  periods: PeriodDef[];
  defaultPeriodId: PeriodId;
  /** Показатели плашки списка машин, порядок = приоритет. */
  cardMetrics: MetricId[];
  comparativeCharts: ChartId[];
  track: {
    defaultTailSeconds: number;
    maxTailSeconds: number;
    pointStepSeconds: number;
  };
  noDataAlarmMinutes: number;
  simulation: {
    maxVehicles: number;
    timeScales: number[];
    chaosLevels: ChaosLevel[];
  };
}

export const APP_CONFIG: AppConfig = {
  timezone: PIT_TIMEZONE,
  pit: {
    center: PIT_CENTER,
    bounds: PIT_BOUNDS,
    minZoom: PIT_MIN_ZOOM,
    maxZoom: PIT_MAX_ZOOM,
    defaultZoom: PIT_DEFAULT_ZOOM,
  },
  periods: PERIODS,
  defaultPeriodId: DEFAULT_PERIOD_ID,
  cardMetrics: CARD_METRIC_IDS,
  comparativeCharts: COMPARATIVE_CHARTS.map((chart) => chart.id),
  track: {
    // Хвост трека по умолчанию 15 минут, слайдер тянется до 12 часов, точка не чаще 5 секунд.
    defaultTailSeconds: 900,
    maxTailSeconds: 43_200,
    pointStepSeconds: 5,
  },
  noDataAlarmMinutes: NO_DATA_ALARM_MINUTES,
  simulation: {
    maxVehicles: MAX_VEHICLES,
    timeScales: TIME_SCALES,
    chaosLevels: CHAOS_LEVELS.map((level) => level.id),
  },
};

/**
 * Параметры расчета производных показателей (раздел 6.3 `CONTEXT.md`).
 * Вынесены сюда, чтобы формулы в `derived.ts` не содержали чисел.
 */
export const DERIVED_RULES = {
  /** Выше этой скорости машина считается движущейся, км/ч. */
  movingSpeedKmh: 1,
  /** Выше этого угла платформа считается поднятой, градусы. */
  bodyRaisedAngleDeg: 3,
  /** От этой доли номинала считается, что груз есть, проценты. */
  loadedPayloadRatioPercent: 20,
  /** Интервал ТО-1 по наработке, моточасы. */
  serviceIntervalHours: 250,
} as const;

/**
 * Признаки несоответствия режима работы (сравнительный чарт "Режим работы", раздел 9.2
 * `CONTEXT.md`): высокие обороты при низкой скорости и высоком расходе - работа внатяг;
 * низкие обороты при высокой скорости - движение накатом.
 */
export const DUTY_MODE_RULES = {
  /** От этих оборотов двигатель считается нагруженным, об/мин (желтая зона - от 2100). */
  highRpm: 1700,
  /** До этой скорости движение нагруженного двигателя считается медленным, км/ч. */
  lowSpeedKmh: 12,
  /** Доля расхода на полной мощности, от которой расход считается высоким. */
  highFuelShare: 0.6,
  /** До этих оборотов двигатель считается работающим без нагрузки, об/мин. */
  coastRpm: 900,
  /** От этой скорости движение без нагрузки на двигатель считается накатом, км/ч. */
  coastSpeedKmh: 20,
  /** Удельный расход дизеля на полной мощности, л/(кВт*ч): около 220 г/(кВт*ч). */
  fullLoadLitersPerKwh: 0.26,
} as const;

/** Правила свертки выходов за нормативы в события (раздел 5.4 `SPEC.md`). */
export const EVENT_RULES = {
  /** Сколько секунд подряд показатель вне зеленой зоны, чтобы открыть событие. */
  openAfterSeconds: 10,
  /** Сколько секунд подряд показатель в зеленой зоне, чтобы закрыть событие (гистерезис). */
  closeAfterSeconds: 30,
  /** Нет данных дольше этого времени - событие NO_DATA. */
  noDataMinutes: NO_DATA_ALARM_MINUTES,
  /** Падение уровня топлива при заглушенном двигателе, проценты - подозрение на слив. */
  fuelTheftDropPercent: 5,
} as const;

/** Ограничения ответов API. */
export const QUERY_LIMITS = {
  defaultMaxPoints: 1000,
  maxMaxPoints: 5000,
  defaultTrackMaxPoints: 600,
  defaultEventLimit: 500,
  maxEventLimit: 5000,
} as const;
