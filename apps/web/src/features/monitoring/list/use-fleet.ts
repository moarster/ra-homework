/**
 * Состав, порядок и сводка парка из снапшотов. Список машин подписан на все хранилище, но
 * перерисовывается только когда меняется порядок плашек или цифры сводки: значения внутри
 * плашек обновляет подписка каждой плашки на свою машину.
 */

import type { VehiclesResponse } from '@ra/contracts';
import { useCallback, useRef, useSyncExternalStore } from 'react';
import { snapshotStore } from '@/shared/ws';
import { compareFleet, type FleetCounts, type FleetEntry, fleetCounts } from '../data/fleet.js';
import { subscribeThrottled } from './refresh.js';

export type ApiVehicle = VehiclesResponse['vehicles'][number];

export interface FleetView {
  /** Машины в порядке показа. */
  vehicles: ApiVehicle[];
  counts: FleetCounts;
  /** Подпись состава и порядка: равенство подписей - равенство видов. */
  signature: string;
}

const EMPTY: FleetView = {
  vehicles: [],
  counts: { total: 0, working: 0, alarms: 0, warnings: 0, noData: 0 },
  signature: '',
};

function buildView(vehicles: readonly ApiVehicle[]): FleetView {
  // Справочник отдает весь возможный парк, а в симуляции может быть включено меньше машин.
  const present = new Set(snapshotStore.getVehicleIds());
  const byId = new Map<string, ApiVehicle>();
  const entries: FleetEntry[] = [];
  for (const vehicle of vehicles) {
    if (present.size > 0 && !present.has(vehicle.id)) {
      continue;
    }
    const snapshot = snapshotStore.getSnapshot(vehicle.id);
    byId.set(vehicle.id, vehicle);
    entries.push({
      id: vehicle.id,
      sideNumber: vehicle.sideNumber,
      severity: snapshot?.sev ?? 3,
      status: snapshot?.st ?? 'NO_DATA',
    });
  }
  entries.sort(compareFleet);
  const counts = fleetCounts(entries);
  return {
    vehicles: entries.map((entry) => byId.get(entry.id) as ApiVehicle),
    counts,
    signature: `${entries.map((entry) => entry.id).join(',')}|${Object.values(counts).join(',')}`,
  };
}

export function useFleet(vehicles: readonly ApiVehicle[] | undefined): FleetView {
  const cache = useRef<{ version: number; source: readonly ApiVehicle[]; view: FleetView } | null>(
    null,
  );
  const getSnapshot = useCallback(() => {
    if (vehicles === undefined) {
      return EMPTY;
    }
    const version = snapshotStore.getVersion();
    const current = cache.current;
    if (current !== null && current.version === version && current.source === vehicles) {
      return current.view;
    }
    const next = buildView(vehicles);
    const view =
      current !== null && current.source === vehicles && current.view.signature === next.signature
        ? current.view
        : next;
    cache.current = { version, source: vehicles, view };
    return view;
  }, [vehicles]);
  return useSyncExternalStore(subscribeThrottled, getSnapshot);
}
