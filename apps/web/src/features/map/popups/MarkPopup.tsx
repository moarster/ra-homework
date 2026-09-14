/** Всплывашка флажка на треке: что сработало, когда и на какой машине (раздел 6 этапа). */

import { ALARMS, findFlag, SEVERITY, type Severity, WARNINGS } from '@ra/contracts';
import { formatTime } from '@/shared/format';
import { Badge, Panel, severityClasses } from '@/shared/ui';

export interface MarkPopupProps {
  code: string;
  severity: Severity;
  t: number;
  sideNumber: string;
}

/** Название бита из каталога контрактов; каталог выбирается по степени события. */
function markTitle(code: string, severity: Severity): string {
  const catalog = severity === SEVERITY.ALARM ? ALARMS : WARNINGS;
  return findFlag(code, catalog)?.name ?? code;
}

export function MarkPopup({ code, severity, t, sideNumber }: MarkPopupProps) {
  return (
    // Плотная подложка, а не полупрозрачное стекло: всплывашка всплывает в любом месте снимка.
    <Panel tone="popup" className="w-60 p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-semibold leading-snug">{markTitle(code, severity)}</span>
        <Badge severity={severity} dot={false}>
          {severityClasses(severity).name}
        </Badge>
      </div>
      <div className="tabular mt-1.5 text-[12px] text-fg-muted">{formatTime(t)}</div>
      <div className="mt-0.5 text-[12px] text-fg-muted">Борт {sideNumber}</div>
    </Panel>
  );
}
