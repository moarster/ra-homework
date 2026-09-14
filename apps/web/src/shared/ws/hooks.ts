/**
 * Точки подключения компонентов к mutable-хранилищу снапшотов.
 * Все через `useSyncExternalStore`: React узнает об изменении по номеру версии,
 * а сами данные читаются напрямую из хранилища, без копирования в состояние.
 */

import type { VehicleSnapshot } from '@ra/contracts';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { type SnapshotStats, snapshotStore } from './snapshot-store.js';

/** Версия всего хранилища: подписка для компонентов, которым нужен весь парк. */
export function useSnapshotsVersion(): number {
  return useSyncExternalStore(snapshotStore.subscribe, snapshotStore.getVersion);
}

/** Идентификаторы машин в снапшоте. */
export function useSnapshotVehicleIds(): string[] {
  const version = useSnapshotsVersion();
  const cache = useRef<{ version: number; ids: string[] }>({ version: -1, ids: [] });
  if (cache.current.version !== version) {
    const ids = snapshotStore.getVehicleIds();
    const same =
      ids.length === cache.current.ids.length &&
      ids.every((id, index) => id === cache.current.ids[index]);
    cache.current = { version, ids: same ? cache.current.ids : ids };
  }
  return cache.current.ids;
}

/** Подписка на одну машину: плашка перерисовывается только от своего тика. */
export function useVehicleSnapshot(vehicleId: string | null): VehicleSnapshot | undefined {
  const subscribe = useCallback(
    (listener: () => void) =>
      vehicleId === null ? () => undefined : snapshotStore.subscribeVehicle(vehicleId, listener),
    [vehicleId],
  );
  const getVersion = useCallback(
    () => (vehicleId === null ? 0 : snapshotStore.getVehicleVersion(vehicleId)),
    [vehicleId],
  );
  useSyncExternalStore(subscribe, getVersion);
  return vehicleId === null ? undefined : snapshotStore.getSnapshot(vehicleId);
}

export function useSnapshotStats(): SnapshotStats {
  useSnapshotsVersion();
  return snapshotStore.getStats();
}

/** Как часто обновляются часы в полоске, миллисекунды реального времени. */
const CLOCK_INTERVAL_MS = 200;

/**
 * Виртуальное время "сейчас" с интерполяцией между тиками. Обновляется по таймеру,
 * а не на каждый тик: часам достаточно пяти обновлений в секунду.
 */
export function useSimClock(running: boolean): number {
  const [simTime, setSimTime] = useState(() => snapshotStore.interpolatedSimTime());

  useEffect(() => {
    setSimTime(running ? snapshotStore.interpolatedSimTime() : snapshotStore.getSimTime());
    if (!running) {
      // Время остановлено: достаточно слушать хранилище, таймер не нужен.
      return snapshotStore.subscribe(() => {
        setSimTime(snapshotStore.getSimTime());
      });
    }
    const timer = window.setInterval(() => {
      setSimTime(snapshotStore.interpolatedSimTime());
    }, CLOCK_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [running]);

  return simTime;
}
