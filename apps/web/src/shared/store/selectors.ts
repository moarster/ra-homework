/**
 * Точечные селекторы. В компонентах читается именно такой хук, а не весь стор:
 * подписка на весь стор означала бы перерисовку всего экрана на каждое изменение.
 */

import { DEFAULT_PERIOD_ID, PERIODS } from '@ra/contracts';
import { useAppStore } from './app-store.js';

export const usePeriodId = () => useAppStore((state) => state.periodId);
export const useRealtime = () => useAppStore((state) => state.realtime);
export const useMonitorTs = () => useAppStore((state) => state.monitorTs);
export const useSelectedVehicleId = () => useAppStore((state) => state.selectedVehicleId);
export const useFocusMetric = () => useAppStore((state) => state.focusMetric);
export const useTrackedMetrics = () => useAppStore((state) => state.trackedMetrics);
export const useTrackTailSeconds = () => useAppStore((state) => state.trackTailSeconds);
export const useTheme = () => useAppStore((state) => state.theme);
export const useSplit = () => useAppStore((state) => state.split);
export const useSim = () => useAppStore((state) => state.sim);
export const useConnection = () => useAppStore((state) => state.connection);

/** Длина периода по умолчанию: страховка, если в состоянии оказался неизвестный период. */
const DEFAULT_PERIOD_SECONDS =
  PERIODS.find((period) => period.id === DEFAULT_PERIOD_ID)?.seconds ?? 3600;

/** Длина выбранного периода в секундах. */
export const usePeriodSeconds = () =>
  useAppStore(
    (state) =>
      PERIODS.find((period) => period.id === state.periodId)?.seconds ?? DEFAULT_PERIOD_SECONDS,
  );

/**
 * Действия стора стабильны по ссылке (zustand не пересоздает их),
 * поэтому их можно брать одним объектом без риска лишних перерисовок.
 */
export function useAppActions() {
  return useAppStore.getState();
}
