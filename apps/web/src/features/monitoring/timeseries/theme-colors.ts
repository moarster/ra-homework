/**
 * Цвета для canvas uPlot. Canvas не понимает CSS-переменные, поэтому значения токенов
 * читаются из вычисленного стиля корня: так графики получают ту же палитру, что и остальной
 * интерфейс, и не хранят собственных цветов.
 *
 * Тема переключается атрибутом на корневом элементе. Эффект применения темы живет в корне
 * приложения и выполняется позже эффектов графиков, поэтому палитра перечитывается не по
 * значению темы в сторе, а по факту изменения атрибутов корня.
 */

import { SEVERITY, type Severity } from '@ra/contracts';
import { useSyncExternalStore } from 'react';

export interface ChartColors {
  fg: string;
  fgMuted: string;
  fgFaint: string;
  border: string;
  primary: string;
  primarySoft: string;
  accent: string;
  severity: Record<Severity, string>;
  severitySoft: Record<Severity, string>;
}

function token(style: CSSStyleDeclaration, name: string): string {
  return style.getPropertyValue(name).trim();
}

function readChartColors(): ChartColors {
  const style = getComputedStyle(document.documentElement);
  return {
    fg: token(style, '--fg'),
    fgMuted: token(style, '--fg-muted'),
    fgFaint: token(style, '--fg-faint'),
    border: token(style, '--border'),
    primary: token(style, '--primary-500'),
    primarySoft: token(style, '--primary-soft'),
    accent: token(style, '--accent-500'),
    severity: {
      [SEVERITY.OK]: token(style, '--sev-ok'),
      [SEVERITY.WARN]: token(style, '--sev-warn'),
      [SEVERITY.ALARM]: token(style, '--sev-alarm'),
      [SEVERITY.UNKNOWN]: token(style, '--sev-unknown'),
    },
    severitySoft: {
      [SEVERITY.OK]: token(style, '--sev-ok-soft'),
      [SEVERITY.WARN]: token(style, '--sev-warn-soft'),
      [SEVERITY.ALARM]: token(style, '--sev-alarm-soft'),
      [SEVERITY.UNKNOWN]: token(style, '--sev-unknown-soft'),
    },
  };
}

let cached: { key: string; colors: ChartColors } | null = null;

function getColors(): ChartColors {
  const root = document.documentElement;
  const key = `${root.getAttribute('data-theme') ?? ''}|${root.className}`;
  if (cached === null || cached.key !== key) {
    cached = { key, colors: readChartColors() };
  }
  return cached.colors;
}

function subscribe(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true });
  return () => {
    observer.disconnect();
  };
}

/** Палитра графиков; новый объект - только при смене темы. */
export function useChartColors(): ChartColors {
  return useSyncExternalStore(subscribe, getColors);
}
