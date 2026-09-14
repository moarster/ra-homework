/**
 * Парк машин: модели с паспортными характеристиками, три именные машины
 * и детерминированный генератор остальных (раздел 5 `CONTEXT.md`).
 *
 * ФИО и телефоны водителей фиктивны. В промышленной системе это персональные данные:
 * они живут в справочнике с ограниченным доступом и не передаются вместе с телеметрией.
 */

import type { RouteId } from './pit.js';

export type VehicleModelId = 'BELAZ_75131' | 'BELAZ_7555B' | 'BELAZ_7540V' | 'KOMATSU_HD785_7';

/** Тип трансмиссии: у машин от 90 т вместо ГМП дизель-генератор и мотор-колеса. */
export type TransmissionKind = 'HYDROMECHANICAL' | 'ELECTROMECHANICAL';

export const TRANSMISSION_NAMES: Record<TransmissionKind, string> = {
  HYDROMECHANICAL: 'Гидромеханическая передача',
  ELECTROMECHANICAL: 'Электромеханическая трансмиссия',
};

export interface VehicleModel {
  id: VehicleModelId;
  /** Название модели на русском. */
  name: string;
  manufacturer: string;
  /** Номинальная грузоподъемность, кг. */
  ratedPayloadKg: number;
  /** Снаряженная масса, кг. */
  curbWeightKg: number;
  /** Полная масса (снаряженная + номинальный груз), кг. */
  grossWeightKg: number;
  engineName: string;
  enginePowerKw: number;
  transmission: TransmissionKind;
  fuelTankLiters: number;
  maxSpeedKmh: number;
}

export const VEHICLE_MODELS: Record<VehicleModelId, VehicleModel> = {
  BELAZ_75131: {
    id: 'BELAZ_75131',
    name: 'БелАЗ-75131',
    manufacturer: 'БелАЗ',
    ratedPayloadKg: 130_000,
    curbWeightKg: 106_000,
    grossWeightKg: 236_000,
    engineName: 'Cummins QSK60-C',
    enginePowerKw: 1715,
    transmission: 'ELECTROMECHANICAL',
    fuelTankLiters: 1600,
    maxSpeedKmh: 50,
  },
  BELAZ_7555B: {
    id: 'BELAZ_7555B',
    name: 'БелАЗ-7555B',
    manufacturer: 'БелАЗ',
    ratedPayloadKg: 55_000,
    curbWeightKg: 44_000,
    grossWeightKg: 99_000,
    engineName: 'ЯМЗ-8501.10',
    enginePowerKw: 515,
    transmission: 'HYDROMECHANICAL',
    fuelTankLiters: 800,
    maxSpeedKmh: 50,
  },
  BELAZ_7540V: {
    id: 'BELAZ_7540V',
    name: 'БелАЗ-7540В',
    manufacturer: 'БелАЗ',
    ratedPayloadKg: 30_000,
    curbWeightKg: 22_500,
    grossWeightKg: 52_500,
    engineName: 'ЯМЗ-240ПМ2',
    enginePowerKw: 309,
    transmission: 'HYDROMECHANICAL',
    fuelTankLiters: 550,
    maxSpeedKmh: 55,
  },
  KOMATSU_HD785_7: {
    id: 'KOMATSU_HD785_7',
    name: 'Komatsu HD785-7',
    manufacturer: 'Komatsu',
    ratedPayloadKg: 91_000,
    curbWeightKg: 73_000,
    grossWeightKg: 164_000,
    engineName: 'Komatsu SAA12V140E-3',
    enginePowerKw: 879,
    transmission: 'HYDROMECHANICAL',
    fuelTankLiters: 1150,
    maxSpeedKmh: 65,
  },
};

export const VEHICLE_MODEL_IDS: VehicleModelId[] = Object.keys(VEHICLE_MODELS) as VehicleModelId[];

/** Водитель смены. Данные фиктивны; в промышленной системе это персональные данные. */
export interface Driver {
  fullName: string;
  phone: string;
}

export interface Vehicle {
  /** Идентификатор в API: 'v-12'. */
  id: string;
  /** Бортовой номер. */
  sideNumber: string;
  /** Государственный регистрационный знак (Гостехнадзор). */
  plate: string;
  modelId: VehicleModelId;
  /** Год выпуска. */
  year: number;
  /** Наработка двигателя на старте симуляции, моточасы. */
  engineHoursAtStart: number;
  driver: Driver;
  defaultRouteId: RouteId;
}

/** Три именные машины: всегда присутствуют и неизменны (раздел 5.1 `CONTEXT.md`). */
export const NAMED_VEHICLES: Vehicle[] = [
  {
    id: 'v-12',
    sideNumber: '12',
    plate: '4212 КЕ 42',
    modelId: 'BELAZ_75131',
    year: 2021,
    engineHoursAtStart: 18_400,
    driver: { fullName: 'Гаврилов Сергей Петрович', phone: '+7 913 450-11-27' },
    defaultRouteId: 'PIT_TO_CRUSHER',
  },
  {
    id: 'v-07',
    sideNumber: '07',
    plate: '3907 КЕ 42',
    modelId: 'BELAZ_7555B',
    year: 2019,
    engineHoursAtStart: 26_100,
    driver: { fullName: 'Нуртдинов Ильдар Рафикович', phone: '+7 913 450-11-84' },
    defaultRouteId: 'PIT_TO_DUMP',
  },
  {
    id: 'v-21',
    sideNumber: '21',
    plate: '5521 КЕ 42',
    modelId: 'KOMATSU_HD785_7',
    year: 2018,
    engineHoursAtStart: 31_900,
    driver: { fullName: 'Ковтун Андрей Валерьевич', phone: '+7 913 450-12-06' },
    defaultRouteId: 'PIT_TO_CRUSHER',
  },
];

/** Максимальное число машин в парке. */
export const MAX_VEHICLES = 60;

/** Минимальное число машин: три именные. */
export const MIN_VEHICLES = NAMED_VEHICLES.length;

/** Пул моделей для генерации остальных машин (раздел 5.2 `CONTEXT.md`). */
const MODEL_POOL: VehicleModelId[] = [
  'BELAZ_7555B',
  'BELAZ_75131',
  'BELAZ_7540V',
  'KOMATSU_HD785_7',
];

/** Фиктивные фамилии, имена и отчества. Персональные данные, см. заголовок файла. */
const SURNAMES = [
  'Абрамов',
  'Белов',
  'Ващенко',
  'Гнатюк',
  'Дорохов',
  'Ерофеев',
  'Жуков',
  'Зарипов',
  'Исаев',
  'Кузнецов',
  'Лапшин',
  'Мухаметшин',
  'Нестеров',
  'Овчинников',
  'Панкратов',
  'Романюк',
  'Савельев',
  'Тихонов',
  'Ушаков',
  'Федорчук',
  'Хайруллин',
  'Цветков',
  'Черепанов',
  'Шадрин',
  'Щербаков',
  'Юрченко',
  'Ямщиков',
];

const FIRST_NAMES = [
  'Александр',
  'Виктор',
  'Геннадий',
  'Дмитрий',
  'Евгений',
  'Игорь',
  'Константин',
  'Леонид',
  'Максим',
  'Николай',
  'Олег',
  'Павел',
  'Роман',
  'Станислав',
  'Тимур',
  'Юрий',
];

const PATRONYMICS = [
  'Алексеевич',
  'Борисович',
  'Викторович',
  'Геннадьевич',
  'Дмитриевич',
  'Ильич',
  'Кузьмич',
  'Михайлович',
  'Николаевич',
  'Петрович',
  'Рафикович',
  'Сергеевич',
  'Федорович',
  'Юрьевич',
];

/** Буквенная часть государственных номеров Гостехнадзора Кемеровской области. */
const PLATE_SUFFIX = 'КЕ 42';

/** Номерная емкость телефонов: +7 913 450-XX-XX. */
const PHONE_PREFIX = '+7 913 450';

/** Маршруты, на которые ставятся сгенерированные машины. */
const ROUTE_POOL: RouteId[] = ['PIT_TO_CRUSHER', 'PIT_TO_DUMP', 'UPPER_BENCH'];

const MIN_YEAR = 2012;
const MAX_YEAR = 2024;
const MIN_ENGINE_HOURS = 3000;
const MAX_ENGINE_HOURS = 42_000;

/** Детерминированный генератор псевдослучайных чисел (mulberry32). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, pool: readonly T[], fallback: T): T {
  const index = Math.floor(random() * pool.length);
  return pool[index] ?? fallback;
}

function randomInt(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/**
 * Парк из `count` машин: первые три всегда именные, остальные генерируются
 * детерминированно от `seed` (одинаковый seed дает одинаковый парк).
 */
export function generateFleet(count: number, seed: number): Vehicle[] {
  const total = Math.min(Math.max(Math.trunc(count), MIN_VEHICLES), MAX_VEHICLES);
  const random = mulberry32(seed);
  const vehicles: Vehicle[] = [...NAMED_VEHICLES];
  const usedSideNumbers = new Set(NAMED_VEHICLES.map((vehicle) => vehicle.sideNumber));
  let sideNumberCandidate = 1;
  for (let i = vehicles.length; i < total; i += 1) {
    while (usedSideNumbers.has(String(sideNumberCandidate).padStart(2, '0'))) {
      sideNumberCandidate += 1;
    }
    const sideNumber = String(sideNumberCandidate).padStart(2, '0');
    usedSideNumbers.add(sideNumber);
    const modelId = pick(random, MODEL_POOL, 'BELAZ_7555B');
    const plateNumber = randomInt(random, 1000, 9999);
    const fullName = [
      pick(random, SURNAMES, 'Абрамов'),
      pick(random, FIRST_NAMES, 'Александр'),
      pick(random, PATRONYMICS, 'Алексеевич'),
    ].join(' ');
    const phoneTail = String(randomInt(random, 1300, 9999)).padStart(4, '0');
    vehicles.push({
      id: `v-${sideNumber}`,
      sideNumber,
      plate: `${plateNumber} ${PLATE_SUFFIX}`,
      modelId,
      year: randomInt(random, MIN_YEAR, MAX_YEAR),
      engineHoursAtStart: randomInt(random, MIN_ENGINE_HOURS, MAX_ENGINE_HOURS),
      driver: {
        fullName,
        phone: `${PHONE_PREFIX}-${phoneTail.slice(0, 2)}-${phoneTail.slice(2)}`,
      },
      defaultRouteId: pick(random, ROUTE_POOL, 'PIT_TO_CRUSHER'),
    });
  }
  return vehicles;
}

export function getVehicleModel(id: VehicleModelId): VehicleModel {
  return VEHICLE_MODELS[id];
}

/** Паспортная величина модели, от которой считаются относительные нормативы. */
export function modelReferenceValue(
  model: VehicleModel,
  base: 'ratedPayload' | 'grossWeight',
): number {
  return base === 'ratedPayload' ? model.ratedPayloadKg : model.grossWeightKg;
}
