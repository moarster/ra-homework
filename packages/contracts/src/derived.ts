/**
 * Производные показатели: чистые функции по формулам раздела 6.2 `CONTEXT.md`.
 * Используются и сервером (он их считает), и клиентом (сравнительные чарты, плашки).
 */

import { DERIVED_RULES, DUTY_MODE_RULES } from './config.js';
import type { PitZoneKind } from './pit.js';

export type VehicleStatus =
  | 'HAULING'
  | 'RETURNING'
  | 'LOADING'
  | 'UNLOADING'
  | 'IDLING'
  | 'PARKED'
  | 'NO_DATA';

export const VEHICLE_STATUS_NAMES: Record<VehicleStatus, string> = {
  HAULING: 'Движение груженым',
  RETURNING: 'Движение порожним',
  LOADING: 'Погрузка',
  UNLOADING: 'Разгрузка',
  IDLING: 'Холостой ход',
  PARKED: 'Стоянка, двигатель заглушен',
  NO_DATA: 'Нет данных',
};

export interface VehicleStatusInput {
  /** Есть ли свежая точка с качеством GOOD. */
  hasData: boolean;
  /** Работает ли двигатель (бит ENGINE_RUNNING или обороты больше нуля). */
  engineRunning: boolean;
  speedKmh: number | null;
  cargoMassKg: number | null;
  /** Номинальная грузоподъемность модели, кг. */
  ratedPayloadKg: number;
  bodyAngleDeg: number | null;
  /** Зона карьера, в которой стоит машина, если известна. */
  zoneKind: PitZoneKind | null;
}

function isMoving(input: VehicleStatusInput): boolean {
  return input.speedKmh !== null && input.speedKmh > DERIVED_RULES.movingSpeedKmh;
}

function isLoaded(input: VehicleStatusInput): boolean {
  if (input.cargoMassKg === null || input.ratedPayloadKg <= 0) {
    return false;
  }
  const ratio = (input.cargoMassKg / input.ratedPayloadKg) * 100;
  return ratio >= DERIVED_RULES.loadedPayloadRatioPercent;
}

function isBodyRaised(input: VehicleStatusInput): boolean {
  return input.bodyAngleDeg !== null && input.bodyAngleDeg > DERIVED_RULES.bodyRaisedAngleDeg;
}

/**
 * Таблица решений для статуса машины: первое подошедшее правило и дает статус.
 * Порядок важен и является частью контракта - на него опираются тесты.
 */
export const VEHICLE_STATUS_TABLE: {
  status: VehicleStatus;
  /** Описание правила на русском - идет в документацию и подсказки интерфейса. */
  description: string;
  when: (input: VehicleStatusInput) => boolean;
}[] = [
  {
    status: 'NO_DATA',
    description: 'Нет свежих данных с борта',
    when: (input) => !input.hasData,
  },
  {
    status: 'PARKED',
    description: 'Двигатель заглушен',
    when: (input) => !input.engineRunning,
  },
  {
    status: 'HAULING',
    description: 'Машина движется и груз есть',
    when: (input) => isMoving(input) && isLoaded(input),
  },
  {
    status: 'RETURNING',
    description: 'Машина движется и груза нет',
    when: (input) => isMoving(input) && !isLoaded(input),
  },
  {
    status: 'UNLOADING',
    description: 'Машина стоит с поднятой платформой',
    when: (input) => isBodyRaised(input),
  },
  {
    status: 'LOADING',
    description: 'Машина стоит в забое под погрузкой',
    when: (input) => input.zoneKind === 'LOADING',
  },
  {
    status: 'IDLING',
    description: 'Двигатель работает, машина стоит',
    when: () => true,
  },
];

export function vehicleStatus(input: VehicleStatusInput): VehicleStatus {
  for (const rule of VEHICLE_STATUS_TABLE) {
    if (rule.when(input)) {
      return rule.status;
    }
  }
  return 'IDLING';
}

/**
 * Числовые коды статуса: показатель `VEHICLE_STATUS` имеет единицу `STATE_CODE`
 * и хранится на сервере в числовых буферах наравне с физическими показателями.
 * Порядок кодов - часть контракта, менять нельзя без версии API.
 */
export const VEHICLE_STATUSES: VehicleStatus[] = [
  'NO_DATA',
  'PARKED',
  'IDLING',
  'LOADING',
  'HAULING',
  'UNLOADING',
  'RETURNING',
];

export const VEHICLE_STATUS_CODES: Record<VehicleStatus, number> = VEHICLE_STATUSES.reduce(
  (acc, status, index) => {
    acc[status] = index;
    return acc;
  },
  {} as Record<VehicleStatus, number>,
);

/** Код -> статус. Нецелый или неизвестный код трактуется как отсутствие данных. */
export function vehicleStatusFromCode(code: number | null | undefined): VehicleStatus {
  if (code === null || code === undefined || !Number.isFinite(code)) {
    return 'NO_DATA';
  }
  return VEHICLE_STATUSES[Math.round(code)] ?? 'NO_DATA';
}

/**
 * Максимум и разброс температур тормозов считаются без аллокаций: эти функции вызываются
 * сервером на каждую машину каждую виртуальную секунду (до 3600 раз в реальную секунду).
 */
function brakeExtremes(values: (number | null | undefined)[]): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let seen = false;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value === null || value === undefined || !Number.isFinite(value)) {
      continue;
    }
    seen = true;
    if (value < min) {
      min = value;
    }
    if (value > max) {
      max = value;
    }
  }
  return seen ? { min, max } : null;
}

/** Максимум из четырех тормозов. */
export function brakeTemperatureMax(values: (number | null | undefined)[]): number | null {
  return brakeExtremes(values)?.max ?? null;
}

/** Разброс температур тормозов: максимум минус минимум. */
export function brakeTemperatureSpread(values: (number | null | undefined)[]): number | null {
  const extremes = brakeExtremes(values);
  return extremes === null ? null : extremes.max - extremes.min;
}

/** Загрузка в процентах от номинала модели. */
export function payloadRatio(
  cargoMassKg: number | null | undefined,
  ratedPayloadKg: number,
): number | null {
  if (cargoMassKg === null || cargoMassKg === undefined || !Number.isFinite(cargoMassKg)) {
    return null;
  }
  if (ratedPayloadKg <= 0) {
    return null;
  }
  return (cargoMassKg / ratedPayloadKg) * 100;
}

/** Доля передней оси в процентах от суммы нагрузок на оси. */
export function frontAxleShare(
  frontAxleLoadKg: number | null | undefined,
  rearAxleLoadKg: number | null | undefined,
): number | null {
  if (
    frontAxleLoadKg === null ||
    frontAxleLoadKg === undefined ||
    rearAxleLoadKg === null ||
    rearAxleLoadKg === undefined
  ) {
    return null;
  }
  const total = frontAxleLoadKg + rearAxleLoadKg;
  if (!Number.isFinite(total) || total <= 0) {
    return null;
  }
  return (frontAxleLoadKg / total) * 100;
}

/**
 * Время без связи в минутах: текущее время симуляции минус метка последней точки
 * с качеством GOOD. Оба аргумента - unix seconds.
 */
export function timeSinceLastData(
  simTimeSec: number,
  lastGoodTimeSec: number | null | undefined,
): number | null {
  if (lastGoodTimeSec === null || lastGoodTimeSec === undefined) {
    return null;
  }
  return Math.max(0, (simTimeSec - lastGoodTimeSec) / 60);
}

/** Часов до ближайшего кратного интервалу ТО (по умолчанию 250 моточасов). */
export function hoursToService(
  engineHours: number | null | undefined,
  intervalHours: number = DERIVED_RULES.serviceIntervalHours,
): number | null {
  if (engineHours === null || engineHours === undefined || !Number.isFinite(engineHours)) {
    return null;
  }
  if (intervalHours <= 0) {
    return null;
  }
  const remainder = engineHours % intervalHours;
  return remainder === 0 ? 0 : intervalHours - remainder;
}

/** Режим работы машины в точке: соответствует ли нагрузка двигателя движению. */
export type DutyMode = 'LUGGING' | 'COASTING' | 'NORMAL' | 'UNKNOWN';

export const DUTY_MODE_NAMES: Record<DutyMode, string> = {
  LUGGING: 'Работа внатяг',
  COASTING: 'Движение накатом',
  NORMAL: 'Режим соответствует движению',
  UNKNOWN: 'Режим не определен',
};

/** Что означает режим: подпись под чартом. */
export const DUTY_MODE_HINTS: Record<DutyMode, string> = {
  LUGGING:
    'Высокие обороты и расход при низкой скорости: перегруз, пробуксовка или неверная передача',
  COASTING: 'Низкие обороты при высокой скорости: спуск без торможения двигателем',
  NORMAL: 'Обороты, скорость и расход согласованы',
  UNKNOWN: 'Нет оборотов или скорости в этой точке',
};

export interface DutyModeInput {
  rpm: number | null;
  speedKmh: number | null;
  fuelLitersPerHour: number | null;
  enginePowerKw: number;
}

/** Расход топлива на полной мощности двигателя, л/ч: опорная величина шкалы расхода. */
export function fullLoadFuelLitersPerHour(enginePowerKw: number): number {
  return enginePowerKw * DUTY_MODE_RULES.fullLoadLitersPerKwh;
}

export function dutyMode(input: DutyModeInput): DutyMode {
  const { rpm, speedKmh, fuelLitersPerHour } = input;
  if (rpm === null || speedKmh === null) {
    return 'UNKNOWN';
  }
  const highFuel =
    fuelLitersPerHour !== null &&
    fuelLitersPerHour >=
      DUTY_MODE_RULES.highFuelShare * fullLoadFuelLitersPerHour(input.enginePowerKw);
  if (rpm >= DUTY_MODE_RULES.highRpm && speedKmh <= DUTY_MODE_RULES.lowSpeedKmh && highFuel) {
    return 'LUGGING';
  }
  if (rpm <= DUTY_MODE_RULES.coastRpm && speedKmh >= DUTY_MODE_RULES.coastSpeedKmh) {
    return 'COASTING';
  }
  return 'NORMAL';
}
