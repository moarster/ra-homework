/** Склейка классов: короче и честнее, чем зависимость ради одной функции. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ');
}
