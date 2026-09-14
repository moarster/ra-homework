/**
 * Сводка без мигания. При включенном real-time окно периода сдвигается каждые несколько секунд,
 * у запроса сводки меняется ключ, и без удержания прошлого ответа шапка на время каждого
 * запроса проваливалась бы в скелетоны.
 */

import type { VehicleSummaryResponse } from '@ra/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import { useRef } from 'react';

export interface StickySummary {
  data: VehicleSummaryResponse | undefined;
  /** Данных еще не было ни разу. */
  pending: boolean;
  /** Показан прошлый ответ, новый в пути. */
  refreshing: boolean;
  error: Error | null;
}

export function useStickySummary(query: UseQueryResult<VehicleSummaryResponse>): StickySummary {
  const last = useRef<VehicleSummaryResponse | undefined>(undefined);
  if (query.data !== undefined) {
    last.current = query.data;
  }
  return {
    data: last.current,
    pending: last.current === undefined && query.error === null,
    refreshing: query.data === undefined && last.current !== undefined,
    error: query.error,
  };
}
