/**
 * Страница машины: шапка (НСИ, сводка за период, события), сравнительные чарты на точку
 * монитора и полотно временных рядов. Все три потребителя монитора - карта, чарты и полотно -
 * читают одно значение `monitorTs` из стора.
 */

import { usePeriodWindow, useSummary, useVehicles } from '@/shared/api';
import { EmptyState, Panel, Skeleton } from '@/shared/ui';
import { ComparativeCharts } from '../charts/ComparativeCharts.js';
import { resolveModel } from '../data/snapshot-values.js';
import { ChartsIcon } from '../icons.js';
import { SeriesCanvas } from '../timeseries/SeriesCanvas.js';
import { useVehicleSeries } from '../timeseries/use-vehicle-series.js';
import { BackToList } from './BackToList.js';
import { useStickySummary } from './use-sticky-summary.js';
import { VehicleHeader } from './VehicleHeader.js';

export function VehiclePage({ vehicleId }: { vehicleId: string }) {
  const vehiclesQuery = useVehicles();
  const vehicle = vehiclesQuery.data?.vehicles.find((item) => item.id === vehicleId);
  const model = vehicle === undefined ? undefined : resolveModel(vehicle.modelId);
  const periodWindow = usePeriodWindow();
  const summary = useStickySummary(useSummary(vehicleId, periodWindow));
  const series = useVehicleSeries(vehicleId, model);

  if (vehiclesQuery.isPending) {
    return (
      <div className="flex flex-col gap-3 p-3" aria-busy="true">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-56 w-full rounded-panel" />
        <Skeleton className="h-64 w-full rounded-panel" />
      </div>
    );
  }

  if (vehicle === undefined || model === undefined) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <BackToList />
        <EmptyState
          icon={<ChartsIcon />}
          title="Машина не найдена"
          description={`В справочнике парка нет машины ${vehicleId}. Возможно, парк уменьшили в настройках симуляции.`}
        />
      </div>
    );
  }

  const noData = summary.data?.hasData === false;

  return (
    <div className="flex flex-col gap-3 p-3">
      <VehicleHeader
        vehicle={vehicle}
        model={model}
        summary={summary.data}
        summaryPending={summary.pending}
        summaryRefreshing={summary.refreshing}
        summaryError={summary.error}
        periodTo={periodWindow.to}
      />
      {noData ? (
        // Один осмысленный экран вместо двадцати пустых графиков.
        <Panel tone="glass" className="py-4">
          <EmptyState
            icon={<ChartsIcon />}
            title="Графики не строятся: за период нет ни одной точки"
            description="Увеличьте период в верхней полоске или свяжитесь с водителем по телефону в шапке. Как только машина выйдет на связь, данные появятся здесь."
          />
        </Panel>
      ) : (
        <>
          <ComparativeCharts buffer={series.buffer} model={model} />
          <SeriesCanvas
            vehicleId={vehicleId}
            buffer={series.buffer}
            model={model}
            error={series.error}
          />
        </>
      )}
    </div>
  );
}
