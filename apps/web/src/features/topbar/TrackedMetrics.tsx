/**
 * Отслеживаемые показатели (раздел 9.4 `CONTEXT.md`). Выбранные здесь показатели
 * закрепляются вверху полотна графиков и переключают светофор трека на карте в режим
 * "только по отслеживаемым" - это превращает карту в инструмент расследования.
 *
 * Выбор идет из справочника: показатели сгруппированы по группам, с иконками и поиском.
 */

import {
  getMetric,
  METRIC_GROUP_IDS,
  METRIC_GROUPS,
  METRIC_IDS,
  type MetricId,
  UNITS,
} from '@ra/contracts';
import { useMemo, useState } from 'react';
import { useAppStore, useTrackedMetrics } from '@/shared/store';
import { Button, cx, MetricIcon, Popover, Tooltip, usePopoverAnchor } from '@/shared/ui';
import { SearchIcon, TrackedIcon } from './icons.js';

/** Сколько чипов показываем в полоске, прежде чем свернуть остаток в счетчик. */
const MAX_VISIBLE_CHIPS = 3;

function matches(metricId: MetricId, query: string): boolean {
  if (query === '') {
    return true;
  }
  const metric = getMetric(metricId);
  const needle = query.toLocaleLowerCase('ru');
  return (
    metric.name.toLocaleLowerCase('ru').includes(needle) ||
    metric.shortName.toLocaleLowerCase('ru').includes(needle) ||
    metric.id.toLowerCase().includes(needle)
  );
}

export function TrackedMetrics({ compact }: { compact: boolean }) {
  const tracked = useTrackedMetrics();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { ref, anchor } = usePopoverAnchor();

  const groups = useMemo(
    () =>
      METRIC_GROUP_IDS.map((groupId) => ({
        group: METRIC_GROUPS[groupId],
        metrics: METRIC_IDS.filter(
          (metricId) => getMetric(metricId).groupId === groupId && matches(metricId, query),
        ),
      })).filter((entry) => entry.metrics.length > 0),
    [query],
  );

  const visible = tracked.slice(0, MAX_VISIBLE_CHIPS);
  const hidden = tracked.length - visible.length;

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Tooltip
        placement="bottom"
        content="Отслеживаемые показатели закрепляются вверху полотна графиков и переключают светофор трека на карте в режим 'только по отслеживаемым'."
      >
        <Button
          ref={ref}
          variant="outline"
          active={tracked.length > 0}
          onClick={() => setOpen((v) => !v)}
        >
          <TrackedIcon />
          {!compact && <span>Отслеживаемые</span>}
          {tracked.length > 0 && (
            <span className="tabular rounded-pill bg-primary-soft px-1.5 text-[11px] text-primary-text">
              {tracked.length}
            </span>
          )}
        </Button>
      </Tooltip>

      {/* Чипы выбранных: видны прямо в полоске, снимаются щелчком. */}
      {!compact && (
        <div className="flex min-w-0 items-center gap-1">
          {visible.map((metricId) => (
            <button
              key={metricId}
              type="button"
              title={`${getMetric(metricId).name} - убрать из отслеживаемых`}
              onClick={() => useAppStore.getState().toggleTrackedMetric(metricId)}
              className={cx(
                'flex h-6 max-w-40 items-center gap-1 rounded-pill border border-primary/35',
                'bg-primary-soft px-2 text-[11px] text-primary-text hover:border-primary/70 cursor-pointer',
              )}
            >
              <MetricIcon metricId={metricId} className="size-3.5" />
              <span className="truncate">{getMetric(metricId).shortName}</span>
              <span aria-hidden="true" className="text-fg-faint">
                x
              </span>
            </button>
          ))}
          {hidden > 0 && (
            <span className="tabular text-[11px] whitespace-nowrap text-fg-faint">
              и еще {hidden}
            </span>
          )}
        </div>
      )}

      <Popover open={open} onOpenChange={setOpen} anchor={anchor} className="w-80">
        <div className="flex items-center gap-2 border-b border-border-base px-1.5 pb-2">
          <span className="text-fg-faint">
            <SearchIcon />
          </span>
          <input
            type="search"
            value={query}
            // biome-ignore lint/a11y/noAutofocus: поповер открыт щелчком ради поиска - фокус в поле ожидаем
            autoFocus
            placeholder="Поиск показателя"
            aria-label="Поиск показателя"
            onChange={(event) => setQuery(event.currentTarget.value)}
            className="h-6 flex-1 bg-transparent text-[12px] text-fg outline-none placeholder:text-fg-faint"
          />
          {tracked.length > 0 && (
            <Button
              variant="ghost"
              onClick={() => useAppStore.getState().setTrackedMetrics([])}
              className="text-fg-faint"
            >
              Сбросить
            </Button>
          )}
        </div>

        <div className="mt-1.5 max-h-96 overflow-y-auto pr-0.5">
          {groups.length === 0 && (
            <p className="px-2 py-4 text-center text-[12px] text-fg-faint">Ничего не найдено</p>
          )}
          {groups.map(({ group, metrics }) => (
            <div key={group.id} className="mb-1.5">
              <div className="flex items-center gap-1.5 px-1.5 py-1 text-[11px] text-fg-faint">
                <MetricIcon groupId={group.id} className="size-3.5" />
                <span>{group.name}</span>
              </div>
              {metrics.map((metricId) => {
                const metric = getMetric(metricId);
                const checked = tracked.includes(metricId);
                return (
                  <label
                    key={metricId}
                    className={cx(
                      'flex cursor-pointer items-center gap-2 rounded-control px-1.5 py-1',
                      'hover:bg-surface-hover',
                      checked && 'text-primary-text',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => useAppStore.getState().toggleTrackedMetric(metricId)}
                      className="size-3.5 accent-[var(--primary-500)]"
                    />
                    <MetricIcon metricId={metricId} className="size-3.5" />
                    <span className="flex-1 truncate text-[12px]">{metric.name}</span>
                    <span className="text-[11px] text-fg-faint">
                      {UNITS[metric.displayUnitId].symbol}
                    </span>
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      </Popover>
    </div>
  );
}
