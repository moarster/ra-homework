/**
 * Временная отладочная панель (удаляется на этапе 6). На этом этапе карта и мониторинг пусты,
 * и это единственный способ увидеть, что данные действительно текут и укладываются в бюджеты.
 */

import { SEVERITY_NAMES } from '@ra/contracts';
import { useState } from 'react';
import { formatBytes, formatDuration, formatTime } from '@/shared/format';
import { useConnection, useRealtime, useSim } from '@/shared/store';
import { Badge, cx, Panel } from '@/shared/ui';
import { snapshotStore, useSnapshotStats, useSnapshotsVersion } from '@/shared/ws';

/** Бюджет обработки тика на клиенте, миллисекунды (раздел 11 `SPEC.md`). */
const TICK_BUDGET_MS = 8;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border-base/60 py-1">
      <span className="text-[11px] whitespace-nowrap text-fg-faint">{label}</span>
      <span className="tabular text-[11px] text-fg">{children}</span>
    </div>
  );
}

export function DebugPanel() {
  const [open, setOpen] = useState(false);
  const stats = useSnapshotStats();
  const sim = useSim();
  const realtime = useRealtime();
  const connection = useConnection();
  // Версия хранилища в зависимостях: панель должна обновляться и от событий, и от тиков.
  useSnapshotsVersion();
  const events = snapshotStore.getRecentEvents();
  const overBudget = stats.lastTotalMs > TICK_BUDGET_MS;

  return (
    <Panel
      tone="glass"
      className={cx(
        'pointer-events-auto absolute inset-x-2 bottom-2 z-10 overflow-hidden',
        open ? 'max-h-[60%]' : '',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-hover"
      >
        <span className="text-[11px] font-semibold tracking-wider text-fg-faint uppercase">
          отладка
        </span>
        <Badge severity={overBudget ? 1 : 0} className="tabular">
          тик {stats.lastTotalMs.toFixed(1)} мс
        </Badge>
        <span className="tabular text-[11px] text-fg-muted">
          {stats.vehicles} машин, {stats.tickRateHz.toFixed(1)} тик/с
        </span>
        <span className="ml-auto text-[11px] text-fg-faint">
          {open ? 'свернуть' : 'развернуть'}
        </span>
      </button>

      {open && (
        <div className="grid gap-x-6 gap-y-0 overflow-y-auto px-3 pt-1 pb-3 @md/monitor:grid-cols-2">
          <div>
            <Row label="Виртуальное время">
              {/* Время последнего тика, а не зеркала `/api/sim`: именно оно показывает поток. */}
              {snapshotStore.getSimTime() > 0
                ? formatTime(snapshotStore.getSimTime())
                : 'нет данных'}
            </Row>
            <Row label="История с">
              {sim.historyFrom > 0 ? formatTime(sim.historyFrom) : 'нет данных'}
            </Row>
            <Row label="Глубина истории">
              {snapshotStore.getSimTime() > 0
                ? formatDuration(snapshotStore.getSimTime() - sim.historyFrom)
                : '-'}
            </Row>
            <Row label="Скорость времени">x{sim.timeScale}</Row>
            <Row label="Машин в симуляции">{sim.vehicleCount}</Row>
            <Row label="Мера хаоса">{sim.chaos}</Row>
            <Row label="Симуляция идет">{sim.running ? 'да' : 'нет'}</Row>
            <Row label="Seed">{sim.seed}</Row>
          </div>
          <div>
            <Row label="Тумблер real-time">{realtime ? 'включен' : 'выключен'}</Row>
            <Row label="Websocket">{connection}</Row>
            <Row label="Машин в снапшоте">{stats.vehicles}</Row>
            <Row label="Частота тиков">{stats.tickRateHz.toFixed(2)} тик/с</Row>
            <Row label="Тиков получено">{stats.ticksReceived}</Row>
            <Row label="Последнее сообщение">{formatBytes(stats.lastMessageBytes)}</Row>
            <Row label="Точек позиции в пачке">{stats.lastPositionPoints}</Row>
            <Row label="Разбор / применение">
              {stats.lastDecodeMs.toFixed(2)} / {stats.lastApplyMs.toFixed(2)} мс
            </Row>
            <Row label={`Обработка тика (бюджет ${TICK_BUDGET_MS} мс)`}>
              <span className={overBudget ? 'text-sev-warn' : 'text-sev-ok'}>
                {stats.lastTotalMs.toFixed(2)} мс, худший {stats.maxTotalMs.toFixed(2)} мс
              </span>
            </Row>
          </div>

          <div className="@md/monitor:col-span-2">
            <div className="mt-2 mb-1 text-[11px] font-semibold tracking-wider text-fg-faint uppercase">
              последние события
            </div>
            {events.length === 0 ? (
              <p className="text-[11px] text-fg-faint">Событий пока не было</p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {events.map((event) => (
                  <li
                    key={`${event.id}-${event.endedAt ?? 'open'}`}
                    className="flex items-baseline gap-2 text-[11px]"
                  >
                    <span className="tabular text-fg-faint">{formatTime(event.startedAt)}</span>
                    <Badge severity={event.severity} dot={false}>
                      {SEVERITY_NAMES[event.severity]}
                    </Badge>
                    <span className="text-fg-muted">{event.vehicleId}</span>
                    <span className="truncate text-fg">{event.title}</span>
                    <span className="ml-auto text-fg-faint">
                      {event.endedAt === null ? 'активно' : 'закрыто'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
