/**
 * Заглушечный источник телеметрии (этап 1).
 *
 * Задача заглушки - дать картинку, на которой можно разрабатывать интерфейс: машины едут
 * по маршрутам карьера, выполняют цикл "погрузка - движение - разгрузка - возврат",
 * показатели двигаются по простым правилам от режима работы. Физики здесь нет: сопротивление
 * движению, тяговый баланс и теплообмен появятся в симуляторе этапа 5, который заменит этот
 * файл целиком через интерфейс `TelemetrySource`.
 *
 * Гарантии, которые заглушка обязана держать наравне с симулятором:
 * детерминизм по seed, отсутствие аллокаций в `step`, предыстория при старте и при
 * добавлении машин.
 */

import {
  ALARMS,
  type ChaosLevel,
  findFlag,
  GNSS_NOISE_METERS,
  generateFleet,
  METRIC_INDEX,
  METRIC_ORDER,
  type PhysicalMetricId,
  PIT_METERS_PER_DEGREE_LATITUDE,
  PIT_METERS_PER_DEGREE_LONGITUDE,
  PIT_ROUTES,
  PIT_ZONE_KINDS,
  type PitRoute,
  type PitZoneKind,
  QUALITY,
  type Quality,
  ROUTE_CORRIDOR_HALF_WIDTH_METERS,
  resolveThreshold,
  routeGradeAt,
  routeHeadingAt,
  routePositionAt,
  type Severity,
  SYSTEM_STATE,
  type ThresholdZone,
  VEHICLE_MODELS,
  type Vehicle,
  type VehicleModel,
  WARNINGS,
  ZONE_CORRIDOR_HALF_WIDTH_METERS,
} from '@ra/contracts';
import { approach, clamp, mulberry32, noise, range } from './random.js';
import type {
  BackfillBatch,
  SnapshotWriter,
  SourceInitOptions,
  TelemetrySource,
} from './source.js';
import { CHAOS_PARAMS, SHIFT_SECONDS, STUB_PARAMS } from './stub-params.js';

const METRIC_COUNT = METRIC_ORDER.length;

const IDX = {
  rpm: METRIC_INDEX.ENGINE_RPM,
  coolant: METRIC_INDEX.ENGINE_COOLANT_TEMPERATURE,
  oilPressure: METRIC_INDEX.ENGINE_OIL_PRESSURE,
  oilTemp: METRIC_INDEX.ENGINE_OIL_TEMPERATURE,
  engineHours: METRIC_INDEX.ENGINE_HOURS,
  gear: METRIC_INDEX.TRANSMISSION_GEAR,
  transOil: METRIC_INDEX.TRANSMISSION_OIL_TEMPERATURE,
  transPressure: METRIC_INDEX.TRANSMISSION_SYSTEM_PRESSURE,
  brakeFl: METRIC_INDEX.BRAKE_TEMPERATURE_FRONT_LEFT,
  brakeFr: METRIC_INDEX.BRAKE_TEMPERATURE_FRONT_RIGHT,
  brakeRl: METRIC_INDEX.BRAKE_TEMPERATURE_REAR_LEFT,
  brakeRr: METRIC_INDEX.BRAKE_TEMPERATURE_REAR_RIGHT,
  fuelLevel: METRIC_INDEX.FUEL_LEVEL,
  fuelInstant: METRIC_INDEX.FUEL_INSTANT_CONSUMPTION,
  fuelTotal: METRIC_INDEX.FUEL_TOTAL_CONSUMPTION,
  cargo: METRIC_INDEX.CARGO_MASS,
  frontAxle: METRIC_INDEX.FRONT_AXLE_LOAD,
  rearAxle: METRIC_INDEX.REAR_AXLE_LOAD,
  bodyAngle: METRIC_INDEX.BODY_ANGLE,
  speed: METRIC_INDEX.POSITION_SPEED,
  heading: METRIC_INDEX.POSITION_HEADING,
  latitude: METRIC_INDEX.POSITION_LATITUDE,
  longitude: METRIC_INDEX.POSITION_LONGITUDE,
} as const;

/** Показатели с частотой 0,2 Гц: обновляются раз в 5 секунд, между обновлениями - STALE. */
const SLOW_METRICS: number[] = [
  IDX.fuelLevel,
  IDX.fuelInstant,
  IDX.fuelTotal,
  IDX.cargo,
  IDX.frontAxle,
  IDX.rearAxle,
  IDX.bodyAngle,
];

const SLOW_FLAGS = new Uint8Array(METRIC_COUNT);
for (const index of SLOW_METRICS) {
  SLOW_FLAGS[index] = 1;
}

/**
 * Уклон и курс постоянны внутри сегмента маршрута и не меняются за время работы, поэтому
 * считаются один раз на все сегменты всех маршрутов. Иначе на каждую машино-секунду
 * приходилось бы три двоичных поиска и тригонометрия гаверсинуса.
 */
interface RouteGeometry {
  grade: Float64Array;
  heading: Float64Array;
}

const ROUTE_GEOMETRY = new Map<string, RouteGeometry>();
for (const route of Object.values(PIT_ROUTES)) {
  const segments = Math.max(1, route.points.length - 1);
  const grade = new Float64Array(segments);
  const heading = new Float64Array(segments);
  for (let i = 0; i < segments; i += 1) {
    // Точка чуть правее начала сегмента: попадает гарантированно в него.
    const at = (route.cumulativeMeters[i] ?? 0) + 0.1;
    grade[i] = routeGradeAt(route, at);
    heading[i] = routeHeadingAt(route, at);
  }
  ROUTE_GEOMETRY.set(route.id, { grade, heading });
}

type Phase = 'LOADING' | 'HAULING' | 'UNLOADING' | 'RETURNING' | 'IDLING' | 'PARKED';

/** Когда сценарий отклонения имеет смысл. */
type ScenarioWhen = 'loaded' | 'moving' | 'stopped' | 'any';

interface ScenarioDef {
  id: string;
  /** Показатели, которые уводятся в нужную зону. */
  metrics: PhysicalMetricId[];
  /** Взять один случайный показатель из списка (подклинивший тормоз - одно колесо). */
  pickOne: boolean;
  severity: 1 | 2;
  field: 'ALARMS' | 'WARNINGS';
  /** Код бита, который взводится на плато отклонения. */
  code: string;
  when: ScenarioWhen;
}

const BRAKE_METRICS: PhysicalMetricId[] = [
  'BRAKE_TEMPERATURE_FRONT_LEFT',
  'BRAKE_TEMPERATURE_FRONT_RIGHT',
  'BRAKE_TEMPERATURE_REAR_LEFT',
  'BRAKE_TEMPERATURE_REAR_RIGHT',
];

/**
 * Сценарии отклонений: подмножество каталога раздела 10 `CONTEXT.md`, помеченное как
 * обязательное или "по возможности". Целевое значение не задается числом: оно берется
 * из нормативов показателя, поэтому сценарий остается корректным при правке порогов.
 */
const SCENARIOS: ScenarioDef[] = [
  {
    id: 'S1-warn',
    metrics: ['TRANSMISSION_OIL_TEMPERATURE'],
    pickOne: false,
    severity: 1,
    field: 'WARNINGS',
    code: 'TRANSMISSION_TEMP_HIGH',
    when: 'loaded',
  },
  {
    id: 'S1-alarm',
    metrics: ['TRANSMISSION_OIL_TEMPERATURE'],
    pickOne: false,
    severity: 2,
    field: 'ALARMS',
    code: 'TRANSMISSION_OVERHEAT',
    when: 'loaded',
  },
  {
    id: 'S2',
    metrics: BRAKE_METRICS,
    pickOne: false,
    severity: 2,
    field: 'ALARMS',
    code: 'BRAKE_OVERHEAT',
    when: 'moving',
  },
  {
    id: 'S3',
    metrics: BRAKE_METRICS,
    pickOne: true,
    severity: 1,
    field: 'WARNINGS',
    code: 'BRAKE_WEAR',
    when: 'any',
  },
  {
    id: 'S4-alarm',
    metrics: ['ENGINE_OIL_PRESSURE'],
    pickOne: false,
    severity: 2,
    field: 'ALARMS',
    code: 'OIL_PRESSURE_CRITICAL',
    when: 'moving',
  },
  {
    id: 'S4-warn',
    metrics: ['ENGINE_OIL_PRESSURE'],
    pickOne: false,
    severity: 1,
    field: 'WARNINGS',
    code: 'OIL_PRESSURE_LOW',
    when: 'moving',
  },
  {
    id: 'S5-warn',
    metrics: ['ENGINE_COOLANT_TEMPERATURE'],
    pickOne: false,
    severity: 1,
    field: 'WARNINGS',
    code: 'COOLANT_TEMP_HIGH',
    when: 'loaded',
  },
  {
    id: 'S5-alarm',
    metrics: ['ENGINE_COOLANT_TEMPERATURE'],
    pickOne: false,
    severity: 2,
    field: 'ALARMS',
    code: 'COOLANT_OVERHEAT',
    when: 'loaded',
  },
  {
    id: 'S6',
    metrics: ['CARGO_MASS'],
    pickOne: false,
    severity: 2,
    field: 'ALARMS',
    code: 'OVERLOAD',
    when: 'loaded',
  },
  {
    id: 'S7',
    metrics: ['FRONT_AXLE_LOAD'],
    pickOne: false,
    severity: 1,
    field: 'WARNINGS',
    code: 'PAYLOAD_OUT_OF_RANGE',
    when: 'loaded',
  },
  {
    id: 'S9',
    metrics: ['POSITION_SPEED'],
    pickOne: false,
    severity: 1,
    field: 'WARNINGS',
    code: 'OVERSPEED',
    when: 'moving',
  },
];

/** Контекст, в котором берутся нормативы для целевого значения отклонения. */
const ANOMALY_CONTEXT = {
  rpm: 1500,
  speedKmh: 20,
  stoppedSeconds: 0,
  cargoRatioPercent: 100,
};

/**
 * Значение внутри зоны заданной степени: середина конечной зоны, либо небольшой отступ
 * за открытую границу. Так сценарий "уходит в желтую зону" не зависит от конкретных чисел.
 */
function valueInZone(zones: ThresholdZone[], severity: Severity): number | null {
  for (const zone of zones) {
    if (zone.severity !== severity) {
      continue;
    }
    if (zone.from !== null && zone.to !== null) {
      return zone.from + (zone.to - zone.from) * 0.6;
    }
    if (zone.from !== null) {
      return zone.from + Math.max(1, Math.abs(zone.from) * 0.04);
    }
    if (zone.to !== null) {
      return zone.to - Math.max(0.3, Math.abs(zone.to) * 0.15);
    }
  }
  return null;
}

interface StubVehicleState {
  vehicle: Vehicle;
  model: VehicleModel;
  route: PitRoute;
  random: () => number;

  phase: Phase;
  /** Фаза, в которую нужно вернуться после холостого хода или стоянки. */
  resumePhase: Phase;
  phaseUntil: number;
  distance: number;
  loaded: boolean;
  zone: PitZoneKind | null;

  speedKmh: number;
  headingDeg: number;
  /** Уклон в текущей точке с учетом направления движения, проценты. */
  grade: number;
  geometry: RouteGeometry;
  lat: number;
  lon: number;
  corridor: number;
  corridorTarget: number;
  corridorNextAt: number;

  rpm: number;
  rpmTarget: number;
  coolant: number;
  oilTemp: number;
  oilPressure: number;
  transOil: number;
  transPressure: number;
  brakeFl: number;
  brakeFr: number;
  brakeRl: number;
  brakeRr: number;
  /** Постоянный разброс тормозов по колесам: у каждой машины свой. */
  brakeBiasFl: number;
  brakeBiasFr: number;
  brakeBiasRl: number;
  brakeBiasRr: number;

  fuelLevel: number;
  fuelTotal: number;
  fuelInstant: number;
  engineHours: number;
  cargo: number;
  cargoTarget: number;
  bodyAngle: number;
  gear: number;

  /** Персональные сдвиги базовых уровней: парк не должен быть однородным. */
  baseSpeedFactor: number;
  baseThermalOffset: number;
  frontShare: number;

  /** Активное отклонение: индексы показателей и целевые значения. */
  anomalyCount: number;
  anomalyMetrics: Int32Array;
  anomalyTargets: Float64Array;
  anomalyFrom: number;
  anomalyUntil: number;
  anomalyAlarms: number;
  anomalyWarnings: number;

  /** Слив топлива: процентов в секунду и до какого времени. */
  theftRate: number;
  theftUntil: number;

  outageUntil: number;
  outageFrom: number;
  /** Буфер провала связи: выделяется один раз при первом провале. */
  buffer: BackfillBatch | null;
  bufferCount: number;

  /** Последние значения медленных показателей: между обновлениями отдаются как STALE. */
  slow: Float64Array;
  slowReady: boolean;
}

/** Максимальная длина буфера дозаливки, секунды. */
const MAX_OUTAGE_SECONDS = STUB_PARAMS.outageSeconds[1];

export class StubTelemetrySource implements TelemetrySource {
  private states: StubVehicleState[] = [];
  private seed = 0;
  private chaos: ChaosLevel = 'NORMAL';
  private startTime = 0;
  private readonly frame = new Float64Array(METRIC_COUNT);
  private readonly frameQuality = new Uint8Array(METRIC_COUNT);
  private readonly pending: BackfillBatch[] = [];

  init(options: SourceInitOptions): void {
    this.seed = options.seed;
    this.startTime = options.startTime;
    this.states = [];
    for (const vehicle of options.vehicles) {
      this.states.push(this.createState(vehicle, options.startTime - options.historySeconds));
    }
  }

  setVehicleCount(count: number): void {
    const fleet = generateFleet(count, this.seed);
    if (fleet.length < this.states.length) {
      this.states.length = fleet.length;
      return;
    }
    for (let i = this.states.length; i < fleet.length; i += 1) {
      const vehicle = fleet[i];
      if (vehicle !== undefined) {
        this.states.push(this.createState(vehicle, this.startTime));
      }
    }
  }

  setChaos(level: ChaosLevel): void {
    this.chaos = level;
  }

  step(simTimeSec: number, writer: SnapshotWriter): void {
    for (let i = 0; i < this.states.length; i += 1) {
      this.advance(i, simTimeSec, writer, false);
    }
  }

  generateHistory(
    vehicleIndexes: number[],
    fromTime: number,
    toTime: number,
    writer: SnapshotWriter,
  ): void {
    for (let t = fromTime; t < toTime; t += 1) {
      for (const index of vehicleIndexes) {
        this.advance(index, t, writer, true);
      }
    }
  }

  drainBackfill(): BackfillBatch[] {
    if (this.pending.length === 0) {
      return EMPTY_BACKFILL;
    }
    const batches = this.pending.slice();
    this.pending.length = 0;
    return batches;
  }

  /** Число машин у источника: используется тестами. */
  get vehicleCount(): number {
    return this.states.length;
  }

  private createState(vehicle: Vehicle, startTime: number): StubVehicleState {
    // Seed машины складывается из seed прогона и ее идентификатора: парк воспроизводим
    // независимо от порядка добавления машин.
    const random = mulberry32(this.seed + hashString(vehicle.id));
    const model = VEHICLE_MODELS[vehicle.modelId];
    const route = PIT_ROUTES[vehicle.defaultRouteId];
    const spread = CHAOS_PARAMS[this.chaos].spread;
    const state: StubVehicleState = {
      vehicle,
      model,
      route,
      random,
      phase: 'LOADING',
      resumePhase: 'LOADING',
      phaseUntil: startTime + range(random, 0, STUB_PARAMS.loadingSeconds),
      distance: 0,
      loaded: false,
      zone: 'LOADING',
      speedKmh: 0,
      headingDeg: routeHeadingAt(route, 0),
      grade: 0,
      geometry: ROUTE_GEOMETRY.get(route.id) ?? {
        grade: new Float64Array(1),
        heading: new Float64Array(1),
      },
      lat: 0,
      lon: 0,
      corridor: 0,
      corridorTarget: 0,
      corridorNextAt: startTime,
      rpm: 0,
      rpmTarget: 0,
      coolant: STUB_PARAMS.ambientC,
      oilTemp: STUB_PARAMS.ambientC,
      oilPressure: 0,
      transOil: STUB_PARAMS.ambientC,
      transPressure: 14,
      brakeFl: STUB_PARAMS.ambientC,
      brakeFr: STUB_PARAMS.ambientC,
      brakeRl: STUB_PARAMS.ambientC,
      brakeRr: STUB_PARAMS.ambientC,
      brakeBiasFl: 1 + noise(random) * 0.08 * spread,
      brakeBiasFr: 1 + noise(random) * 0.08 * spread,
      brakeBiasRl: 1 + noise(random) * 0.08 * spread,
      brakeBiasRr: 1 + noise(random) * 0.08 * spread,
      fuelLevel: range(
        random,
        STUB_PARAMS.initialFuelPercent[0],
        STUB_PARAMS.initialFuelPercent[1],
      ),
      fuelTotal: range(random, 10_000, 400_000),
      fuelInstant: 0,
      engineHours: vehicle.engineHoursAtStart,
      cargo: 0,
      cargoTarget: 0,
      bodyAngle: 0,
      gear: 0,
      baseSpeedFactor: 1 + noise(random) * 0.12 * spread,
      baseThermalOffset: noise(random) * 4 * spread,
      frontShare: 0.33 + noise(random) * 0.012 * spread,
      anomalyCount: 0,
      anomalyMetrics: new Int32Array(BRAKE_METRICS.length),
      anomalyTargets: new Float64Array(BRAKE_METRICS.length),
      anomalyFrom: 0,
      anomalyUntil: 0,
      anomalyAlarms: 0,
      anomalyWarnings: 0,
      theftRate: 0,
      theftUntil: 0,
      outageUntil: 0,
      outageFrom: 0,
      buffer: null,
      bufferCount: 0,
      slow: new Float64Array(METRIC_COUNT),
      slowReady: false,
    };
    const position = routePositionAt(route, 0);
    state.lat = position.lat;
    state.lon = position.lon;
    return state;
  }

  /** Одна виртуальная секунда одной машины. */
  private advance(index: number, t: number, writer: SnapshotWriter, history: boolean): void {
    const state = this.states[index];
    if (state === undefined) {
      return;
    }
    const chaos = CHAOS_PARAMS[this.chaos];
    this.updatePhase(state, t, chaos.idleChance, chaos.parkChance);
    this.updateMotion(state, t, chaos.noiseScale);
    this.updateMetrics(state, t, chaos.noiseScale);
    this.updateAnomaly(state, t, chaos.anomaliesPer12h);
    this.buildFrame(state, t, chaos.noiseScale);

    // Провал связи: кадр не передается. В реальном времени он копится в буфере и потом
    // дозаливается; в предыстории дозаливать нечего - дыра остается дырой.
    if (!history && t < state.outageUntil) {
      this.bufferFrame(state, index, t);
      writer.skipFrame(index, t);
      return;
    }
    if (history && t < state.outageUntil) {
      writer.skipFrame(index, t);
      return;
    }
    if (!history && state.bufferCount > 0) {
      this.flushBuffer(state);
    }
    if (!history) {
      this.maybeStartOutage(state, t, chaos.outagesPer12h);
      if (t < state.outageUntil) {
        this.bufferFrame(state, index, t);
        writer.skipFrame(index, t);
        return;
      }
    }
    this.emitFrame(state, index, t, writer);
  }

  private updatePhase(
    state: StubVehicleState,
    t: number,
    idleChance: number,
    parkChance: number,
  ): void {
    switch (state.phase) {
      case 'LOADING': {
        state.zone = 'LOADING';
        // Заправка между рейсами: иначе за смену бак кончается и машина стоит с красным
        // уровнем топлива до конца прогона.
        if (state.fuelLevel < STUB_PARAMS.refuelBelowPercent) {
          state.fuelLevel = STUB_PARAMS.refuelToPercent;
        }
        if (state.cargoTarget === 0) {
          // Загрузка в пределах зеленой зоны политики 10/10/20.
          state.cargoTarget = state.model.ratedPayloadKg * range(state.random, 0.97, 1.07);
        }
        if (t >= state.phaseUntil) {
          state.phase = 'HAULING';
          state.loaded = true;
          state.distance = 0;
        }
        break;
      }
      case 'HAULING': {
        state.zone = null;
        if (state.distance >= state.route.lengthMeters) {
          state.phase = 'UNLOADING';
          state.phaseUntil = t + STUB_PARAMS.unloadingSeconds;
          state.zone = state.route.id === 'PIT_TO_CRUSHER' ? 'UNLOADING_CRUSHER' : 'UNLOADING_DUMP';
        }
        break;
      }
      case 'UNLOADING': {
        if (t >= state.phaseUntil) {
          state.loaded = false;
          state.cargoTarget = 0;
          state.resumePhase = 'RETURNING';
          this.startPause(state, t, idleChance, parkChance, 'RETURNING');
        }
        break;
      }
      case 'RETURNING': {
        state.zone = null;
        if (state.distance <= 0) {
          state.distance = 0;
          state.resumePhase = 'LOADING';
          this.startPause(state, t, idleChance, parkChance, 'LOADING');
        }
        break;
      }
      case 'IDLING':
      case 'PARKED': {
        if (t >= state.phaseUntil) {
          state.phase = state.resumePhase;
          if (state.phase === 'LOADING') {
            state.phaseUntil = t + STUB_PARAMS.loadingSeconds;
          }
        }
        break;
      }
    }
  }

  /** Пауза между рейсами: холостой ход или стоянка с заглушенным двигателем. */
  private startPause(
    state: StubVehicleState,
    t: number,
    idleChance: number,
    parkChance: number,
    next: Phase,
  ): void {
    state.resumePhase = next;
    const roll = state.random();
    if (roll < parkChance) {
      state.phase = 'PARKED';
      state.zone = 'PARKING';
      state.phaseUntil =
        t + range(state.random, STUB_PARAMS.parkedSeconds[0], STUB_PARAMS.parkedSeconds[1]);
      if (state.fuelLevel < STUB_PARAMS.refuelBelowPercent) {
        state.fuelLevel = STUB_PARAMS.refuelToPercent;
      }
      this.maybeStartTheft(state, t);
      return;
    }
    if (roll < parkChance + idleChance) {
      state.phase = 'IDLING';
      state.phaseUntil =
        t + range(state.random, STUB_PARAMS.idleSeconds[0], STUB_PARAMS.idleSeconds[1]);
      return;
    }
    state.phase = next;
    if (next === 'LOADING') {
      state.phaseUntil = t + STUB_PARAMS.loadingSeconds;
    }
  }

  private updateMotion(state: StubVehicleState, t: number, noiseScale: number): void {
    const moving = state.phase === 'HAULING' || state.phase === 'RETURNING';
    const direction = state.phase === 'RETURNING' ? -1 : 1;
    const grade = state.grade;
    let target = 0;
    if (moving) {
      const band = state.loaded ? STUB_PARAMS.loadedSpeedKmh : STUB_PARAMS.emptySpeedKmh;
      target = range(state.random, band[0], band[1]) * state.baseSpeedFactor;
      // На подъеме машина теряет скорость, на спуске держит ограничение карьера.
      if (grade > 0) {
        target *= clamp(1 - grade / 22, 0.35, 1);
      } else if (state.loaded) {
        target = Math.min(target, 20);
      }
      target = clamp(target, 4, Math.min(state.model.maxSpeedKmh, STUB_PARAMS.speedLimitKmh));
    }
    state.speedKmh = approach(state.speedKmh, target, moving ? 6 : 4);
    if (!moving && state.speedKmh < 0.3) {
      state.speedKmh = 0;
    }
    if (moving) {
      state.distance += (state.speedKmh * 1000 * direction) / 3600;
      state.distance = clamp(state.distance, 0, state.route.lengthMeters);
    }
    const position = routePositionAt(state.route, state.distance);
    const segment = position.segmentIndex;
    const routeHeading = state.geometry.heading[segment] ?? 0;
    state.grade = (state.geometry.grade[segment] ?? 0) * direction;
    state.headingDeg = direction > 0 ? routeHeading : (routeHeading + 180) % 360;

    // Коридор: смещение от осевой линии меняется медленно, иначе треки всех машин
    // лягут в одну линию и будут выглядеть синтетически.
    const halfWidth =
      state.zone === null ? ROUTE_CORRIDOR_HALF_WIDTH_METERS : ZONE_CORRIDOR_HALF_WIDTH_METERS;
    if (t >= state.corridorNextAt) {
      state.corridorTarget = noise(state.random) * halfWidth;
      state.corridorNextAt =
        t +
        range(
          state.random,
          STUB_PARAMS.corridorChangeSeconds[0],
          STUB_PARAMS.corridorChangeSeconds[1],
        );
    }
    state.corridor = approach(state.corridor, state.corridorTarget, STUB_PARAMS.corridorTauSeconds);

    const headingRad = (state.headingDeg * Math.PI) / 180;
    // Смещение вправо от направления движения плюс шум ГНСС.
    const offsetEast =
      state.corridor * Math.cos(headingRad) + noise(state.random) * GNSS_NOISE_METERS * noiseScale;
    const offsetNorth =
      -state.corridor * Math.sin(headingRad) + noise(state.random) * GNSS_NOISE_METERS * noiseScale;
    state.lat = position.lat + offsetNorth / PIT_METERS_PER_DEGREE_LATITUDE;
    state.lon = position.lon + offsetEast / PIT_METERS_PER_DEGREE_LONGITUDE;
  }

  private updateMetrics(state: StubVehicleState, t: number, noiseScale: number): void {
    const engineOn = state.phase !== 'PARKED';
    const moving = state.speedKmh > 1;
    const grade = state.grade;
    const loadFactor = state.loaded ? 1 : 0.45;
    const uphill = Math.max(0, grade);
    const downhill = Math.max(0, -grade);

    // Обороты: холостой ход, тяга по скорости, добавка на подъеме груженым.
    if (!engineOn) {
      state.rpmTarget = 0;
    } else if (!moving) {
      state.rpmTarget = 700 + noise(state.random) * 25 * noiseScale;
    } else {
      state.rpmTarget =
        900 +
        (state.speedKmh / state.model.maxSpeedKmh) * 700 +
        uphill * 25 * loadFactor +
        noise(state.random) * 40 * noiseScale;
    }
    // Заглушенный двигатель дает ровно ноль оборотов, а не затухающий хвост: иначе на
    // выбеге контекст "двигатель заглушен" не срабатывает и нулевое давление масла
    // на несколько секунд читается как авария.
    state.rpm = engineOn ? approach(state.rpm, state.rpmTarget, 3) : 0;

    state.gear = !engineOn || !moving ? 0 : clamp(Math.round(state.speedKmh / 6) + 1, 1, 6);

    // Температуры: первый порядок с запаздыванием, цель зависит от режима.
    const coolantTarget = engineOn
      ? STUB_PARAMS.ambientC +
        58 +
        loadFactor * 8 +
        uphill * 0.9 +
        state.baseThermalOffset +
        noise(state.random) * 1.2 * noiseScale
      : STUB_PARAMS.ambientC;
    state.coolant = approach(state.coolant, coolantTarget, STUB_PARAMS.coolantTauSeconds);
    state.oilTemp = approach(
      state.oilTemp,
      engineOn ? coolantTarget + 14 : STUB_PARAMS.ambientC,
      STUB_PARAMS.coolantTauSeconds * 1.4,
    );
    const transTarget = engineOn
      ? STUB_PARAMS.ambientC +
        52 +
        loadFactor * 10 +
        uphill * 2.1 +
        state.baseThermalOffset +
        noise(state.random) * 1.5 * noiseScale
      : STUB_PARAMS.ambientC;
    state.transOil = approach(state.transOil, transTarget, STUB_PARAMS.transmissionTauSeconds);

    state.oilPressure = engineOn
      ? clamp(
          state.rpm < 1000
            ? 1.4 + (state.rpm / 1000) * 1.9
            : 3.3 + ((state.rpm - 1000) / 1100) * 1.1,
          0,
          6,
        ) +
        noise(state.random) * 0.08 * noiseScale
      : 0;
    state.transPressure = engineOn
      ? 14.5 + noise(state.random) * 0.6 * noiseScale
      : 13 + noise(state.random) * 0.2;

    // Тормоза: греются на спуске, остывают всегда. Разброс по колесам постоянный.
    const heat =
      downhill * state.speedKmh * STUB_PARAMS.brakeHeatingRate * (state.loaded ? 1.6 : 1);
    state.brakeFl = coolBrake(state.brakeFl, heat * state.brakeBiasFl);
    state.brakeFr = coolBrake(state.brakeFr, heat * state.brakeBiasFr);
    state.brakeRl = coolBrake(state.brakeRl, heat * state.brakeBiasRl);
    state.brakeRr = coolBrake(state.brakeRr, heat * state.brakeBiasRr);

    // Топливо и счетчики: монотонно.
    state.fuelInstant = engineOn
      ? clamp(
          state.model.enginePowerKw * 0.02 +
            (state.rpm / 2100) * state.model.enginePowerKw * 0.17 * loadFactor,
          5,
          state.model.enginePowerKw * 0.23,
        ) +
        noise(state.random) * 3 * noiseScale
      : 0;
    const litersThisSecond = state.fuelInstant / 3600;
    state.fuelTotal += litersThisSecond;
    state.fuelLevel = clamp(
      state.fuelLevel - (litersThisSecond / state.model.fuelTankLiters) * 100,
      0,
      100,
    );
    if (t < state.theftUntil) {
      state.fuelLevel = clamp(state.fuelLevel - state.theftRate, 0, 100);
    }
    if (engineOn) {
      state.engineHours += 1 / 3600;
    }

    // Груз: появляется при погрузке, обнуляется при разгрузке.
    if (state.phase === 'LOADING') {
      const remaining = Math.max(1, state.phaseUntil - t);
      state.cargo = approach(state.cargo, state.cargoTarget, Math.min(40, remaining));
    } else if (state.phase === 'UNLOADING') {
      state.bodyAngle = unloadingAngle(state, t);
      if (state.bodyAngle > 25) {
        state.cargo = approach(state.cargo, 0, 8);
      }
    } else {
      state.bodyAngle = approach(state.bodyAngle, 0, 4);
      if (!state.loaded) {
        state.cargo = approach(state.cargo, 0, 5);
      }
    }
    // Экспоненциальное приближение к нулю оставляет денормальные хвосты: обнуляем явно.
    if (state.bodyAngle < 0.05) {
      state.bodyAngle = 0;
    }
    if (state.cargo < 50) {
      state.cargo = 0;
    }
  }

  /**
   * Отклонение показателя: с вероятностью от меры хаоса машина на несколько минут уходит
   * в желтую или красную зону по одному из показателей, и взводится соответствующий бит.
   */
  private updateAnomaly(state: StubVehicleState, t: number, anomaliesPer12h: number): void {
    if (t < state.anomalyUntil) {
      return;
    }
    if (state.anomalyUntil !== 0 && t >= state.anomalyUntil) {
      state.anomalyCount = 0;
      state.anomalyAlarms = 0;
      state.anomalyWarnings = 0;
      state.anomalyUntil = 0;
    }
    if (state.random() >= anomaliesPer12h / SHIFT_SECONDS) {
      return;
    }
    const scenario = SCENARIOS[Math.floor(state.random() * SCENARIOS.length)];
    if (scenario === undefined || !scenarioApplies(scenario, state)) {
      return;
    }
    const metrics = scenario.pickOne
      ? [scenario.metrics[Math.floor(state.random() * scenario.metrics.length)]]
      : scenario.metrics;
    state.anomalyCount = 0;
    for (const metric of metrics) {
      if (metric === undefined) {
        continue;
      }
      const resolved = resolveThreshold(metric, state.vehicle, ANOMALY_CONTEXT);
      const target = resolved === null ? null : valueInZone(resolved.zones, scenario.severity);
      if (target === null) {
        continue;
      }
      state.anomalyMetrics[state.anomalyCount] = METRIC_INDEX[metric];
      state.anomalyTargets[state.anomalyCount] = target;
      state.anomalyCount += 1;
    }
    if (state.anomalyCount === 0) {
      return;
    }
    state.anomalyFrom = t;
    state.anomalyUntil =
      t + range(state.random, STUB_PARAMS.anomalySeconds[0], STUB_PARAMS.anomalySeconds[1]);
    const flag = findFlag(scenario.code, scenario.field === 'ALARMS' ? ALARMS : WARNINGS);
    const mask = flag === undefined ? 0 : 1 << flag.bit;
    state.anomalyAlarms = scenario.field === 'ALARMS' ? mask : 0;
    state.anomalyWarnings = scenario.field === 'WARNINGS' ? mask : 0;
  }

  private maybeStartTheft(state: StubVehicleState, t: number): void {
    // Слив топлива возможен только на стоянке с заглушенным двигателем (сценарий S10).
    if (state.random() > 0.25) {
      return;
    }
    const durationSeconds = range(state.random, 600, 1200);
    const dropPercent = range(state.random, 6, 15);
    state.theftRate = dropPercent / durationSeconds;
    state.theftUntil = t + durationSeconds;
  }

  private maybeStartOutage(state: StubVehicleState, t: number, outagesPer12h: number): void {
    if (state.random() >= outagesPer12h / SHIFT_SECONDS) {
      return;
    }
    const duration = range(
      state.random,
      STUB_PARAMS.outageSeconds[0],
      STUB_PARAMS.outageSeconds[1],
    );
    state.outageFrom = t;
    state.outageUntil = t + duration;
    state.bufferCount = 0;
  }

  /** Собрать кадр в общий буфер источника: значения и качество по индексам METRIC_ORDER. */
  private buildFrame(state: StubVehicleState, t: number, noiseScale: number): void {
    const frame = this.frame;
    const quality = this.frameQuality;
    const slowTick = t % STUB_PARAMS.slowPeriodSeconds === 0 || !state.slowReady;

    frame[IDX.rpm] = Math.round(state.rpm);
    frame[IDX.coolant] = state.coolant;
    frame[IDX.oilPressure] = state.oilPressure;
    frame[IDX.oilTemp] = state.oilTemp;
    frame[IDX.engineHours] = state.engineHours;
    frame[IDX.gear] = state.gear;
    frame[IDX.transOil] = state.transOil;
    frame[IDX.transPressure] = state.transPressure;
    frame[IDX.brakeFl] = state.brakeFl;
    frame[IDX.brakeFr] = state.brakeFr;
    frame[IDX.brakeRl] = state.brakeRl;
    frame[IDX.brakeRr] = state.brakeRr;
    frame[IDX.speed] = Math.max(0, state.speedKmh + noise(state.random) * 0.4 * noiseScale);
    frame[IDX.heading] = state.headingDeg;
    frame[IDX.latitude] = state.lat;
    frame[IDX.longitude] = state.lon;

    // Медленные показатели обновляются раз в 5 секунд; между обновлениями повторяется
    // последнее значение с качеством STALE - это видно на графиках ступеньками.
    if (slowTick) {
      const total = state.model.curbWeightKg + state.cargo;
      state.slow[IDX.fuelLevel] = state.fuelLevel;
      state.slow[IDX.fuelInstant] = state.fuelInstant;
      state.slow[IDX.fuelTotal] = state.fuelTotal;
      state.slow[IDX.cargo] = state.cargo;
      state.slow[IDX.frontAxle] = total * (state.frontShare + noise(state.random) * 0.004);
      state.slow[IDX.rearAxle] = total * (1 - state.frontShare);
      state.slow[IDX.bodyAngle] = state.bodyAngle;
      state.slowReady = true;
    }

    for (let m = 0; m < METRIC_COUNT; m += 1) {
      if (SLOW_FLAGS[m] === 1) {
        frame[m] = state.slow[m] ?? 0;
        quality[m] = slowTick ? QUALITY.GOOD : QUALITY.STALE;
      } else {
        quality[m] = QUALITY.GOOD;
      }
    }

    // Отклонение: значение плавно уводится к цели и так же плавно возвращается.
    if (state.anomalyCount > 0 && t < state.anomalyUntil) {
      const k = anomalyWeight(t, state.anomalyFrom, state.anomalyUntil);
      for (let i = 0; i < state.anomalyCount; i += 1) {
        const metricIndex = state.anomalyMetrics[i] ?? 0;
        const target = state.anomalyTargets[i] ?? 0;
        const base = frame[metricIndex] ?? 0;
        frame[metricIndex] = base + (target - base) * k;
        // Медленный показатель должен остаться согласованным со своим STALE-значением.
        if (SLOW_FLAGS[metricIndex] === 1) {
          state.slow[metricIndex] = frame[metricIndex] ?? 0;
        }
      }
    }
  }

  private emitFrame(
    state: StubVehicleState,
    index: number,
    t: number,
    writer: SnapshotWriter,
  ): void {
    writer.beginFrame(index, t);
    for (let m = 0; m < METRIC_COUNT; m += 1) {
      writer.setValue(m, this.frame[m] ?? 0, (this.frameQuality[m] ?? QUALITY.GOOD) as Quality);
    }
    writer.setFlags(
      this.currentAlarms(state, t),
      this.currentWarnings(state, t),
      stateFlags(state),
    );
    writer.setZone(state.zone);
    writer.commitFrame();
  }

  private currentAlarms(state: StubVehicleState, t: number): number {
    if (state.anomalyCount === 0 || t >= state.anomalyUntil) {
      return 0;
    }
    // Бит взводится на плато отклонения, а не на фронтах: так событие не дребезжит.
    return anomalyWeight(t, state.anomalyFrom, state.anomalyUntil) > 0.85 ? state.anomalyAlarms : 0;
  }

  private currentWarnings(state: StubVehicleState, t: number): number {
    if (state.anomalyCount === 0 || t >= state.anomalyUntil) {
      return 0;
    }
    return anomalyWeight(t, state.anomalyFrom, state.anomalyUntil) > 0.85
      ? state.anomalyWarnings
      : 0;
  }

  /** Сложить кадр в буфер провала связи. */
  private bufferFrame(state: StubVehicleState, index: number, t: number): void {
    const buffer = this.ensureBuffer(state, index);
    if (state.bufferCount >= MAX_OUTAGE_SECONDS) {
      return;
    }
    const offset = state.bufferCount * METRIC_COUNT;
    for (let m = 0; m < METRIC_COUNT; m += 1) {
      buffer.values[offset + m] = this.frame[m] ?? 0;
      buffer.quality[offset + m] = this.frameQuality[m] ?? QUALITY.GOOD;
    }
    buffer.alarms[state.bufferCount] = this.currentAlarms(state, t);
    buffer.warnings[state.bufferCount] = this.currentWarnings(state, t);
    buffer.state[state.bufferCount] = stateFlags(state);
    buffer.zone[state.bufferCount] = zoneCode(state.zone);
    if (state.bufferCount === 0) {
      buffer.from = t;
    }
    buffer.to = t;
    state.bufferCount += 1;
  }

  private ensureBuffer(state: StubVehicleState, index: number): BackfillBatch {
    if (state.buffer === null) {
      state.buffer = {
        vehicleId: state.vehicle.id,
        vehicleIndex: index,
        from: 0,
        to: 0,
        count: 0,
        metricCount: METRIC_COUNT,
        values: new Float32Array(MAX_OUTAGE_SECONDS * METRIC_COUNT),
        quality: new Uint8Array(MAX_OUTAGE_SECONDS * METRIC_COUNT),
        alarms: new Uint16Array(MAX_OUTAGE_SECONDS),
        warnings: new Uint16Array(MAX_OUTAGE_SECONDS),
        state: new Uint16Array(MAX_OUTAGE_SECONDS),
        zone: new Int8Array(MAX_OUTAGE_SECONDS),
      };
    }
    state.buffer.vehicleIndex = index;
    return state.buffer;
  }

  /** Провал связи закончился: отдать накопленный буфер на дозаливку. */
  private flushBuffer(state: StubVehicleState): void {
    const buffer = state.buffer;
    if (buffer === null || state.bufferCount === 0) {
      return;
    }
    buffer.count = state.bufferCount;
    this.pending.push(buffer);
    state.bufferCount = 0;
    // Буфер отдан наружу: следующий провал получит новый, чтобы дозаливка не читала
    // перезаписанные значения.
    state.buffer = null;
  }
}

const EMPTY_BACKFILL: BackfillBatch[] = [];

function coolBrake(current: number, heat: number): number {
  const cooled = current - (current - STUB_PARAMS.ambientC) * STUB_PARAMS.brakeCoolingRate;
  return clamp(cooled + heat, STUB_PARAMS.ambientC, 700);
}

/** Угол платформы при разгрузке: подъем, выдержка, опускание. */
function unloadingAngle(state: StubVehicleState, t: number): number {
  const total = STUB_PARAMS.unloadingSeconds;
  const elapsed = clamp(total - (state.phaseUntil - t), 0, total);
  const rise = total * 0.35;
  const fall = total * 0.7;
  if (elapsed < rise) {
    return (elapsed / rise) * 45;
  }
  if (elapsed < fall) {
    return 45;
  }
  return clamp(45 * (1 - (elapsed - fall) / (total - fall)), 0, 45);
}

/** Вес отклонения: 0 на фронтах, 1 на плато. Сценарий - развитие во времени, а не выброс. */
function anomalyWeight(t: number, from: number, until: number): number {
  const duration = Math.max(1, until - from);
  const k = (t - from) / duration;
  const ramp = 0.2;
  if (k < ramp) {
    return k / ramp;
  }
  if (k > 1 - ramp) {
    return Math.max(0, (1 - k) / ramp);
  }
  return 1;
}

function scenarioApplies(scenario: ScenarioDef, state: StubVehicleState): boolean {
  switch (scenario.when) {
    case 'loaded':
      return state.loaded;
    case 'moving':
      return state.speedKmh > 3;
    case 'stopped':
      return state.speedKmh <= 1;
    case 'any':
      return true;
  }
}

/** Битовое поле состояний систем по фазе цикла. */
function stateFlags(state: StubVehicleState): number {
  let value = 0;
  const set = (code: string): void => {
    const flag = findFlag(code, SYSTEM_STATE);
    if (flag !== undefined) {
      value |= 1 << flag.bit;
    }
  };
  if (state.phase !== 'PARKED') {
    set('IGNITION_ON');
    set('ENGINE_RUNNING');
  }
  if (state.speedKmh <= 0.5) {
    set('PARKING_BRAKE');
  }
  if (state.bodyAngle > 3) {
    set('BODY_RAISED');
  }
  if (state.gear === 0 && state.phase !== 'PARKED') {
    set('NEUTRAL');
  }
  if (state.loaded) {
    set('LOADED');
  }
  // Ретардер на спуске: вспомогательный тормоз.
  if (state.speedKmh > 1 && state.grade < -3) {
    set('RETARDER_ACTIVE');
  }
  return value;
}

function zoneCode(zone: PitZoneKind | null): number {
  if (zone === null) {
    return 0;
  }
  return PIT_ZONE_KINDS.indexOf(zone) + 1;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
