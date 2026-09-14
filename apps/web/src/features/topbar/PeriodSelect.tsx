/**
 * Выбор периода данных в стиле Grafana. Список пресетов берется из `/api/config`,
 * пока конфигурация не пришла - из контрактов (значения те же, это один справочник).
 */

import { PERIODS, type PeriodId } from '@ra/contracts';
import { useConfig } from '@/shared/api';
import { useAppStore, usePeriodId } from '@/shared/store';
import { Select, type SelectOption } from '@/shared/ui';
import { ClockIcon } from './icons.js';

export function PeriodSelect({ showLabel }: { showLabel: boolean }) {
  const periodId = usePeriodId();
  const config = useConfig();
  const periods = config.data?.periods ?? PERIODS;

  const options: SelectOption<PeriodId>[] = periods.map((period) => ({
    value: period.id,
    label: period.label,
  }));

  return (
    <Select
      label="Период данных"
      showLabel={showLabel}
      value={periodId}
      options={options}
      onChange={(next) => useAppStore.getState().setPeriodId(next)}
      className="min-w-24"
      renderTrigger={(option) => (
        <>
          <span className="text-fg-faint">
            <ClockIcon />
          </span>
          <span>{option?.label ?? '-'}</span>
        </>
      )}
    />
  );
}
