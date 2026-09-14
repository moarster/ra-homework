/**
 * Иконки показателей и групп: inline-SVG, viewBox 0 0 24 24, цвет через `currentColor`.
 *
 * На этапе 0 все иконки одинаковы - общая заглушка. Уникальные рисуются на этапе 6;
 * важно, что структура данных финальная: замена иконок будет правкой только этого файла.
 */

/** Общая заглушка: круг с точкой. */
export const PLACEHOLDER_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/></svg>';

/** Иконка показателя по идентификатору. На этапе 0 всегда заглушка. */
export function metricIcon(_metricId: string): string {
  return PLACEHOLDER_ICON;
}

/** Иконка группы показателей по идентификатору. На этапе 0 всегда заглушка. */
export function metricGroupIcon(_groupId: string): string {
  return PLACEHOLDER_ICON;
}
