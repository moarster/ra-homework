/**
 * Навигационный список машин (раздел 9.1 `CONTEXT.md`): плашка за секунду отвечает
 * "машина здорова / машину надо смотреть". Сверху - компактная сводка по парку.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { queryKeys, useVehicles } from '@/shared/api';
import { EmptyState, Skeleton } from '@/shared/ui';
import { useSnapshotVehicleIds } from '@/shared/ws';
import { ChartsIcon } from '../icons.js';
import { FleetSummary } from './FleetSummary.js';
import { type ApiVehicle, useFleet } from './use-fleet.js';
import { VehicleCard } from './VehicleCard.js';

const SKELETON_ROWS = ['a', 'b', 'c', 'd', 'e'];

/**
 * Справочник машин кешируется навсегда, но парк меняется: число машин переключают в полоске
 * этого клиента, другого клиента или прямо на сервере. Машина, которая есть в снапшоте и
 * которой нет в справочнике, - признак устаревшего справочника; без перезапроса она просто
 * не попала бы в список. Один и тот же набор недостающих машин перезапрашивается один раз:
 * если сервер и после этого их не знает, повторять бессмысленно.
 */
function useDictionaryFreshness(vehicles: readonly ApiVehicle[] | undefined, fetching: boolean) {
  const queryClient = useQueryClient();
  const snapshotIds = useSnapshotVehicleIds();
  const attempted = useRef('');

  useEffect(() => {
    if (vehicles === undefined || fetching) {
      return;
    }
    const known = new Set(vehicles.map((vehicle) => vehicle.id));
    const missing = snapshotIds.filter((id) => !known.has(id)).join(',');
    if (missing === '' || missing === attempted.current) {
      return;
    }
    attempted.current = missing;
    void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles });
  }, [queryClient, snapshotIds, vehicles, fetching]);
}

export function VehicleList() {
  const vehiclesQuery = useVehicles();
  const fleet = useFleet(vehiclesQuery.data?.vehicles);
  useDictionaryFreshness(vehiclesQuery.data?.vehicles, vehiclesQuery.isFetching);

  if (vehiclesQuery.isPending) {
    return (
      <div className="flex flex-col gap-2 p-3" aria-busy="true">
        <Skeleton className="h-10 w-full" />
        {SKELETON_ROWS.map((key) => (
          <Skeleton key={key} className="h-[68px] w-full rounded-panel" />
        ))}
      </div>
    );
  }

  if (vehiclesQuery.isError) {
    return (
      <EmptyState
        icon={<ChartsIcon />}
        title="Список машин не загрузился"
        description={vehiclesQuery.error.message}
      />
    );
  }

  if (fleet.vehicles.length === 0) {
    return (
      <EmptyState
        icon={<ChartsIcon />}
        title="Парк пуст"
        description="Сервер еще не прислал ни одной машины."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <FleetSummary counts={fleet.counts} />
      <ul className="flex flex-col gap-2" aria-label="Машины парка">
        {fleet.vehicles.map((vehicle) => (
          <VehicleCard key={vehicle.id} vehicle={vehicle} />
        ))}
      </ul>
    </div>
  );
}
