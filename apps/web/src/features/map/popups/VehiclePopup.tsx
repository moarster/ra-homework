/**
 * Всплывашка машины. Обычный DOM поверх canvas: внутри кликабельные показатели и телефон
 * водителя, а на canvas ни ссылок, ни фокуса с клавиатуры не сделать (раздел 3 этапа).
 *
 * Два состояния одной всплывашки, а не две разные: по наведению - модель и скорость,
 * по клику к ним добавляется список отклонений (раздел 7 этапа).
 */

import {
  decodeSnapshot,
  formatMetricValue,
  getMetric,
  METRIC_INDEX,
  type MetricId,
  metricSeverities,
  SEVERITY,
  SEVERITY_METRIC_IDS,
  type Severity,
  VEHICLE_MODELS,
  type VehicleModelId,
  type VehicleSnapshot,
} from '@ra/contracts';
import { useMemo } from 'react';
import { formatDuration, formatTime } from '@/shared/format';
import { Badge, cx, MetricIcon, Panel, severityClasses } from '@/shared/ui';
import type { MapVehicle } from '../data/use-map-data.js';

export interface VehiclePopupProps {
  vehicle: MapVehicle;
  snapshot: VehicleSnapshot | undefined;
  /** Развернутая всплывашка: показана по клику, а не по наведению. */
  expanded: boolean;
  /** Машина без данных дольше норматива. */
  noData: boolean;
  /** Момент точки трека, по которой кликнули; null - всплывашка про последнюю точку. */
  at: number | null;
  onSelectMetric: (metricId: MetricId) => void;
}

/**
 * Модель машины по идентификатору из ответа API. В zod-схеме `modelId` - строка, поэтому
 * принадлежность справочнику проверяется, а не предполагается: неизвестная модель не должна
 * ронять всплывашку.
 */
export function resolveVehicleModel(modelId: string) {
  return Object.hasOwn(VEHICLE_MODELS, modelId)
    ? VEHICLE_MODELS[modelId as VehicleModelId]
    : undefined;
}

/** Отклонения показателей: желтые и красные, худшие сверху. */
function deviations(
  snapshot: VehicleSnapshot | undefined,
  modelId: VehicleModelId | undefined,
): { metricId: MetricId; severity: Severity; value: number | null }[] {
  if (snapshot === undefined || modelId === undefined) {
    return [];
  }
  const values = decodeSnapshot(snapshot.v, snapshot.q);
  // Светофор считается функциями контрактов, а не собственной логикой (раздел "Важное" этапа).
  const severities = metricSeverities(values, { vehicle: { modelId } });
  const result: { metricId: MetricId; severity: Severity; value: number | null }[] = [];
  for (const metricId of SEVERITY_METRIC_IDS) {
    const severity = severities[metricId];
    if (severity !== SEVERITY.WARN && severity !== SEVERITY.ALARM) {
      continue;
    }
    // Производные показатели в компактный снапшот не едут: у них значения нет, только степень.
    const sample = Object.hasOwn(values, metricId)
      ? values[metricId as keyof typeof values]
      : undefined;
    result.push({ metricId, severity, value: sample?.value ?? null });
  }
  return result.sort((a, b) => b.severity - a.severity);
}

export function VehiclePopup({
  vehicle,
  snapshot,
  expanded,
  noData,
  at,
  onSelectMetric,
}: VehiclePopupProps) {
  const model = resolveVehicleModel(vehicle.modelId);
  const speed = snapshot?.v[METRIC_INDEX.POSITION_SPEED] ?? null;
  const items = useMemo(
    () => (expanded ? deviations(snapshot, model?.id) : []),
    [expanded, snapshot, model],
  );

  return (
    /*
     * Тон `popup`, а не обычное стекло: всплывашка висит поверх спутникового снимка и может
     * оказаться на чем угодно - хоть на белом отвале. Сквозь полупрозрачное стекло приглушенный
     * текст (модель, время точки, "отклонений нет") на светлом снимке пропадал.
     */
    <Panel tone="popup" className="w-64 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[14px] font-semibold">Борт {vehicle.sideNumber}</span>
        <Badge severity={noData ? SEVERITY.UNKNOWN : (snapshot?.sev ?? SEVERITY.UNKNOWN)}>
          {severityClasses(noData ? SEVERITY.UNKNOWN : (snapshot?.sev ?? SEVERITY.UNKNOWN)).name}
        </Badge>
      </div>

      <div className="mt-1 text-[12px] text-fg-muted">{model?.name ?? vehicle.modelId}</div>
      <div className="tabular mt-1 text-[13px]">
        Скорость: {speed === null ? '-' : formatMetricValue(speed, 'POSITION_SPEED')}
      </div>

      {at !== null && (
        <div className="mt-1 text-[11px] text-fg-muted">Точка трека: {formatTime(at)}</div>
      )}

      {expanded && (
        <>
          {noData && (
            /*
             * Машина серая - на карте по ней уже ничего не узнать, а связаться надо.
             * Телефон водителя здесь ровно для этого (раздел 7 этапа).
             */
            <div className="mt-2 rounded-control bg-sev-unknown-soft p-2 text-[12px]">
              <div className="text-fg-muted">
                Последняя передача:{' '}
                <span className="tabular text-fg">
                  {snapshot === undefined ? '-' : formatDuration(snapshot.age)} назад
                </span>
              </div>
              <div className="mt-1 text-fg">{vehicle.driver.fullName}</div>
              <a
                href={`tel:${vehicle.driver.phone.replace(/[^+\d]/g, '')}`}
                className="tabular text-primary-text underline-offset-2 hover:underline"
              >
                {vehicle.driver.phone}
              </a>
            </div>
          )}

          <div className="mt-2 border-t border-border-base pt-2">
            {items.length === 0 ? (
              <div className="text-[12px] text-fg-muted">
                {noData ? 'Данных нет, отклонения неизвестны' : 'Отклонений нет'}
              </div>
            ) : (
              <>
                <div className="mb-1 text-[11px] text-fg-muted">Отклонения</div>
                <ul className="flex flex-col gap-0.5">
                  {items.map((item) => {
                    const metric = getMetric(item.metricId);
                    const classes = severityClasses(item.severity);
                    return (
                      <li key={item.metricId}>
                        {/*
                          Клик по показателю открывает страницу машины и ставит focusMetric -
                          полотно графиков на этапе 4 проскроллит к нужному графику.
                        */}
                        <button
                          type="button"
                          onClick={() => onSelectMetric(item.metricId)}
                          className={cx(
                            'flex w-full cursor-pointer items-center gap-1.5 rounded-control',
                            'px-1.5 py-1 text-left hover:bg-surface-hover',
                          )}
                        >
                          <MetricIcon metricId={item.metricId} className={classes.text} />
                          <span className="min-w-0 flex-1 truncate text-[12px]">
                            {metric.shortName}
                          </span>
                          <span className={cx('tabular text-[12px] font-medium', classes.text)}>
                            {formatMetricValue(item.value, item.metricId)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}
