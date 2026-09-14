/**
 * Элементы симуляции. Визуально отделены в собственную стеклянную группу с пометкой
 * "симуляция": это управление генератором данных, а не производственный элемент интерфейса,
 * и на защите важно, что эта граница видна.
 *
 * Любое изменение отправляется в `POST /api/sim` и подтверждается ответом сервера:
 * в сторе лежит подтвержденное состояние, а не оптимистичное.
 */

import {
  CHAOS_LEVELS,
  type ChaosLevel,
  MAX_VEHICLES,
  MIN_VEHICLES,
  TIME_SCALES,
} from '@ra/contracts';
import { useEffect, useRef, useState } from 'react';
import { useSetSim } from '@/shared/api';
import { useSim } from '@/shared/store';
import {
  Button,
  cx,
  IconButton,
  Popover,
  Select,
  Slider,
  Tooltip,
  usePopoverAnchor,
} from '@/shared/ui';
import { ChaosIcon, InfoIcon, SimIcon, SpeedIcon, TruckIcon } from './icons.js';

/** Пауза перед отправкой числа машин, миллисекунды: слайдер шлет много промежуточных значений. */
const VEHICLE_COMMIT_DELAY_MS = 350;

/** Пояснение меры хаоса: она меняет не только частоту аварий (раздел 10 `CONTEXT.md`). */
const CHAOS_HINT =
  'Мера хаоса управляет двумя вещами сразу: частотой аварийных сценариев и разбродом обычной ' +
  'работы парка. При высокой мере дашборд выглядит беспокойным и без аварий: линии гуляют шире, ' +
  'машины заметно отличаются друг от друга, показатели чаще задевают желтую зону, растет доля ' +
  'холостого хода, качество связи хуже.';

const CHAOS_HINTS: Record<ChaosLevel, string> = {
  NORMAL: 'Ровные показатели, парк однородный, связь устойчивая',
  MESSY: 'Шум и дрейф выше, разброс между машинами заметен, простои дольше',
  UGLY: 'Показатели работают у границы желтой зоны, тормоза горячее, связь рвется',
  CHAOS: 'Сильный разброд, разнородный парк, частый холостой ход, рваные данные',
};

function VehicleCountControl() {
  const sim = useSim();
  const setSim = useSetSim();
  const [draft, setDraft] = useState(sim.vehicleCount);
  const timer = useRef<number | null>(null);
  const pending = useRef(false);

  // Подтвержденное сервером значение главнее черновика, если мы сами его не меняем.
  useEffect(() => {
    if (!pending.current) {
      setDraft(sim.vehicleCount);
    }
  }, [sim.vehicleCount]);

  const commit = (value: number) => {
    setDraft(value);
    pending.current = true;
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
    }
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setSim.mutate(
        { vehicleCount: value },
        {
          onSettled: () => {
            pending.current = false;
          },
        },
      );
    }, VEHICLE_COMMIT_DELAY_MS);
  };

  return (
    <Tooltip
      content={`Число машин в парке: от ${MIN_VEHICLES} до ${MAX_VEHICLES}`}
      placement="bottom"
    >
      <span className="flex items-center gap-1.5">
        <span className="text-fg-faint">
          <TruckIcon />
        </span>
        <Slider
          label="Машин"
          min={MIN_VEHICLES}
          max={MAX_VEHICLES}
          value={draft}
          onChange={commit}
          valueText={String(draft)}
          className="[&>span:first-child]:sr-only"
        />
      </span>
    </Tooltip>
  );
}

function TimeScaleControl() {
  const sim = useSim();
  const setSim = useSetSim();
  return (
    <Tooltip content="Скорость течения виртуального времени" placement="bottom">
      <span className="flex items-center gap-1.5">
        <Select
          label="Скорость времени"
          value={sim.timeScale}
          options={TIME_SCALES.map((scale) => ({ value: scale, label: `x${scale}` }))}
          onChange={(scale) => setSim.mutate({ timeScale: scale })}
          renderTrigger={(option) => (
            <>
              <span className="text-fg-faint">
                <SpeedIcon />
              </span>
              <span className="tabular">{option?.label ?? '-'}</span>
            </>
          )}
        />
      </span>
    </Tooltip>
  );
}

function ChaosControl() {
  const sim = useSim();
  const setSim = useSetSim();
  return (
    <span className="flex items-center gap-1">
      <Select
        label="Мера хаоса"
        value={sim.chaos}
        options={CHAOS_LEVELS.map((level) => ({
          value: level.id,
          label: level.name,
          hint: CHAOS_HINTS[level.id],
        }))}
        onChange={(chaos) => setSim.mutate({ chaos })}
        className="min-w-28"
        renderTrigger={(option) => (
          <>
            <span className="text-fg-faint">
              <ChaosIcon />
            </span>
            <span>{option?.label ?? '-'}</span>
          </>
        )}
      />
      <Tooltip content={CHAOS_HINT} placement="bottom">
        <IconButton label="Что меняет мера хаоса" icon={<InfoIcon />} className="size-6" />
      </Tooltip>
    </span>
  );
}

/** Сами элементы: используются и в полоске, и внутри поповера компактного режима. */
function SimControlsBody({ stacked }: { stacked: boolean }) {
  return (
    <div className={cx('flex gap-2', stacked ? 'flex-col items-stretch' : 'items-center')}>
      <VehicleCountControl />
      <TimeScaleControl />
      <ChaosControl />
    </div>
  );
}

export function SimControls({ inPopover }: { inPopover: boolean }) {
  const [open, setOpen] = useState(false);
  const { ref, anchor } = usePopoverAnchor();
  const sim = useSim();

  if (inPopover) {
    return (
      <>
        <Tooltip content="Параметры симуляции данных" placement="bottom">
          <Button
            ref={ref}
            variant="outline"
            onClick={() => setOpen((v) => !v)}
            className="gap-1.5"
          >
            <SimIcon />
            <span className="tabular text-fg-muted">
              {sim.vehicleCount} / x{sim.timeScale}
            </span>
          </Button>
        </Tooltip>
        <Popover open={open} onOpenChange={setOpen} anchor={anchor} placement="bottom-end">
          <div className="flex flex-col gap-2 p-1">
            <span className="text-[10px] font-semibold tracking-wider text-accent-text uppercase">
              симуляция
            </span>
            <SimControlsBody stacked />
          </div>
        </Popover>
      </>
    );
  }

  return (
    <div
      className={cx(
        'relative flex items-center gap-2 rounded-control border border-accent/25',
        'bg-accent-soft/40 pt-2.5 pr-2 pb-1 pl-2',
      )}
    >
      <span className="absolute top-0 left-2 text-[9px] leading-none font-semibold tracking-wider text-accent-text uppercase">
        симуляция
      </span>
      <SimControlsBody stacked={false} />
    </div>
  );
}
