/**
 * Числовые параметры заглушечного источника телеметрии.
 *
 * Заглушка нужна, чтобы на этапах 2-4 было на чем разрабатывать интерфейс: правдоподобная
 * картинка без претензий на физику. На этапе 5 она целиком заменяется симулятором, поэтому
 * ее параметры живут здесь, а не в `packages/contracts`: они не часть контракта системы.
 */

import type { ChaosLevel } from '@ra/contracts';

export const STUB_PARAMS = {
  /** Погрузка в забое, секунды. */
  loadingSeconds: 180,
  /** Разгрузка, секунды. */
  unloadingSeconds: 90,
  /** Скорость груженого, км/ч: диапазон по парку. */
  loadedSpeedKmh: [15, 25] as [number, number],
  /** Скорость порожнего, км/ч. */
  emptySpeedKmh: [25, 30] as [number, number],
  /**
   * Ограничение скорости в карьере, км/ч. Выше начинается желтая зона норматива, поэтому
   * штатно машины держатся под ним: превышение - это сценарий, а не обычная работа.
   */
  speedLimitKmh: 29.5,
  /** Как часто меняется цель бокового смещения в коридоре, секунды. */
  corridorChangeSeconds: [40, 160] as [number, number],
  /** Время подтягивания смещения к цели, секунды: смещение меняется медленно. */
  corridorTauSeconds: 25,
  /** Период показателей с частотой 0,2 Гц, секунды. */
  slowPeriodSeconds: 5,
  /** Температура окружающего воздуха, C (лето на объекте). */
  ambientC: 22,
  /** Время подтягивания температур, секунды. */
  coolantTauSeconds: 120,
  transmissionTauSeconds: 90,
  /** Остывание тормозов: доля разницы с воздухом в секунду. */
  brakeCoolingRate: 0.0035,
  /**
   * Нагрев тормозов: C в секунду на процент уклона и км/ч скорости.
   * Подобран так, чтобы затяжной спуск груженым выводил тормоза на 150-190 C -
   * верх зеленой зоны. Перегрев выше 200 C должен быть сценарием, а не нормой.
   */
  brakeHeatingRate: 0.0022,
  /** Уровень топлива на старте, проценты. */
  initialFuelPercent: [35, 95] as [number, number],
  /**
   * Ниже этого уровня машина заправляется между рейсами. Порог выше желтой зоны норматива
   * (20%): низкий уровень топлива должен быть событием, а не постоянным состоянием парка.
   */
  refuelBelowPercent: 22,
  refuelToPercent: 95,
  /** Длительность отклонения показателя, секунды. */
  anomalySeconds: [150, 420] as [number, number],
  /** Провал связи, секунды (раздел 10 `CONTEXT.md`, сценарий S11). */
  outageSeconds: [120, 2400] as [number, number],
  /** Вставка холостого хода между рейсами, секунды. */
  idleSeconds: [90, 900] as [number, number],
  /** Стоянка с заглушенным двигателем, секунды. */
  parkedSeconds: [600, 2400] as [number, number],
} as const;

export interface ChaosParams {
  /** Множитель шума и дрейфа обычной работы. */
  noiseScale: number;
  /** Отклонений показателей на машину за 12 часов. */
  anomaliesPer12h: number;
  /** Провалов связи на машину за 12 часов. */
  outagesPer12h: number;
  /** Вероятность вставить холостой ход между рейсами. */
  idleChance: number;
  /** Вероятность встать на стоянку с заглушенным двигателем между рейсами. */
  parkChance: number;
  /** Разброс базовых уровней между машинами. */
  spread: number;
}

/**
 * Мера хаоса управляет и частотой сценариев, и разбродом обычной работы
 * (раздел 10 `CONTEXT.md`): при высокой мере дашборд выглядит беспокойным и без аварий.
 * Число сценариев взято из `CHAOS_LEVELS.intensity`.
 */
export const CHAOS_PARAMS: Record<ChaosLevel, ChaosParams> = {
  NORMAL: {
    noiseScale: 1,
    anomaliesPer12h: 0.5,
    outagesPer12h: 0.3,
    idleChance: 0.05,
    parkChance: 0.01,
    spread: 0.4,
  },
  MESSY: {
    noiseScale: 1.7,
    anomaliesPer12h: 2,
    outagesPer12h: 0.8,
    idleChance: 0.15,
    parkChance: 0.03,
    spread: 0.8,
  },
  UGLY: {
    noiseScale: 2.5,
    anomaliesPer12h: 6,
    outagesPer12h: 2,
    idleChance: 0.3,
    parkChance: 0.06,
    spread: 1.3,
  },
  CHAOS: {
    noiseScale: 3.5,
    anomaliesPer12h: 15,
    outagesPer12h: 4,
    idleChance: 0.45,
    parkChance: 0.1,
    spread: 2,
  },
};

/** Секунд в 12-часовой смене: база для пересчета частоты сценариев в вероятность за секунду. */
export const SHIFT_SECONDS = 12 * 3600;
