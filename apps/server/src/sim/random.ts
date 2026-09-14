/**
 * Детерминированный генератор псевдослучайных чисел.
 *
 * Отдельный экземпляр на машину: тогда прогон воспроизводится по seed независимо от порядка,
 * в котором машины обходятся, и от числа машин в парке.
 */

/** mulberry32: 32-битный счетчик с хорошим перемешиванием, достаточно для симуляции. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Число в диапазоне [min, max). */
export function range(random: () => number, min: number, max: number): number {
  return min + random() * (max - min);
}

/** Целое в диапазоне [min, max]. */
export function rangeInt(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/**
 * Нормальный шум со средним 0 и единичной дисперсией: сумма двух равномерных величин
 * (приближение Ирвина-Холла). Хвостов нет, для дрейфа показателей этого достаточно
 * и не бывает выбросов на пять сигм.
 */
export function noise(random: () => number): number {
  return random() + random() - 1;
}

/** Экспоненциальное сглаживание: подтянуть текущее значение к целевому за время tau секунд. */
export function approach(current: number, target: number, tauSeconds: number): number {
  const k = 1 - Math.exp(-1 / Math.max(1, tauSeconds));
  return current + (target - current) * k;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
