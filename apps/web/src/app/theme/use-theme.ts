/**
 * Применение темы к документу. Компоненты тему не знают: меняется только атрибут
 * `data-theme` на `html`, а все цвета приходят из CSS-переменных - поэтому переключение
 * мгновенное и не требует перемонтирования дерева.
 */

import { useEffect } from 'react';
import { useAppStore, useTheme } from '@/shared/store';

export function useApplyTheme(): void {
  const theme = useAppStore((state) => state.theme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    // Если пользователь не выбирал тему руками, следим за системной.
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => {
      if (localStorage.getItem('ra.theme') === null) {
        useAppStore.getState().setTheme(event.matches ? 'dark' : 'light');
      }
    };
    media.addEventListener('change', onChange);
    return () => {
      media.removeEventListener('change', onChange);
    };
  }, []);
}

export { useTheme };
