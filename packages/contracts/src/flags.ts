/**
 * Битовые поля, приходящие с борта: аварии, предупреждения и состояния систем
 * (раздел 8 `CONTEXT.md`). Три поля на частоте 1 Гц.
 */

import type { Severity } from './severity.js';

export type FlagFieldId = 'ALARMS' | 'WARNINGS' | 'SYSTEM_STATE';

export interface FlagDef {
  /** Индекс бита в поле. */
  bit: number;
  /** Код на английском - он же код события. */
  code: string;
  /** Название на русском. */
  name: string;
  /** Степень: 2 авария, 1 предупреждение, 0 состояние (не отклонение). */
  severity: Severity;
}

/** Аварии: взведенный бит делает точку красной. */
export const ALARMS: FlagDef[] = [
  {
    bit: 0,
    code: 'OIL_PRESSURE_CRITICAL',
    name: 'Аварийное давление масла двигателя',
    severity: 2,
  },
  { bit: 1, code: 'COOLANT_OVERHEAT', name: 'Перегрев охлаждающей жидкости', severity: 2 },
  { bit: 2, code: 'TRANSMISSION_OVERHEAT', name: 'Перегрев масла трансмиссии', severity: 2 },
  { bit: 3, code: 'BRAKE_OVERHEAT', name: 'Перегрев тормозов', severity: 2 },
  { bit: 4, code: 'BRAKE_PRESSURE_LOW', name: 'Падение давления в тормозной системе', severity: 2 },
  { bit: 5, code: 'OVERLOAD', name: 'Перегруз (более 120% номинала)', severity: 2 },
  { bit: 6, code: 'BODY_UP_WHILE_MOVING', name: 'Движение с поднятой платформой', severity: 2 },
  {
    bit: 7,
    code: 'STEERING_PRESSURE_LOW',
    name: 'Низкое давление в системе рулевого управления',
    severity: 2,
  },
  { bit: 8, code: 'ENGINE_EMERGENCY_STOP', name: 'Аварийный останов двигателя', severity: 2 },
  { bit: 9, code: 'FIRE_ALARM', name: 'Срабатывание пожарной сигнализации', severity: 2 },
  { bit: 10, code: 'FUEL_CRITICAL', name: 'Критически низкий уровень топлива', severity: 2 },
];

/** Предупреждения: взведенный бит делает точку желтой. */
export const WARNINGS: FlagDef[] = [
  { bit: 0, code: 'COOLANT_TEMP_HIGH', name: 'Повышенная температура ОЖ', severity: 1 },
  {
    bit: 1,
    code: 'TRANSMISSION_TEMP_HIGH',
    name: 'Повышенная температура масла трансмиссии',
    severity: 1,
  },
  { bit: 2, code: 'OIL_PRESSURE_LOW', name: 'Пониженное давление масла', severity: 1 },
  { bit: 3, code: 'FUEL_LOW', name: 'Низкий уровень топлива', severity: 1 },
  { bit: 4, code: 'AIR_FILTER_CLOGGED', name: 'Загрязнение воздушного фильтра', severity: 1 },
  { bit: 5, code: 'COOLANT_LEVEL_LOW', name: 'Низкий уровень охлаждающей жидкости', severity: 1 },
  { bit: 6, code: 'BRAKE_WEAR', name: 'Износ тормозных накладок', severity: 1 },
  { bit: 7, code: 'OVERSPEED', name: 'Превышение скорости', severity: 1 },
  { bit: 8, code: 'PAYLOAD_OUT_OF_RANGE', name: 'Загрузка вне допустимого диапазона', severity: 1 },
  { bit: 9, code: 'EXCESSIVE_IDLING', name: 'Длительная работа на холостом ходу', severity: 1 },
  { bit: 10, code: 'SERVICE_DUE', name: 'Приближение планового ТО', severity: 1 },
  { bit: 11, code: 'BATTERY_VOLTAGE_LOW', name: 'Низкое напряжение бортовой сети', severity: 1 },
];

/** Состояния систем: не события и не отклонения, степень всегда 0. */
export const SYSTEM_STATE: FlagDef[] = [
  { bit: 0, code: 'IGNITION_ON', name: 'Зажигание включено', severity: 0 },
  { bit: 1, code: 'ENGINE_RUNNING', name: 'Двигатель запущен', severity: 0 },
  { bit: 2, code: 'PARKING_BRAKE', name: 'Стояночный тормоз', severity: 0 },
  { bit: 3, code: 'RETARDER_ACTIVE', name: 'Ретардер активен', severity: 0 },
  { bit: 4, code: 'BODY_RAISED', name: 'Платформа поднята', severity: 0 },
  { bit: 5, code: 'NEUTRAL', name: 'Нейтраль', severity: 0 },
  { bit: 6, code: 'REVERSE', name: 'Задний ход', severity: 0 },
  { bit: 7, code: 'LOADED', name: 'Есть груз', severity: 0 },
  { bit: 8, code: 'REFUELING', name: 'Заправка', severity: 0 },
  { bit: 9, code: 'MAINTENANCE_MODE', name: 'Режим обслуживания', severity: 0 },
];

export const FLAG_CATALOGS: Record<FlagFieldId, FlagDef[]> = {
  ALARMS: ALARMS,
  WARNINGS: WARNINGS,
  SYSTEM_STATE: SYSTEM_STATE,
};

/** Адреса регистров битовых полей: блок 40501, шаг 2 регистра. */
export const FLAG_REGISTER_ADDRESSES: Record<FlagFieldId, number> = {
  ALARMS: 40501,
  WARNINGS: 40503,
  SYSTEM_STATE: 40505,
};

/** Битовые поля точки: [аварии, предупреждения, состояния]. */
export type FlagsTriple = [alarms: number, warnings: number, state: number];

export function isBitSet(value: number, bit: number): boolean {
  return ((value >>> bit) & 1) === 1;
}

/** Взведенные биты поля в виде записей каталога. */
export function decodeFlags(value: number, catalog: FlagDef[]): FlagDef[] {
  return catalog.filter((flag) => isBitSet(value, flag.bit));
}

/** Коды взведенных битов. */
export function flagsToCodes(value: number, catalog: FlagDef[]): string[] {
  return decodeFlags(value, catalog).map((flag) => flag.code);
}

/** Значение поля из списка кодов - обратная операция к `flagsToCodes`. */
export function codesToFlags(codes: string[], catalog: FlagDef[]): number {
  let value = 0;
  for (const flag of catalog) {
    if (codes.includes(flag.code)) {
      value |= 1 << flag.bit;
    }
  }
  return value;
}

export function findFlag(code: string, catalog: FlagDef[]): FlagDef | undefined {
  return catalog.find((flag) => flag.code === code);
}

/** Взведен ли конкретный бит состояния систем. */
export function isStateSet(stateValue: number, code: string): boolean {
  const flag = findFlag(code, SYSTEM_STATE);
  return flag !== undefined && isBitSet(stateValue, flag.bit);
}
