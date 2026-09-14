/** Сводка по парку над списком: сколько машин в работе, с авариями, без связи. */

import { SEVERITY, type Severity } from '@ra/contracts';
import { cx, Panel, severityClasses } from '@/shared/ui';
import type { FleetCounts } from '../data/fleet.js';

function Figure({
  label,
  value,
  severity,
}: {
  label: string;
  value: number;
  severity: Severity | null;
}) {
  const active = severity !== null && value > 0;
  const classes = severity === null ? null : severityClasses(severity);
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap">
      {classes !== null && (
        <span
          aria-hidden="true"
          className={cx(
            'size-2 self-center rounded-full',
            active ? classes.solid : 'bg-border-strong',
          )}
        />
      )}
      <span
        className={cx(
          'tabular text-[16px] font-semibold',
          active && classes !== null ? classes.text : 'text-fg',
        )}
      >
        {value}
      </span>
      <span className="text-[11px] text-fg-muted">{label}</span>
    </div>
  );
}

export function FleetSummary({ counts }: { counts: FleetCounts }) {
  return (
    <Panel
      tone="glass"
      className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2.5"
      aria-label="Сводка по парку"
    >
      <div className="flex items-baseline gap-1.5 whitespace-nowrap">
        <span className="tabular text-[16px] font-semibold">{counts.working}</span>
        <span className="text-[11px] text-fg-muted">в работе из {counts.total}</span>
      </div>
      <Figure label="с авариями" value={counts.alarms} severity={SEVERITY.ALARM} />
      <Figure label="с предупреждениями" value={counts.warnings} severity={SEVERITY.WARN} />
      <Figure label="без связи" value={counts.noData} severity={SEVERITY.UNKNOWN} />
    </Panel>
  );
}
