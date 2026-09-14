/**
 * Значения точки машины по всем показателям - физическим и производным.
 *
 * Компактный снапшот несет только физические показатели (раздел 5.1 `SPEC.md`), а плашкам,
 * заголовкам графиков и сравнительным чартам нужны и производные: загрузка, максимум и
 * разброс тормозов, доля передней оси. Они считаются здесь функциями контрактов, а не
 * своими формулами, поэтому совпадают с тем, что сервер пишет в серии.
 */

import {
  brakeTemperatureMax,
  brakeTemperatureSpread,
  DERIVED_RULES,
  decodeSnapshot,
  frontAxleShare,
  hoursToService,
  type MetricId,
  type MetricSample,
  metricSeverities,
  type PhysicalMetricId,
  type PointContext,
  type PointValues,
  payloadRatio,
  QUALITY,
  type Severity,
  VEHICLE_MODELS,
  VEHICLE_STATUS_CODES,
  type VehicleModel,
  type VehicleModelId,
  type VehicleSnapshot,
} from '@ra/contracts';

/**
 * Модель машины по идентификатору из ответа API. В zod-схеме `modelId` - строка,
 * поэтому принадлежность справочнику проверяется, а не предполагается.
 */
export function resolveModel(modelId: string): VehicleModel | undefined {
  return Object.hasOwn(VEHICLE_MODELS, modelId)
    ? VEHICLE_MODELS[modelId as VehicleModelId]
    : undefined;
}

const BRAKES: PhysicalMetricId[] = [
  'BRAKE_TEMPERATURE_FRONT_LEFT',
  'BRAKE_TEMPERATURE_FRONT_RIGHT',
  'BRAKE_TEMPERATURE_REAR_LEFT',
  'BRAKE_TEMPERATURE_REAR_RIGHT',
];

function sample(value: number | null): MetricSample {
  return value === null
    ? { value: null, quality: QUALITY.NOT_AVAILABLE }
    : { value, quality: QUALITY.GOOD };
}

/** Годное значение показателя точки или null. */
export function goodValue(values: PointValues, metric: MetricId): number | null {
  const item = values[metric];
  if (item === undefined || item.quality !== QUALITY.GOOD || item.value === null) {
    return null;
  }
  return Number.isFinite(item.value) ? item.value : null;
}

/**
 * Все показатели снапшота: физические как пришли, производные - формулами контрактов.
 *
 * Качество STALE у показателей 0,2 Гц означает "между опросами датчика", а значение - это
 * последний опрос (так его трактуют и источник, и детектор событий сервера). В последней
 * точке это действующее показание, поэтому оно считается годным: иначе загрузка и топливо
 * на плашке четыре секунды из пяти показывали бы прочерк и мигали светофором.
 */
export function snapshotValues(snapshot: VehicleSnapshot, model: VehicleModel): PointValues {
  const physical: PointValues = decodeSnapshot(snapshot.v, snapshot.q);
  for (const sampleValue of Object.values(physical)) {
    if (sampleValue.quality === QUALITY.STALE && sampleValue.value !== null) {
      sampleValue.quality = QUALITY.GOOD;
    }
  }
  const brakes = BRAKES.map((metric) => goodValue(physical, metric));
  return {
    ...physical,
    BRAKE_TEMPERATURE_MAX: sample(brakeTemperatureMax(brakes)),
    BRAKE_TEMPERATURE_SPREAD: sample(brakeTemperatureSpread(brakes)),
    PAYLOAD_RATIO: sample(payloadRatio(goodValue(physical, 'CARGO_MASS'), model.ratedPayloadKg)),
    FRONT_AXLE_SHARE: sample(
      frontAxleShare(goodValue(physical, 'FRONT_AXLE_LOAD'), goodValue(physical, 'REAR_AXLE_LOAD')),
    ),
    HOURS_TO_SERVICE: sample(hoursToService(goodValue(physical, 'ENGINE_HOURS'))),
    TIME_SINCE_LAST_DATA: sample(snapshot.age / 60),
    VEHICLE_STATUS: sample(VEHICLE_STATUS_CODES[snapshot.st]),
  };
}

/**
 * Контекст нормативов точки. Длительность стоянки клиенту неизвестна (ее знает только
 * детектор сервера), известен лишь сам факт "машина стоит". Одной секунды стоянки хватает
 * правилу "груз на стоянке не нормируется" и не хватает правилу остывших тормозов - то есть
 * клиент ошибается только в сторону более мягкого норматива тормозов, а не ложной аварии.
 */
export function pointContext(values: PointValues, model: VehicleModel): PointContext {
  const speed = goodValue(values, 'POSITION_SPEED');
  return {
    vehicle: { modelId: model.id },
    stoppedSeconds: speed === null ? null : speed > DERIVED_RULES.movingSpeedKmh ? 0 : 1,
  };
}

/** Светофор перечисленных показателей точки: считается контрактами, своих порогов здесь нет. */
export function severitiesOf(
  values: PointValues,
  model: VehicleModel,
  metrics: readonly MetricId[],
): Partial<Record<MetricId, Severity>> {
  return metricSeverities(values, pointContext(values, model), { metrics: [...metrics] });
}
