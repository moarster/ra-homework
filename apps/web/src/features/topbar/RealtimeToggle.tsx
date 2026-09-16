/**
 * Тумблер real-time: включает и выключает подписку на websocket. Рядом - индикатор соединения,
 * потому что это ровно то, что тумблер и делает.
 */

import type { ConnectionStatus } from '@/shared/store';
import { useAppStore, useConnection, useRealtime } from '@/shared/store';
import { cx, Toggle, Tooltip } from '@/shared/ui';

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  offline: 'Отключено',
  connecting: 'Подключение',
  online: 'Подключено',
  reconnecting: 'Переподключение',
};

const STATUS_DOT: Record<ConnectionStatus, string> = {
  offline: 'bg-sev-unknown',
  connecting: 'bg-sev-warn animate-pulse',
  online: 'bg-sev-ok',
  reconnecting: 'bg-sev-warn animate-pulse',
};

const STATUS_HINT: Record<ConnectionStatus, string> = {
  offline: 'Поток данных выключен. Время и показатели замерли на последней точке.',
  connecting: 'Открываем соединение с сервером.',
  online: 'Снапшоты машин приходят по websocket, до четырех раз в секунду.',
  reconnecting: 'Соединение потеряно, повторяем попытки с нарастающей задержкой.',
};

export function ConnectionIndicator() {
  const connection = useConnection();
  return (
    <Tooltip content={STATUS_HINT[connection]} placement="bottom">
      <span className="flex items-center gap-1.5" role="status">
        <span aria-hidden="true" className={cx('size-2 rounded-full', STATUS_DOT[connection])} />
        <span className="text-[11px] whitespace-nowrap text-fg-faint">
          {STATUS_TEXT[connection]}
        </span>
      </span>
    </Tooltip>
  );
}

export function RealtimeToggle({ showLabel }: { showLabel: boolean }) {
  const realtime = useRealtime();
  return (
    <div className="flex items-center gap-2">
      <Tooltip
        content="Подписка на поток данных. При выключении соединение закрывается, при включении открывается заново и пропущенный интервал добирается одним запросом."
        placement="bottom"
      >
        <span>
          <Toggle
            checked={realtime}
            onChange={(next) => useAppStore.getState().setRealtime(next)}
            label="real-time"
            showLabel={showLabel}
          />
        </span>
      </Tooltip>
      <ConnectionIndicator />
    </div>
  );
}
