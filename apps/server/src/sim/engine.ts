/**
 * Движок симуляции: связывает часы, источник телеметрии, хранилище, детектор событий
 * и websocket.
 *
 * Движок - единственное место, которое знает и про источник, и про хранилище. Источник
 * пишет физические показатели, движок считает производные, светофор и статус, складывает
 * все в хранилище и отдает наружу снапшоты.
 */

import {
  brakeTemperatureMax,
  brakeTemperatureSpread,
  type ChaosLevel,
  type CompiledThresholds,
  clampTimeScale,
  combinePointSeverity,
  compiledThresholds,
  contextMatches,
  frontAxleShare,
  generateFleet,
  hoursToService,
  isStateSet,
  MAX_VEHICLES,
  METRIC_ORDER,
  METRICS,
  MIN_VEHICLES,
  maxTimeScaleFor,
  PIT_ZONE_KINDS,
  type PitZoneKind,
  payloadRatio,
  QUALITY,
  type Quality,
  type ResolvedThreshold,
  resolveThreshold,
  type Severity,
  type SimPatch,
  type SimState,
  type TelemetryEvent,
  type ThresholdContext,
  TIME_SCALES,
  type TrackPoint,
  timeSinceLastData,
  VEHICLE_MODEL_IDS,
  VEHICLE_STATUS_CODES,
  type Vehicle,
  type VehicleSnapshot,
  vehicleStatus,
  worstSeverity,
  zoneSeverity,
} from '@ra/contracts';
import { EventDetector } from '../events/detector.js';
import { EventJournal } from '../events/journal.js';
import { SERVER_RULES } from '../server-config.js';
import { STORED_METRIC_COUNT, STORED_METRICS, storedMetricIndex } from '../store/stored-metrics.js';
import { TelemetryStore } from '../store/tiered-store.js';
import { SimClock } from './clock.js';
import { TelemetrySimulator } from './simulator/telemetry-simulator.js';
import type { BackfillBatch, SnapshotWriter, TelemetrySource } from './source.js';

/** Индексы в буферах хранилища: считаются один раз при загрузке модуля. */
const S = {
  rpm: storedMetricIndex('ENGINE_RPM'),
  coolant: storedMetricIndex('ENGINE_COOLANT_TEMPERATURE'),
  engineHours: storedMetricIndex('ENGINE_HOURS'),
  brakeFl: storedMetricIndex('BRAKE_TEMPERATURE_FRONT_LEFT'),
  brakeFr: storedMetricIndex('BRAKE_TEMPERATURE_FRONT_RIGHT'),
  brakeRl: storedMetricIndex('BRAKE_TEMPERATURE_REAR_LEFT'),
  brakeRr: storedMetricIndex('BRAKE_TEMPERATURE_REAR_RIGHT'),
  cargo: storedMetricIndex('CARGO_MASS'),
  frontAxle: storedMetricIndex('FRONT_AXLE_LOAD'),
  rearAxle: storedMetricIndex('REAR_AXLE_LOAD'),
  bodyAngle: storedMetricIndex('BODY_ANGLE'),
  speed: storedMetricIndex('POSITION_SPEED'),
  heading: storedMetricIndex('POSITION_HEADING'),
  latitude: storedMetricIndex('POSITION_LATITUDE'),
  longitude: storedMetricIndex('POSITION_LONGITUDE'),
  brakeMax: storedMetricIndex('BRAKE_TEMPERATURE_MAX'),
  brakeSpread: storedMetricIndex('BRAKE_TEMPERATURE_SPREAD'),
  payloadRatio: storedMetricIndex('PAYLOAD_RATIO'),
  frontAxleShare: storedMetricIndex('FRONT_AXLE_SHARE'),
  timeSinceData: storedMetricIndex('TIME_SINCE_LAST_DATA'),
  hoursToService: storedMetricIndex('HOURS_TO_SERVICE'),
  vehicleStatus: storedMetricIndex('VEHICLE_STATUS'),
} as const;

/** Участвует ли показатель в светофоре: таблица по индексам буфера. */
const SEVERITY_RELEVANT = Uint8Array.from(
  STORED_METRICS.map((id) => (METRICS[id].severityRelevant ? 1 : 0)),
);

/**
 * Нормативы, разобранные на старте: `[модель][индекс показателя]`.
 *
 * В горячем пути (60 машин x 30 показателей x 60 шагов в секунду - это 108 000 разрешений
 * норматива в секунду) недопустимо ни собирать строковый ключ, ни искать в Map: таблица
 * адресуется целыми индексами.
 */
const THRESHOLD_TABLE: Record<string, (CompiledThresholds | null)[]> = {};
for (const modelId of VEHICLE_MODEL_IDS) {
  THRESHOLD_TABLE[modelId] = STORED_METRICS.map((metric) => {
    const compiled = compiledThresholds(metric, modelId);
    // Показатель без правил в светофоре не участвует: разрешать нечего.
    return compiled.contextual.length === 0 && compiled.fallback === null ? null : compiled;
  });
}

/** Правило, применимое в данном контексте. */
function pickRule(
  compiled: CompiledThresholds | null,
  ctx: ThresholdContext,
): ResolvedThreshold | null {
  if (compiled === null) {
    return null;
  }
  for (const resolved of compiled.contextual) {
    const context = resolved.rule.context;
    if (context !== undefined && contextMatches(context, ctx)) {
      return resolved;
    }
  }
  return compiled.fallback;
}

/** Режим записи кадра. */
type IngestMode = 'live' | 'history' | 'backfill';

export interface EngineListener {
  onEvents(opened: TelemetryEvent[], closed: TelemetryEvent[]): void;
  /** `changedBy` - вкладка, изменившая параметры; нет - изменение сделал сам сервер. */
  onSim(sim: SimState, changedBy?: string): void;
  onBackfill(vehicleId: string, from: number, to: number): void;
  /** Вызывается после каждой пачки шагов часов: место для публикации тика. */
  onBatch(simTime: number): void;
}

export interface EngineOptions {
  seed: number;
  vehicleCount: number;
  historySeconds: number;
  chaos?: ChaosLevel;
  timeScale?: number;
  /** Источник телеметрии. На этапе 5 сюда передается симулятор вместо заглушки. */
  source?: TelemetrySource;
  /** Режим замера: разрешены скорости вне `TIME_SCALES` (см. `isAllowedTimeScale`). */
  anyTimeScale?: boolean;
  log?: (message: string, details?: Record<string, unknown>) => void;
}

/**
 * Верхняя граница скорости в режиме замера: часы выполняют не больше 600 шагов за пачку
 * в 100 мс, выше этого значения скорость упирается в защиту от залипания, а не в генерацию.
 */
export const MAX_BENCHMARK_TIME_SCALE = 6000;

/** Допустима ли скорость времени: список `TIME_SCALES` или, в режиме замера, любое целое. */
export function isAllowedTimeScale(scale: number, anyTimeScale: boolean): boolean {
  if (anyTimeScale) {
    return Number.isInteger(scale) && scale >= 1 && scale <= MAX_BENCHMARK_TIME_SCALE;
  }
  return TIME_SCALES.includes(scale);
}

/** Дополнительное состояние машины, которое ведет движок. */
interface EngineVehicleState {
  /** Сколько секунд машина стоит: нужно контекстным нормативам тормозов. */
  stoppedSeconds: number;
  zone: PitZoneKind | null;
  /** Точки позиции с прошлого тика websocket. */
  positions: TrackPoint[];
}

export class SimEngine implements SnapshotWriter {
  readonly store = new TelemetryStore();
  readonly journal = new EventJournal();
  readonly detector = new EventDetector(this.journal);
  readonly clock: SimClock;

  listener: EngineListener | null = null;

  private readonly source: TelemetrySource;
  private readonly log: (message: string, details?: Record<string, unknown>) => void;
  private readonly startedAtReal = Date.now();
  private seed: number;
  private chaos: ChaosLevel;
  private vehicleCountValue: number;
  private historySeconds: number;
  private historyFromValue: number;
  private fleet: Vehicle[] = [];
  private engineState: EngineVehicleState[] = [];
  private lastPruneAt = 0;
  /** Идущая фоновая генерация предыстории новых машин. */
  private historyJob: {
    indexes: number[];
    cursor: number;
    to: number;
    wasRunning: boolean;
  } | null = null;

  /** Буферы текущего кадра: переиспользуются, аллокаций на значение нет. */
  private readonly values = new Float64Array(STORED_METRIC_COUNT);
  private readonly quality = new Uint8Array(STORED_METRIC_COUNT);
  private readonly severities = new Uint8Array(STORED_METRIC_COUNT);
  private frameIndex = -1;
  private frameTime = 0;
  private frameAlarms = 0;
  private frameWarnings = 0;
  private frameState = 0;
  private frameZone: PitZoneKind | null = null;
  private mode: IngestMode = 'live';
  /** Переиспользуемый буфер температур тормозов: производные считаются без аллокаций. */
  private readonly brakeScratch: (number | null)[] = [null, null, null, null];
  private readonly thresholdCtx: ThresholdContext = {
    rpm: null,
    speedKmh: null,
    stoppedSeconds: null,
    cargoRatioPercent: null,
  };

  private readonly anyTimeScale: boolean;

  constructor(options: EngineOptions) {
    this.anyTimeScale = options.anyTimeScale === true;
    this.seed = options.seed;
    this.chaos = options.chaos ?? 'NORMAL';
    this.vehicleCountValue = clampVehicleCount(options.vehicleCount);
    this.historySeconds = options.historySeconds;
    this.source = options.source ?? new TelemetrySimulator();
    this.log = options.log ?? (() => {});
    const startTime = Math.floor(Date.now() / 1000);
    this.historyFromValue = startTime - options.historySeconds;
    const timeScale = options.timeScale ?? 1;
    this.clock = new SimClock({
      startTime,
      timeScale: this.anyTimeScale ? timeScale : clampTimeScale(timeScale, this.vehicleCountValue),
      onStep: (t) => {
        this.stepOnce(t);
      },
      onBatch: (t) => {
        this.listener?.onBatch(t);
      },
      onLag: (lag) => {
        this.log('часы симуляции отстают', { lagSeconds: Math.round(lag) });
      },
    });
  }

  /** Поднять парк, сгенерировать предысторию и запустить часы. */
  start(): void {
    this.fleet = generateFleet(this.vehicleCountValue, this.seed);
    this.store.setVehicles(this.fleet);
    this.engineState = this.fleet.map(() => createVehicleState());
    this.source.init({
      vehicles: this.fleet,
      seed: this.seed,
      startTime: this.clock.simTime,
      historySeconds: this.historySeconds,
    });
    this.source.setChaos(this.chaos);
    const startedAt = performance.now();
    this.generateHistory(
      this.fleet.map((_, index) => index),
      this.historyFromValue,
      this.clock.simTime,
    );
    this.log('предыстория сгенерирована', {
      vehicles: this.fleet.length,
      seconds: this.historySeconds,
      ms: Math.round(performance.now() - startedAt),
    });
    this.clock.start();
  }

  stop(): void {
    this.historyJob = null;
    this.clock.stop();
  }

  get simTime(): number {
    return this.clock.simTime;
  }

  get historyFrom(): number {
    return this.historyFromValue;
  }

  simState(): SimState {
    return {
      simTime: this.clock.simTime,
      historyFrom: this.historyFromValue,
      timeScale: this.clock.timeScale,
      vehicleCount: this.store.count,
      chaos: this.chaos,
      seed: this.seed,
      running: this.clock.running,
    };
  }

  /**
   * Изменение параметров симуляции: любое подмножество полей. `changedBy` уходит зрителям
   * вместе с новым состоянием: симуляция одна на всех, и чужое изменение должно быть видно.
   */
  patch(patch: SimPatch, changedBy?: string): SimState {
    if (patch.timeScale !== undefined) {
      if (!isAllowedTimeScale(patch.timeScale, this.anyTimeScale)) {
        throw new Error(`недопустимая скорость времени: ${patch.timeScale}`);
      }
      const count =
        patch.vehicleCount !== undefined ? clampVehicleCount(patch.vehicleCount) : this.store.count;
      if (!this.anyTimeScale && patch.timeScale > maxTimeScaleFor(count)) {
        throw new Error(`скорость x${patch.timeScale} выше предела для ${count} машин`);
      }
      // Смена скорости не перезапускает симуляцию и не рвет историю.
      this.clock.setTimeScale(patch.timeScale);
    }
    if (patch.chaos !== undefined && patch.chaos !== this.chaos) {
      this.chaos = patch.chaos;
      this.source.setChaos(patch.chaos);
    }
    if (patch.vehicleCount !== undefined) {
      this.setVehicleCount(patch.vehicleCount);
      // Рост парка снижает скорость до предела, а не отклоняет изменение: так проще зрителю.
      if (!this.anyTimeScale) {
        this.clock.setTimeScale(clampTimeScale(this.clock.timeScale, this.store.count));
      }
    }
    if (patch.running !== undefined) {
      if (patch.running) {
        this.clock.start();
      } else {
        this.clock.stop();
      }
    }
    const state = this.simState();
    this.listener?.onSim(state, changedBy);
    return state;
  }

  /**
   * Изменение числа машин. История существующих машин не сбрасывается; новые приходят
   * с предысторией той же глубины, а не с пустотой.
   */
  private setVehicleCount(count: number): void {
    const next = clampVehicleCount(count);
    if (next === this.store.count) {
      return;
    }
    // Идущая генерация предыстории относится к прежнему составу парка: ее нужно снять,
    // иначе она восстановит ход часов уже после того, как это сделает новая генерация.
    this.cancelHistoryJob();
    const previousIds = new Set(this.store.ids());
    this.fleet = generateFleet(next, this.seed);
    const { removed } = this.store.setVehicles(this.fleet);
    for (const id of removed) {
      this.detector.forget(id);
      this.journal.removeVehicle(id);
    }
    this.engineState = this.fleet.map(
      (_, index) => this.engineState[index] ?? createVehicleState(),
    );
    this.source.setVehicleCount(next);
    this.vehicleCountValue = next;
    const addedIndexes = this.fleet
      .map((vehicle, index) => (previousIds.has(vehicle.id) ? -1 : index))
      .filter((index) => index >= 0);
    if (addedIndexes.length > 0) {
      this.scheduleHistory(
        addedIndexes,
        this.clock.simTime - this.historySeconds,
        this.clock.simTime,
      );
    }
  }

  /**
   * Предыстория новых машин генерируется порциями с уступанием цикла событий: двенадцать
   * часов на пятьдесят семь машин - это около трех миллионов машино-секунд, и делать их
   * одним блоком означало бы на секунды перестать отвечать на запросы.
   *
   * На время генерации часы останавливаются: иначе источник получал бы для одной и той же
   * машины и шаги предыстории, и шаги реального времени, и ее внутреннее состояние
   * перемешалось бы. Остановка видна в `/api/sim` полем `running`.
   */
  private scheduleHistory(indexes: number[], from: number, to: number): void {
    const wasRunning = this.clock.running;
    this.clock.stop();
    const startedAt = performance.now();
    this.historyJob = { indexes, cursor: from, to, wasRunning };
    const run = (): void => {
      const job = this.historyJob;
      if (job === null) {
        return;
      }
      const budgetStartedAt = performance.now();
      this.mode = 'history';
      while (job.cursor < job.to && performance.now() - budgetStartedAt < HISTORY_BUDGET_MS) {
        const chunkEnd = Math.min(job.to, job.cursor + HISTORY_CHUNK_SECONDS);
        this.source.generateHistory(job.indexes, job.cursor, chunkEnd, this);
        job.cursor = chunkEnd;
      }
      this.mode = 'live';
      this.detector.drain();
      if (job.cursor < job.to) {
        setImmediate(run);
        return;
      }
      this.historyJob = null;
      for (const index of job.indexes) {
        const entry = this.store.at(index);
        if (entry !== undefined) {
          this.detector.observeSilence(entry.vehicle.id, job.to, entry.latest.lastGoodAt);
        }
      }
      this.detector.drain();
      this.log('предыстория новых машин сгенерирована', {
        vehicles: job.indexes.length,
        ms: Math.round(performance.now() - startedAt),
      });
      if (job.wasRunning) {
        this.clock.start();
      }
      this.listener?.onSim(this.simState());
    };
    setImmediate(run);
  }

  /** Снять идущую фоновую генерацию предыстории и вернуть часам прежнее состояние. */
  private cancelHistoryJob(): void {
    const job = this.historyJob;
    if (job === null) {
      return;
    }
    this.historyJob = null;
    this.log('генерация предыстории прервана: состав парка изменился', {
      remainingSeconds: job.to - job.cursor,
    });
    if (job.wasRunning) {
      this.clock.start();
    }
  }

  private generateHistory(indexes: number[], from: number, to: number): void {
    this.mode = 'history';
    this.source.generateHistory(indexes, from, to, this);
    for (const index of indexes) {
      const entry = this.store.at(index);
      if (entry !== undefined) {
        this.detector.observeSilence(entry.vehicle.id, to, entry.latest.lastGoodAt);
      }
    }
    this.mode = 'live';
    // События предыстории в websocket не уходят: клиент получает их REST-запросом.
    this.detector.drain();
  }

  /** Одна виртуальная секунда: шаг источника, дозаливка, серверные события. */
  private stepOnce(t: number): void {
    this.mode = 'live';
    this.source.step(t, this);
    const batches = this.source.drainBackfill();
    for (const batch of batches) {
      this.applyBackfill(batch);
    }
    for (const entry of this.store.vehicles) {
      this.detector.observeSilence(entry.vehicle.id, t, entry.latest.lastGoodAt);
    }
    const drained = this.detector.drain();
    if (drained.opened.length > 0 || drained.closed.length > 0) {
      this.listener?.onEvents(drained.opened, drained.closed);
    }
    if (t - this.lastPruneAt >= SERVER_RULES.eventPruneIntervalSeconds) {
      this.lastPruneAt = t;
      this.journal.prune(t);
    }
  }

  /* ------------------------------------------------------------ SnapshotWriter */

  beginFrame(vehicleIndex: number, simTimeSec: number): void {
    this.frameIndex = vehicleIndex;
    this.frameTime = simTimeSec;
    this.frameAlarms = 0;
    this.frameWarnings = 0;
    this.frameState = 0;
    this.frameZone = null;
    this.values.fill(Number.NaN);
    this.quality.fill(QUALITY.NOT_AVAILABLE);
    this.severities.fill(3);
  }

  setValue(metricIndex: number, value: number, quality: Quality): void {
    this.values[metricIndex] = value;
    this.quality[metricIndex] = quality;
  }

  setMissing(metricIndex: number, quality: Quality): void {
    this.values[metricIndex] = Number.NaN;
    this.quality[metricIndex] = quality;
  }

  setFlags(alarms: number, warnings: number, state: number): void {
    this.frameAlarms = alarms;
    this.frameWarnings = warnings;
    this.frameState = state;
  }

  setZone(zone: PitZoneKind | null): void {
    this.frameZone = zone;
  }

  commitFrame(): void {
    this.ingestFrame(this.frameIndex, this.frameTime, this.mode);
  }

  skipFrame(vehicleIndex: number, simTimeSec: number): void {
    const entry = this.store.at(vehicleIndex);
    if (entry === undefined) {
      return;
    }
    // Дыра в данных: бакеты открываются, значений в них нет. Интерполяции нет.
    this.store.openTime(vehicleIndex, simTimeSec);
    this.detector.observeGap(entry.vehicle.id);
    const latest = entry.latest;
    latest.t = simTimeSec;
    // Время без связи сервер считает сам и пишет даже тогда, когда борт молчит:
    // иначе на графике этого показателя была бы дыра именно там, где он и нужен.
    const minutes = timeSinceLastData(simTimeSec, latest.lastGoodAt);
    if (S.timeSinceData >= 0 && minutes !== null) {
      const severity = this.metricSeverityAt(entry.model.id, 'TIME_SINCE_LAST_DATA', minutes);
      this.store.writeSample(vehicleIndex, S.timeSinceData, minutes, QUALITY.GOOD, severity);
      latest.values[S.timeSinceData] = minutes;
      latest.quality[S.timeSinceData] = QUALITY.GOOD;
    }
    if (simTimeSec - (latest.lastGoodAt ?? simTimeSec) >= SERVER_RULES.noDataStatusSeconds) {
      latest.status = 'NO_DATA';
      latest.sev = 3;
      if (S.vehicleStatus >= 0) {
        this.store.writeSample(
          vehicleIndex,
          S.vehicleStatus,
          VEHICLE_STATUS_CODES.NO_DATA,
          QUALITY.GOOD,
          0,
        );
        latest.values[S.vehicleStatus] = VEHICLE_STATUS_CODES.NO_DATA;
      }
    }
  }

  /* ------------------------------------------------------------ запись кадра */

  private ingestFrame(index: number, t: number, mode: IngestMode): void {
    const entry = this.store.at(index);
    const engineState = this.engineState[index];
    if (entry === undefined || engineState === undefined) {
      return;
    }
    const values = this.values;
    const quality = this.quality;
    // Бакеты секунды открываются до записи значений: продвижение кольца освобождает слоты.
    this.store.openTime(index, t);

    const speed = goodValue(values, quality, S.speed);
    if (mode !== 'backfill') {
      engineState.stoppedSeconds = speed !== null && speed > 1 ? 0 : engineState.stoppedSeconds + 1;
      engineState.zone = this.frameZone;
    }

    this.computeDerived(entry.model.ratedPayloadKg, t, entry.latest.lastGoodAt, engineState);

    // Контекст нормативов: то, чего не видно в самих значениях.
    this.thresholdCtx.rpm = goodValue(values, quality, S.rpm);
    this.thresholdCtx.speedKmh = speed;
    this.thresholdCtx.stoppedSeconds = engineState.stoppedSeconds;
    this.thresholdCtx.cargoRatioPercent = goodValue(values, quality, S.payloadRatio);

    const rules = THRESHOLD_TABLE[entry.vehicle.modelId] ?? EMPTY_RULES;
    let worst: Severity = 3;
    let seenGood = false;
    for (let m = 0; m < STORED_METRIC_COUNT; m += 1) {
      const q = (quality[m] ?? QUALITY.NOT_AVAILABLE) as Quality;
      const value = values[m] ?? Number.NaN;
      if (!Number.isFinite(value) || q === QUALITY.NOT_AVAILABLE || q === QUALITY.COMM_ERROR) {
        this.severities[m] = 3;
        continue;
      }
      const metric = STORED_METRICS[m];
      if (metric === undefined) {
        continue;
      }
      const resolved = pickRule(rules[m] ?? null, this.thresholdCtx);
      const severity: Severity =
        resolved === null || resolved.excludeFromSeverity ? 0 : zoneSeverity(resolved.zones, value);
      this.severities[m] = severity;
      if (SEVERITY_RELEVANT[m] === 1 && q === QUALITY.GOOD) {
        if (resolved !== null && !resolved.excludeFromSeverity) {
          seenGood = true;
          worst = worstSeverity(worst, severity);
        }
      }
      this.store.writeSample(index, m, value, q, severity);
    }

    const pointSeverity = combinePointSeverity(worst, seenGood, [
      this.frameAlarms,
      this.frameWarnings,
      this.frameState,
    ]);

    const lat = goodValue(values, quality, S.latitude);
    const lon = goodValue(values, quality, S.longitude);
    const heading = goodValue(values, quality, S.heading) ?? 0;
    if (lat !== null && lon !== null) {
      this.store.writePosition(index, t, lat, lon, heading, pointSeverity);
      if (mode === 'live') {
        pushPosition(engineState.positions, [t, lat, lon, heading, pointSeverity]);
      }
    }

    if (mode !== 'backfill') {
      const latest = entry.latest;
      latest.t = t;
      latest.values.set(values);
      latest.quality.set(quality);
      latest.alarms = this.frameAlarms;
      latest.warnings = this.frameWarnings;
      latest.state = this.frameState;
      latest.lastGoodAt = t;
      latest.sev = pointSeverity;
      latest.stoppedSeconds = engineState.stoppedSeconds;
      latest.status = this.computeStatus(entry.model.ratedPayloadKg, engineState, true);
      if (S.vehicleStatus >= 0) {
        const code = VEHICLE_STATUS_CODES[latest.status];
        latest.values[S.vehicleStatus] = code;
        this.store.writeSample(index, S.vehicleStatus, code, QUALITY.GOOD, 0);
      }
      this.detector.observe({
        vehicleId: entry.vehicle.id,
        t,
        values,
        quality,
        severities: this.severities,
        alarms: this.frameAlarms,
        warnings: this.frameWarnings,
        state: this.frameState,
      });
    }
  }

  /** Производные показатели (раздел 6.2 `CONTEXT.md`): считает сервер, не источник. */
  private computeDerived(
    ratedPayloadKg: number,
    t: number,
    lastGoodAt: number | null,
    engineState: EngineVehicleState,
  ): void {
    const values = this.values;
    const quality = this.quality;
    const fl = goodValue(values, quality, S.brakeFl);
    const fr = goodValue(values, quality, S.brakeFr);
    const rl = goodValue(values, quality, S.brakeRl);
    const rr = goodValue(values, quality, S.brakeRr);
    const brakes = this.brakeScratch;
    brakes[0] = fl;
    brakes[1] = fr;
    brakes[2] = rl;
    brakes[3] = rr;
    setDerived(values, quality, S.brakeMax, brakeTemperatureMax(brakes), QUALITY.GOOD);
    setDerived(values, quality, S.brakeSpread, brakeTemperatureSpread(brakes), QUALITY.GOOD);

    const cargo = goodValue(values, quality, S.cargo);
    const cargoQuality = (quality[S.cargo] ?? QUALITY.NOT_AVAILABLE) as Quality;
    setDerived(values, quality, S.payloadRatio, payloadRatio(cargo, ratedPayloadKg), cargoQuality);

    const front = goodValue(values, quality, S.frontAxle);
    const rear = goodValue(values, quality, S.rearAxle);
    setDerived(
      values,
      quality,
      S.frontAxleShare,
      frontAxleShare(front, rear),
      (quality[S.frontAxle] ?? QUALITY.NOT_AVAILABLE) as Quality,
    );

    setDerived(
      values,
      quality,
      S.timeSinceData,
      timeSinceLastData(t, lastGoodAt) ?? 0,
      QUALITY.GOOD,
    );
    setDerived(
      values,
      quality,
      S.hoursToService,
      hoursToService(goodValue(values, quality, S.engineHours)),
      QUALITY.GOOD,
    );
    // Статус пишется после расчета светофора: он зависит от тех же значений.
    values[S.vehicleStatus] =
      VEHICLE_STATUS_CODES[this.computeStatus(ratedPayloadKg, engineState, true)];
    quality[S.vehicleStatus] = QUALITY.GOOD;
  }

  private computeStatus(ratedPayloadKg: number, engineState: EngineVehicleState, hasData: boolean) {
    const values = this.values;
    const quality = this.quality;
    return vehicleStatus({
      hasData,
      engineRunning:
        isStateSet(this.frameState, 'ENGINE_RUNNING') ||
        (goodValue(values, quality, S.rpm) ?? 0) > 0,
      speedKmh: goodValue(values, quality, S.speed),
      cargoMassKg: lastKnown(values, quality, S.cargo),
      ratedPayloadKg,
      bodyAngleDeg: lastKnown(values, quality, S.bodyAngle),
      zoneKind: engineState.zone,
    });
  }

  private metricSeverityAt(
    modelId: Vehicle['modelId'],
    metric: Parameters<typeof resolveThreshold>[0],
    value: number,
  ): Severity {
    const resolved = resolveThreshold(metric, { modelId }, this.thresholdCtx);
    if (resolved === null || resolved.excludeFromSeverity) {
      return 0;
    }
    return zoneSeverity(resolved.zones, value);
  }

  /* ------------------------------------------------------------ дозаливка */

  /** Записать накопленный буфер задним числом и сообщить об этом наружу. */
  private applyBackfill(batch: BackfillBatch): void {
    const entry = this.store.at(batch.vehicleIndex);
    if (entry === undefined || batch.count === 0) {
      return;
    }
    const physicalCount = METRIC_ORDER.length;
    for (let i = 0; i < batch.count; i += 1) {
      const t = batch.from + i;
      const offset = i * batch.metricCount;
      this.beginFrame(batch.vehicleIndex, t);
      for (let m = 0; m < physicalCount; m += 1) {
        this.setValue(
          m,
          batch.values[offset + m] ?? Number.NaN,
          (batch.quality[offset + m] ?? QUALITY.GOOD) as Quality,
        );
      }
      this.setFlags(batch.alarms[i] ?? 0, batch.warnings[i] ?? 0, batch.state[i] ?? 0);
      const zoneCode = batch.zone[i] ?? 0;
      this.setZone(zoneCode === 0 ? null : (PIT_ZONE_KINDS[zoneCode - 1] ?? null));
      this.ingestFrame(batch.vehicleIndex, t, 'backfill');
    }
    this.detector.replayFlags(
      entry.vehicle.id,
      batch.from,
      batch.alarms,
      batch.warnings,
      batch.count,
    );
    this.detector.observeBackfill(entry.vehicle.id, batch.from, batch.to);
    this.listener?.onBackfill(entry.vehicle.id, batch.from, batch.to);
    this.log('дозалит буфер провала связи', {
      vehicleId: entry.vehicle.id,
      seconds: batch.count,
    });
  }

  /* ------------------------------------------------------------ снапшоты */

  /** Компактный снапшот машины (раздел 5.1 `SPEC.md`). */
  snapshotOf(vehicleId: string): VehicleSnapshot | null {
    const entry = this.store.get(vehicleId);
    if (entry === undefined) {
      return null;
    }
    const latest = entry.latest;
    const simTime = this.clock.simTime;
    const age =
      latest.lastGoodAt === null ? simTime - this.historyFromValue : simTime - latest.lastGoodAt;
    const stale = age >= SERVER_RULES.noDataStatusSeconds;
    const v: (number | null)[] = new Array(METRIC_ORDER.length);
    const q: number[] = new Array(METRIC_ORDER.length);
    for (let i = 0; i < METRIC_ORDER.length; i += 1) {
      const value = latest.values[i] ?? Number.NaN;
      const quality = latest.quality[i] ?? QUALITY.NOT_AVAILABLE;
      v[i] = Number.isFinite(value) ? value : null;
      // Пока связи нет, последние значения помечаются как устаревшие.
      q[i] = stale && quality === QUALITY.GOOD ? QUALITY.STALE : quality;
    }
    return {
      id: entry.vehicle.id,
      t: latest.t,
      v,
      q: q as VehicleSnapshot['q'],
      f: [latest.alarms, latest.warnings, latest.state],
      st: stale ? 'NO_DATA' : latest.status,
      sev: stale ? 3 : latest.sev,
      age: Math.max(0, Math.round(age)),
    };
  }

  snapshots(): VehicleSnapshot[] {
    const result: VehicleSnapshot[] = [];
    for (const entry of this.store.vehicles) {
      const snapshot = this.snapshotOf(entry.vehicle.id);
      if (snapshot !== null) {
        result.push(snapshot);
      }
    }
    return result;
  }

  /** Точки позиции, накопленные с прошлого тика. Буферы очищаются. */
  drainPositions(): Map<string, TrackPoint[]> {
    const result = new Map<string, TrackPoint[]>();
    for (let i = 0; i < this.store.count; i += 1) {
      const entry = this.store.at(i);
      const state = this.engineState[i];
      if (entry === undefined || state === undefined) {
        continue;
      }
      if (state.positions.length === 0) {
        result.set(entry.vehicle.id, EMPTY_POSITIONS);
        continue;
      }
      result.set(entry.vehicle.id, state.positions.slice());
      state.positions.length = 0;
    }
    return result;
  }

  /** Метрики для `/api/health`. */
  health(): Record<string, unknown> {
    const metrics = this.clock.metrics();
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    return {
      status: 'ok',
      uptimeSeconds: Math.round((Date.now() - this.startedAtReal) / 1000),
      vehicles: this.store.count,
      simTime: metrics.simTime,
      historyFrom: this.historyFromValue,
      timeScale: this.clock.timeScale,
      chaos: this.chaos,
      clock: {
        lagSeconds: Math.round(metrics.lagSeconds * 100) / 100,
        maxLagSeconds: Math.round(metrics.maxLagSeconds * 100) / 100,
        stepsDone: metrics.stepsDone,
        load: Math.round(metrics.load * 1000) / 1000,
        stepMsTotal: Math.round(metrics.stepMsTotal * 1000) / 1000,
        timedSteps: metrics.timedSteps,
      },
      // Процессорное время процесса с запуска, микросекунды: замер делит приращение на интервал.
      cpu: { userMicros: cpu.user, systemMicros: cpu.system },
      memory: {
        storeBytes: this.store.byteLength(),
        heapUsedBytes: memory.heapUsed,
        rssBytes: memory.rss,
        externalBytes: memory.external,
        arrayBuffersBytes: memory.arrayBuffers,
      },
      events: this.journal.size,
    };
  }
}

/** Сколько виртуальных секунд генерируется за один проход фоновой предыстории. */
const HISTORY_CHUNK_SECONDS = 300;

/** Сколько миллисекунд подряд фоновая предыстория занимает цикл событий. */
const HISTORY_BUDGET_MS = 25;

const EMPTY_POSITIONS: TrackPoint[] = [];

const EMPTY_RULES: (CompiledThresholds | null)[] = [];

function createVehicleState(): EngineVehicleState {
  return { stoppedSeconds: 0, zone: null, positions: [] };
}

function clampVehicleCount(count: number): number {
  return Math.min(Math.max(Math.trunc(count), MIN_VEHICLES), MAX_VEHICLES);
}

/** Значение, если оно годное; иначе null. */
function goodValue(values: Float64Array, quality: Uint8Array, index: number): number | null {
  if (index < 0) {
    return null;
  }
  const q = quality[index] ?? QUALITY.NOT_AVAILABLE;
  if (q !== QUALITY.GOOD) {
    return null;
  }
  const value = values[index] ?? Number.NaN;
  return Number.isFinite(value) ? value : null;
}

/** Последнее известное значение: годится и устаревшее (показатель 0,2 Гц между обновлениями). */
function lastKnown(values: Float64Array, quality: Uint8Array, index: number): number | null {
  if (index < 0) {
    return null;
  }
  const q = quality[index] ?? QUALITY.NOT_AVAILABLE;
  if (q !== QUALITY.GOOD && q !== QUALITY.STALE) {
    return null;
  }
  const value = values[index] ?? Number.NaN;
  return Number.isFinite(value) ? value : null;
}

function setDerived(
  values: Float64Array,
  quality: Uint8Array,
  index: number,
  value: number | null,
  inheritedQuality: Quality,
): void {
  if (index < 0) {
    return;
  }
  if (value === null || !Number.isFinite(value)) {
    values[index] = Number.NaN;
    quality[index] = QUALITY.NOT_AVAILABLE;
    return;
  }
  values[index] = value;
  quality[index] = inheritedQuality;
}

/** Точки позиции в тике ограничены: при переполнении прореживаются равномерно. */
function pushPosition(buffer: TrackPoint[], point: TrackPoint): void {
  buffer.push(point);
  if (buffer.length <= SERVER_RULES.maxTickPositions) {
    return;
  }
  for (let i = 1; i < buffer.length; i += 2) {
    buffer.splice(i, 1);
  }
}
