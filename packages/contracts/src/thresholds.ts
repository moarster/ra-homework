/**
 * Нормативы показателей: зоны светофора, относительные и контекстные правила.
 *
 * Модель - раздел 4 `SPEC.md`, числа - разделы 6.1 и 6.2 `CONTEXT.md`.
 *
 * Соглашение по границам зон: `from` включается, `to` не включается. Граничное значение
 * попадает в старшую зону (300 C на тормозах - уже красная зона). Значение, не покрытое
 * ни одной зоной, считается нормой: так у показателей описываются только опасные направления
 * (холодный двигатель или давление выше рабочего аварией не являются).
 */

import { DERIVED_RULES } from './config.js';
import { METRICS, type MetricId, type RelativeBase } from './metrics.js';
import type { Severity } from './severity.js';
import { modelReferenceValue, VEHICLE_MODELS, type VehicleModelId } from './vehicles.js';

export interface ThresholdZone {
  /** Включительно; null - минус бесконечность. */
  from: number | null;
  /** Не включительно; null - плюс бесконечность. */
  to: number | null;
  severity: Severity;
}

export type ThresholdContextRule =
  | { kind: 'rpmAbove'; value: number }
  | { kind: 'rpmBelow'; value: number }
  | { kind: 'engineOff' }
  | { kind: 'stoppedLongerThan'; seconds: number }
  | { kind: 'speedAbove'; value: number }
  | { kind: 'unloaded' };

export interface ThresholdRule {
  metric: MetricId;
  /** Если не задано - правило для всех моделей. */
  vehicleModelId?: VehicleModelId;
  /** Значения зон трактуются как проценты от паспортной величины модели. */
  relative?: RelativeBase;
  /** Условие применимости. Если не задано - правило по умолчанию для показателя. */
  context?: ThresholdContextRule;
  zones: ThresholdZone[];
  /** Показатель не участвует в светофоре при выполнении контекста. */
  excludeFromSeverity?: boolean;
}

/** Точка, в которой разрешается правило: то, что нужно для проверки контекста. */
export interface ThresholdContext {
  /** Обороты двигателя, об/мин. */
  rpm?: number | null;
  /** Скорость, км/ч. */
  speedKmh?: number | null;
  /** Сколько секунд машина стоит (скорость 0). */
  stoppedSeconds?: number | null;
  /** Загрузка в процентах от номинала модели: нужна контексту "груза нет". */
  cargoRatioPercent?: number | null;
}

/** Минимум, который нужен от машины для разрешения норматива. */
export interface ThresholdVehicle {
  modelId: VehicleModelId;
}

/** Порог контекста "машина стоит дольше 10 минут" для тормозов. */
const BRAKE_STOPPED_SECONDS = 600;

/** Порог оборотов, выше которого действуют рабочие зоны давления масла. */
const OIL_PRESSURE_RPM_THRESHOLD = 1000;

/** Скорость, выше которой поднятая платформа - авария. */
const BODY_ANGLE_SPEED_THRESHOLD = 3;

/** Зоны температуры тормозов в движении. */
const BRAKE_ZONES_DEFAULT: ThresholdZone[] = [
  { from: null, to: 200, severity: 0 },
  { from: 200, to: 300, severity: 1 },
  { from: 300, to: null, severity: 2 },
];

/** Зоны температуры тормозов на длительной стоянке: греться остывший тормоз не должен. */
const BRAKE_ZONES_STOPPED: ThresholdZone[] = [
  { from: null, to: 120, severity: 0 },
  { from: 120, to: 200, severity: 1 },
  { from: 200, to: null, severity: 2 },
];

const BRAKE_METRICS: MetricId[] = [
  'BRAKE_TEMPERATURE_FRONT_LEFT',
  'BRAKE_TEMPERATURE_FRONT_RIGHT',
  'BRAKE_TEMPERATURE_REAR_LEFT',
  'BRAKE_TEMPERATURE_REAR_RIGHT',
  'BRAKE_TEMPERATURE_MAX',
];

/** Зоны загрузки в процентах от номинала (политика 10/10/20). */
const PAYLOAD_ZONES: ThresholdZone[] = [
  { from: null, to: 85, severity: 2 },
  { from: 85, to: 95, severity: 1 },
  { from: 95, to: 110, severity: 0 },
  { from: 110, to: 120, severity: 1 },
  { from: 120, to: null, severity: 2 },
];

/** Показатели груза и осей, которые у порожней машины в светофоре не участвуют. */
const UNLOADED_EXCLUDED_METRICS: MetricId[] = [
  'CARGO_MASS',
  'FRONT_AXLE_LOAD',
  'REAR_AXLE_LOAD',
  'PAYLOAD_RATIO',
  'FRONT_AXLE_SHARE',
];

/** Зоны доли передней оси в процентах. */
const FRONT_AXLE_ZONES: ThresholdZone[] = [
  { from: null, to: 27, severity: 2 },
  { from: 27, to: 30, severity: 1 },
  { from: 30, to: 36, severity: 0 },
  { from: 36, to: 40, severity: 1 },
  { from: 40, to: null, severity: 2 },
];

export const THRESHOLD_RULES: ThresholdRule[] = [
  // --- Двигатель -------------------------------------------------------------------------
  {
    metric: 'ENGINE_RPM',
    zones: [
      { from: 600, to: 2100, severity: 0 },
      { from: 2100, to: 2300, severity: 1 },
      { from: 2300, to: null, severity: 2 },
    ],
  },
  {
    metric: 'ENGINE_COOLANT_TEMPERATURE',
    zones: [
      { from: 75, to: 95, severity: 0 },
      { from: 95, to: 105, severity: 1 },
      { from: 105, to: null, severity: 2 },
    ],
  },
  // Заглушенный двигатель: давление масла из светофора исключается.
  {
    metric: 'ENGINE_OIL_PRESSURE',
    context: { kind: 'engineOff' },
    zones: [],
    excludeFromSeverity: true,
  },
  // Холостой ход и прогрев: рабочего давления еще нет.
  {
    metric: 'ENGINE_OIL_PRESSURE',
    context: { kind: 'rpmBelow', value: OIL_PRESSURE_RPM_THRESHOLD },
    zones: [
      { from: null, to: 0.8, severity: 2 },
      { from: 0.8, to: 1.2, severity: 1 },
      { from: 1.2, to: 6.0, severity: 0 },
    ],
  },
  // Правило по умолчанию действует при оборотах выше 1000.
  {
    metric: 'ENGINE_OIL_PRESSURE',
    zones: [
      { from: null, to: 2.0, severity: 2 },
      { from: 2.0, to: 3.0, severity: 1 },
      { from: 3.0, to: 6.0, severity: 0 },
    ],
  },
  {
    metric: 'ENGINE_OIL_TEMPERATURE',
    zones: [
      { from: 80, to: 110, severity: 0 },
      { from: 110, to: 120, severity: 1 },
      { from: 120, to: null, severity: 2 },
    ],
  },
  // --- Трансмиссия и ходовая -------------------------------------------------------------
  {
    metric: 'TRANSMISSION_OIL_TEMPERATURE',
    zones: [
      { from: 70, to: 110, severity: 0 },
      { from: 110, to: 120, severity: 1 },
      { from: 120, to: null, severity: 2 },
    ],
  },
  {
    metric: 'TRANSMISSION_SYSTEM_PRESSURE',
    zones: [
      { from: null, to: 10, severity: 2 },
      { from: 10, to: 12, severity: 1 },
      { from: 12, to: 18, severity: 0 },
    ],
  },
  ...BRAKE_METRICS.flatMap((metric): ThresholdRule[] => [
    {
      metric,
      context: { kind: 'stoppedLongerThan', seconds: BRAKE_STOPPED_SECONDS },
      zones: BRAKE_ZONES_STOPPED,
    },
    { metric, zones: BRAKE_ZONES_DEFAULT },
  ]),
  // --- Топливо ---------------------------------------------------------------------------
  {
    metric: 'FUEL_LEVEL',
    zones: [
      { from: null, to: 10, severity: 2 },
      { from: 10, to: 20, severity: 1 },
      { from: 20, to: null, severity: 0 },
    ],
  },
  // --- Груз и оси ------------------------------------------------------------------------
  /*
   * Нормативы груза и осей заданы в процентах от паспортной массы и имеют смысл только
   * под грузом: у порожней машины масса груза заведомо ниже 85% номинала, а нагрузка на
   * переднюю ось - ниже 30% полной массы. Поэтому у порожней машины эти показатели
   * из светофора исключаются (раздел 6.1 `CONTEXT.md`).
   */
  ...UNLOADED_EXCLUDED_METRICS.flatMap((metric): ThresholdRule[] => [
    { metric, context: { kind: 'unloaded' }, zones: [], excludeFromSeverity: true },
    /*
     * Пока машина стоит, масса груза не нормируется: при погрузке она по определению
     * проходит все зоны от нуля до номинала, и норматив недогруза дал бы событие на каждый
     * рейс. Загрузка проверяется на ходу - так же, как ее проверяет весовая на выезде.
     */
    {
      metric,
      context: { kind: 'stoppedLongerThan', seconds: 0 },
      zones: [],
      excludeFromSeverity: true,
    },
  ]),
  { metric: 'CARGO_MASS', relative: 'ratedPayload', zones: PAYLOAD_ZONES },
  { metric: 'FRONT_AXLE_LOAD', relative: 'grossWeight', zones: FRONT_AXLE_ZONES },
  // Задняя ось считается вместе с передней: у нее описана только зеленая зона,
  // в светофоре показатель не участвует (severityRelevant: false в реестре).
  {
    metric: 'REAR_AXLE_LOAD',
    relative: 'grossWeight',
    zones: [{ from: 64, to: 70, severity: 0 }],
  },
  // Движение с поднятой платформой: обрыв ЛЭП, опрокидывание.
  {
    metric: 'BODY_ANGLE',
    context: { kind: 'speedAbove', value: BODY_ANGLE_SPEED_THRESHOLD },
    zones: [
      { from: null, to: 5, severity: 0 },
      { from: 5, to: null, severity: 2 },
    ],
  },
  // Вне движения угол не нормируется: при разгрузке платформа поднимается до 50 градусов.
  { metric: 'BODY_ANGLE', zones: [{ from: null, to: null, severity: 0 }] },
  // --- Позиционирование ------------------------------------------------------------------
  {
    metric: 'POSITION_SPEED',
    zones: [
      { from: null, to: 30, severity: 0 },
      { from: 30, to: 40, severity: 1 },
      { from: 40, to: null, severity: 2 },
    ],
  },
  // --- Производные -----------------------------------------------------------------------
  {
    metric: 'BRAKE_TEMPERATURE_SPREAD',
    zones: [
      { from: null, to: 80, severity: 0 },
      { from: 80, to: 150, severity: 1 },
      { from: 150, to: null, severity: 2 },
    ],
  },
  { metric: 'PAYLOAD_RATIO', zones: PAYLOAD_ZONES },
  { metric: 'FRONT_AXLE_SHARE', zones: FRONT_AXLE_ZONES },
  {
    metric: 'TIME_SINCE_LAST_DATA',
    zones: [
      { from: null, to: 5, severity: 0 },
      { from: 5, to: 40, severity: 1 },
      { from: 40, to: null, severity: 2 },
    ],
  },
  {
    metric: 'HOURS_TO_SERVICE',
    zones: [
      { from: null, to: 5, severity: 2 },
      { from: 5, to: 20, severity: 1 },
      { from: 20, to: null, severity: 0 },
    ],
  },
];

export interface ResolvedThreshold {
  rule: ThresholdRule;
  /** Зоны в единицах показателя: относительные проценты уже пересчитаны в абсолютные величины. */
  zones: ThresholdZone[];
  /** Показатель исключен из светофора в этом контексте. */
  excludeFromSeverity: boolean;
}

/** Выполняется ли условие применимости правила в данной точке. */
export function contextMatches(rule: ThresholdContextRule, ctx: ThresholdContext): boolean {
  switch (rule.kind) {
    case 'rpmAbove':
      return ctx.rpm !== null && ctx.rpm !== undefined && ctx.rpm > rule.value;
    case 'rpmBelow':
      return ctx.rpm !== null && ctx.rpm !== undefined && ctx.rpm < rule.value;
    case 'engineOff':
      return ctx.rpm !== null && ctx.rpm !== undefined && ctx.rpm === 0;
    case 'stoppedLongerThan':
      return (
        ctx.stoppedSeconds !== null &&
        ctx.stoppedSeconds !== undefined &&
        ctx.stoppedSeconds > rule.seconds
      );
    case 'speedAbove':
      return ctx.speedKmh !== null && ctx.speedKmh !== undefined && ctx.speedKmh > rule.value;
    case 'unloaded':
      return (
        ctx.cargoRatioPercent !== null &&
        ctx.cargoRatioPercent !== undefined &&
        ctx.cargoRatioPercent < DERIVED_RULES.loadedPayloadRatioPercent
      );
  }
}

function absoluteZones(rule: ThresholdRule, vehicle: ThresholdVehicle): ThresholdZone[] {
  const relative = rule.relative;
  if (relative === undefined) {
    return rule.zones;
  }
  const reference = modelReferenceValue(VEHICLE_MODELS[vehicle.modelId], relative);
  return rule.zones.map((zone) => ({
    from: zone.from === null ? null : (zone.from * reference) / 100,
    to: zone.to === null ? null : (zone.to * reference) / 100,
    severity: zone.severity,
  }));
}

/**
 * Разобранные правила показателя для конкретной модели: контекстные в порядке объявления
 * и правило по умолчанию. Кэшируются, потому что `resolveThreshold` вызывается в горячем
 * пути сервера (60 машин x 30 показателей x 60 шагов в секунду) и не имеет права
 * ни фильтровать массивы, ни создавать объекты.
 */
export interface CompiledThresholds {
  contextual: ResolvedThreshold[];
  fallback: ResolvedThreshold | null;
}

const compiledCache = new Map<string, CompiledThresholds>();

function compile(metric: MetricId, modelId: VehicleModelId): CompiledThresholds {
  const candidates = THRESHOLD_RULES.filter(
    (rule) =>
      rule.metric === metric &&
      (rule.vehicleModelId === undefined || rule.vehicleModelId === modelId),
  );
  // Правила конкретной модели важнее общих.
  const modelSpecific = candidates.filter((rule) => rule.vehicleModelId !== undefined);
  const pool = modelSpecific.length > 0 ? modelSpecific : candidates;
  const vehicle: ThresholdVehicle = { modelId };
  const toResolved = (rule: ThresholdRule): ResolvedThreshold => ({
    rule,
    zones: absoluteZones(rule, vehicle),
    excludeFromSeverity: rule.excludeFromSeverity === true,
  });
  const fallbackRule = pool.find((rule) => rule.context === undefined);
  return {
    contextual: pool.filter((rule) => rule.context !== undefined).map(toResolved),
    fallback: fallbackRule === undefined ? null : toResolved(fallbackRule),
  };
}

function compiled(metric: MetricId, modelId: VehicleModelId): CompiledThresholds {
  const key = `${metric}|${modelId}`;
  const cached = compiledCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const built = compile(metric, modelId);
  compiledCache.set(key, built);
  return built;
}

/**
 * Разобранные правила показателя для модели. Сервер забирает их один раз при старте и
 * дальше разрешает норматив без обращения к кэшу и без сборки строкового ключа.
 */
export function compiledThresholds(metric: MetricId, modelId: VehicleModelId): CompiledThresholds {
  return compiled(metric, modelId);
}

/**
 * Применимое правило для показателя: среди правил показателя и модели выбирается первое,
 * чей контекст выполняется; если ни одно не подошло - правило без контекста.
 * Если правил нет вовсе, возвращается null (показатель нормативов не имеет).
 *
 * Возвращается закэшированный объект: его нельзя мутировать.
 */
export function resolveThreshold(
  metric: MetricId,
  vehicle: ThresholdVehicle,
  ctx: ThresholdContext = {},
): ResolvedThreshold | null {
  const rules = compiled(metric, vehicle.modelId);
  for (const resolved of rules.contextual) {
    const context = resolved.rule.context;
    if (context !== undefined && contextMatches(context, ctx)) {
      return resolved;
    }
  }
  return rules.fallback;
}

/** Степень отклонения значения по набору зон. Значение вне всех зон - норма. */
export function zoneSeverity(zones: ThresholdZone[], value: number): Severity {
  for (const zone of zones) {
    const aboveFrom = zone.from === null || value >= zone.from;
    const belowTo = zone.to === null || value < zone.to;
    if (aboveFrom && belowTo) {
      return zone.severity;
    }
  }
  return 0;
}

/** Степень отклонения значения показателя с учетом контекста и модели машины. */
export function metricSeverity(
  metric: MetricId,
  value: number | null | undefined,
  vehicle: ThresholdVehicle,
  ctx: ThresholdContext = {},
): Severity {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 3;
  }
  const resolved = resolveThreshold(metric, vehicle, ctx);
  if (resolved === null || resolved.excludeFromSeverity) {
    return 0;
  }
  return zoneSeverity(resolved.zones, value);
}

/** Есть ли у показателя нормативы вообще (нужно интерфейсу для фоновых зон на графиках). */
export function hasThresholds(metric: MetricId): boolean {
  return THRESHOLD_RULES.some((rule) => rule.metric === metric && rule.zones.length > 0);
}

/** Показатели, у которых нормативы заданы относительно паспортной величины модели. */
export const RELATIVE_METRICS: MetricId[] = Array.from(
  new Set(THRESHOLD_RULES.filter((rule) => rule.relative !== undefined).map((rule) => rule.metric)),
).filter((metric) => METRICS[metric].relativeTo !== undefined);
