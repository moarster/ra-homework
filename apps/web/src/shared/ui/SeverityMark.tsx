/**
 * Форма уровня светофора: дублирует цвет, чтобы статус различался и при дальтонизме
 * (красный и зеленый при дейтеранопии сливаются). Авария - треугольник, предупреждение -
 * круг с восклицательным знаком, норма - галочка, нет данных - пунктирный круг.
 * Цвет наследуется: снаружи задается текстовым классом из `severityClasses`.
 */

import { SEVERITY, type Severity } from '@ra/contracts';
import { cx } from './cx.js';
import { severityClasses } from './severity.js';

const SHAPES: Record<Severity, React.ReactNode> = {
  [SEVERITY.ALARM]: (
    <>
      <path d="M12 3.5 21.5 20h-19Z" />
      <path d="M12 10v4.5M12 17.2h.01" />
    </>
  ),
  [SEVERITY.WARN]: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5.5M12 16.2h.01" />
    </>
  ),
  [SEVERITY.OK]: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8 12.2 2.8 2.8L16 9.5" />
    </>
  ),
  [SEVERITY.UNKNOWN]: <circle cx="12" cy="12" r="8.5" strokeDasharray="3.5 3" />,
};

export interface SeverityMarkProps {
  severity: Severity;
  className?: string;
}

export function SeverityMark({ severity, className }: SeverityMarkProps) {
  const classes = severityClasses(severity);
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={classes.name}
      className={cx('size-3.5 shrink-0', classes.text, className)}
    >
      <title>{classes.name}</title>
      {SHAPES[severity]}
    </svg>
  );
}
