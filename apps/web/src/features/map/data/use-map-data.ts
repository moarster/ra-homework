/**
 * Данные карты: окно периода, история трека, живые точки и справочник машин.
 *
 * Результат намеренно отдается ссылками на mutable-структуры, а не копиями: цикл отрисовки
 * читает их напрямую из `requestAnimationFrame`, и перерисовка React на каждую новую точку
 * трека здесь не нужна и вредна.
 */

import type { MetricId, VehiclesResponse } from '@ra/contracts';
import { useEffect, useMemo, useRef } from 'react';
import { usePeriodWindow, useTrack, useVehicles } from '@/shared/api';
import { usePeriodSeconds, useTrackedMetrics, useTrackTailSeconds } from '@/shared/store';
import { snapshotStore, useSnapshotsVersion } from '@/shared/ws';
import type { VehicleMeta } from '../overlay/renderer.js';
import { TailStore, type TrackMark } from './tail-store.js';

/** Максимум точек трека в ответе: на все машины сразу, иначе суточный период не увезти. */
const TRACK_MAX_POINTS = 4000;

/**
 * Машина в том виде, в котором ее отдает API. Это не `Vehicle` из контрактов: в zod-схеме
 * `modelId` объявлен строкой, поэтому тип ответа шире доменного, и подменять одно другим
 * без проверки нельзя (см. `resolveVehicleModel`).
 */
export type MapVehicle = VehiclesResponse['vehicles'][number];

export interface MapData {
  tails: TailStore;
  meta: ReadonlyMap<string, VehicleMeta>;
  vehicles: ReadonlyMap<string, MapVehicle>;
  /** Длина хвоста: минимум из периода дашборда и значения слайдера (раздел 4 этапа). */
  tailSeconds: number;
  /** Окно периода: `to` - правая граница, она же голова хвоста при выключенном real-time. */
  window: { from: number; to: number; ready: boolean };
  /** Данные трека еще едут: отличает "пусто" от "не приехало". */
  loading: boolean;
  /** Ответ трека приехал хотя бы раз: до этого хвостов нет и позиционировать карту не по чему. */
  tracksReady: boolean;
  /** Ни у одной машины нет точек за период. */
  empty: boolean;
}

function toMeta(vehicles: readonly MapVehicle[]): Map<string, VehicleMeta> {
  const meta = new Map<string, VehicleMeta>();
  for (const vehicle of vehicles) {
    meta.set(vehicle.id, { vehicleId: vehicle.id, sideNumber: vehicle.sideNumber });
  }
  return meta;
}

export function useMapData(): MapData {
  const window = usePeriodWindow();
  const periodSeconds = usePeriodSeconds();
  const sliderSeconds = useTrackTailSeconds();
  const trackedMetrics = useTrackedMetrics();
  const vehiclesQuery = useVehicles();
  const snapshotVersion = useSnapshotsVersion();

  const tailSeconds = Math.min(periodSeconds, sliderSeconds);

  /**
   * Светофор трека считается только по отслеживаемым показателям, если они выбраны
   * (раздел 7 `CONTEXT.md`, п. 4). Пустой список означает "по всем", и параметр не шлется.
   */
  const severityMetrics: readonly MetricId[] | undefined =
    trackedMetrics.length > 0 ? trackedMetrics : undefined;

  const trackQuery = useTrack(
    {
      from: window.from,
      to: window.to,
      maxPoints: TRACK_MAX_POINTS,
      ...(severityMetrics !== undefined ? { severityMetrics } : {}),
    },
    window.ready,
  );

  const storeRef = useRef<TailStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = new TailStore();
  }
  const store = storeRef.current;

  // История: перекладывается в хранилище при каждом новом ответе трека.
  useEffect(() => {
    store.setHistory(trackQuery.data, window.from, window.to);
  }, [store, trackQuery.data, window.from, window.to]);

  // Живые точки: досылаются из хранилища снапшотов на каждый применённый тик.
  // biome-ignore lint/correctness/useExhaustiveDependencies: snapshotVersion и есть сигнал о новых точках, хранилище mutable
  useEffect(() => {
    if (!window.ready) {
      return;
    }
    for (const vehicleId of snapshotStore.getVehicleIds()) {
      store.appendLive(vehicleId, snapshotStore.getPositions(vehicleId), window.to);
    }
    store.trim(window.to - periodSeconds);
  }, [store, snapshotVersion, window.ready, window.to, periodSeconds]);

  // Флажки событий, пришедших по websocket: до следующего ответа трека это единственный
  // способ увидеть свежую аварию на треке. Авторитетный источник - все равно ответ трека.
  // biome-ignore lint/correctness/useExhaustiveDependencies: события лежат в mutable-хранилище, признак их появления - номер версии
  useEffect(() => {
    for (const event of snapshotStore.getRecentEvents()) {
      if (event.endedAt !== null) {
        continue;
      }
      if (event.source !== 'alarmBit' && event.source !== 'warningBit') {
        continue;
      }
      const tail = store.get(event.vehicleId);
      if (tail === undefined || tail.count === 0) {
        continue;
      }
      const index = tail.count - 1;
      const mark: TrackMark = {
        vehicleId: event.vehicleId,
        t: event.startedAt,
        lat: tail.lat[index] as number,
        lon: tail.lon[index] as number,
        code: event.code,
        severity: event.severity,
      };
      store.addMark(mark);
    }
  }, [store, snapshotVersion]);

  const vehicles = useMemo(() => {
    const map = new Map<string, MapVehicle>();
    for (const vehicle of vehiclesQuery.data?.vehicles ?? []) {
      map.set(vehicle.id, vehicle);
    }
    return map;
  }, [vehiclesQuery.data]);

  /**
   * Рисуем только те машины, что есть и в справочнике, и в снапшоте: справочник отдает весь
   * возможный парк, а в симуляции может быть включено меньше машин.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: состав парка лежит в mutable-хранилище, его смена видна по номеру версии
  const meta = useMemo(() => {
    const all = toMeta(vehiclesQuery.data?.vehicles ?? []);
    const present = new Set(snapshotStore.getVehicleIds());
    if (present.size === 0) {
      return all;
    }
    const result = new Map<string, VehicleMeta>();
    for (const [id, item] of all) {
      if (present.has(id)) {
        result.set(id, item);
      }
    }
    return result;
  }, [vehiclesQuery.data, snapshotVersion]);

  const empty =
    window.ready && !trackQuery.isPending && store.entries().size === 0 && meta.size > 0;

  return {
    tails: store,
    meta,
    vehicles,
    tailSeconds,
    window,
    loading: trackQuery.isPending && window.ready,
    tracksReady: trackQuery.data !== undefined,
    empty,
  };
}
