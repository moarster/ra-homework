/**
 * Дата и время объекта до секунды - самый крупный элемент полоски: все остальное на экране
 * читается относительно этого момента.
 *
 * Показывается время монитора, если он выбран, иначе время последней точки данных.
 * При выбранном мониторе рядом появляется кнопка "к последней точке".
 */

import {
  formatDate,
  formatTime,
  formatWeekday,
  TIMEZONE_NAME,
  timezoneLabel,
} from '@/shared/format';
import { useAppStore, useMonitorTs, useRealtime, useSim } from '@/shared/store';
import { Button, cx, Skeleton, Tooltip } from '@/shared/ui';
import { useSimClock } from '@/shared/ws';
import { LatestIcon, TargetIcon } from './icons.js';

export function SimClock({ compact }: { compact: boolean }) {
  const monitorTs = useMonitorTs();
  const realtime = useRealtime();
  const sim = useSim();
  // Часы идут только когда данные текут: на паузе время замирает на последней точке.
  const liveTs = useSimClock(realtime && sim.running);
  const shownTs = monitorTs ?? liveTs;
  const isMonitor = monitorTs !== null;

  if (shownTs <= 0) {
    return (
      <div className="flex items-center gap-2">
        <Skeleton className="h-6 w-36" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Tooltip
        placement="bottom"
        content={
          <span className="block">
            <span className="block">
              {isMonitor
                ? 'Время монитора: точка временного фокуса.'
                : 'Время последней точки данных.'}
            </span>
            <span className="mt-1 block text-fg-muted">
              Часовой пояс объекта: {TIMEZONE_NAME} ({timezoneLabel(shownTs)}).
            </span>
          </span>
        }
      >
        <div className="flex cursor-help items-baseline gap-2">
          <span
            className={cx(
              'tabular text-[19px] leading-none font-semibold',
              isMonitor ? 'text-accent-text' : 'text-fg',
            )}
          >
            {formatTime(shownTs)}
          </span>
          {!compact && (
            <span className="tabular text-[11px] whitespace-nowrap text-fg-muted">
              {formatWeekday(shownTs)} {formatDate(shownTs)}
            </span>
          )}
          <span className="text-[10px] whitespace-nowrap text-fg-faint">
            {timezoneLabel(shownTs)}
          </span>
        </div>
      </Tooltip>

      {isMonitor && (
        <Tooltip content="Сбросить монитор и вернуться к последней точке данных" placement="bottom">
          <Button
            variant="outline"
            onClick={() => useAppStore.getState().clearMonitor()}
            className="gap-1"
          >
            <span className="text-accent-text">
              <TargetIcon />
            </span>
            {!compact && <span>к последней точке</span>}
            <LatestIcon />
          </Button>
        </Tooltip>
      )}
    </div>
  );
}
