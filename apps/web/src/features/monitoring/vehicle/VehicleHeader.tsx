/**
 * Шапка страницы машины: слева НСИ и водитель смены, справа сводка за период
 * (раздел 9.3 `CONTEXT.md`), ниже - аварии и предупреждения по типам.
 *
 * Живые значения (светофор, статус, наработка) вынесены в маленькие компоненты с подпиской
 * на свою машину: тик не должен перерисовывать всю шапку.
 */

import {
  formatValue,
  METRIC_INDEX,
  PERIODS,
  QUALITY,
  SEVERITY,
  TRANSMISSION_NAMES,
  UNITS,
  type UnitId,
  VEHICLE_STATUS_NAMES,
  type VehicleModel,
  type VehicleSummaryResponse,
} from '@ra/contracts';
import type { ReactNode } from 'react';
import { formatDate, formatDuration, formatShortTime } from '@/shared/format';
import { usePeriodId } from '@/shared/store';
import { Badge, cx, Panel, Skeleton, severityClasses } from '@/shared/ui';
import { useVehicleSnapshot } from '@/shared/ws';
import { isGrey } from '../data/fleet.js';
import type { ApiVehicle } from '../list/use-fleet.js';
import { telHref } from '../list/VehicleCard.js';
import { BackToList } from './BackToList.js';
import { EventStats } from './EventStats.js';

export interface VehicleHeaderProps {
  vehicle: ApiVehicle;
  model: VehicleModel;
  summary: VehicleSummaryResponse | undefined;
  summaryPending: boolean;
  summaryRefreshing: boolean;
  summaryError: Error | null;
  /** Правая граница окна периода: от нее считается "сколько назад". */
  periodTo: number;
}

/** Секунд в сутках: старше этого момент без даты уже неоднозначен. */
const DAY_SECONDS = 86_400;

export function VehicleHeader(props: VehicleHeaderProps) {
  const { vehicle, model, summary } = props;
  const periodId = usePeriodId();
  const periodLabel = PERIODS.find((period) => period.id === periodId)?.label ?? periodId;

  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <BackToList />
        <h1 className="flex items-baseline gap-1.5">
          <span className="text-[12px] text-fg-faint">борт</span>
          <span className="tabular text-[26px] leading-none font-semibold">
            {vehicle.sideNumber}
          </span>
        </h1>
        <span className="text-[13px] text-fg-muted">{model.name}</span>
        <LiveState vehicleId={vehicle.id} />
      </div>

      <div className="grid gap-3 @4xl/monitor:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Panel tone="glass" className="p-4">
          <h2 className="mb-2 text-[11px] font-semibold tracking-wider text-fg-faint uppercase">
            Машина
          </h2>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[12px]">
            <Info label="Модель">
              {model.name}, {model.manufacturer}
            </Info>
            <Info label="Бортовой номер">{vehicle.sideNumber}</Info>
            <Info label="Гос. номер">{vehicle.plate}</Info>
            <Info label="Грузоподъемность">
              {formatValue(model.ratedPayloadKg, 'KILOGRAM', { unitId: 'TONNE', precision: 0 })}
            </Info>
            <Info label="Год выпуска">{vehicle.year}</Info>
            <Info label="Двигатель">
              {model.engineName}, {formatNumber(model.enginePowerKw, 0)} кВт
            </Info>
            <Info label="Трансмиссия">{TRANSMISSION_NAMES[model.transmission]}</Info>
            <Info label="Общая наработка">
              <LiveEngineHours vehicleId={vehicle.id} fallback={vehicle.engineHoursAtStart} />
            </Info>
            <Info label="Водитель смены">
              <span className="block">{vehicle.driver.fullName}</span>
              <a
                href={telHref(vehicle.driver.phone)}
                className="tabular text-primary-text underline-offset-2 hover:underline"
              >
                {vehicle.driver.phone}
              </a>
            </Info>
          </dl>
        </Panel>

        <Panel tone="glass" className="p-4" aria-busy={props.summaryRefreshing}>
          <h2 className="mb-2 flex items-baseline gap-2 text-[11px] font-semibold tracking-wider text-fg-faint uppercase">
            Сводка за {periodLabel}
            {props.summaryRefreshing && (
              <span className="font-normal tracking-normal normal-case">обновляется</span>
            )}
          </h2>
          {props.summaryError !== null && summary === undefined ? (
            <p className="text-[12px] text-sev-alarm-text">
              Сводка не загрузилась: {props.summaryError.message}
            </p>
          ) : props.summaryPending || summary === undefined ? (
            <SummarySkeleton />
          ) : summary.hasData ? (
            <SummaryFigures summary={summary} />
          ) : (
            <NoDataExplanation
              vehicle={vehicle}
              lastGoodAt={summary.lastGoodAt}
              periodTo={props.periodTo}
              periodLabel={periodLabel}
            />
          )}
        </Panel>
      </div>

      {summary?.hasData === true && <EventStats vehicleId={vehicle.id} summary={summary} />}
    </header>
  );
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="whitespace-nowrap text-fg-faint">{label}</dt>
      <dd className="min-w-0 text-fg">{children}</dd>
    </>
  );
}

const numberFormatters = new Map<number, Intl.NumberFormat>();

/** Число по-русски без единицы: для величин, которых нет в справочнике единиц (км, л/т, рейсы). */
function formatNumber(value: number | null, precision: number): string {
  if (value === null || !Number.isFinite(value)) {
    return '-';
  }
  let formatter = numberFormatters.get(precision);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
    numberFormatters.set(precision, formatter);
  }
  return formatter.format(value);
}

function withUnit(value: number | null, unitId: UnitId, precision?: number): string {
  return formatValue(value, unitId, precision === undefined ? {} : { precision });
}

function LiveState({ vehicleId }: { vehicleId: string }) {
  const snapshot = useVehicleSnapshot(vehicleId);
  if (snapshot === undefined) {
    return <Badge severity={SEVERITY.UNKNOWN}>Нет данных</Badge>;
  }
  const severity = isGrey({ severity: snapshot.sev, status: snapshot.st })
    ? SEVERITY.UNKNOWN
    : snapshot.sev;
  return (
    <span className="flex items-center gap-2">
      <Badge severity={severity}>{severityClasses(severity).name}</Badge>
      <span className="text-[12px] text-fg-muted">{VEHICLE_STATUS_NAMES[snapshot.st]}</span>
    </span>
  );
}

function LiveEngineHours({ vehicleId, fallback }: { vehicleId: string; fallback: number }) {
  const snapshot = useVehicleSnapshot(vehicleId);
  const index = METRIC_INDEX.ENGINE_HOURS;
  const live =
    snapshot !== undefined && snapshot.q[index] === QUALITY.GOOD
      ? (snapshot.v[index] ?? null)
      : null;
  return (
    <span className="tabular">
      {formatValue(live ?? fallback, 'HOUR', { precision: 0 })}
      {live === null && <span className="text-fg-faint"> на начало смены</span>}
    </span>
  );
}

function Figure({ label, value, detail }: { label: string; value: string; detail?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[11px] text-fg-faint">{label}</div>
      <div className="tabular truncate text-[18px] leading-tight font-semibold">{value}</div>
      {detail !== undefined && <div className="truncate text-[11px] text-fg-muted">{detail}</div>}
    </div>
  );
}

function SummaryFigures({ summary }: { summary: VehicleSummaryResponse }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 @2xl/monitor:grid-cols-3">
      <Figure
        label="Рейсов выполнено"
        value={formatNumber(summary.trips, 0)}
        detail={`${withUnit(summary.tonnes, 'TONNE', 0)} вывезено`}
      />
      <Figure
        label="Средняя загрузка"
        value={withUnit(summary.avgPayloadPercent, 'PERCENT', 0)}
        detail="от номинала модели"
      />
      <Figure
        label="Моточасы за период"
        value={withUnit(summary.engineHours, 'HOUR', 1)}
        detail={`холостой ход ${withUnit(summary.idlePercent, 'PERCENT', 0)}`}
      />
      <Figure
        label="Топливо"
        value={withUnit(summary.fuelLiters, 'LITER')}
        detail={`${withUnit(summary.fuelPerHour, 'LITERS_PER_HOUR')}, ${formatNumber(summary.fuelPerTonne, 2)} л/т`}
      />
      <Figure
        label="Пробег"
        value={`${formatNumber(summary.distanceKm, 1)} км`}
        detail={`ср. ${withUnit(summary.avgSpeedKmh, 'KILOMETERS_PER_HOUR', 0)}, макс. ${withUnit(summary.maxSpeedKmh, 'KILOMETERS_PER_HOUR', 0)}`}
      />
      <Figure
        label="Без связи"
        value={`${formatNumber(summary.noDataMinutes, 0)} ${UNITS.MINUTE.symbol}`}
        detail={`разрывов: ${summary.noDataGaps}`}
      />
      <Figure
        label="КТГ за период"
        value={withUnit(summary.availabilityPercent, 'PERCENT', 1)}
        detail="доля времени без аварий"
      />
    </div>
  );
}

function SummarySkeleton() {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 @2xl/monitor:grid-cols-3" aria-busy="true">
      {['a', 'b', 'c', 'd', 'e', 'f'].map((key) => (
        <div key={key} className="flex flex-col gap-1">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-5 w-16" />
        </div>
      ))}
    </div>
  );
}

function NoDataExplanation({
  vehicle,
  lastGoodAt,
  periodTo,
  periodLabel,
}: {
  vehicle: ApiVehicle;
  lastGoodAt: number | null;
  periodTo: number;
  periodLabel: string;
}) {
  const unknown = severityClasses(SEVERITY.UNKNOWN);
  const ago = lastGoodAt === null ? null : periodTo - lastGoodAt;
  const since =
    lastGoodAt === null
      ? null
      : ago !== null && ago >= DAY_SECONDS
        ? `${formatDate(lastGoodAt)} ${formatShortTime(lastGoodAt)}`
        : formatShortTime(lastGoodAt);
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className={cx('text-[16px] font-semibold', unknown.text)}>
          Нет данных за {periodLabel}
        </div>
        <p className="mt-1 text-[13px] text-fg-muted">
          {lastGoodAt === null || ago === null
            ? 'От машины не поступило ни одной точки с достоверными данными.'
            : `Нет связи с ${since}, последняя точка ${formatDuration(ago)} назад.`}
        </p>
      </div>
      <div className="rounded-control bg-sev-unknown-soft p-3">
        <div className="text-[11px] text-fg-faint">Водитель смены</div>
        <div className="text-[13px] text-fg">{vehicle.driver.fullName}</div>
        <a
          href={telHref(vehicle.driver.phone)}
          className="tabular mt-1 block text-[26px] leading-tight font-semibold text-primary-text underline-offset-4 hover:underline"
        >
          {vehicle.driver.phone}
        </a>
      </div>
    </div>
  );
}
