/** Мелкая математика горячего цикла: без объектов и замыканий. */

/** Множитель, дающий равномерному шуму на [-0,5; 0,5) единичную дисперсию. */
const UNIT_UNIFORM = Math.sqrt(12);

/** Коэффициент шага процесса Орнштейна-Уленбека с постоянной времени tau. */
export function ouGain(tauSeconds: number): number {
  return Math.sqrt(2 / tauSeconds);
}

/**
 * Шаг сглаженного случайного процесса (Орнштейна-Уленбека) с единичной стационарной
 * дисперсией при `gain = 1`. Множитель подмешивается в приращение, а не в результат: при
 * смене уровня хаоса амплитуда нарастает или затухает за tau, без ступеньки на графике.
 */
export function ouStep(
  x: number,
  tauSeconds: number,
  stepGain: number,
  gain: number,
  random: () => number,
): number {
  return x - x / tauSeconds + stepGain * gain * (random() - 0.5) * UNIT_UNIFORM;
}

/** Симметричный шум на (-1; 1) с горбом в нуле: сумма двух равномерных. */
export function triangular(random: () => number): number {
  return random() + random() - 1;
}

/** Равномерный шум на [-1; 1). */
export function signedUniform(random: () => number): number {
  return random() * 2 - 1;
}

/** Кусочно-линейная кривая из плоского массива пар [x0, y0, x1, y1, ...]. */
export function interpolateCurve(curve: readonly number[], x: number): number {
  const n = curve.length;
  if (x <= (curve[0] ?? 0)) {
    return curve[1] ?? 0;
  }
  for (let i = 2; i < n; i += 2) {
    const x1 = curve[i] ?? 0;
    if (x <= x1) {
      const x0 = curve[i - 2] ?? 0;
      const y0 = curve[i - 1] ?? 0;
      const y1 = curve[i + 1] ?? 0;
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return curve[n - 1] ?? 0;
}
