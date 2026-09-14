/**
 * Хуки загрузки данных. Справочники и конфигурация - бесконечный кеш, телеметрия - по окну
 * периода. Запросы получают `AbortSignal` от TanStack Query, поэтому при смене периода
 * неактуальный запрос отменяется, а не доезжает впустую.
 */

import type { MetricId, SimPatch } from '@ra/contracts';
import { type UseQueryResult, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { usePeriodSeconds, useRealtime } from '../store/selectors.js';
import { snapshotStore } from '../ws/snapshot-store.js';
import { api, type TimeWindow } from './endpoints.js';
import { queryKeys } from './query-keys.js';

/** Бесконечный кеш: справочники не меняются в пределах запуска сервера. */
const FOREVER = { staleTime: Number.POSITIVE_INFINITY, gcTime: Number.POSITIVE_INFINITY } as const;

/**
 * Как часто сдвигается правая граница окна при включенном real-time, миллисекунды реального
 * времени. Данные внутри окна обновляет websocket, повторные запросы нужны только чтобы окно
 * не отставало; чаще чем раз в несколько секунд их делать незачем (раздел 5 этапа).
 */
const WINDOW_STEP_MS = 5000;

export function useConfig() {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: ({ signal }) => api.getConfig(signal),
    ...FOREVER,
  });
}

export function useDictionaries() {
  return useQuery({
    queryKey: queryKeys.dictionaries,
    queryFn: ({ signal }) => api.getDictionaries(signal),
    ...FOREVER,
  });
}

export function useVehicles() {
  return useQuery({
    queryKey: queryKeys.vehicles,
    queryFn: ({ signal }) => api.getVehicles(signal),
    ...FOREVER,
  });
}

/**
 * Последний снапшот по всем машинам. Нужен один раз при запуске и при выключенном real-time:
 * при включенном снапшоты приходят по websocket.
 */
export function useLatest(enabled: boolean) {
  const result = useQuery({
    queryKey: queryKeys.latest,
    queryFn: ({ signal }) => api.getLatest(signal),
    enabled,
    staleTime: 2000,
  });
  useEffect(() => {
    if (result.data !== undefined) {
      snapshotStore.replaceSnapshots(result.data.snapshots, result.data.t);
    }
  }, [result.data]);
  return result;
}

export function useSim() {
  return useQuery({
    queryKey: queryKeys.sim,
    queryFn: ({ signal }) => api.getSim(signal),
    staleTime: 1000,
  });
}

/**
 * Изменение параметров симуляции. Ответ сервера - единственный источник истины:
 * зеркало в сторе обновляется подтвержденным состоянием, а не тем, что отправили.
 */
export function useSetSim() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: SimPatch) => api.setSim(patch),
    onSuccess: (sim) => {
      queryClient.setQueryData(queryKeys.sim, sim);
      snapshotStore.setSimState(sim);
      // Число машин и мера хаоса меняют данные: накопленные ответы телеметрии уже не годятся.
      queryClient.invalidateQueries({ queryKey: ['latest'] });
      /*
       * Справочник машин кешируется навсегда - но только пока парк не меняется. Изменение
       * `vehicleCount` порождает новые машины, и без сброса справочника они остаются
       * безымянными: карта рисует только те машины, что есть и в снапшоте, и в справочнике,
       * и новые просто не появлялись бы на снимке.
       */
      queryClient.invalidateQueries({ queryKey: queryKeys.vehicles });
    },
  });
}

export function useSeries(
  params: {
    vehicleIds?: readonly string[];
    metrics?: readonly MetricId[];
    maxPoints?: number;
  } & TimeWindow,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.series(params.vehicleIds, params.metrics, params.from, params.to),
    queryFn: ({ signal }) => api.getSeries(params, signal),
    enabled: enabled && params.to > 0,
  });
}

export function useTrack(
  params: {
    vehicleIds?: readonly string[];
    maxPoints?: number;
    severityMetrics?: readonly MetricId[];
  } & TimeWindow,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.track(params.vehicleIds, params.from, params.to, params.severityMetrics),
    queryFn: ({ signal }) => api.getTrack(params, signal),
    enabled: enabled && params.to > 0,
  });
}

export function useEvents(
  params: { vehicleIds?: readonly string[]; severity?: 1 | 2; limit?: number } & TimeWindow,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.events(params.vehicleIds, params.from, params.to, params.severity),
    queryFn: ({ signal }) => api.getEvents(params, signal),
    enabled: enabled && params.to > 0,
  });
}

export function useSummary(vehicleId: string | null, window: TimeWindow) {
  return useQuery({
    queryKey: queryKeys.summary(vehicleId ?? '', window.from, window.to),
    queryFn: ({ signal }) => api.getSummary(vehicleId as string, window, signal),
    enabled: vehicleId !== null && window.to > 0,
  });
}

export interface PeriodWindow extends TimeWindow {
  /** Виртуальное время уже известно: до этого запросы телеметрии бессмысленны. */
  ready: boolean;
}

/**
 * Окно выбранного периода: `to` - текущее виртуальное время, `from` - `to` минус период.
 * При включенном real-time окно скользит, но правая граница пересчитывается шагами,
 * иначе каждый тик менял бы ключ запроса и сбрасывал кеш.
 */
export function usePeriodWindow(): PeriodWindow {
  const periodSeconds = usePeriodSeconds();
  const realtime = useRealtime();
  const [to, setTo] = useState(() => Math.floor(snapshotStore.interpolatedSimTime()));

  useEffect(() => {
    const sync = () => {
      const next = Math.floor(
        realtime ? snapshotStore.interpolatedSimTime() : snapshotStore.getSimTime(),
      );
      setTo((current) => (next > current ? next : current));
    };
    sync();
    if (!realtime) {
      // Время замерло: граница окна двигается только когда сервер сообщил новое время.
      return snapshotStore.subscribe(sync);
    }
    const timer = window.setInterval(sync, WINDOW_STEP_MS);
    const unsubscribe = snapshotStore.subscribe(() => {
      // Первое известное время нужно взять сразу, не дожидаясь шага таймера.
      if (to === 0) {
        sync();
      }
    });
    return () => {
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [realtime, to]);

  return { from: to - periodSeconds, to, ready: to > 0 };
}

export type { UseQueryResult };
