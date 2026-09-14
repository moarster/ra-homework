/**
 * Цвета для canvas. Canvas не понимает CSS-переменные, поэтому токены темы один раз
 * вычисляются в строки и кешируются до следующей смены темы.
 *
 * Источник цветов тот же, что у всего интерфейса (`app/theme/tokens.css`), поэтому машина
 * на карте и плашка той же машины в списке совпадают по цвету по построению, а не по
 * договоренности (раздел 7 `CONTEXT.md`).
 */

import { SEVERITY, type Severity } from '@ra/contracts';
import type { ThemeName } from '@/shared/store';

export interface MapPalette {
  severity: Record<Severity, string>;
  /** Обводка машины: отделяет пиктограмму от пестрого снимка. */
  vehicleStroke: string;
  /** Кольцо машины без данных. */
  noDataRing: string;
  label: string;
  labelShadow: string;
  accent: string;
  /** Ореол под элементом, на который наведен курсор. */
  hoverHalo: string;
  /** Подложка, когда тайлы недоступны. */
  backdrop: string;
  /** Контур карьера на подложке. */
  outline: string;
  selection: string;
}

function readToken(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

let cache: { theme: ThemeName; palette: MapPalette } | null = null;

export function mapPalette(theme: ThemeName): MapPalette {
  if (cache !== null && cache.theme === theme) {
    return cache.palette;
  }
  const styles = getComputedStyle(document.documentElement);
  const palette: MapPalette = {
    severity: {
      [SEVERITY.OK]: readToken(styles, '--sev-ok', '#2fa36b'),
      [SEVERITY.WARN]: readToken(styles, '--sev-warn', '#c9881a'),
      [SEVERITY.ALARM]: readToken(styles, '--sev-alarm', '#d9453d'),
      [SEVERITY.UNKNOWN]: readToken(styles, '--sev-unknown', '#7b848b'),
    },
    // Обводка и подписи всегда контрастны снимку, а не теме: снимок темный в обеих темах.
    vehicleStroke: 'rgba(8, 16, 16, 0.85)',
    noDataRing: readToken(styles, '--sev-alarm', '#d9453d'),
    label: '#ffffff',
    labelShadow: 'rgba(8, 16, 16, 0.9)',
    accent: readToken(styles, '--accent-500', '#e0492f'),
    // Ореол белый в обеих темах: он лежит поверх спутникового снимка, а не поверх фона
    // интерфейса, и должен читаться и на светлом отвале, и на темном борту уступа.
    hoverHalo: 'rgba(255, 255, 255, 0.3)',
    backdrop: readToken(styles, '--bg-deep', '#dde5e5'),
    outline: readToken(styles, '--fg-faint', '#5f6f6d'),
    selection: readToken(styles, '--primary-400', '#2ec4b2'),
  };
  cache = { theme, palette };
  return palette;
}
