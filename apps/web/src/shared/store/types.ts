/** Типы управляющего состояния приложения (раздел 10 `SPEC.md`). */

import type { MetricId, PeriodId, SimState } from '@ra/contracts';

export type ThemeName = 'light' | 'dark';

export type CollapsedPane = 'none' | 'left' | 'right';

export interface SplitState {
  /** Доля левой области в процентах ширины рабочей зоны. */
  leftPercent: number;
  collapsed: CollapsedPane;
}

/** Состояние соединения websocket: показывается в верхней полоске. */
export type ConnectionStatus = 'offline' | 'connecting' | 'online' | 'reconnecting';

export interface AppState {
  periodId: PeriodId;
  realtime: boolean;
  /** Точка временного фокуса; null - следим за последней точкой. */
  monitorTs: number | null;
  selectedVehicleId: string | null;
  /** Показатель, к которому надо проскроллить полотно графиков. */
  focusMetric: MetricId | null;
  trackedMetrics: MetricId[];
  trackTailSeconds: number;
  theme: ThemeName;
  split: SplitState;
  /** Зеркало состояния симуляции на сервере. */
  sim: SimState;
  connection: ConnectionStatus;
}

export interface AppActions {
  setPeriodId: (periodId: PeriodId) => void;
  setRealtime: (realtime: boolean) => void;
  toggleRealtime: () => void;
  setMonitorTs: (monitorTs: number | null) => void;
  /** Кнопка "к последней точке". */
  clearMonitor: () => void;
  selectVehicle: (vehicleId: string | null) => void;
  setFocusMetric: (metricId: MetricId | null) => void;
  setTrackedMetrics: (metrics: MetricId[]) => void;
  toggleTrackedMetric: (metricId: MetricId) => void;
  setTrackTailSeconds: (seconds: number) => void;
  setTheme: (theme: ThemeName) => void;
  toggleTheme: () => void;
  setSplitPercent: (leftPercent: number) => void;
  setCollapsed: (collapsed: CollapsedPane) => void;
  resetSplit: () => void;
  setSim: (sim: SimState) => void;
  setConnection: (connection: ConnectionStatus) => void;
}

export type AppStore = AppState & AppActions;
