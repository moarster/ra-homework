/**
 * Дублирование части состояния в localStorage. В URL живет контекст одного экрана,
 * в localStorage - предпочтения, которые должны переживать открытие чистого адреса:
 * тема и геометрия сплиттера (раздел 4 `2_PROMPT_FRONT_SHELL.md`).
 */

import type { SplitState, ThemeName } from './types.js';

const THEME_KEY = 'ra.theme';
const SPLIT_KEY = 'ra.split';

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Приватный режим и запрет хранилища не должны ломать запуск приложения.
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Молча: потеря предпочтения не стоит падения интерфейса.
  }
}

export function loadStoredTheme(): ThemeName | null {
  const raw = readRaw(THEME_KEY);
  return raw === 'light' || raw === 'dark' ? raw : null;
}

export function storeTheme(theme: ThemeName): void {
  writeRaw(THEME_KEY, theme);
}

export function loadStoredSplit(): SplitState | null {
  const raw = readRaw(SPLIT_KEY);
  if (raw === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const { leftPercent, collapsed } = parsed as Partial<SplitState>;
    if (typeof leftPercent !== 'number' || !Number.isFinite(leftPercent)) {
      return null;
    }
    if (collapsed !== 'none' && collapsed !== 'left' && collapsed !== 'right') {
      return null;
    }
    return { leftPercent, collapsed };
  } catch {
    return null;
  }
}

export function storeSplit(split: SplitState): void {
  writeRaw(SPLIT_KEY, JSON.stringify(split));
}

/** Системная тема: используется, когда сохраненного выбора нет. */
export function systemTheme(): ThemeName {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
