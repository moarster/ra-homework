/**
 * Аварии и предупреждения выводятся из нормативов, а не придумываются отдельно.
 *
 * Для каждого показателя из таблицы соответствия берется степень по нормативу контрактов
 * (то же, что `metricSeverity`, но по заранее разобранным правилам - без сборки строкового
 * ключа в горячем цикле), красная зона взводит аварию, желтая - предупреждение.
 *
 * Бортовой контроллер взводит бит с задержкой и снимает с гистерезисом: без этого шум у
 * границы зоны давал бы серию однокадровых событий - детектор сервера открывает событие
 * по биту сразу.
 *
 * Биты, которые не выводятся из наших показателей (AIR_FILTER_CLOGGED, COOLANT_LEVEL_LOW,
 * BRAKE_WEAR, BATTERY_VOLTAGE_LOW, FIRE_ALARM, STEERING_PRESSURE_LOW), не взводятся вообще.
 */

import {
  ALARMS,
  type CompiledThresholds,
  compiledThresholds,
  contextMatches,
  type FlagDef,
  findFlag,
  METRIC_INDEX,
  type PhysicalMetricId,
  type ResolvedThreshold,
  type ThresholdContext,
  VEHICLE_MODEL_IDS,
  type VehicleModelId,
  WARNINGS,
  zoneSeverity,
} from '@ra/contracts';
import { SIM_PARAMS } from './params.js';

interface FlagMapping {
  metric: PhysicalMetricId;
  /** Бит аварии для красной зоны или null. */
  alarm: string | null;
  /** Бит предупреждения для желтой зоны (и для красной, если аварии нет). */
  warning: string | null;
  /** Авария только выше паспортной грузоподъемности: недогруз - не перегруз. */
  alarmAboveRatedPayload?: boolean;
}

const MAPPINGS: FlagMapping[] = [
  { metric: 'ENGINE_COOLANT_TEMPERATURE', alarm: 'COOLANT_OVERHEAT', warning: 'COOLANT_TEMP_HIGH' },
  {
    metric: 'TRANSMISSION_OIL_TEMPERATURE',
    alarm: 'TRANSMISSION_OVERHEAT',
    warning: 'TRANSMISSION_TEMP_HIGH',
  },
  { metric: 'BRAKE_TEMPERATURE_FRONT_LEFT', alarm: 'BRAKE_OVERHEAT', warning: null },
  { metric: 'BRAKE_TEMPERATURE_FRONT_RIGHT', alarm: 'BRAKE_OVERHEAT', warning: null },
  { metric: 'BRAKE_TEMPERATURE_REAR_LEFT', alarm: 'BRAKE_OVERHEAT', warning: null },
  { metric: 'BRAKE_TEMPERATURE_REAR_RIGHT', alarm: 'BRAKE_OVERHEAT', warning: null },
  { metric: 'ENGINE_OIL_PRESSURE', alarm: 'OIL_PRESSURE_CRITICAL', warning: 'OIL_PRESSURE_LOW' },
  { metric: 'FUEL_LEVEL', alarm: 'FUEL_CRITICAL', warning: 'FUEL_LOW' },
  {
    metric: 'CARGO_MASS',
    alarm: 'OVERLOAD',
    warning: 'PAYLOAD_OUT_OF_RANGE',
    alarmAboveRatedPayload: true,
  },
  { metric: 'FRONT_AXLE_LOAD', alarm: null, warning: 'PAYLOAD_OUT_OF_RANGE' },
  { metric: 'POSITION_SPEED', alarm: null, warning: 'OVERSPEED' },
  { metric: 'BODY_ANGLE', alarm: 'BODY_UP_WHILE_MOVING', warning: null },
];

function bitOf(code: string | null, catalog: FlagDef[]): number {
  if (code === null) {
    return -1;
  }
  const flag = findFlag(code, catalog);
  if (flag === undefined) {
    throw new Error(`бит ${code} отсутствует в справочнике`);
  }
  return flag.bit;
}

const MAPPING_COUNT = MAPPINGS.length;
const MAP_METRIC = Int32Array.from(MAPPINGS.map((m) => METRIC_INDEX[m.metric]));
const MAP_ALARM = Int32Array.from(MAPPINGS.map((m) => bitOf(m.alarm, ALARMS)));
const MAP_WARNING = Int32Array.from(MAPPINGS.map((m) => bitOf(m.warning, WARNINGS)));
const MAP_ABOVE_RATED = Uint8Array.from(MAPPINGS.map((m) => (m.alarmAboveRatedPayload ? 1 : 0)));

const RULES: Record<string, CompiledThresholds[]> = {};
for (const modelId of VEHICLE_MODEL_IDS) {
  RULES[modelId] = MAPPINGS.map((m) => compiledThresholds(m.metric, modelId));
}

function pickRule(compiled: CompiledThresholds, ctx: ThresholdContext): ResolvedThreshold | null {
  for (const resolved of compiled.contextual) {
    const context = resolved.rule.context;
    if (context !== undefined && contextMatches(context, ctx)) {
      return resolved;
    }
  }
  return compiled.fallback;
}

const FIELD_BITS = 16;

/** Биты одной машины: сырые по нормативу плюс задержка взведения и гистерезис снятия. */
export class FlagDebouncer {
  alarms = 0;
  warnings = 0;
  private rawAlarms = 0;
  private rawWarnings = 0;
  private readonly rules: CompiledThresholds[];
  private readonly onCount = new Int32Array(FIELD_BITS * 2);
  private readonly offCount = new Int32Array(FIELD_BITS * 2);

  constructor(
    modelId: VehicleModelId,
    private readonly ratedPayloadKg: number,
  ) {
    this.rules = RULES[modelId] ?? [];
  }

  /** Обновить биты по значениям кадра (индексы `METRIC_ORDER`) и контексту нормативов. */
  update(values: Float64Array, ctx: ThresholdContext): void {
    let alarms = 0;
    let warnings = 0;
    for (let i = 0; i < MAPPING_COUNT; i += 1) {
      const compiled = this.rules[i];
      if (compiled === undefined) {
        continue;
      }
      const resolved = pickRule(compiled, ctx);
      if (resolved === null || resolved.excludeFromSeverity) {
        continue;
      }
      const value = values[MAP_METRIC[i] ?? 0] ?? 0;
      const severity = zoneSeverity(resolved.zones, value);
      if (severity === 0) {
        continue;
      }
      const alarmBit = MAP_ALARM[i] ?? -1;
      const warningBit = MAP_WARNING[i] ?? -1;
      const alarmAllowed = (MAP_ABOVE_RATED[i] ?? 0) === 0 || value >= this.ratedPayloadKg;
      if (severity === 2 && alarmBit >= 0 && alarmAllowed) {
        alarms |= 1 << alarmBit;
      } else if (warningBit >= 0) {
        warnings |= 1 << warningBit;
      }
    }
    this.rawAlarms = alarms;
    this.rawWarnings = warnings;
    this.alarms = this.debounce(this.alarms, this.rawAlarms, 0);
    this.warnings = this.debounce(this.warnings, this.rawWarnings, FIELD_BITS);
  }

  private debounce(current: number, raw: number, offset: number): number {
    let next = current;
    for (let bit = 0; bit < FIELD_BITS; bit += 1) {
      const slot = offset + bit;
      if ((raw >>> bit) & 1) {
        this.offCount[slot] = 0;
        const on = (this.onCount[slot] ?? 0) + 1;
        this.onCount[slot] = on;
        if (on >= SIM_PARAMS.flagRaiseSeconds) {
          next |= 1 << bit;
        }
      } else {
        this.onCount[slot] = 0;
        const off = (this.offCount[slot] ?? 0) + 1;
        this.offCount[slot] = off;
        if (off >= SIM_PARAMS.flagClearSeconds) {
          next &= ~(1 << bit);
        }
      }
    }
    return next;
  }
}
