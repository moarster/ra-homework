/**
 * Серии машины для полотна и сравнительных чартов: один запрос истории на машину и период,
 * дальше буфер достраивается живыми снапшотами (раздел 4 этапа).
 *
 * Окно запроса привязано к моменту открытия страницы, а не к скользящему окну периода: иначе
 * ключ запроса менялся бы каждые несколько секунд и вся серия запрашивалась бы заново. Смена
 * периода меняет ключ, и TanStack Query отменяет неактуальный запрос через `AbortSignal`.
 */

import { METRIC_IDS, METRICS, type MetricId, type VehicleModel } from '@ra/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSeries } from '@/shared/api';
import { usePeriodSeconds } from '@/shared/store';
import { snapshotStore } from '@/shared/ws';
import { snapshotValues } from '../data/snapshot-values.js';
import { SeriesBuffer } from './series-buffer.js';

/** Показатели полотна: все, кроме координат - их место на карте, а не на графике. */
export const CANVAS_METRICS: MetricId[] = METRIC_IDS.filter(
  (metricId) => METRICS[metricId].kind !== 'coordinate',
);

/** Точек на серию: столько uPlot рисует без потери кадра и столько видно глазом на ширине области. */
const SERIES_MAX_POINTS = 1000;

/**
 * Разрыв между краем буфера и свежим снапшотом, после которого историю надо дозапросить,
 * виртуальные секунды. Так бывает после выключенного real-time или обрыва связи: тики за это
 * время не приходили, и соединять точки через провал нельзя. При ускорении x60 соседние тики
 * отстоят на 15 виртуальных секунд, порог взят с четырехкратным запасом.
 */
const REFETCH_GAP_SECONDS = 60;

export interface VehicleSeries {
  buffer: SeriesBuffer;
  error: Error | null;
}

export function useVehicleSeries(
  vehicleId: string,
  model: VehicleModel | undefined,
): VehicleSeries {
  const periodSeconds = usePeriodSeconds();
  /*
   * Окно хранится вместе с периодом, для которого оно выставлено. Смена периода
   * переустанавливает окно прямо во время отрисовки, а не в эффекте: иначе сначала ушел бы
   * запрос нового периода со старой правой границей и тут же был бы отменен.
   */
  const [anchor, setAnchor] = useState(() => ({
    periodSeconds,
    to: Math.floor(snapshotStore.getSimTime()),
  }));
  if (anchor.periodSeconds !== periodSeconds) {
    setAnchor({ periodSeconds, to: Math.floor(snapshotStore.getSimTime()) });
  }
  const anchorTo =
    anchor.periodSeconds === periodSeconds ? anchor.to : Math.floor(snapshotStore.getSimTime());
  const anchorRef = useRef(anchorTo);
  anchorRef.current = anchorTo;

  // Буфер живет, пока не сменились машина (страница пересоздается по ключу) или период.
  const buffer = useMemo(() => new SeriesBuffer(CANVAS_METRICS, periodSeconds), [periodSeconds]);

  // Страница открыта раньше, чем стало известно виртуальное время: ждем его.
  useEffect(() => {
    if (anchorTo > 0) {
      return;
    }
    return snapshotStore.subscribe(() => {
      const simTime = Math.floor(snapshotStore.getSimTime());
      if (simTime > 0) {
        setAnchor((current) => ({ ...current, to: simTime }));
      }
    });
  }, [anchorTo]);

  const vehicleIds = useMemo(() => [vehicleId], [vehicleId]);
  const query = useSeries(
    {
      vehicleIds,
      metrics: CANVAS_METRICS,
      from: anchorTo - periodSeconds,
      to: anchorTo,
      maxPoints: SERIES_MAX_POINTS,
    },
    anchorTo > 0,
  );

  useEffect(() => {
    if (query.data !== undefined) {
      buffer.setHistory(query.data);
    }
  }, [buffer, query.data]);

  // Живые снапшоты: подписка только на свою машину, тики остального парка сюда не доходят.
  // biome-ignore lint/correctness/useExhaustiveDependencies: после новой истории нужен повторный прием последнего снапшота
  useEffect(() => {
    if (model === undefined) {
      return;
    }
    const apply = () => {
      const snapshot = snapshotStore.getSnapshot(vehicleId);
      if (snapshot === undefined || !buffer.isLoaded()) {
        return;
      }
      const edge = buffer.window().to;
      const gapLimit = Math.max(REFETCH_GAP_SECONDS, buffer.getStep() * 2);
      // Запрос за пропущенный интервал уже в пути - второй не нужен.
      if (snapshot.t - edge > gapLimit && anchorRef.current <= edge) {
        const refetchTo = Math.floor(snapshot.t);
        setAnchor((current) => ({ ...current, to: refetchTo }));
        return;
      }
      buffer.appendValues(snapshot.t, snapshotValues(snapshot, model));
    };
    apply();
    return snapshotStore.subscribeVehicle(vehicleId, apply);
  }, [buffer, vehicleId, model, query.data]);

  return { buffer, error: query.error };
}
