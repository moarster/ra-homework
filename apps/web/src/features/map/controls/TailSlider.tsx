/**
 * Слайдер длины хвоста трека.
 *
 * Диапазон - от минуты до текущего периода дашборда (раздел 4 этапа). Значение в сторе
 * при этом не обрезается периодом: пользователь мог выставить хвост в 6 часов на суточном
 * периоде, переключиться на час и вернуться обратно - хвост должен вернуться прежним.
 * Поэтому ползунок показывает фактическую длину (минимум из периода и значения), а в стор
 * пишется то, что выбрано.
 */

import { PERIODS, type PeriodId } from '@ra/contracts';
import { formatDuration } from '@/shared/format';
import { Panel, Slider } from '@/shared/ui';

/** Минимальная длина хвоста: минута. */
const MIN_TAIL_SECONDS = 60;

export interface TailSliderProps {
  /** Значение из стора: может быть больше периода. */
  value: number;
  periodSeconds: number;
  periodId: PeriodId;
  onChange: (seconds: number) => void;
}

function periodLabel(periodId: PeriodId): string {
  return PERIODS.find((period) => period.id === periodId)?.label ?? formatDuration(0);
}

export function TailSlider({ value, periodSeconds, periodId, onChange }: TailSliderProps) {
  const effective = Math.min(value, periodSeconds);
  const max = Math.max(MIN_TAIL_SECONDS, periodSeconds);
  // Шаг в сотую долю периода: на пяти минутах это три секунды, на сутках - около 15 минут.
  const step = Math.max(1, Math.round(periodSeconds / 100));

  return (
    <Panel
      tone="float"
      overImagery
      className="pointer-events-auto absolute bottom-3 left-3 flex items-center gap-2 px-3 py-2"
    >
      <Slider
        label="Хвост"
        min={MIN_TAIL_SECONDS}
        max={max}
        step={step}
        value={Math.min(Math.max(effective, MIN_TAIL_SECONDS), max)}
        onChange={onChange}
        className="w-auto"
      />
      {/* Подпись отдельной строкой, а не через `valueText` слайдера: там она обрезается. */}
      <span className="tabular text-[12px] whitespace-nowrap text-fg">
        {formatDuration(effective)} из {periodLabel(periodId)}
      </span>
    </Panel>
  );
}
