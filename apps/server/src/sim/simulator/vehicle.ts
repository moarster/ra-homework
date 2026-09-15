/**
 * Модель одной машины: автомат рейса, движение в коридоре, показатели "цель режима плюс
 * инерция плюс шум", сценарии, биты и сборка кадра.
 *
 * Состояние выделяется один раз при создании машины; в `advance` нет ни объектов, ни
 * замыканий, ни строк. Единственная аллокация - буфер провала связи, один на провал.
 */

import {
  DERIVED_RULES,
  findFlag,
  METRIC_INDEX,
  METRIC_ORDER,
  METRICS,
  type PhysicalMetricId,
  PIT_ROUTES,
  PIT_ZONE_KINDS,
  QUALITY,
  resolveThreshold,
  SYSTEM_STATE,
  type ThresholdContext,
  VEHICLE_MODEL_IDS,
  VEHICLE_MODELS,
  type Vehicle,
  type VehicleModel,
  type VehicleModelId,
} from '@ra/contracts';
import { approach, clamp, mulberry32, range, rangeInt } from '../random.js';
import type { BackfillBatch } from '../source.js';
import type { ChaosProfile } from './chaos-profile.js';
import { FlagDebouncer } from './flags.js';
import { interpolateCurve, ouGain, ouStep, signedUniform, triangular } from './math.js';
import {
  AMBIENT_C,
  CH,
  CHANNEL_COOLING_TAU,
  CHANNEL_COUNT,
  CHANNEL_METRICS,
  CHANNEL_TAU,
  DRIFT_AMPLITUDE,
  FUEL_REFERENCE_POWER_KW,
  MODE,
  MODE_COUNT,
  MODE_TARGETS,
  type Mode,
  NOISE_AMPLITUDE,
  OIL_PRESSURE_CURVE,
  SIM_PARAMS as P,
  SCENARIO_PARAMS as SC,
  TRANS_PRESSURE_CURVE,
} from './params.js';
import {
  buildRouteGeometry,
  halfWidthAt,
  positionAt,
  type RouteGeometry,
  toLatitude,
  toLongitude,
} from './route-geometry.js';
import {
  pickScenario,
  SCENARIO,
  SCENARIO_COUNT,
  SCENARIO_TRIGGERS,
  type ScenarioKind,
  TRIGGER,
  type Trigger,
} from './scenarios.js';
import { isLunchAnchor, nextBreakAnchor } from './shift.js';

const METRIC_COUNT = METRIC_ORDER.length;
const SHIFT_SECONDS = 12 * 3600;

const IDX = {
  rpm: METRIC_INDEX.ENGINE_RPM,
  hours: METRIC_INDEX.ENGINE_HOURS,
  gear: METRIC_INDEX.TRANSMISSION_GEAR,
  fuelLevel: METRIC_INDEX.FUEL_LEVEL,
  fuelRate: METRIC_INDEX.FUEL_INSTANT_CONSUMPTION,
  fuelTotal: METRIC_INDEX.FUEL_TOTAL_CONSUMPTION,
  cargo: METRIC_INDEX.CARGO_MASS,
  front: METRIC_INDEX.FRONT_AXLE_LOAD,
  rear: METRIC_INDEX.REAR_AXLE_LOAD,
  body: METRIC_INDEX.BODY_ANGLE,
  speed: METRIC_INDEX.POSITION_SPEED,
  heading: METRIC_INDEX.POSITION_HEADING,
  lat: METRIC_INDEX.POSITION_LATITUDE,
  lon: METRIC_INDEX.POSITION_LONGITUDE,
} as const;

/** Индекс показателя кадра для каждого канала модели. */
const CHANNEL_METRIC_INDEX = Int32Array.from(CHANNEL_METRICS.map((id) => METRIC_INDEX[id]));

/** Показатели 0,2 Гц: между опросами повторяется последнее значение с качеством STALE. */
const SLOW_METRIC = Uint8Array.from(
  METRIC_ORDER.map((id) => (METRICS[id].sampleRateHz < 1 ? 1 : 0)),
);

/**
 * Показатели, которым может достаться одиночное недостоверное значение. Скорость и обороты
 * исключены: сервер выводит из них статус машины, и один кадр без скорости дергал бы статус.
 */
const CORRUPTIBLE: number[] = (
  [
    'ENGINE_COOLANT_TEMPERATURE',
    'ENGINE_OIL_PRESSURE',
    'ENGINE_OIL_TEMPERATURE',
    'TRANSMISSION_OIL_TEMPERATURE',
    'TRANSMISSION_SYSTEM_PRESSURE',
    'BRAKE_TEMPERATURE_FRONT_LEFT',
    'BRAKE_TEMPERATURE_FRONT_RIGHT',
    'BRAKE_TEMPERATURE_REAR_LEFT',
    'BRAKE_TEMPERATURE_REAR_RIGHT',
  ] as PhysicalMetricId[]
).map((id) => METRIC_INDEX[id]);

function stateBit(code: string): number {
  const flag = findFlag(code, SYSTEM_STATE);
  if (flag === undefined) {
    throw new Error(`бит состояния ${code} отсутствует в справочнике`);
  }
  return 1 << flag.bit;
}

const S_IGNITION = stateBit('IGNITION_ON');
const S_ENGINE = stateBit('ENGINE_RUNNING');
const S_PARKING_BRAKE = stateBit('PARKING_BRAKE');
const S_RETARDER = stateBit('RETARDER_ACTIVE');
const S_BODY_RAISED = stateBit('BODY_RAISED');
const S_NEUTRAL = stateBit('NEUTRAL');
const S_LOADED = stateBit('LOADED');
const S_REFUELING = stateBit('REFUELING');

/* ------------------------------------------------------------------ сдвиг целей к желтой зоне */

/** Худшее направление канала: +1 вверх, -1 вниз, 0 нет. */
const CHANNEL_WORSE = Int8Array.from(
  CHANNEL_METRICS.map((id) => {
    const direction = METRICS[id].worseDirection;
    return direction === 'up' ? 1 : direction === 'down' ? -1 : 0;
  }),
);

/** Цель режима для расчета границы: давления - по кривой от оборотов режима. */
function representativeTarget(channel: number, mode: number): number {
  const rpm = MODE_TARGETS[CH.RPM]?.[mode] ?? 0;
  if (channel === CH.OIL_PRESSURE) {
    return interpolateCurve(OIL_PRESSURE_CURVE, rpm);
  }
  if (channel === CH.TRANS_PRESSURE) {
    return interpolateCurve(TRANS_PRESSURE_CURVE, rpm);
  }
  return MODE_TARGETS[channel]?.[mode] ?? Number.NaN;
}

/**
 * Ближайшая граница желтой зоны в худшую сторону для `[модель][режим * каналы + канал]`,
 * NaN - границы нет. Контекст норматива - типичная точка режима. Считается один раз.
 */
const YELLOW_BOUNDARY: Record<string, Float64Array> = {};
for (const modelId of VEHICLE_MODEL_IDS) {
  const table = new Float64Array(MODE_COUNT * CHANNEL_COUNT).fill(Number.NaN);
  for (let mode = 0; mode < MODE_COUNT; mode += 1) {
    const moving = mode === MODE.HAULING || mode === MODE.RETURNING;
    const ctx: ThresholdContext = {
      rpm: MODE_TARGETS[CH.RPM]?.[mode] ?? 0,
      speedKmh: moving ? 20 : 0,
      stoppedSeconds: moving ? 0 : 60,
      cargoRatioPercent: mode === MODE.HAULING ? 100 : 0,
    };
    for (let channel = 0; channel < CHANNEL_COUNT; channel += 1) {
      const worse = CHANNEL_WORSE[channel] ?? 0;
      const metric = CHANNEL_METRICS[channel];
      const target = representativeTarget(channel, mode);
      if (worse === 0 || metric === undefined || !Number.isFinite(target)) {
        continue;
      }
      const resolved = resolveThreshold(metric, { modelId }, ctx);
      if (resolved === null || resolved.excludeFromSeverity) {
        continue;
      }
      let boundary = Number.NaN;
      for (const zone of resolved.zones) {
        if (zone.severity !== 1) {
          continue;
        }
        if (worse > 0 && zone.from !== null && zone.from > target) {
          boundary = Number.isNaN(boundary) ? zone.from : Math.min(boundary, zone.from);
        }
        if (worse < 0 && zone.to !== null && zone.to < target) {
          boundary = Number.isNaN(boundary) ? zone.to : Math.max(boundary, zone.to);
        }
      }
      table[mode * CHANNEL_COUNT + channel] = boundary;
    }
  }
  YELLOW_BOUNDARY[modelId] = table;
}

/** Сдвинуть цель к границе желтой зоны на долю расстояния. Только в худшую сторону. */
function biasTowardYellow(target: number, boundary: number, share: number, worse: number): number {
  if (Number.isNaN(boundary) || share === 0 || (boundary - target) * worse <= 0) {
    return target;
  }
  return target + (boundary - target) * share;
}

/* ------------------------------------------------------------------ геометрия маршрутов */

const ROUTE_GEOMETRY = new Map<string, RouteGeometry>();
function routeGeometryOf(routeId: Vehicle['defaultRouteId']): RouteGeometry {
  let geometry = ROUTE_GEOMETRY.get(routeId);
  if (geometry === undefined) {
    geometry = buildRouteGeometry(PIT_ROUTES[routeId].points);
    ROUTE_GEOMETRY.set(routeId, geometry);
  }
  return geometry;
}

const DRIFT_STEP = ouGain(P.driftTauSeconds);
const NOISE_STEP = ouGain(P.noiseTauSeconds);
const GNSS_STEP = ouGain(P.gnssTauSeconds);
const HEADING_SLOTS = P.headingWindowSeconds + 1;

/** Результат шага машины. */
export const FRAME_EMIT = 0;
export const FRAME_SKIP = 1;

export interface FrameBuffers {
  values: Float64Array;
  quality: Uint8Array;
}

export interface VehicleOptions {
  /** Геометрия маршрута вместо маршрута машины из контрактов (тесты). */
  route?: RouteGeometry;
}

export class VehicleSim {
  readonly vehicle: Vehicle;
  readonly model: VehicleModel;
  readonly route: RouteGeometry;
  readonly random: () => number;
  /** Сколько раз стартовал каждый сценарий: для тестов и диагностики. */
  readonly scenarioStarts = new Uint32Array(SCENARIO_COUNT);
  /** Число завершенных разгрузок. */
  trips = 0;

  /** Битовые поля последнего кадра. */
  alarms = 0;
  warnings = 0;
  state = 0;
  /** Буфер провала связи, готовый к дозаливке; забирает источник. */
  completedBuffer: BackfillBatch | null = null;

  private readonly flags: FlagDebouncer;
  private readonly boundaries: Float64Array;
  private readonly powerFactor: number;
  private readonly ctx: ThresholdContext = {
    rpm: 0,
    speedKmh: 0,
    stoppedSeconds: 0,
    cargoRatioPercent: 0,
  };
  private initialized = false;

  /* цикл */
  private mode: Mode = MODE.LOADING;
  private resumeMode: Mode = MODE.LOADING;
  private modeStartedAt = 0;
  private modeUntil = 0;
  private tripStartedAt = 0;
  private engineOnSince = 0;
  private breakAnchor = Number.NEGATIVE_INFINITY;
  private breakStart = 0;
  private breakEnd = 0;
  private refuelFrom = 0;
  private refuelUntil = 0;
  private refuelStartLevel = 0;
  private refuelTarget = 0;

  /* движение */
  private s = 0;
  private dir = 1;
  private speed = 0;
  private cruise = 0;
  private stopS = 0;
  private stopLateral = 0;
  private arrived = false;
  private lateral = 0;
  private corridorRaw = 0;
  private readonly corridorTau: number;
  private readonly corridorStep: number;
  private segment = 0;
  private readonly pos = new Float64Array(2);
  private readonly histX = new Float64Array(HEADING_SLOTS);
  private readonly histY = new Float64Array(HEADING_SLOTS);
  private histPos = 0;
  private heading = 0;
  private gnssX = 0;
  private gnssY = 0;
  private speedNoise = 0;

  /* показатели */
  private readonly value = new Float64Array(CHANNEL_COUNT);
  private readonly drift = new Float64Array(CHANNEL_COUNT);
  private readonly noise = new Float64Array(CHANNEL_COUNT);
  private readonly biasUnit = new Float64Array(CHANNEL_COUNT);
  private readonly wheelUnit = new Float64Array(4);
  private readonly speedUnit: number;
  private readonly blendTau: number;
  private spread = 0;
  private targetBias = 0;
  private brakeBias = 0;
  private corridorGain = 1;
  private gnssAmp = 0;

  private cargo = 0;
  private cargoTarget = 0;
  private cargoAtUnload = 0;
  private loadSteps = 4;
  private frontShareLoaded: number = P.frontShareLoaded;
  private bodyAngle = 0;
  private bodyPeak = 45;
  private fuelLevel = 0;
  private fuelTotal = 0;
  private engineHours = 0;
  private stoppedSeconds = 0;

  /* кадр */
  private readonly slow = new Float64Array(METRIC_COUNT);
  private readonly slowPhase: number;
  private slowReady = false;
  private invalidCoordsUntil = 0;
  private frameDue = 1;

  /* сценарии */
  private pending = -1;
  private pendingSince = 0;
  private transHeat = false;
  private transHeatUntil = 0;
  private brakeHeat = false;
  private brakeHeatTarget = 0;
  private stuckWheel = -1;
  private stuckFrom = 0;
  private stuckUntil = 0;
  private overload = false;
  private oilFrom = 0;
  private oilUntil = 0;
  private oilFactor = 1;
  private oilSharp = false;
  private oilFactorNow = 1;
  private outageUntil = 0;
  private buffer: BackfillBatch | null = null;
  private theftUntil = 0;
  private theftRate = 0;
  private overspeedUntil = 0;
  private bodyUpPending = false;
  private bodyUpAngle = 0;
  private bodyUpSeconds = 0;
  private bodyUpUntil = 0;
  private skew = false;

  constructor(vehicle: Vehicle, seed: number, options: VehicleOptions = {}) {
    this.vehicle = vehicle;
    this.model = VEHICLE_MODELS[vehicle.modelId];
    this.route = options.route ?? routeGeometryOf(vehicle.defaultRouteId);
    // Отдельный поток случайных чисел на машину: seed прогона плюс идентификатор машины.
    // Добавление машины в парк не меняет поведение уже существующих.
    this.random = mulberry32(seed + hashString(vehicle.id));
    this.flags = new FlagDebouncer(vehicle.modelId, this.model.ratedPayloadKg);
    this.boundaries = YELLOW_BOUNDARY[vehicle.modelId as VehicleModelId] ?? new Float64Array(0);
    this.powerFactor = this.model.enginePowerKw / FUEL_REFERENCE_POWER_KW;
    const random = this.random;
    for (let ch = 0; ch < CHANNEL_COUNT; ch += 1) {
      this.biasUnit[ch] = signedUniform(random);
      this.drift[ch] = triangular(random);
    }
    // Подклинивший тормоз и перегрев - дело механики, а не "характера": тормоза одной машины
    // смещены согласованно, колеса между собой расходятся немного.
    for (let w = 0; w < 4; w += 1) {
      this.wheelUnit[w] = signedUniform(random);
    }
    this.speedUnit = signedUniform(random);
    this.corridorTau = range(random, P.corridorTauSeconds[0], P.corridorTauSeconds[1]);
    this.corridorStep = ouGain(this.corridorTau);
    this.blendTau = range(random, P.chaosBlendTauSeconds[0], P.chaosBlendTauSeconds[1]);
    this.slowPhase = rangeInt(random, 0, P.slowPeriodSeconds - 1);
  }

  /** Одна виртуальная секунда. Кадр пишется в `out`; результат - публиковать или нет. */
  advance(
    t: number,
    profile: ChaosProfile,
    live: boolean,
    scenarios: boolean,
    out: FrameBuffers,
  ): number {
    if (!this.initialized) {
      this.initialize(t, profile);
    }
    this.blend(profile);
    if (scenarios) {
      this.updateScenarios(t, profile, live);
    }
    this.updateCycle(t, profile);
    this.updateMotion(t, profile);
    this.updateChannels(t, profile);
    this.updateLoad(t);
    this.buildFrame(t, profile, out);

    if (t < this.outageUntil) {
      if (live && this.buffer !== null) {
        this.bufferFrame(t, out);
      }
      return FRAME_SKIP;
    }
    if (this.buffer !== null) {
      if (this.buffer.count > 0) {
        this.completedBuffer = this.buffer;
      }
      this.buffer = null;
    }
    // Неустойчивая связь: интервал между кадрами плавает, часть кадров теряется.
    this.frameDue -= 1;
    if (this.frameDue > 1e-6) {
      return FRAME_SKIP;
    }
    this.frameDue += range(
      this.random,
      profile.frameIntervalRange[0],
      profile.frameIntervalRange[1],
    );
    if (profile.dropFrameShare > 0 && this.random() < profile.dropFrameShare) {
      return FRAME_SKIP;
    }
    return FRAME_EMIT;
  }

  /** Зона карьера, в которой стоит машина: индекс в `PIT_ZONE_KINDS` плюс единица, 0 - вне зон. */
  zoneCode(): number {
    const edge = P.zoneBlendM / 2;
    if (this.s <= edge) {
      return PIT_ZONE_KINDS.indexOf('LOADING') + 1;
    }
    if (this.route.lengthM - this.s <= edge) {
      return PIT_ZONE_KINDS.indexOf(this.route.endZone) + 1;
    }
    return 0;
  }

  /* ---------------------------------------------------------------- инициализация */

  private initialize(t: number, profile: ChaosProfile): void {
    this.initialized = true;
    const random = this.random;
    this.spread = profile.vehicleSpread;
    this.targetBias = profile.targetBias;
    this.brakeBias = profile.brakeBias;
    this.corridorGain = profile.corridorGain;
    this.gnssAmp = profile.gnssJitterM;
    this.fuelLevel = range(random, P.initialFuelPercent[0], P.initialFuelPercent[1]);
    this.engineHours = this.vehicle.engineHoursAtStart;
    this.fuelTotal = this.engineHours * P.lifetimeLitersPerHour * this.powerFactor;
    this.engineOnSince = t - 3600;
    this.tripStartedAt = t - range(random, 0, 600);
    this.ensureBreak(t);

    // Парк стартует в разных точках цикла: иначе машины одного маршрута ходили бы строем.
    const roll = random();
    if (roll < 0.3) {
      this.startLoading(t, profile);
    } else if (roll < 0.65) {
      this.pickPayload(profile);
      this.cargo = this.cargoTarget;
      this.startMove(t, profile, MODE.HAULING);
      this.s = range(random, 0.1, 0.9) * this.route.lengthM;
    } else {
      this.startMove(t, profile, MODE.RETURNING);
      this.s = range(random, 0.1, 0.9) * this.route.lengthM;
    }
    for (let ch = 0; ch < CHANNEL_COUNT; ch += 1) {
      const base = MODE_TARGETS[ch]?.[this.mode] ?? 0;
      this.value[ch] = Number.isNaN(base) ? AMBIENT_C + 20 : base;
    }
    this.value[CH.FUEL_RATE] = (this.value[CH.FUEL_RATE] ?? 0) * this.powerFactor;
    this.value[CH.OIL_PRESSURE] = interpolateCurve(OIL_PRESSURE_CURVE, this.value[CH.RPM] ?? 0);
    this.value[CH.TRANS_PRESSURE] = interpolateCurve(TRANS_PRESSURE_CURVE, this.value[CH.RPM] ?? 0);
    this.segment = positionAt(this.route, this.s, 0, this.pos);
    const segmentDirX = this.route.dirX[this.segment] ?? 0;
    const segmentDirY = this.route.dirY[this.segment] ?? 1;
    this.heading = headingOf(segmentDirX * this.dir, segmentDirY * this.dir, 0);
    this.histX.fill(this.pos[0] ?? 0);
    this.histY.fill(this.pos[1] ?? 0);
  }

  /** Индивидуальные смещения и цели переходят к новому уровню хаоса плавно, за 2-5 минут. */
  private blend(profile: ChaosProfile): void {
    const tau = this.blendTau;
    this.spread = approach(this.spread, profile.vehicleSpread, tau);
    this.targetBias = approach(this.targetBias, profile.targetBias, tau);
    this.brakeBias = approach(this.brakeBias, profile.brakeBias, tau);
    this.corridorGain = approach(this.corridorGain, profile.corridorGain, tau);
    this.gnssAmp = approach(this.gnssAmp, profile.gnssJitterM, tau);
  }

  /* ---------------------------------------------------------------- цикл рейса */

  private updateCycle(t: number, profile: ChaosProfile): void {
    switch (this.mode) {
      case MODE.LOADING:
        if (t >= this.modeUntil) {
          this.startMove(t, profile, MODE.HAULING);
        }
        break;
      case MODE.HAULING:
        if (this.arrived) {
          this.startUnloading(t, profile);
        }
        break;
      case MODE.UNLOADING:
        if (t >= this.modeUntil) {
          this.trips += 1;
          if (this.transHeat) {
            this.transHeat = false;
            this.transHeatUntil = t + SC.transHeatTailSeconds;
          }
          this.overload = false;
          this.skew = false;
          this.pause(t, profile, MODE.RETURNING);
        }
        break;
      case MODE.RETURNING:
        if (this.arrived) {
          this.brakeHeat = false;
          this.pause(t, profile, MODE.LOADING);
        }
        break;
      case MODE.IDLING:
      case MODE.PARKED:
        if (t >= this.modeUntil) {
          if (this.mode === MODE.PARKED) {
            this.engineOnSince = t;
          }
          if (this.resumeMode === MODE.LOADING) {
            this.startLoading(t, profile);
          } else {
            this.startMove(t, profile, MODE.RETURNING);
          }
        }
        break;
    }
  }

  /** Длительность фазы с разбросом от меры хаоса. */
  private phaseSeconds(bounds: readonly [number, number], profile: ChaosProfile): number {
    const base = range(this.random, bounds[0], bounds[1]);
    return Math.max(bounds[0] * 0.4, base * (1 + profile.phaseSpread * triangular(this.random)));
  }

  private setMode(t: number, mode: Mode, until: number): void {
    this.mode = mode;
    this.modeStartedAt = t;
    this.modeUntil = until;
  }

  private pickPayload(profile: ChaosProfile): void {
    const random = this.random;
    const rated = this.model.ratedPayloadKg;
    this.cargoTarget = rated * (P.payloadCenter + profile.payloadSpread * triangular(random));
    this.frontShareLoaded =
      P.frontShareLoaded + P.frontShareJitter * (profile.payloadSpread / 0.06) * triangular(random);
  }

  private startLoading(t: number, profile: ChaosProfile): void {
    this.setMode(t, MODE.LOADING, t + this.phaseSeconds(P.loadingSeconds, profile));
    this.tripStartedAt = t;
    this.loadSteps = rangeInt(this.random, P.loadingSteps[0], P.loadingSteps[1]);
    this.pickPayload(profile);
    this.fire(t, TRIGGER.LOADING_START);
  }

  private startMove(t: number, profile: ChaosProfile, mode: Mode): void {
    const random = this.random;
    const hauling = mode === MODE.HAULING;
    this.setMode(t, mode, Number.POSITIVE_INFINITY);
    this.dir = hauling ? 1 : -1;
    this.arrived = false;
    const band = hauling ? P.haulSpeedKmh : P.returnSpeedKmh;
    this.cruise =
      ((band[0] + band[1]) / 2) *
      (1 + profile.speedSpread * signedUniform(random)) *
      (1 + this.speedUnit * this.spread);
    // Точка остановки: 20-30 м от конца маршрута, со стороны подъезда и в пределах коридора
    // зоны, чтобы машины не стояли друг в друге.
    const radius = range(random, P.stopRadiusM[0], P.stopRadiusM[1]);
    const angle = signedUniform(random) * (Math.PI / 2);
    const zoneHalf = P.zoneHalfWidthM * this.corridorGain * 0.9;
    const along = Math.abs(radius * Math.cos(angle));
    this.stopLateral = clamp(radius * Math.sin(angle), -zoneHalf, zoneHalf);
    this.stopS = hauling
      ? Math.max(0, this.route.lengthM - along)
      : Math.min(this.route.lengthM, along);
    this.fire(t, hauling ? TRIGGER.HAULING_START : TRIGGER.RETURNING_START);
    if (!hauling && this.bodyUpSeconds > 0) {
      this.bodyUpUntil = t + this.bodyUpSeconds;
      this.bodyUpSeconds = 0;
    }
  }

  private startUnloading(t: number, profile: ChaosProfile): void {
    const duration = Math.max(
      P.bodyRiseSeconds + P.bodyLowerSeconds + 5,
      this.phaseSeconds(P.unloadingSeconds, profile),
    );
    this.setMode(t, MODE.UNLOADING, t + duration);
    this.speed = 0;
    this.bodyPeak = range(this.random, P.bodyPeakDeg[0], P.bodyPeakDeg[1]);
    this.cargoAtUnload = this.cargo;
    this.fire(t, TRIGGER.UNLOADING_START);
  }

  /**
   * Остановка между фазами: перерыв по графику, заправка, холостой ход или сразу дальше.
   * Машина уходит на перерыв на ближайшей остановке, а не бросает рейс посреди дороги.
   */
  private pause(t: number, profile: ChaosProfile, next: Mode): void {
    const random = this.random;
    this.resumeMode = next;
    this.speed = 0;
    this.ensureBreak(t);
    const needFuel = this.fuelLevel < P.refuelBelowPercent;
    if (t >= this.breakStart - P.breakLeadSeconds && t < this.breakEnd) {
      this.setMode(t, MODE.PARKED, Math.max(this.breakEnd, t + 300) + range(random, 0, 120));
      if (needFuel) {
        this.startRefuel(t);
      } else {
        this.fire(t, TRIGGER.BREAK_START);
      }
      return;
    }
    if (needFuel) {
      this.setMode(t, MODE.PARKED, t + P.refuelSeconds + range(random, 30, 120));
      this.startRefuel(t);
      return;
    }
    if (next === MODE.RETURNING) {
      this.startMove(t, profile, MODE.RETURNING);
      return;
    }
    const tripSeconds = t - this.tripStartedAt;
    const share = range(random, profile.idleShare[0], profile.idleShare[1]);
    const idle = Math.min(
      P.maxIdleSeconds,
      ((tripSeconds * share) / (1 - share)) * range(random, 0, 2),
    );
    // Короткий маршрут: машина ждет своей очереди у экскаватора.
    const queue = Math.max(0, P.minTripSeconds - tripSeconds - P.loadingSeconds[0]);
    const wait = idle + queue;
    if (wait >= P.minIdleSeconds) {
      this.setMode(t, MODE.IDLING, t + wait);
      return;
    }
    this.startLoading(t, profile);
  }

  private startRefuel(t: number): void {
    this.refuelFrom = t;
    this.refuelUntil = t + P.refuelSeconds;
    this.refuelStartLevel = this.fuelLevel;
    this.refuelTarget = range(this.random, P.refuelToPercent[0], P.refuelToPercent[1]);
  }

  private ensureBreak(t: number): void {
    if (t < this.breakEnd) {
      return;
    }
    const anchor = nextBreakAnchor(t, this.breakAnchor);
    const bounds = isLunchAnchor(anchor) ? P.lunchSeconds : P.shiftChangeSeconds;
    this.breakAnchor = anchor;
    this.breakStart = anchor + range(this.random, 0, 300);
    this.breakEnd = this.breakStart + range(this.random, bounds[0], bounds[1]);
  }

  /* ---------------------------------------------------------------- движение */

  private remaining(): number {
    return this.dir > 0 ? this.stopS - this.s : this.s - this.stopS;
  }

  private updateMotion(t: number, profile: ChaosProfile): void {
    const moving = this.mode === MODE.HAULING || this.mode === MODE.RETURNING;
    const random = this.random;
    if (moving && !this.arrived) {
      let target = this.cruise;
      if (t < this.overspeedUntil) {
        target *= SC.overspeedFactor;
      }
      target = Math.min(target, this.model.maxSpeedKmh);
      // Подъезд к точке остановки: скорость, с которой еще успеваешь плавно встать.
      const brakingKmh = Math.sqrt(2 * P.stopDecelMps2 * Math.max(0, this.remaining() - 0.3)) * 3.6;
      target = Math.min(target, brakingKmh);
      this.speed =
        target > this.speed
          ? Math.min(target, this.speed + P.accelKmhPerSecond)
          : Math.max(target, this.speed - P.decelKmhPerSecond);
      this.s = clamp(this.s + (this.dir * this.speed) / 3.6, 0, this.route.lengthM);
      if (this.remaining() <= 0.5 && this.speed <= 2.5) {
        this.arrived = true;
        this.speed = 0;
        this.s = this.stopS;
      }
    } else {
      this.speed = 0;
    }

    // Коридор: медленное боковое блуждание, ограниченное половиной ширины. На подъезде
    // к остановке машина плавно смещается к своей точке в зоне; стоящая машина не сдвигается.
    const halfWidth =
      halfWidthAt(
        this.route,
        this.s,
        P.routeHalfWidthM,
        P.zoneHalfWidthM,
        P.zoneExtentM,
        P.zoneBlendM,
      ) * this.corridorGain;
    this.corridorRaw = ouStep(this.corridorRaw, this.corridorTau, this.corridorStep, 1, random);
    let lateralTarget = halfWidth * Math.tanh(this.corridorRaw * 0.7);
    if (moving) {
      const toStop = this.remaining();
      if (toStop < P.zoneBlendM) {
        const w = 1 - Math.max(0, toStop) / P.zoneBlendM;
        lateralTarget = lateralTarget * (1 - w) + this.stopLateral * w;
      }
    }
    if (this.speed > 0) {
      const k = (1 - Math.exp(-1 / P.lateralSmoothSeconds)) * Math.min(1, this.speed / 10);
      this.lateral += (lateralTarget - this.lateral) * k;
    }
    this.lateral = clamp(this.lateral, -halfWidth, halfWidth);
    this.segment = positionAt(this.route, this.s, this.lateral, this.pos);

    // Курс - по фактическому перемещению за окно: учитывает и виляние в коридоре.
    const x = this.pos[0] ?? 0;
    const y = this.pos[1] ?? 0;
    this.histPos = (this.histPos + 1) % HEADING_SLOTS;
    this.histX[this.histPos] = x;
    this.histY[this.histPos] = y;
    const oldest = (this.histPos + 1) % HEADING_SLOTS;
    const dx = x - (this.histX[oldest] ?? x);
    const dy = y - (this.histY[oldest] ?? y);
    if (dx * dx + dy * dy >= P.headingMinDisplacementM * P.headingMinDisplacementM) {
      this.heading = headingOf(dx, dy, this.heading);
    }

    this.gnssX = ouStep(this.gnssX, P.gnssTauSeconds, GNSS_STEP, 1, random);
    this.gnssY = ouStep(this.gnssY, P.gnssTauSeconds, GNSS_STEP, 1, random);
    this.speedNoise = ouStep(
      this.speedNoise,
      P.noiseTauSeconds,
      NOISE_STEP,
      profile.noiseGain,
      random,
    );
  }

  /* ---------------------------------------------------------------- показатели */

  private updateChannels(t: number, profile: ChaosProfile): void {
    const random = this.random;
    const mode = this.mode;
    const engineOn = mode !== MODE.PARKED;
    const moving = mode === MODE.HAULING || mode === MODE.RETURNING;
    // На ходу нагрузка двигателя растет со скоростью: трогание и подъезд к остановке мягкие.
    const load = moving ? clamp(0.4 + this.speed / Math.max(1, this.cruise), 0, 1) : 1;
    const row = mode * CHANNEL_COUNT;

    for (let ch = 0; ch < CHANNEL_COUNT; ch += 1) {
      if (ch === CH.OIL_PRESSURE || ch === CH.TRANS_PRESSURE) {
        continue;
      }
      const base = MODE_TARGETS[ch]?.[mode] ?? 0;
      const brake = ch >= CH.BRAKE_FL && ch <= CH.BRAKE_RR;
      let target: number;
      if (Number.isNaN(base)) {
        target = AMBIENT_C;
      } else {
        target = base;
        if (moving && (ch === CH.RPM || ch === CH.FUEL_RATE)) {
          const idle = MODE_TARGETS[ch]?.[MODE.IDLING] ?? 0;
          target = idle + (base - idle) * load;
        }
        if (ch === CH.FUEL_RATE) {
          target *= this.powerFactor;
        }
        target = biasTowardYellow(
          target,
          this.boundaries[row + ch] ?? Number.NaN,
          this.targetBias,
          CHANNEL_WORSE[ch] ?? 0,
        );
        if (brake && mode === MODE.RETURNING) {
          target += this.brakeBias;
        }
        target *= 1 + (this.biasUnit[ch] ?? 0) * this.spread;
        if (brake) {
          const wheel = this.wheelUnit[ch - CH.BRAKE_FL] ?? 0;
          target = AMBIENT_C + (target - AMBIENT_C) * (1 + wheel * (0.03 + this.spread * 0.5));
        }
      }
      let tau = engineOn ? (CHANNEL_TAU[ch] ?? 1) : (CHANNEL_COOLING_TAU[ch] ?? 1);

      // Сценарии: меняется цель или инерция, значение идет к ней само.
      if (ch === CH.TRANS_TEMP && engineOn && (this.transHeat || t < this.transHeatUntil)) {
        target += SC.transHeatC;
        tau = SC.transHeatTauSeconds;
      }
      if (brake) {
        if (this.brakeHeat && mode === MODE.RETURNING) {
          target = Math.max(target, this.brakeHeatTarget);
        }
        if (this.stuckWheel === ch - CH.BRAKE_FL && t < this.stuckUntil) {
          const span = this.stuckUntil - this.stuckFrom;
          const ramp = Math.min(1, (t - this.stuckFrom) / (span * SC.stuckBrakeRampShare));
          target += SC.stuckBrakeC * ramp * (this.speed > 1 ? 1 : SC.stuckBrakeStandingShare);
        }
        tau =
          target > (this.value[ch] ?? 0) ? (CHANNEL_TAU[ch] ?? 1) : (CHANNEL_COOLING_TAU[ch] ?? 1);
      }
      this.value[ch] = approach(this.value[ch] ?? 0, target, tau);
    }

    // Обороты: заглушенный двигатель дает ровно ноль (иначе не срабатывает контекст норматива
    // давления масла), после пуска выход на холостой ход за несколько секунд.
    if (!engineOn) {
      this.value[CH.RPM] = 0;
    } else {
      const sinceStart = t - this.engineOnSince;
      if (sinceStart < P.engineStartSeconds) {
        const idle = MODE_TARGETS[CH.RPM]?.[MODE.IDLING] ?? 0;
        this.value[CH.RPM] = (idle * (sinceStart + 1)) / P.engineStartSeconds;
      }
    }
    const rpm = this.value[CH.RPM] ?? 0;

    // Давление масла идет за оборотами; сценарий S5 - множитель к нормальному давлению.
    let oilTarget = 1;
    if (t < this.oilUntil) {
      if (this.oilSharp) {
        oilTarget = this.oilFactor;
      } else {
        const ramp = Math.min(1, (t - this.oilFrom) / ((this.oilUntil - this.oilFrom) * 0.8));
        oilTarget = 1 + (this.oilFactor - 1) * ramp;
      }
    }
    this.oilFactorNow =
      this.oilSharp || t >= this.oilUntil
        ? approach(this.oilFactorNow, oilTarget, SC.oilSharpTauSeconds)
        : oilTarget;
    const oilBase = engineOn ? interpolateCurve(OIL_PRESSURE_CURVE, rpm) : 0;
    this.value[CH.OIL_PRESSURE] =
      biasTowardYellow(
        oilBase,
        this.boundaries[row + CH.OIL_PRESSURE] ?? Number.NaN,
        this.targetBias,
        CHANNEL_WORSE[CH.OIL_PRESSURE] ?? 0,
      ) *
      (1 + (this.biasUnit[CH.OIL_PRESSURE] ?? 0) * this.spread) *
      this.oilFactorNow;
    const transBase = interpolateCurve(TRANS_PRESSURE_CURVE, rpm);
    const transTarget =
      biasTowardYellow(
        transBase,
        this.boundaries[row + CH.TRANS_PRESSURE] ?? Number.NaN,
        engineOn ? this.targetBias : 0,
        CHANNEL_WORSE[CH.TRANS_PRESSURE] ?? 0,
      ) *
      (1 + (this.biasUnit[CH.TRANS_PRESSURE] ?? 0) * this.spread);
    this.value[CH.TRANS_PRESSURE] = approach(
      this.value[CH.TRANS_PRESSURE] ?? 0,
      transTarget,
      CHANNEL_TAU[CH.TRANS_PRESSURE] ?? 1,
    );

    for (let ch = 0; ch < CHANNEL_COUNT; ch += 1) {
      this.drift[ch] = ouStep(
        this.drift[ch] ?? 0,
        P.driftTauSeconds,
        DRIFT_STEP,
        profile.driftGain,
        random,
      );
      this.noise[ch] = ouStep(
        this.noise[ch] ?? 0,
        P.noiseTauSeconds,
        NOISE_STEP,
        profile.noiseGain,
        random,
      );
    }
  }

  private published(ch: number): number {
    const value =
      (this.value[ch] ?? 0) *
      (1 +
        (this.drift[ch] ?? 0) * (DRIFT_AMPLITUDE[ch] ?? 0) +
        (this.noise[ch] ?? 0) * (NOISE_AMPLITUDE[ch] ?? 0));
    return value > 0 ? value : 0;
  }

  private updateLoad(t: number): void {
    const engineOn = this.mode !== MODE.PARKED;
    if (engineOn) {
      const liters = (this.value[CH.FUEL_RATE] ?? 0) / 3600;
      this.fuelTotal += liters;
      this.fuelLevel -= (liters / this.model.fuelTankLiters) * 100;
      this.engineHours += 1 / 3600;
    }
    if (t < this.refuelUntil) {
      const k = (t - this.refuelFrom + 1) / P.refuelSeconds;
      const level = this.refuelStartLevel + (this.refuelTarget - this.refuelStartLevel) * k;
      this.fuelLevel = Math.max(this.fuelLevel, level);
    }
    if (t < this.theftUntil) {
      this.fuelLevel -= this.theftRate;
    }
    this.fuelLevel = clamp(this.fuelLevel, 0, 100);

    const elapsed = t - this.modeStartedAt;
    if (this.mode === MODE.LOADING) {
      const duration = Math.max(1, this.modeUntil - this.modeStartedAt);
      const buckets = clamp(
        Math.floor((elapsed / duration) * this.loadSteps + 0.5),
        0,
        this.loadSteps,
      );
      this.cargo = approach(this.cargo, (this.cargoTarget * buckets) / this.loadSteps, 2);
    } else if (this.mode === MODE.UNLOADING) {
      const duration = this.modeUntil - this.modeStartedAt;
      const holdAngle = this.bodyUpPending ? this.bodyUpAngle : 0;
      if (elapsed < P.bodyRiseSeconds) {
        this.bodyAngle = (this.bodyPeak * elapsed) / P.bodyRiseSeconds;
      } else if (elapsed < duration - P.bodyLowerSeconds) {
        this.bodyAngle = this.bodyPeak;
      } else {
        const k = clamp((duration - elapsed) / P.bodyLowerSeconds, 0, 1);
        this.bodyAngle = holdAngle + (this.bodyPeak - holdAngle) * k;
      }
      this.cargo = this.cargoAtUnload * Math.max(0, 1 - elapsed / P.bodyRiseSeconds);
    } else if (t >= this.bodyUpUntil && this.bodyAngle > 0) {
      this.bodyUpPending = false;
      this.bodyAngle = Math.max(0, this.bodyAngle - P.bodyLowerRateDeg);
    }
    if (this.cargo < 1) {
      this.cargo = 0;
    }
  }

  /* ---------------------------------------------------------------- кадр */

  private buildFrame(t: number, profile: ChaosProfile, out: FrameBuffers): void {
    const values = out.values;
    const quality = out.quality;
    const random = this.random;
    const rated = this.model.ratedPayloadKg;

    for (let ch = 0; ch < CHANNEL_COUNT; ch += 1) {
      values[CHANNEL_METRIC_INDEX[ch] ?? 0] = this.published(ch);
    }
    const speed = this.speed > 0 ? Math.max(0.1, this.speed * (1 + this.speedNoise * 0.01)) : 0;
    values[IDX.speed] = speed;
    const loaded = this.cargo >= (rated * DERIVED_RULES.loadedPayloadRatioPercent) / 100;
    values[IDX.gear] =
      this.speed > DERIVED_RULES.movingSpeedKmh
        ? clamp(1 + Math.floor(this.speed / 6), 1, loaded ? 3 : 5)
        : 0;
    values[IDX.hours] = this.engineHours;
    values[IDX.heading] = this.heading;

    // Шум приемника ГНСС влияет только на публикуемые координаты и ограничен по радиусу.
    let gx = this.gnssX * this.gnssAmp * 0.5;
    let gy = this.gnssY * this.gnssAmp * 0.5;
    const radius = Math.sqrt(gx * gx + gy * gy);
    if (radius > this.gnssAmp) {
      gx *= this.gnssAmp / radius;
      gy *= this.gnssAmp / radius;
    }
    values[IDX.lat] = toLatitude((this.pos[1] ?? 0) + gy);
    values[IDX.lon] = toLongitude((this.pos[0] ?? 0) + gx);

    const slowTick = !this.slowReady || (t + this.slowPhase) % P.slowPeriodSeconds === 0;
    if (slowTick) {
      this.slowReady = true;
      const weigh = 1 + P.weighNoise * profile.noiseGain * triangular(random);
      const cargo = this.cargo * weigh;
      const payloadFraction = clamp(this.cargo / rated, 0, 1);
      // Доля передней оси порожней и груженой; между ними - по массе груза.
      const frontShare =
        P.frontShareEmpty + (this.frontShareLoaded - P.frontShareEmpty) * payloadFraction;
      const total = this.model.curbWeightKg + cargo;
      this.slow[IDX.fuelLevel] = this.fuelLevel;
      this.slow[IDX.fuelRate] = this.published(CH.FUEL_RATE);
      this.slow[IDX.fuelTotal] = this.fuelTotal;
      this.slow[IDX.cargo] = cargo;
      this.slow[IDX.front] = total * frontShare;
      this.slow[IDX.rear] = total * (1 - frontShare);
      this.slow[IDX.body] = this.bodyAngle;
    }
    for (let m = 0; m < METRIC_COUNT; m += 1) {
      if (SLOW_METRIC[m] === 1) {
        values[m] = this.slow[m] ?? 0;
        quality[m] = slowTick ? QUALITY.GOOD : QUALITY.STALE;
      } else {
        quality[m] = QUALITY.GOOD;
      }
    }

    // Биты считает бортовой контроллер по своим датчикам - до искажений канала связи.
    this.stoppedSeconds = speed > DERIVED_RULES.movingSpeedKmh ? 0 : this.stoppedSeconds + 1;
    this.ctx.rpm = values[IDX.rpm] ?? 0;
    this.ctx.speedKmh = speed;
    this.ctx.stoppedSeconds = this.stoppedSeconds;
    this.ctx.cargoRatioPercent = (this.cargo / rated) * 100;
    this.flags.update(values, this.ctx);
    this.alarms = this.flags.alarms;
    this.warnings = this.flags.warnings;
    this.state = this.stateFlags(loaded, t);

    // Качество: изредка короткие всплески недостоверных координат и одиночные сбои датчиков.
    if (t < this.invalidCoordsUntil) {
      quality[IDX.lat] = QUALITY.INVALID;
      quality[IDX.lon] = QUALITY.INVALID;
    } else if (profile.badQualityShare > 0 && random() < profile.badQualityShare) {
      if (random() < 0.5) {
        this.invalidCoordsUntil =
          t + rangeInt(random, P.invalidBurstSeconds[0], P.invalidBurstSeconds[1]);
        quality[IDX.lat] = QUALITY.INVALID;
        quality[IDX.lon] = QUALITY.INVALID;
      } else {
        const metric = CORRUPTIBLE[Math.floor(random() * CORRUPTIBLE.length)] ?? 0;
        quality[metric] = QUALITY.INVALID;
      }
    }
  }

  private stateFlags(loaded: boolean, t: number): number {
    const mode = this.mode;
    let state = 0;
    if (mode !== MODE.PARKED) {
      state |= S_IGNITION | S_ENGINE;
      if (this.speed <= DERIVED_RULES.movingSpeedKmh) {
        state |= S_NEUTRAL;
      }
    }
    if (this.speed === 0) {
      state |= S_PARKING_BRAKE;
    }
    if (this.bodyAngle > DERIVED_RULES.bodyRaisedAngleDeg) {
      state |= S_BODY_RAISED;
    }
    if (loaded) {
      state |= S_LOADED;
    }
    if (t < this.refuelUntil) {
      state |= S_REFUELING;
    }
    if (this.speed > DERIVED_RULES.movingSpeedKmh) {
      const grade = (this.route.grade[this.segment] ?? 0) * this.dir;
      const descending = this.route.hasElevation ? grade < 0 : true;
      if (
        (mode === MODE.RETURNING && descending) ||
        (mode === MODE.HAULING && grade < P.retarderGradePercent)
      ) {
        state |= S_RETARDER;
      }
    }
    return state;
  }

  /* ---------------------------------------------------------------- провал связи */

  private bufferFrame(t: number, out: FrameBuffers): void {
    const buffer = this.buffer;
    if (buffer === null || buffer.count * METRIC_COUNT >= buffer.values.length) {
      return;
    }
    const offset = buffer.count * METRIC_COUNT;
    for (let m = 0; m < METRIC_COUNT; m += 1) {
      buffer.values[offset + m] = out.values[m] ?? 0;
      buffer.quality[offset + m] = out.quality[m] ?? QUALITY.GOOD;
    }
    buffer.alarms[buffer.count] = this.alarms;
    buffer.warnings[buffer.count] = this.warnings;
    buffer.state[buffer.count] = this.state;
    buffer.zone[buffer.count] = this.zoneCode();
    if (buffer.count === 0) {
      buffer.from = t;
    }
    buffer.to = t;
    buffer.count += 1;
  }

  /* ---------------------------------------------------------------- сценарии */

  private activeScenarios(t: number): number {
    let count = this.pending >= 0 ? 1 : 0;
    if (this.transHeat || t < this.transHeatUntil) count += 1;
    if (this.brakeHeat) count += 1;
    if (t < this.stuckUntil) count += 1;
    if (this.overload) count += 1;
    if (t < this.oilUntil) count += 1;
    if (t < this.outageUntil) count += 1;
    if (t < this.theftUntil) count += 1;
    if (t < this.overspeedUntil) count += 1;
    if (this.bodyUpPending || t < this.bodyUpUntil) count += 1;
    if (this.skew) count += 1;
    return count;
  }

  private updateScenarios(t: number, profile: ChaosProfile, live: boolean): void {
    const random = this.random;
    if (this.pending >= 0 && t - this.pendingSince > SC.pendingTimeoutSeconds) {
      this.pending = -1;
    }
    if (
      this.pending < 0 &&
      random() < profile.scenariosPerShift / SHIFT_SECONDS &&
      this.activeScenarios(t) < profile.maxScenarios
    ) {
      this.pending = pickScenario(random);
      this.pendingSince = t;
    }
    if (this.pending < 0) {
      return;
    }
    const kind = this.pending as ScenarioKind;
    const trigger = SCENARIO_TRIGGERS[kind];
    if (trigger === TRIGGER.IMMEDIATE) {
      if (kind === SCENARIO.OIL_PRESSURE_DROP && this.mode === MODE.PARKED) {
        return;
      }
      this.pending = -1;
      this.start(kind, t, profile, live);
    } else if (
      trigger === TRIGGER.RETURNING_OPEN_ROAD &&
      this.mode === MODE.RETURNING &&
      this.speed > 15 &&
      this.remaining() > SC.overspeedMinRemainingM
    ) {
      this.pending = -1;
      this.start(kind, t, profile, live);
    }
  }

  /** Событие цикла: запустить отложенный сценарий, если он ждал именно его. */
  private fire(t: number, trigger: Trigger): void {
    if (this.pending < 0 || SCENARIO_TRIGGERS[this.pending] !== trigger) {
      return;
    }
    const kind = this.pending as ScenarioKind;
    this.pending = -1;
    this.start(kind, t, null, false);
  }

  private start(kind: ScenarioKind, t: number, profile: ChaosProfile | null, live: boolean): void {
    const random = this.random;
    switch (kind) {
      case SCENARIO.TRANSMISSION_OVERHEAT:
        if (this.transHeat) return;
        this.transHeat = true;
        break;
      case SCENARIO.BRAKE_OVERHEAT:
        this.brakeHeat = true;
        this.brakeHeatTarget = range(random, SC.brakeOverheatC[0], SC.brakeOverheatC[1]);
        break;
      case SCENARIO.STUCK_BRAKE:
        if (t < this.stuckUntil) return;
        this.stuckWheel = rangeInt(random, 0, 3);
        this.stuckFrom = t;
        this.stuckUntil = t + range(random, SC.stuckBrakeSeconds[0], SC.stuckBrakeSeconds[1]);
        break;
      case SCENARIO.OVERLOAD:
        this.overload = true;
        this.cargoTarget =
          this.model.ratedPayloadKg * range(random, SC.overloadRatio[0], SC.overloadRatio[1]);
        break;
      case SCENARIO.OIL_PRESSURE_DROP:
        if (t < this.oilUntil) return;
        this.oilSharp = random() < SC.oilSharpShare;
        this.oilFactor = range(random, SC.oilPressureFactor[0], SC.oilPressureFactor[1]);
        this.oilFrom = t;
        this.oilUntil =
          t +
          (this.oilSharp
            ? SC.oilSharpSeconds
            : range(random, SC.oilCrawlSeconds[0], SC.oilCrawlSeconds[1]));
        break;
      case SCENARIO.OUTAGE: {
        if (profile === null || t < this.outageUntil) return;
        const long = profile.longOutageShare > 0 && random() < profile.longOutageShare;
        const minutes = long
          ? range(random, profile.outageRange[1], profile.longOutageMaxMinutes)
          : range(random, profile.outageRange[0], profile.outageRange[1]);
        const seconds = Math.round(minutes * 60);
        this.outageUntil = t + seconds;
        // В предыстории дозаливать нечего: сервер пишет ее напрямую, провал остается дырой.
        this.buffer = live ? createBuffer(this.vehicle.id, seconds) : null;
        break;
      }
      case SCENARIO.FUEL_THEFT: {
        const seconds = range(random, SC.theftSeconds[0], SC.theftSeconds[1]);
        const window = Math.max(60, this.modeUntil - t - 60);
        const duration = Math.min(seconds, window);
        this.theftRate = range(random, SC.theftPercent[0], SC.theftPercent[1]) / duration;
        this.theftUntil = t + duration;
        break;
      }
      case SCENARIO.OVERSPEED:
        this.overspeedUntil = t + range(random, SC.overspeedSeconds[0], SC.overspeedSeconds[1]);
        break;
      case SCENARIO.BODY_UP_WHILE_MOVING:
        this.bodyUpPending = true;
        this.bodyUpAngle = range(random, SC.bodyUpDeg[0], SC.bodyUpDeg[1]);
        this.bodyUpSeconds = range(random, SC.bodyUpSeconds[0], SC.bodyUpSeconds[1]);
        break;
      case SCENARIO.SKEWED_LOAD:
        this.skew = true;
        this.frontShareLoaded = range(random, SC.skewFrontShare[0], SC.skewFrontShare[1]);
        break;
    }
    this.scenarioStarts[kind] = (this.scenarioStarts[kind] ?? 0) + 1;
  }
}

function createBuffer(vehicleId: string, seconds: number): BackfillBatch {
  return {
    vehicleId,
    vehicleIndex: 0,
    from: 0,
    to: 0,
    count: 0,
    metricCount: METRIC_COUNT,
    values: new Float32Array(seconds * METRIC_COUNT),
    quality: new Uint8Array(seconds * METRIC_COUNT),
    alarms: new Uint16Array(seconds),
    warnings: new Uint16Array(seconds),
    state: new Uint16Array(seconds),
    zone: new Int8Array(seconds),
  };
}

/** Курс по перемещению на восток и на север, градусы от севера по часовой. */
function headingOf(dx: number, dy: number, fallback: number): number {
  if (dx === 0 && dy === 0) {
    return fallback;
  }
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  return deg < 0 ? deg + 360 : deg;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
