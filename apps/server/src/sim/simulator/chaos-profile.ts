/**
 * Мера хаоса как один профиль коэффициентов (раздел 7 `5_PROMPT_SIMULATOR.md`).
 *
 * Хаос управляет не только частотой сценариев, но и фоном обычной работы: шумом, дрейфом,
 * разнородностью парка, сдвигом целей к желтой зоне, простоями и качеством связи. Все
 * зависящие от уровня числа живут только здесь - в остальном коде условий по уровню нет.
 */

import { CHAOS_LEVELS, type ChaosLevel } from '@ra/contracts';

export interface ChaosProfile {
  /** Множитель быстрого шума. */
  noiseGain: number;
  /** Множитель медленного дрейфа. */
  driftGain: number;
  /** Разброс индивидуального смещения машин, доля. */
  vehicleSpread: number;
  /** Сдвиг целей режима в сторону желтой зоны, доля расстояния до нее. */
  targetBias: number;
  /** Разброс целевой скорости, доля. */
  speedSpread: number;
  /** Разброс массы груза при погрузке, доля. */
  payloadSpread: number;
  /** Добавка к цели температуры тормозов на порожнем ходу, C. */
  brakeBias: number;
  /** Разброс длительности фаз цикла, доля. */
  phaseSpread: number;
  /** Доля холостого хода за смену. */
  idleShare: [number, number];
  /** Шум координат, м: наибольшее отклонение публикуемой точки. */
  gnssJitterM: number;
  /** Множитель ширины коридора движения. */
  corridorGain: number;
  /** Разброс интервала между кадрами, с. */
  frameIntervalRange: [number, number];
  /** Доля кадров с качеством не GOOD. */
  badQualityShare: number;
  /** Доля одиночных пропущенных кадров. */
  dropFrameShare: number;
  /** Сценариев на машину за 12 ч: берется из `CHAOS_LEVELS` контрактов. */
  scenariosPerShift: number;
  /** Длительность провалов связи, мин. */
  outageRange: [number, number];
  /** Доля длинных провалов связи и их верхняя граница, мин. */
  longOutageShare: number;
  longOutageMaxMinutes: number;
  /**
   * Сколько сценариев одновременно может быть у машины. Наложение запрещено или разрешено
   * флагом `allowOverlap` в контрактах; здесь - числовой предел для разрешенного случая.
   */
  maxScenarios: number;
}

type LevelValues = Omit<ChaosProfile, 'scenariosPerShift'>;

const LEVELS: Record<ChaosLevel, LevelValues> = {
  NORMAL: {
    noiseGain: 1,
    driftGain: 1,
    vehicleSpread: 0.025,
    targetBias: 0,
    speedSpread: 0.08,
    payloadSpread: 0.06,
    brakeBias: 0,
    phaseSpread: 0.2,
    idleShare: [0.1, 0.15],
    gnssJitterM: 2.5,
    corridorGain: 1,
    frameIntervalRange: [1, 1],
    badQualityShare: 0.004,
    dropFrameShare: 0,
    outageRange: [2, 8],
    longOutageShare: 0,
    longOutageMaxMinutes: 8,
    maxScenarios: 1,
  },
  MESSY: {
    noiseGain: 1.6,
    driftGain: 1.8,
    vehicleSpread: 0.05,
    targetBias: 0.15,
    speedSpread: 0.15,
    payloadSpread: 0.1,
    brakeBias: 20,
    phaseSpread: 0.4,
    idleShare: [0.15, 0.25],
    gnssJitterM: 4,
    corridorGain: 1.2,
    frameIntervalRange: [1, 1.1],
    badQualityShare: 0.01,
    dropFrameShare: 0.002,
    outageRange: [2, 15],
    longOutageShare: 0,
    longOutageMaxMinutes: 15,
    maxScenarios: 1,
  },
  UGLY: {
    noiseGain: 2.4,
    driftGain: 3,
    vehicleSpread: 0.08,
    targetBias: 0.35,
    speedSpread: 0.25,
    payloadSpread: 0.14,
    brakeBias: 50,
    phaseSpread: 0.7,
    idleShare: [0.25, 0.35],
    gnssJitterM: 6,
    corridorGain: 1.4,
    frameIntervalRange: [0.9, 1.3],
    badQualityShare: 0.03,
    dropFrameShare: 0.01,
    outageRange: [2, 40],
    longOutageShare: 0,
    longOutageMaxMinutes: 40,
    maxScenarios: 2,
  },
  CHAOS: {
    noiseGain: 3.5,
    driftGain: 4.5,
    vehicleSpread: 0.12,
    targetBias: 0.55,
    speedSpread: 0.35,
    payloadSpread: 0.2,
    brakeBias: 80,
    phaseSpread: 1,
    idleShare: [0.35, 0.5],
    gnssJitterM: 9,
    corridorGain: 1.7,
    frameIntervalRange: [0.8, 1.6],
    badQualityShare: 0.06,
    dropFrameShare: 0.03,
    outageRange: [2, 40],
    longOutageShare: 0.1,
    longOutageMaxMinutes: 180,
    maxScenarios: 4,
  },
};

const PROFILES = new Map<ChaosLevel, ChaosProfile>();
for (const level of CHAOS_LEVELS) {
  const values = LEVELS[level.id];
  PROFILES.set(level.id, {
    ...values,
    scenariosPerShift: level.intensity,
    maxScenarios: level.allowOverlap ? values.maxScenarios : 1,
  });
}

/** Профиль уровня хаоса. Возвращается общий объект: мутировать его нельзя. */
export function chaosProfile(level: ChaosLevel): ChaosProfile {
  const profile = PROFILES.get(level);
  if (profile === undefined) {
    throw new Error(`неизвестный уровень хаоса: ${level}`);
  }
  return profile;
}
