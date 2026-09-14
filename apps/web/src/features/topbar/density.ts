/**
 * Плотность полоски. Полоска обязана оставаться тонкой в одну строку, поэтому при нехватке
 * ширины элементы последовательно упрощаются: сначала исчезают подписи, потом группа симуляции
 * уезжает в поповер.
 */

export type Density = 'full' | 'tight' | 'compact';

/**
 * Границы переключения, пиксели ширины полоски. Значения подобраны по фактической ширине
 * содержимого: в полном режиме полоска занимает около 1400 px, без подписей - около 1280 px.
 */
const TIGHT_BELOW_PX = 1640;
const COMPACT_BELOW_PX = 1440;

export function densityForWidth(width: number): Density {
  if (width === 0) {
    return 'full';
  }
  if (width < COMPACT_BELOW_PX) {
    return 'compact';
  }
  if (width < TIGHT_BELOW_PX) {
    return 'tight';
  }
  return 'full';
}

/** Подписи рядом с элементами управления показываются только в полном режиме. */
export function showsLabels(density: Density): boolean {
  return density === 'full';
}

/** В компактном режиме группа симуляции прячется в поповер. */
export function simInPopover(density: Density): boolean {
  return density === 'compact';
}
