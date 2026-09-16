/**
 * Глобальный стор управляющего состояния (раздел 10 `SPEC.md`).
 *
 * В сторе нет и не должно быть телеметрии: ответы REST живут в кеше TanStack Query,
 * снапшоты машин - в mutable-хранилище `shared/ws/snapshot-store.ts`. Иначе каждый тик
 * пересоздавал бы состояние и перерисовывал весь экран.
 */

import { APP_CONFIG, DEFAULT_PERIOD_ID, MIN_VEHICLES } from '@ra/contracts';
import { create } from 'zustand';
import { loadStoredSplit, loadStoredTheme, systemTheme } from './persist.js';
import type { AppState, AppStore, SplitState } from './types.js';
import { readUrlState, type UrlState } from './url.js';

/** Сплиттер по умолчанию: равные области. */
const DEFAULT_SPLIT: SplitState = { leftPercent: 50, collapsed: 'none' };

/**
 * Зеркало симуляции до первого ответа сервера. Нули честнее выдуманных значений:
 * интерфейс по ним видит, что данных еще нет, и показывает скелетоны.
 */
const INITIAL_SIM: AppState['sim'] = {
  simTime: 0,
  historyFrom: 0,
  timeScale: 1,
  vehicleCount: MIN_VEHICLES,
  chaos: 'NORMAL',
  seed: 0,
  running: false,
};

/** Значения по умолчанию той части состояния, что синхронизируется с адресом. */
export function defaultUrlState(): UrlState {
  return {
    periodId: DEFAULT_PERIOD_ID,
    realtime: true,
    monitorTs: null,
    selectedVehicleId: null,
    trackedMetrics: [],
    trackTailSeconds: APP_CONFIG.track.defaultTailSeconds,
    theme: systemTheme(),
    split: DEFAULT_SPLIT,
  };
}

function clampTail(seconds: number): number {
  const { pointStepSeconds, maxTailSeconds } = APP_CONFIG.track;
  return Math.min(Math.max(Math.round(seconds), pointStepSeconds), maxTailSeconds);
}

function clampPercent(percent: number): number {
  return Math.min(Math.max(percent, 0), 100);
}

/**
 * Начальное состояние: значения по умолчанию, поверх них localStorage (тема и сплиттер),
 * поверх всего - адресная строка. Адрес главнее, потому что это осознанно открытая ссылка.
 */
function initialState(): AppState {
  const defaults = defaultUrlState();
  const storedTheme = loadStoredTheme();
  const storedSplit = loadStoredSplit();
  const stored: Partial<UrlState> = {
    ...(storedTheme !== null ? { theme: storedTheme } : {}),
    ...(storedSplit !== null ? { split: storedSplit } : {}),
  };
  const fromUrl = readUrlState(window.location.search);
  const merged: UrlState = { ...defaults, ...stored, ...fromUrl };
  return {
    ...merged,
    trackTailSeconds: clampTail(merged.trackTailSeconds),
    split: { ...merged.split, leftPercent: clampPercent(merged.split.leftPercent) },
    focusMetric: null,
    sim: INITIAL_SIM,
    connection: 'offline',
    viewers: null,
    simChangedByOtherAt: 0,
  };
}

export const useAppStore = create<AppStore>()((set, get) => ({
  ...initialState(),

  setPeriodId: (periodId) => {
    set({ periodId });
  },
  setRealtime: (realtime) => {
    set({ realtime });
  },
  toggleRealtime: () => {
    set({ realtime: !get().realtime });
  },
  setMonitorTs: (monitorTs) => {
    set({ monitorTs });
  },
  clearMonitor: () => {
    set({ monitorTs: null });
  },
  selectVehicle: (vehicleId) => {
    if (get().selectedVehicleId === vehicleId) {
      return;
    }
    // Смена машины - единственный случай, когда монитор сбрасывается сам (раздел 9.5 CONTEXT.md).
    set({ selectedVehicleId: vehicleId, monitorTs: null, focusMetric: null });
  },
  setFocusMetric: (focusMetric) => {
    set({ focusMetric });
  },
  setTrackedMetrics: (trackedMetrics) => {
    set({ trackedMetrics });
  },
  toggleTrackedMetric: (metricId) => {
    const current = get().trackedMetrics;
    set({
      trackedMetrics: current.includes(metricId)
        ? current.filter((item) => item !== metricId)
        : [...current, metricId],
    });
  },
  setTrackTailSeconds: (seconds) => {
    set({ trackTailSeconds: clampTail(seconds) });
  },
  setTheme: (theme) => {
    set({ theme });
  },
  toggleTheme: () => {
    set({ theme: get().theme === 'dark' ? 'light' : 'dark' });
  },
  setSplitPercent: (leftPercent) => {
    set({ split: { leftPercent: clampPercent(leftPercent), collapsed: 'none' } });
  },
  setCollapsed: (collapsed) => {
    set({ split: { ...get().split, collapsed } });
  },
  resetSplit: () => {
    set({ split: DEFAULT_SPLIT });
  },
  setSim: (sim) => {
    set({ sim });
  },
  setConnection: (connection) => {
    set({ connection });
  },
  setViewers: (viewers) => {
    set({ viewers });
  },
  noteSimChangedByOther: () => {
    set({ simChangedByOtherAt: Date.now() });
  },
}));

/** Доступ к стору вне React: клиент websocket и синхронизация с адресом. */
export const appStore = useAppStore;
