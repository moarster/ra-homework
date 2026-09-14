/**
 * Частота обновления навигационного списка.
 *
 * Список отвечает на вопрос "какую машину смотреть", и для этого не нужны четыре обновления
 * в секунду: при 60 машинах синхронная перерисовка всех плашек на каждый тик давала задачи
 * по сто миллисекунд и выше бюджета кадра. Поэтому плашки и порядок списка обновляются раз
 * в секунду, а перерисовка плашек идет переходом React: он рендерит с уступанием потока,
 * и шестьдесят плашек не складываются в одну длинную задачу.
 */

import type { VehicleSnapshot } from '@ra/contracts';
import { startTransition, useEffect, useState } from 'react';
import { snapshotStore } from '@/shared/ws';

/** Интервал обновления списка, миллисекунды реального времени. */
export const LIST_REFRESH_MS = 1000;

export interface Throttled {
  call: () => void;
  cancel: () => void;
}

/** Слушатель, который вызывается не чаще раза в интервал; последний сигнал не теряется. */
export function throttled(listener: () => void, intervalMs: number = LIST_REFRESH_MS): Throttled {
  let last = Number.NEGATIVE_INFINITY;
  let timer: number | null = null;
  const fire = () => {
    timer = null;
    last = performance.now();
    listener();
  };
  return {
    call: () => {
      if (timer !== null) {
        return;
      }
      const wait = last + intervalMs - performance.now();
      if (wait <= 0) {
        fire();
      } else {
        timer = window.setTimeout(fire, wait);
      }
    },
    cancel: () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    },
  };
}

/** Подписка на весь парк с частотой списка: для порядка плашек и сводки по парку. */
export function subscribeThrottled(listener: () => void): () => void {
  const refresh = throttled(listener);
  const unsubscribe = snapshotStore.subscribe(refresh.call);
  return () => {
    unsubscribe();
    refresh.cancel();
  };
}

/** Снапшот машины для плашки: не чаще раза в интервал и без блокировки кадра. */
export function useCardSnapshot(vehicleId: string): VehicleSnapshot | undefined {
  const [, setVersion] = useState(0);

  useEffect(() => {
    const refresh = throttled(() => {
      startTransition(() => {
        setVersion((version) => version + 1);
      });
    });
    const unsubscribe = snapshotStore.subscribeVehicle(vehicleId, refresh.call);
    return () => {
      unsubscribe();
      refresh.cancel();
    };
  }, [vehicleId]);

  return snapshotStore.getSnapshot(vehicleId);
}
