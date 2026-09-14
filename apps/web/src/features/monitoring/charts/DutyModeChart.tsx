/**
 * Режим работы: обороты, скорость, передача и мгновенный расход в одной композиции плюс
 * вывод о соответствии режима. Высокие обороты при низкой скорости и высоком расходе - работа
 * внатяг; низкие обороты при высокой скорости - накат. Правила вывода живут в контрактах.
 */

import {
  DUTY_MODE_HINTS,
  DUTY_MODE_NAMES,
  type DutyMode,
  dutyMode,
  formatMetricValue,
  fullLoadFuelLitersPerHour,
  SEVERITY,
  type Severity,
} from '@ra/contracts';
import { Badge } from '@/shared/ui';
import { goodValue } from '../data/snapshot-values.js';
import { gearLabel, normativeZones, redlineScale } from './chart-math.js';
import { BulletBar, type ChartPointProps, SCALE_HEADROOM, ValueLine } from './svg.js';

/** Несоответствие режима - повод посмотреть, но не авария: светофор вывода желтый. */
const MODE_SEVERITY: Record<DutyMode, Severity> = {
  LUGGING: SEVERITY.WARN,
  COASTING: SEVERITY.WARN,
  NORMAL: SEVERITY.OK,
  UNKNOWN: SEVERITY.UNKNOWN,
};

export function DutyModeChart({ values, severities, model }: ChartPointProps) {
  const rpm = goodValue(values, 'ENGINE_RPM');
  const speed = goodValue(values, 'POSITION_SPEED');
  const gear = goodValue(values, 'TRANSMISSION_GEAR');
  const fuel = goodValue(values, 'FUEL_INSTANT_CONSUMPTION');

  const rpmZones = normativeZones('ENGINE_RPM', model.id);
  const rpmTop = Math.max(redlineScale(rpmZones)?.redFrom ?? 0, rpm ?? 0) * (1 + SCALE_HEADROOM);
  const speedZones = normativeZones('POSITION_SPEED', model.id);
  const speedTop = Math.max(model.maxSpeedKmh, redlineScale(speedZones)?.redFrom ?? 0, speed ?? 0);
  const fuelTop = Math.max(fullLoadFuelLitersPerHour(model.enginePowerKw), fuel ?? 0);

  const mode = dutyMode({
    rpm,
    speedKmh: speed,
    fuelLitersPerHour: fuel,
    enginePowerKw: model.enginePowerKw,
  });
  const rpmSeverity = rpm === null ? SEVERITY.UNKNOWN : (severities.ENGINE_RPM ?? SEVERITY.OK);
  const speedSeverity =
    speed === null ? SEVERITY.UNKNOWN : (severities.POSITION_SPEED ?? SEVERITY.OK);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <div className="flex flex-col gap-1">
            <ValueLine
              label="Обороты"
              value={formatMetricValue(rpm, 'ENGINE_RPM')}
              severity={rpmSeverity}
            />
            <BulletBar
              min={0}
              max={rpmTop}
              zones={rpmZones}
              value={rpm}
              severity={rpmSeverity}
              label={`Обороты двигателя: ${formatMetricValue(rpm, 'ENGINE_RPM')}`}
            />
          </div>
          <div className="flex flex-col gap-1">
            <ValueLine
              label="Скорость"
              value={formatMetricValue(speed, 'POSITION_SPEED')}
              severity={speedSeverity}
            />
            <BulletBar
              min={0}
              max={speedTop}
              zones={speedZones}
              value={speed}
              severity={speedSeverity}
              label={`Скорость: ${formatMetricValue(speed, 'POSITION_SPEED')}`}
            />
          </div>
          <div className="flex flex-col gap-1">
            <ValueLine
              label="Расход"
              value={formatMetricValue(fuel, 'FUEL_INSTANT_CONSUMPTION')}
              severity={fuel === null ? SEVERITY.UNKNOWN : SEVERITY.OK}
              detail={`из ${formatMetricValue(fullLoadFuelLitersPerHour(model.enginePowerKw), 'FUEL_INSTANT_CONSUMPTION', { precision: 0 })}`}
            />
            <BulletBar
              min={0}
              max={fuelTop}
              zones={[]}
              value={fuel}
              severity={SEVERITY.OK}
              barClassName="fill-primary"
              label={`Мгновенный расход: ${formatMetricValue(fuel, 'FUEL_INSTANT_CONSUMPTION')} при полной мощности`}
            />
          </div>
        </div>
        <div className="flex w-16 shrink-0 flex-col items-center justify-center rounded-control bg-surface-weak">
          <span className="tabular text-[34px] leading-none font-semibold">{gearLabel(gear)}</span>
          <span className="mt-1 text-[10px] text-fg-faint">передача</span>
        </div>
      </div>
      <div className="flex flex-col gap-1 border-t border-border-base pt-2">
        <Badge severity={MODE_SEVERITY[mode]} className="w-fit">
          {DUTY_MODE_NAMES[mode]}
        </Badge>
        <span className="text-[11px] leading-snug text-fg-muted">{DUTY_MODE_HINTS[mode]}</span>
      </div>
    </div>
  );
}
