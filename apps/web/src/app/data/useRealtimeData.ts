/**
 * Связка данных приложения: зеркало состояния симуляции, подписка на websocket по тумблеру
 * real-time и реакция на сообщения сервера (`sim`, `backfill`, `events`).
 *
 * Живет один раз на приложение - выше сплиттера, чтобы обе области видели одни и те же данные.
 */

import type { SimState } from '@ra/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { telemetryKeyPrefixes, useLatest, useSim } from '@/shared/api';
import { useAppStore, useConnection, useRealtime } from '@/shared/store';
import { snapshotStore, WsClient } from '@/shared/ws';

/** Сбрасывает кеши телеметрии по одной машине: реакция на `backfill`. */
function invalidateVehicleTelemetry(
  queryClient: ReturnType<typeof useQueryClient>,
  vehicleId: string,
): void {
  queryClient.invalidateQueries({
    predicate: (query) => {
      const [prefix, scope] = query.queryKey as [string, unknown];
      if (!(telemetryKeyPrefixes as readonly string[]).includes(prefix)) {
        return false;
      }
      // 'all' - запрос по всем машинам, он тоже затронут.
      if (scope === 'all' || scope === vehicleId) {
        return true;
      }
      return Array.isArray(scope) && scope.includes(vehicleId);
    },
  });
}

export function useRealtimeData(): void {
  const queryClient = useQueryClient();
  const realtime = useRealtime();
  const connection = useConnection();
  const clientRef = useRef<WsClient | null>(null);

  // Состояние симуляции: первый источник - REST, дальше его обновляют `hello` и `sim`.
  const simQuery = useSim();
  const sim: SimState | undefined = simQuery.data;
  useEffect(() => {
    if (sim !== undefined) {
      useAppStore.getState().setSim(sim);
      snapshotStore.setSimState(sim);
    }
  }, [sim]);

  // Пока websocket не на связи, снапшот добирается обычным запросом.
  useLatest(!realtime || connection !== 'online');

  useEffect(() => {
    const client = new WsClient({
      onStatus: (status) => {
        useAppStore.getState().setConnection(status);
      },
      onSim: (next) => {
        useAppStore.getState().setSim(next);
        queryClient.setQueryData(['sim'], next);
      },
      onHello: () => {
        // Один запрос за пропущенный интервал: внутри окна данные уже пойдут по websocket.
        queryClient.invalidateQueries({
          predicate: (query) =>
            (telemetryKeyPrefixes as readonly string[]).includes(query.queryKey[0] as string),
        });
      },
      onBackfill: (vehicleId) => {
        invalidateVehicleTelemetry(queryClient, vehicleId);
      },
      onEvents: () => {
        // Лента событий живет в кеше запросов: ее достаточно пометить устаревшей.
        queryClient.invalidateQueries({ queryKey: ['events'] });
      },
    });
    clientRef.current = client;
    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [queryClient]);

  useEffect(() => {
    const client = clientRef.current;
    if (client === null) {
      return;
    }
    if (realtime) {
      client.connect();
    } else {
      client.disconnect();
    }
  }, [realtime]);
}
