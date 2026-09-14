/**
 * Аварии и предупреждения за период по типам: число срабатываний и суммарная длительность.
 * Клик по типу ставит монитор на момент последнего срабатывания и скроллит полотно к графику
 * показателя, на котором это событие видно.
 *
 * В сводке есть только момент первого срабатывания, поэтому последний берется из журнала
 * событий - запросом по клику, а не постоянным опросом.
 */

import {
  eventMetric,
  getMetric,
  QUERY_LIMITS,
  SEVERITY,
  type VehicleSummaryResponse,
} from '@ra/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, queryKeys } from '@/shared/api';
import { formatDuration } from '@/shared/format';
import { useAppStore } from '@/shared/store';
import { Badge, cx, MetricIcon, Panel } from '@/shared/ui';

type EventStat = VehicleSummaryResponse['eventStats'][number];

const PLURAL_RULES = new Intl.PluralRules('ru-RU');

function triggers(count: number): string {
  const form = PLURAL_RULES.select(count);
  const word = form === 'one' ? 'срабатывание' : form === 'few' ? 'срабатывания' : 'срабатываний';
  return `${count} ${word}`;
}

/** Время свежих данных журнала для повторных кликов, миллисекунды. */
const EVENTS_STALE_MS = 5000;

export function EventStats({
  vehicleId,
  summary,
}: {
  vehicleId: string;
  summary: VehicleSummaryResponse;
}) {
  const queryClient = useQueryClient();
  const [busyCode, setBusyCode] = useState<string | null>(null);

  const stats = [...summary.eventStats].sort(
    (a, b) => b.severity - a.severity || b.count - a.count || a.title.localeCompare(b.title, 'ru'),
  );

  const onSelect = async (stat: EventStat) => {
    setBusyCode(stat.code);
    const vehicleIds = [vehicleId];
    let lastAt = stat.firstAt;
    try {
      const response = await queryClient.fetchQuery({
        queryKey: queryKeys.events(vehicleIds, summary.from, summary.to, undefined),
        queryFn: ({ signal }) =>
          api.getEvents(
            {
              vehicleIds,
              from: summary.from,
              to: summary.to,
              limit: QUERY_LIMITS.maxEventLimit,
            },
            signal,
          ),
        staleTime: EVENTS_STALE_MS,
      });
      for (const event of response.events) {
        if (event.code === stat.code && event.startedAt > lastAt) {
          lastAt = event.startedAt;
        }
      }
    } catch {
      // Журнал недоступен: остается момент первого срабатывания из сводки.
    } finally {
      setBusyCode(null);
    }
    const store = useAppStore.getState();
    store.setMonitorTs(lastAt);
    const metric = eventMetric(stat.code, stat.metric);
    if (metric !== null) {
      store.setFocusMetric(metric);
    }
  };

  return (
    <Panel tone="glass" className="p-4">
      <h2 className="mb-2 text-[11px] font-semibold tracking-wider text-fg-faint uppercase">
        Аварии и предупреждения за период
      </h2>
      {stats.length === 0 ? (
        <div className="flex items-center gap-2 text-[12px] text-fg-muted">
          <Badge severity={SEVERITY.OK}>Норма</Badge>
          За период не было ни аварий, ни предупреждений.
        </div>
      ) : (
        <ul className="grid gap-1 @2xl/monitor:grid-cols-2">
          {stats.map((stat) => {
            const metric = eventMetric(stat.code, stat.metric);
            return (
              <li key={stat.code}>
                <button
                  type="button"
                  disabled={busyCode !== null}
                  onClick={() => {
                    void onSelect(stat);
                  }}
                  title={
                    metric === null
                      ? 'Поставить монитор на последнее срабатывание'
                      : `Поставить монитор на последнее срабатывание и перейти к графику: ${getMetric(metric).name}`
                  }
                  className={cx(
                    'flex w-full cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-left',
                    'hover:bg-surface-hover disabled:cursor-wait',
                    busyCode === stat.code && 'bg-surface-hover',
                  )}
                >
                  <Badge severity={stat.severity} className="shrink-0">
                    {stat.severity === SEVERITY.ALARM ? 'Авария' : 'Предупреждение'}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-fg">{stat.title}</span>
                  <span className="tabular shrink-0 text-right text-[11px] text-fg-muted">
                    {triggers(stat.count)}
                    <span className="block text-fg-faint">{formatDuration(stat.totalSeconds)}</span>
                  </span>
                  {metric !== null && (
                    <MetricIcon metricId={metric} className="size-3.5 text-fg-faint" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
