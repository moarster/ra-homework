/**
 * Светофорные классы. Единственный источник соответствия "уровень -> цвет" для всего интерфейса:
 * карта, плашки, графики, сводки и бейджи красятся одинаково (раздел 7 `CONTEXT.md`).
 */

import { SEVERITY, SEVERITY_NAMES, type Severity } from '@ra/contracts';

export interface SeverityClasses {
  /** Цвет текста и иконок: отдельный от заливки ради контраста на светлом фоне. */
  text: string;
  /** Мягкая подложка. */
  surface: string;
  /** Насыщенная заливка, для точек и индикаторов. */
  solid: string;
  /** Граница. */
  border: string;
  /** Название уровня по-русски. */
  name: string;
}

export const SEVERITY_CLASSES: Record<Severity, SeverityClasses> = {
  [SEVERITY.OK]: {
    text: 'text-sev-ok-text',
    surface: 'bg-sev-ok-soft',
    solid: 'bg-sev-ok',
    border: 'border-sev-ok',
    name: SEVERITY_NAMES[SEVERITY.OK],
  },
  [SEVERITY.WARN]: {
    text: 'text-sev-warn-text',
    surface: 'bg-sev-warn-soft',
    solid: 'bg-sev-warn',
    border: 'border-sev-warn',
    name: SEVERITY_NAMES[SEVERITY.WARN],
  },
  [SEVERITY.ALARM]: {
    text: 'text-sev-alarm-text',
    surface: 'bg-sev-alarm-soft',
    solid: 'bg-sev-alarm',
    border: 'border-sev-alarm',
    name: SEVERITY_NAMES[SEVERITY.ALARM],
  },
  [SEVERITY.UNKNOWN]: {
    text: 'text-sev-unknown-text',
    surface: 'bg-sev-unknown-soft',
    solid: 'bg-sev-unknown',
    border: 'border-sev-unknown',
    name: SEVERITY_NAMES[SEVERITY.UNKNOWN],
  },
};

export function severityClasses(severity: Severity): SeverityClasses {
  return SEVERITY_CLASSES[severity];
}
