/**
 * Контракты API: zod-схемы запросов и ответов REST (раздел 7 `SPEC.md`),
 * websocket-сообщений (раздел 8) и компактного снапшота (раздел 5.1).
 * Типы выводятся из схем через `z.infer`, отдельных ручных типов для полезной нагрузки нет.
 */

import { z } from 'zod';
import { type ChaosLevel, QUERY_LIMITS } from './config.js';
import type { PhysicalMetricId } from './metrics.js';
import { METRIC_IDS, METRIC_ORDER, type MetricId } from './metrics.js';
import { type MetricSample, QUALITY, type Quality } from './severity.js';

/* ------------------------------------------------------------------ примитивы */

export const metricIdSchema = z.enum(METRIC_IDS as [MetricId, ...MetricId[]]);

export const physicalMetricIdSchema = z.enum(
  METRIC_ORDER as [PhysicalMetricId, ...PhysicalMetricId[]],
);

export const severitySchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const qualitySchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

export const vehicleStatusSchema = z.enum([
  'HAULING',
  'RETURNING',
  'LOADING',
  'UNLOADING',
  'IDLING',
  'PARKED',
  'NO_DATA',
]);

export const chaosLevelSchema = z.enum(['NORMAL', 'MESSY', 'UGLY', 'CHAOS']);

export const periodIdSchema = z.enum(['5m', '15m', '1h', '3h', '6h', '12h', '24h']);

export const chartIdSchema = z.enum([
  'BRAKE_SYMMETRY',
  'LOAD_BALANCE',
  'THERMAL_STATE',
  'DUTY_MODE',
]);

/** Unix seconds виртуального времени симуляции. */
export const timestampSchema = z.number().int();

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

/* ------------------------------------------------------------------ справочники */

export const unitGroupDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUnitId: z.string(),
});

export const unitDefSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  symbol: z.string(),
  name: z.string(),
  factor: z.number(),
  offset: z.number(),
  precision: z.number().int(),
});

export const metricGroupDefSchema = z.object({
  id: z.enum(['ENGINE', 'DRIVELINE', 'FUEL', 'LOAD', 'POSITION', 'DERIVED']),
  name: z.string(),
  order: z.number().int(),
  icon: z.string(),
});

export const metricDefSchema = z.object({
  id: metricIdSchema,
  groupId: metricGroupDefSchema.shape.id,
  name: z.string(),
  shortName: z.string(),
  unitId: z.string(),
  displayUnitId: z.string(),
  precision: z.number().int(),
  kind: z.enum(['instant', 'counter', 'state', 'coordinate', 'derived']),
  worseDirection: z.enum(['up', 'down', 'both', 'none']),
  severityRelevant: z.boolean(),
  sampleRateHz: z.union([z.literal(1), z.literal(0.2)]),
  aggregation: z.enum(['avg', 'last', 'max', 'sum']),
  relativeTo: z.enum(['ratedPayload', 'grossWeight']).optional(),
  derivedFrom: z.array(metricIdSchema).optional(),
  card: z.number().int().optional(),
  icon: z.string(),
  registerAddress: z.number().int().optional(),
});

export const thresholdZoneSchema = z.object({
  from: z.number().nullable(),
  to: z.number().nullable(),
  severity: severitySchema,
});

export const thresholdRuleSchema = z.object({
  metric: metricIdSchema,
  vehicleModelId: z.string().optional(),
  relative: z.enum(['ratedPayload', 'grossWeight']).optional(),
  context: z
    .union([
      z.object({ kind: z.literal('rpmAbove'), value: z.number() }),
      z.object({ kind: z.literal('rpmBelow'), value: z.number() }),
      z.object({ kind: z.literal('engineOff') }),
      z.object({ kind: z.literal('stoppedLongerThan'), seconds: z.number() }),
      z.object({ kind: z.literal('speedAbove'), value: z.number() }),
      z.object({ kind: z.literal('unloaded') }),
    ])
    .optional(),
  zones: z.array(thresholdZoneSchema),
  excludeFromSeverity: z.boolean().optional(),
});

export const flagDefSchema = z.object({
  bit: z.number().int(),
  code: z.string(),
  name: z.string(),
  severity: severitySchema,
});

export const vehicleModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  manufacturer: z.string(),
  ratedPayloadKg: z.number(),
  curbWeightKg: z.number(),
  grossWeightKg: z.number(),
  engineName: z.string(),
  enginePowerKw: z.number(),
  transmission: z.enum(['HYDROMECHANICAL', 'ELECTROMECHANICAL']),
  fuelTankLiters: z.number(),
  maxSpeedKmh: z.number(),
});

export const vehicleSchema = z.object({
  id: z.string(),
  sideNumber: z.string(),
  plate: z.string(),
  modelId: z.string(),
  year: z.number().int(),
  engineHoursAtStart: z.number(),
  driver: z.object({ fullName: z.string(), phone: z.string() }),
  defaultRouteId: z.enum(['PIT_TO_CRUSHER', 'PIT_TO_DUMP', 'UPPER_BENCH']),
});

export const routePointSchema = z.tuple([z.number(), z.number(), z.number()]);

export const pitRouteSchema = z.object({
  id: z.enum(['PIT_TO_CRUSHER', 'PIT_TO_DUMP', 'UPPER_BENCH']),
  name: z.string(),
  points: z.array(routePointSchema),
  cumulativeMeters: z.array(z.number()),
  lengthMeters: z.number(),
  elevationGainMeters: z.number(),
});

export const pitZoneSchema = z.object({
  id: z.string(),
  kind: z.enum(['LOADING', 'UNLOADING_CRUSHER', 'UNLOADING_DUMP', 'PARKING', 'FUEL_STATION']),
  name: z.string(),
  center: z.tuple([z.number(), z.number()]),
  radiusMeters: z.number(),
  dwellSeconds: z.tuple([z.number(), z.number()]),
});

/** Ответ `GET /api/dictionaries`: все справочники одним ответом. */
export const dictionariesResponseSchema = z.object({
  metricOrder: z.array(physicalMetricIdSchema),
  metrics: z.array(metricDefSchema),
  metricGroups: z.array(metricGroupDefSchema),
  units: z.array(unitDefSchema),
  unitGroups: z.array(unitGroupDefSchema),
  thresholds: z.array(thresholdRuleSchema),
  flags: z.object({
    ALARMS: z.array(flagDefSchema),
    WARNINGS: z.array(flagDefSchema),
    SYSTEM_STATE: z.array(flagDefSchema),
  }),
  vehicleModels: z.array(vehicleModelSchema),
  routes: z.array(pitRouteSchema),
  zones: z.array(pitZoneSchema),
});

export const vehiclesResponseSchema = z.object({
  vehicles: z.array(vehicleSchema),
});

/* ------------------------------------------------------------------ конфигурация */

export const appConfigSchema = z.object({
  timezone: z.string(),
  pit: z.object({
    center: z.tuple([z.number(), z.number()]),
    bounds: z.tuple([z.tuple([z.number(), z.number()]), z.tuple([z.number(), z.number()])]),
    minZoom: z.number(),
    maxZoom: z.number(),
    defaultZoom: z.number(),
  }),
  periods: z.array(z.object({ id: periodIdSchema, label: z.string(), seconds: z.number().int() })),
  defaultPeriodId: periodIdSchema,
  cardMetrics: z.array(metricIdSchema),
  comparativeCharts: z.array(chartIdSchema),
  track: z.object({
    defaultTailSeconds: z.number().int(),
    maxTailSeconds: z.number().int(),
    pointStepSeconds: z.number().int(),
  }),
  noDataAlarmMinutes: z.number().int(),
  simulation: z.object({
    maxVehicles: z.number().int(),
    timeScales: z.array(z.number()),
    chaosLevels: z.array(chaosLevelSchema),
  }),
});

/* ------------------------------------------------------------------ телеметрия */

/** Компактный снапшот машины: общий для REST latest и websocket. */
export const vehicleSnapshotSchema = z.object({
  id: z.string(),
  t: timestampSchema,
  /** Значения в порядке METRIC_ORDER, null - нет данных. */
  v: z.array(z.number().nullable()),
  /** Качество значений в том же порядке. */
  q: z.array(qualitySchema),
  /** Битовые поля: [аварии, предупреждения, состояния]. */
  f: z.tuple([z.number().int(), z.number().int(), z.number().int()]),
  st: vehicleStatusSchema,
  sev: severitySchema,
  /** Секунд с последней точки с качеством GOOD. */
  age: z.number(),
});

export const latestResponseSchema = z.object({
  t: timestampSchema,
  snapshots: z.array(vehicleSnapshotSchema),
});

export const seriesSchema = z.object({
  vehicleId: z.string(),
  metric: metricIdSchema,
  unit: z.string(),
  t0: timestampSchema,
  avg: z.array(z.number().nullable()),
  min: z.array(z.number().nullable()),
  max: z.array(z.number().nullable()),
  sev: z.array(severitySchema),
  /** Число исходных точек GOOD в бакете; 0 - дыра, линия рвется. */
  count: z.array(z.number().int()),
});

export const seriesResponseSchema = z.object({
  from: timestampSchema,
  to: timestampSchema,
  step: z.number().int(),
  tier: z.enum(['raw', 's10', 'm1']),
  series: z.array(seriesSchema),
});

export const trackPointSchema = z.tuple([
  timestampSchema,
  z.number(),
  z.number(),
  z.number(),
  severitySchema,
]);

export const trackResponseSchema = z.object({
  tracks: z.array(
    z.object({
      vehicleId: z.string(),
      points: z.array(trackPointSchema),
      /** Интервалы отсутствия данных: [from, to]. */
      gaps: z.array(z.tuple([timestampSchema, timestampSchema])),
      /** Точки срабатывания битов: флажки на треке. */
      marks: z.array(
        z.object({
          t: timestampSchema,
          lat: z.number(),
          lon: z.number(),
          code: z.string(),
          severity: severitySchema,
        }),
      ),
    }),
  ),
});

export const telemetryEventSchema = z.object({
  id: z.string(),
  vehicleId: z.string(),
  source: z.enum(['alarmBit', 'warningBit', 'threshold', 'server']),
  code: z.string(),
  metric: metricIdSchema.optional(),
  severity: z.union([z.literal(1), z.literal(2)]),
  title: z.string(),
  startedAt: timestampSchema,
  endedAt: timestampSchema.nullable(),
  peakValue: z.number().optional(),
  peakAt: timestampSchema.optional(),
});

export const eventsResponseSchema = z.object({
  events: z.array(telemetryEventSchema),
});

/** Сводка по машине за период (раздел 9.3 `CONTEXT.md`). */
export const vehicleSummaryResponseSchema = z.object({
  vehicleId: z.string(),
  from: timestampSchema,
  to: timestampSchema,
  /** Есть ли за период хоть одна точка с качеством GOOD. */
  hasData: z.boolean(),
  /** Время последней точки с качеством GOOD, null - данных не было никогда. */
  lastGoodAt: timestampSchema.nullable(),
  trips: z.number().int(),
  tonnes: z.number(),
  avgPayloadPercent: z.number().nullable(),
  engineHours: z.number(),
  idlePercent: z.number().nullable(),
  fuelLiters: z.number(),
  fuelPerHour: z.number().nullable(),
  fuelPerTonne: z.number().nullable(),
  distanceKm: z.number(),
  avgSpeedKmh: z.number().nullable(),
  maxSpeedKmh: z.number().nullable(),
  noDataMinutes: z.number(),
  noDataGaps: z.number().int(),
  /** КТГ за период: доля времени без активных аварий, проценты. */
  availabilityPercent: z.number().nullable(),
  /** Аварии и предупреждения по типам. */
  eventStats: z.array(
    z.object({
      code: z.string(),
      title: z.string(),
      severity: z.union([z.literal(1), z.literal(2)]),
      count: z.number().int(),
      totalSeconds: z.number(),
      metric: metricIdSchema.optional(),
      firstAt: timestampSchema,
    }),
  ),
});

/* ------------------------------------------------------------------ симуляция */

export const simStateSchema = z.object({
  simTime: timestampSchema,
  historyFrom: timestampSchema,
  timeScale: z.number(),
  vehicleCount: z.number().int(),
  chaos: chaosLevelSchema,
  seed: z.number().int(),
  running: z.boolean(),
});

/** POST /api/sim принимает любое подмножество полей. */
export const simPatchSchema = z
  .object({
    timeScale: z.number(),
    vehicleCount: z.number().int(),
    chaos: chaosLevelSchema,
    running: z.boolean(),
  })
  .partial();

/* ------------------------------------------------------------------ параметры запросов */

/** Список идентификаторов через запятую: `vehicleIds=v-12,v-07`. */
const csvStrings = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0),
);

const csvMetrics = csvStrings.pipe(z.array(metricIdSchema));

export const seriesQuerySchema = z.object({
  vehicleIds: csvStrings.optional(),
  metrics: csvMetrics.optional(),
  from: z.coerce.number().int(),
  to: z.coerce.number().int(),
  maxPoints: z.coerce
    .number()
    .int()
    .min(1)
    .max(QUERY_LIMITS.maxMaxPoints)
    .default(QUERY_LIMITS.defaultMaxPoints),
});

export const trackQuerySchema = z.object({
  vehicleIds: csvStrings.optional(),
  from: z.coerce.number().int(),
  to: z.coerce.number().int(),
  maxPoints: z.coerce
    .number()
    .int()
    .min(1)
    .max(QUERY_LIMITS.maxMaxPoints)
    .default(QUERY_LIMITS.defaultTrackMaxPoints),
  /** Светофор трека только по этим показателям. */
  severityMetrics: csvMetrics.optional(),
});

export const eventsQuerySchema = z.object({
  vehicleIds: csvStrings.optional(),
  from: z.coerce.number().int(),
  to: z.coerce.number().int(),
  severity: z.coerce.number().int().min(1).max(2).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(QUERY_LIMITS.maxEventLimit)
    .default(QUERY_LIMITS.defaultEventLimit),
});

export const summaryQuerySchema = z.object({
  from: z.coerce.number().int(),
  to: z.coerce.number().int(),
});

/* ------------------------------------------------------------------ websocket */

export const wsHelloSchema = z.object({
  type: z.literal('hello'),
  sim: simStateSchema,
  config: z.object({ metricOrder: z.array(physicalMetricIdSchema) }),
  snapshot: z.array(vehicleSnapshotSchema),
});

export const wsTickSchema = z.object({
  type: z.literal('tick'),
  t: timestampSchema,
  vehicles: z.array(
    z.object({
      id: z.string(),
      snapshot: vehicleSnapshotSchema,
      /** Все точки позиции с прошлого тика: [t, lat, lon, heading, sev]. */
      pos: z.array(trackPointSchema),
    }),
  ),
});

export const wsEventsSchema = z.object({
  type: z.literal('events'),
  opened: z.array(telemetryEventSchema),
  closed: z.array(telemetryEventSchema),
});

/** Состояние симуляции изменилось. Идет по каналу управления `/ws/sim`, а не по потоку данных. */
export const wsSimSchema = z.object({
  type: z.literal('sim'),
  sim: simStateSchema,
  /**
   * Идентификатор вкладки, которая изменила параметры (заголовок `x-viewer-id` у
   * `POST /api/sim`). Нет поля - изменение сделал сам сервер, например закончил предысторию.
   */
  changedBy: z.string().optional(),
});

/** Сколько вкладок сейчас держат канал управления: симуляция одна на всех. */
export const wsViewersSchema = z.object({
  type: z.literal('viewers'),
  count: z.number().int().min(0),
});

export const wsBackfillSchema = z.object({
  type: z.literal('backfill'),
  vehicleId: z.string(),
  from: timestampSchema,
  to: timestampSchema,
});

export const wsPongSchema = z.object({
  type: z.literal('pong'),
  t: timestampSchema,
});

/** Поток данных `/ws`: работает, пока включен real-time. */
export const wsServerMessageSchema = z.discriminatedUnion('type', [
  wsHelloSchema,
  wsTickSchema,
  wsEventsSchema,
  wsBackfillSchema,
  wsPongSchema,
]);

/** Канал управления `/ws/sim`: открыт всегда, независимо от тумблера real-time. */
export const wsControlMessageSchema = z.discriminatedUnion('type', [
  wsSimSchema,
  wsViewersSchema,
  wsPongSchema,
]);

export const wsPingSchema = z.object({ type: z.literal('ping') });

export const wsClientMessageSchema = z.discriminatedUnion('type', [wsPingSchema]);

/* ------------------------------------------------------------------ выводимые типы */

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type DictionariesResponse = z.infer<typeof dictionariesResponseSchema>;
export type VehiclesResponse = z.infer<typeof vehiclesResponseSchema>;
export type AppConfigResponse = z.infer<typeof appConfigSchema>;
export type VehicleSnapshot = z.infer<typeof vehicleSnapshotSchema>;
export type LatestResponse = z.infer<typeof latestResponseSchema>;
export type Series = z.infer<typeof seriesSchema>;
export type SeriesResponse = z.infer<typeof seriesResponseSchema>;
export type TrackPoint = z.infer<typeof trackPointSchema>;
export type TrackResponse = z.infer<typeof trackResponseSchema>;
export type EventsResponse = z.infer<typeof eventsResponseSchema>;
export type VehicleSummaryResponse = z.infer<typeof vehicleSummaryResponseSchema>;
export type SimState = z.infer<typeof simStateSchema>;
export type SimPatch = z.infer<typeof simPatchSchema>;
export type SeriesQuery = z.infer<typeof seriesQuerySchema>;
export type TrackQuery = z.infer<typeof trackQuerySchema>;
export type EventsQuery = z.infer<typeof eventsQuerySchema>;
export type SummaryQuery = z.infer<typeof summaryQuerySchema>;
export type WsServerMessage = z.infer<typeof wsServerMessageSchema>;
export type WsControlMessage = z.infer<typeof wsControlMessageSchema>;
export type WsClientMessage = z.infer<typeof wsClientMessageSchema>;

/** Уровень хранилища, из которого собран ответ серий. */
export type StoreTier = SeriesResponse['tier'];

/** Мера хаоса в состоянии симуляции. */
export type SimChaosLevel = ChaosLevel;

/* ------------------------------------------------------------------ компактный снапшот */

export interface EncodedSnapshotValues {
  v: (number | null)[];
  q: Quality[];
}

/**
 * Запись по показателям -> массивы в порядке `METRIC_ORDER`.
 * Отсутствующий показатель кодируется значением null и качеством NOT_AVAILABLE.
 */
export function encodeSnapshot(
  values: Partial<Record<PhysicalMetricId, MetricSample>>,
): EncodedSnapshotValues {
  const v: (number | null)[] = new Array(METRIC_ORDER.length);
  const q: Quality[] = new Array(METRIC_ORDER.length);
  for (let i = 0; i < METRIC_ORDER.length; i += 1) {
    const metric = METRIC_ORDER[i];
    const sample = metric === undefined ? undefined : values[metric];
    v[i] = sample?.value ?? null;
    q[i] = sample?.quality ?? QUALITY.NOT_AVAILABLE;
  }
  return { v, q };
}

/** Массивы в порядке `METRIC_ORDER` -> запись по показателям. */
export function decodeSnapshot(
  v: (number | null)[],
  q: (Quality | number)[],
): Record<PhysicalMetricId, MetricSample> {
  const result = {} as Record<PhysicalMetricId, MetricSample>;
  for (let i = 0; i < METRIC_ORDER.length; i += 1) {
    const metric = METRIC_ORDER[i];
    if (metric === undefined) {
      continue;
    }
    const quality = q[i];
    result[metric] = {
      value: v[i] ?? null,
      quality: (quality ?? QUALITY.NOT_AVAILABLE) as Quality,
    };
  }
  return result;
}
