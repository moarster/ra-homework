/**
 * Побочные эффекты стора, не относящиеся к отрисовке: запись состояния в адресную строку
 * и в localStorage. Устанавливается один раз при запуске приложения.
 */

import { appStore, defaultUrlState } from './app-store.js';
import { storeSplit, storeTheme } from './persist.js';
import { writeUrlState } from './url.js';

/**
 * Адрес переписывается пачками: перетаскивание сплиттера шлет десятки изменений подряд,
 * и на каждое вызывать `history.replaceState` не нужно.
 *
 * Намеренно таймер, а не `requestAnimationFrame`: кадры не выдаются, пока вкладка скрыта
 * или не отрисовывается, и адрес тогда молча переставал бы обновляться.
 */
const URL_WRITE_DELAY_MS = 100;

function createDebouncer(task: () => void): () => void {
  let timer: number | null = null;
  return () => {
    if (timer !== null) {
      return;
    }
    timer = window.setTimeout(() => {
      timer = null;
      task();
    }, URL_WRITE_DELAY_MS);
  };
}

export function installStoreSync(): () => void {
  const defaults = defaultUrlState();

  const writeUrl = createDebouncer(() => {
    const state = appStore.getState();
    const search = writeUrlState(state, defaults);
    const next = `${window.location.pathname}${search}${window.location.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      // replaceState, а не pushState: состояние экрана не создает записей в истории браузера.
      window.history.replaceState(window.history.state, '', next);
    }
  });

  const unsubscribeUrl = appStore.subscribe(writeUrl);
  writeUrl();

  let lastTheme = appStore.getState().theme;
  let lastSplit = appStore.getState().split;
  const unsubscribeStorage = appStore.subscribe((state) => {
    if (state.theme !== lastTheme) {
      lastTheme = state.theme;
      storeTheme(state.theme);
    }
    if (state.split !== lastSplit) {
      lastSplit = state.split;
      storeSplit(state.split);
    }
  });

  return () => {
    unsubscribeUrl();
    unsubscribeStorage();
  };
}
