/**
 * Связка данных приложения: зеркало состояния симуляции, подписка на websocket по тумблеру
 * real-time и реакция на сообщения сервера (`backfill`, `events`). Состояние симуляции и число
 * зрителей идут по отдельному каналу управления, который открыт всегда: симуляция одна на всех
 * зрителей стенда, и чужое изменение должно дойти и при выключенном real-time.
 *
 * Живет один раз на приложение - выше сплиттера, чтобы обе области видели одни и те же данные.
 */

import type { SimState } from '@ra/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { queryKeys, telemetryKeyPrefixes, useLatest, useSim, VIEWER_ID } from '@/shared/api';
import { useAppStore, useConnection, useRealtime } from '@/shared/store';
import { ControlClient, snapshotStore, WsClient } from '@/shared/ws';

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

  // Канал управления: открыт всегда, тумблер real-time на него не влияет.
  useEffect(() => {
    const control = new ControlClient({
      onSim: (next, changedBy) => {
        const store = useAppStore.getState();
        const previous = store.sim;
        store.setSim(next);
        snapshotStore.setSimState(next);
        queryClient.setQueryData(queryKeys.sim, next);
        if (changedBy !== undefined && changedBy !== VIEWER_ID) {
          store.noteSimChangedByOther();
        }
        // Первое сообщение после загрузки - просто начальное состояние.
        if (previous.simTime === 0) {
          return;
        }
        // Те же сбросы, что после своего `POST /api/sim` (`useSetSim`): парк и данные другие.
        const fleetChanged = previous.vehicleCount !== next.vehicleCount;
        if (fleetChanged) {
          queryClient.invalidateQueries({ queryKey: queryKeys.vehicles });
        }
        if (fleetChanged || previous.chaos !== next.chaos) {
          queryClient.invalidateQueries({ queryKey: queryKeys.latest });
        }
      },
      onViewers: (count) => {
        useAppStore.getState().setViewers(count);
      },
      onDisconnected: () => {
        useAppStore.getState().setViewers(null);
      },
    });
    control.connect();
    return () => {
      control.disconnect();
    };
  }, [queryClient]);

  useEffect(() => {
    const client = new WsClient({
      onStatus: (status) => {
        useAppStore.getState().setConnection(status);
      },
      onSim: (next) => {
        useAppStore.getState().setSim(next);
        queryClient.setQueryData(queryKeys.sim, next);
      },
      onHello: () => {
        // Один запрос за пропущенный интервал: внутри окна данные уже пойдут по websocket.
        queryClient.invalidateQueries({
          predicate: (query) =>
            (telemetryKeyPrefixes as readonly string[]).includes(query.queryKey[0] as string),
        });
        /*
         * `hello` значит, что сервер снова доступен. Запросы, исчерпавшие повторы, пока его не
         * было (справочник машин, конфигурация, состояние симуляции кешируются навсегда и сами
         * не перезапрашиваются), иначе остались бы в ошибке до перезагрузки страницы.
         */
        void queryClient.refetchQueries({ predicate: (query) => query.state.status === 'error' });
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
