/**
 * Плотность полоски. Полоска обязана оставаться тонкой в одну строку, поэтому при нехватке
 * ширины элементы последовательно упрощаются: сначала исчезают подписи, потом текст у названия,
 * даты, отслеживаемых и пользователя, и только в последнюю очередь группа симуляции уезжает
 * в поповер - ее элементы нужны на стенде чаще всего.
 *
 * Границы не зашиты в пиксели: ширина содержимого зависит от выбранного монитора, числа
 * отслеживаемых показателей, текста статуса соединения. Полоска меряет свое содержимое в текущей
 * плотности и помнит, насколько каждая плотность шире следующей, более скромной. Разница почти
 * не зависит от содержимого (подписи, название, имя пользователя), а общие для всех плотностей
 * элементы при сравнении сокращаются.
 */

export const DENSITIES = ['full', 'tight', 'dense', 'compact'] as const;

export type Density = (typeof DENSITIES)[number];

/** Подписи рядом с элементами управления показываются только в полном режиме. */
export function showsLabels(density: Density): boolean {
  return density === 'full';
}

/** Название системы, дата, имя пользователя и чипы отслеживаемых сворачиваются до иконок. */
export function isCondensed(density: Density): boolean {
  return density === 'dense' || density === 'compact';
}

/** Группа симуляции уезжает в поповер последней. */
export function simInPopover(density: Density): boolean {
  return density === 'compact';
}

/**
 * Запас при возврате к более полной плотности, пиксели: дробные ширины и мерцание текста
 * не должны гонять полоску туда-обратно на самой границе.
 */
const GROW_MARGIN_PX = 8;

export interface DensityMeasure {
  density: Density;
  /** Ширина содержимого в этой плотности. */
  contentWidth: number;
}

/**
 * Выбор плотности по замеру. `extra` - насколько каждая плотность шире следующей; обновляется
 * при каждом переходе между соседними плотностями. Неизвестная разница означает "попробовать":
 * лишний переход вверх тут же откатится, а разница запомнится.
 */
export class DensityPlanner {
  private readonly extra = new Map<Density, number>();
  private last: DensityMeasure | null = null;

  next(measure: DensityMeasure, available: number): Density {
    const index = DENSITIES.indexOf(measure.density);
    const previous = this.last;
    if (previous !== null) {
      const previousIndex = DENSITIES.indexOf(previous.density);
      if (Math.abs(previousIndex - index) === 1) {
        const [fuller, leaner] = previousIndex < index ? [previous, measure] : [measure, previous];
        this.extra.set(fuller.density, fuller.contentWidth - leaner.contentWidth);
      }
    }
    this.last = measure;

    if (measure.contentWidth > available) {
      return DENSITIES[Math.min(index + 1, DENSITIES.length - 1)] as Density;
    }
    const fuller = DENSITIES[index - 1];
    if (fuller === undefined) {
      return measure.density;
    }
    const extra = this.extra.get(fuller);
    if (extra === undefined || measure.contentWidth + extra + GROW_MARGIN_PX <= available) {
      return fuller;
    }
    return measure.density;
  }
}
