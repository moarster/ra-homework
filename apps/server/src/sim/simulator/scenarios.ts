/**
 * Сценарии отклонений (раздел 6 `5_PROMPT_SIMULATOR.md`, каталог - раздел 10 `CONTEXT.md`).
 *
 * Сценарий - временное изменение целей или параметров модели, а не подмена значения в кадре:
 * скачок без инерции читается как сбой датчика. Здесь только каталог и выбор; сама механика
 * живет в модели машины рядом с показателями, которые сценарий меняет.
 */

export const SCENARIO = {
  /** S1. Перегрев трансмиссии: груженый ход плюс хвост. */
  TRANSMISSION_OVERHEAT: 0,
  /** S2. Перегрев тормозов на порожнем спуске. */
  BRAKE_OVERHEAT: 1,
  /** S3. Подклинивший тормоз одного колеса, часы. */
  STUCK_BRAKE: 2,
  /** S6 каталога. Перегруз на один рейс. */
  OVERLOAD: 3,
  /** S4 каталога. Падение давления масла: резко или ползком. */
  OIL_PRESSURE_DROP: 4,
  /** S11 каталога. Провал связи с дозаливкой. */
  OUTAGE: 5,
  /** S10. Слив топлива на стоянке (необязательный). */
  FUEL_THEFT: 6,
  /** S9. Превышение скорости (необязательный). */
  OVERSPEED: 7,
  /** S8. Трогание с поднятой платформой (необязательный). */
  BODY_UP_WHILE_MOVING: 8,
  /** S7. Кривая загрузка (необязательный). */
  SKEWED_LOAD: 9,
} as const;

export type ScenarioKind = (typeof SCENARIO)[keyof typeof SCENARIO];

export const SCENARIO_COUNT = 10;

export const SCENARIO_CODES: string[] = [
  'TRANSMISSION_OVERHEAT',
  'BRAKE_OVERHEAT',
  'STUCK_BRAKE',
  'OVERLOAD',
  'OIL_PRESSURE_DROP',
  'OUTAGE',
  'FUEL_THEFT',
  'OVERSPEED',
  'BODY_UP_WHILE_MOVING',
  'SKEWED_LOAD',
];

/** Обязательные шесть сценариев. */
export const MANDATORY_SCENARIOS: ScenarioKind[] = [0, 1, 2, 3, 4, 5];

/**
 * Веса выбора: обязательные сценарии выпадают вдвое чаще необязательных - именно их
 * показывают на защите.
 */
const WEIGHTS: number[] = [1, 1, 1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5];

const CUMULATIVE = new Float64Array(SCENARIO_COUNT);
{
  const total = WEIGHTS.reduce((sum, weight) => sum + weight, 0);
  let acc = 0;
  for (let i = 0; i < SCENARIO_COUNT; i += 1) {
    acc += (WEIGHTS[i] ?? 0) / total;
    CUMULATIVE[i] = acc;
  }
}

/** Выбрать вид сценария по весам. */
export function pickScenario(random: () => number): ScenarioKind {
  const roll = random();
  for (let i = 0; i < SCENARIO_COUNT; i += 1) {
    if (roll < (CUMULATIVE[i] ?? 1)) {
      return i as ScenarioKind;
    }
  }
  return SCENARIO.OUTAGE;
}

/**
 * Момент, в который отложенный сценарий начинается. Привязка к режиму там, где она очевидна:
 * перегрев трансмиссии - только на груженом ходу, тормозов - только на порожнем спуске,
 * слив топлива - только на стоянке с заглушенным двигателем.
 */
export const TRIGGER = {
  /** Сразу (с работающим двигателем, если сценарий этого требует). */
  IMMEDIATE: 0,
  LOADING_START: 1,
  HAULING_START: 2,
  UNLOADING_START: 3,
  RETURNING_START: 4,
  BREAK_START: 5,
  /** На порожнем ходу, когда до остановки далеко. */
  RETURNING_OPEN_ROAD: 6,
} as const;

export type Trigger = (typeof TRIGGER)[keyof typeof TRIGGER];

export const SCENARIO_TRIGGERS: Trigger[] = [
  TRIGGER.HAULING_START,
  TRIGGER.RETURNING_START,
  TRIGGER.IMMEDIATE,
  TRIGGER.LOADING_START,
  TRIGGER.IMMEDIATE,
  TRIGGER.IMMEDIATE,
  TRIGGER.BREAK_START,
  TRIGGER.RETURNING_OPEN_ROAD,
  TRIGGER.UNLOADING_START,
  TRIGGER.LOADING_START,
];
