/**
 * Элементы симуляции. Визуально отделены в собственную стеклянную группу с пометкой
 * "симуляция": это управление генератором данных, а не производственный элемент интерфейса,
 * и на защите важно, что эта граница видна.
 *
 * Любое изменение отправляется в `POST /api/sim` и подтверждается ответом сервера:
 * в сторе лежит подтвержденное состояние, а не оптимистичное.
 *
 * Симуляция одна на всех зрителей стенда. Группа показывает, сколько вкладок открыто, и на
 * несколько секунд помечается, когда параметры поменял кто-то другой: иначе скорость или
 * число машин, сменившиеся сами собой, выглядели бы сбоем.
 */

import {
  CHAOS_LEVELS,
  type ChaosLevel,
  MAX_VEHICLES,
  MIN_VEHICLES,
  maxTimeScaleFor,
  maxVehiclesForTimeScale,
  SEVERITY,
  TIME_SCALES,
} from '@ra/contracts';
import { useEffect, useRef, useState } from 'react';
import { useSetSim } from '@/shared/api';
import { useSim, useSimChangedByOtherAt, useViewers } from '@/shared/store';
import {
  Button,
  cx,
  IconButton,
  Popover,
  SEVERITY_CLASSES,
  Select,
  Slider,
  Tooltip,
  usePopoverAnchor,
} from '@/shared/ui';
import { ChaosIcon, InfoIcon, SimIcon, SpeedIcon, TruckIcon, ViewersIcon } from './icons.js';

/** Пауза перед отправкой числа машин, миллисекунды: слайдер шлет много промежуточных значений. */
const VEHICLE_COMMIT_DELAY_MS = 350;

/** Сколько держится пометка о чужом изменении параметров, миллисекунды. */
const FOREIGN_CHANGE_NOTICE_MS = 6000;

/** Пометка чужого изменения - повод обратить внимание, поэтому цвет предупреждения. */
const NOTICE_CLASSES = SEVERITY_CLASSES[SEVERITY.WARN];

const PLURAL_RULES = new Intl.PluralRules('ru-RU');

/** true, пока с последнего чужого изменения параметров прошло меньше пары секунд. */
function useForeignChangeNotice(): boolean {
  const changedAt = useSimChangedByOtherAt();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const left = changedAt + FOREIGN_CHANGE_NOTICE_MS - Date.now();
    if (changedAt === 0 || left <= 0) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const timer = window.setTimeout(() => {
      setVisible(false);
    }, left);
    return () => {
      window.clearTimeout(timer);
    };
  }, [changedAt]);
  return visible;
}

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
      content={
        <span className="block">
          <span className="block">
            Число машин в парке: от {MIN_VEHICLES} до {MAX_VEHICLES}
          </span>
          <span className="mt-1 block text-fg-muted">
            Чем больше машин, тем ниже предел скорости времени: при {draft} - не выше x
            {maxTimeScaleFor(draft)}. Если скорость выше предела, она снизится сама.
          </span>
        </span>
      }
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
  const max = maxTimeScaleFor(sim.vehicleCount);
  return (
    <Tooltip
      content={`Скорость течения виртуального времени. Предел зависит от числа машин: при ${sim.vehicleCount} - не выше x${max}.`}
      placement="bottom"
    >
      <span className="flex items-center gap-1.5">
        <Select
          label="Скорость времени"
          value={sim.timeScale}
          options={TIME_SCALES.map((scale) => ({
            value: scale,
            label: `x${scale}`,
            ...(scale > max
              ? { disabled: true, hint: `не больше ${maxVehiclesForTimeScale(scale)} машин` }
              : {}),
          }))}
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

/** Сколько вкладок открыто на стенде: симуляция у всех одна. */
function ViewersIndicator() {
  const viewers = useViewers();
  if (viewers === null) {
    return null;
  }
  const tabs = PLURAL_RULES.select(viewers) === 'one' ? 'вкладке' : 'вкладках';
  return (
    <Tooltip
      placement="bottom-end"
      content={
        <span className="block">
          <span className="block">
            Стенд сейчас открыт в {viewers} {tabs}, включая эту.
          </span>
          <span className="mt-1 block text-fg-muted">
            Симуляция одна на всех: число машин, скорость и мера хаоса меняются сразу у всех
            зрителей. Изменение, сделанное другим зрителем, ненадолго подсвечивает эту группу.
          </span>
        </span>
      }
    >
      <span
        role="status"
        aria-label={`Открыто вкладок: ${viewers}`}
        className="flex cursor-help items-center gap-1 text-[12px] text-fg-muted tabular"
      >
        <span className="text-fg-faint">
          <ViewersIcon />
        </span>
        {viewers}
      </span>
    </Tooltip>
  );
}

/** Сами элементы: используются и в полоске, и внутри поповера компактного режима. */
function SimControlsBody({ stacked }: { stacked: boolean }) {
  return (
    <div className={cx('flex gap-2', stacked ? 'flex-col items-stretch' : 'items-center')}>
      <VehicleCountControl />
      <TimeScaleControl />
      <ChaosControl />
      <ViewersIndicator />
    </div>
  );
}

/** Подпись группы: "симуляция" или, после чужого изменения, кто его сделал. */
function GroupLabel({ notice, className }: { notice: boolean; className: string }) {
  return (
    <span
      aria-live="polite"
      className={cx(
        'font-semibold tracking-wider whitespace-nowrap uppercase',
        notice ? NOTICE_CLASSES.text : 'text-accent-text',
        className,
      )}
    >
      {notice ? 'изменено другим зрителем' : 'симуляция'}
    </span>
  );
}

export function SimControls({ inPopover }: { inPopover: boolean }) {
  const [open, setOpen] = useState(false);
  const { ref, anchor } = usePopoverAnchor();
  const sim = useSim();
  const notice = useForeignChangeNotice();

  if (inPopover) {
    return (
      <>
        <Tooltip content="Параметры симуляции данных" placement="bottom">
          <Button
            ref={ref}
            variant="outline"
            onClick={() => setOpen((v) => !v)}
            className={cx('gap-1.5', notice && cx(NOTICE_CLASSES.border, NOTICE_CLASSES.surface))}
          >
            <SimIcon />
            <span className="tabular text-fg-muted">
              {sim.vehicleCount} / x{sim.timeScale}
            </span>
          </Button>
        </Tooltip>
        <Popover open={open} onOpenChange={setOpen} anchor={anchor} placement="bottom-end">
          <div className="flex flex-col gap-2 p-1">
            <GroupLabel notice={notice} className="text-[10px]" />
            <SimControlsBody stacked />
          </div>
        </Popover>
      </>
    );
  }

  return (
    <div
      className={cx(
        'relative flex items-center gap-2 rounded-control border pt-2.5 pr-2 pb-1 pl-2',
        'transition-colors',
        notice
          ? cx(NOTICE_CLASSES.border, NOTICE_CLASSES.surface)
          : 'border-accent/25 bg-accent-soft/40',
      )}
    >
      <GroupLabel notice={notice} className="absolute top-0 left-2 text-[9px] leading-none" />
      <SimControlsBody stacked={false} />
    </div>
  );
}
