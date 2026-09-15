/**
 * Симулятор телеметрии парка карьерных самосвалов (этап 5): заменяет заглушку этапа 1
 * через интерфейс `TelemetrySource`.
 *
 * Цель - правдоподобная картинка, а не физическая модель машины: у каждого показателя есть
 * цель в текущем режиме работы, к которой значение идет с инерцией, плюс медленный дрейф,
 * быстрый шум и "характер машины". Аварии - сценарии, меняющие цели, а не значения в кадре.
 *
 * Почему TypeScript внутри сервера, а не отдельный симулятор на Python:
 * - сервер вызывает источник синхронно на каждую виртуальную секунду; при 60 машинах и
 *   скорости x60 это около 80 тысяч значений в секунду, и межпроцессное взаимодействие
 *   добавило бы и задержку, и второй рантайм в образ;
 * - справочники, нормативы и геометрия маршрутов лежат в `@ra/contracts`; реализация на другом
 *   языке потребовала бы их дублирования, а расхождение справочников - ровно та проблема,
 *   ради которой контракты вынесены в отдельный пакет;
 * - управление симуляцией (число машин, скорость времени, мера хаоса) работает на лету и
 *   трогает внутреннее состояние источника.
 * Python уместен для офлайн-генерации готового набора данных, который сервер только
 * проигрывает, - но это лишает дашборд управляемой симуляции.
 */

import {
  type ChaosLevel,
  generateFleet,
  METRIC_ORDER,
  PIT_ZONE_KINDS,
  type PitZoneKind,
  type Quality,
  type Vehicle,
} from '@ra/contracts';
import type {
  BackfillBatch,
  SnapshotWriter,
  SourceInitOptions,
  TelemetrySource,
} from '../source.js';
import { type ChaosProfile, chaosProfile } from './chaos-profile.js';
import type { RouteGeometry } from './route-geometry.js';
import { SCENARIO_COUNT } from './scenarios.js';
import { FRAME_EMIT, type FrameBuffers, VehicleSim } from './vehicle.js';

const METRIC_COUNT = METRIC_ORDER.length;

export interface TelemetrySimulatorOptions {
  /** Запускать ли сценарии отклонений. Выключаются тестом фона хаоса. */
  scenarios?: boolean;
  /** Подменить маршрут всем машинам (тесты на синтетической полилинии). */
  route?: RouteGeometry;
}

const EMPTY_BACKFILL: BackfillBatch[] = [];

export class TelemetrySimulator implements TelemetrySource {
  private vehicles: VehicleSim[] = [];
  private seed = 0;
  private profile: ChaosProfile = chaosProfile('NORMAL');
  private readonly scenarios: boolean;
  private readonly route: RouteGeometry | undefined;
  private readonly frame: FrameBuffers = {
    values: new Float64Array(METRIC_COUNT),
    quality: new Uint8Array(METRIC_COUNT),
  };
  private readonly pending: BackfillBatch[] = [];

  constructor(options: TelemetrySimulatorOptions = {}) {
    this.scenarios = options.scenarios ?? true;
    this.route = options.route;
  }

  init(options: SourceInitOptions): void {
    this.seed = options.seed;
    this.vehicles = options.vehicles.map((vehicle) => this.createVehicle(vehicle));
    this.pending.length = 0;
  }

  setVehicleCount(count: number): void {
    const fleet = generateFleet(count, this.seed);
    if (fleet.length < this.vehicles.length) {
      this.vehicles.length = fleet.length;
      return;
    }
    // Новые машины инициализируются на первом шаге своей предыстории.
    for (let i = this.vehicles.length; i < fleet.length; i += 1) {
      const vehicle = fleet[i];
      if (vehicle !== undefined) {
        this.vehicles.push(this.createVehicle(vehicle));
      }
    }
  }

  /** Коэффициенты уровня действуют сразу; смещения машин и цели переходят плавно. */
  setChaos(level: ChaosLevel): void {
    this.profile = chaosProfile(level);
  }

  step(simTimeSec: number, writer: SnapshotWriter): void {
    for (let i = 0; i < this.vehicles.length; i += 1) {
      this.advance(i, simTimeSec, writer, true);
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
        this.advance(index, t, writer, false);
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

  get vehicleCount(): number {
    return this.vehicles.length;
  }

  /** Сколько раз стартовал каждый сценарий по всему парку. */
  scenarioStarts(): number[] {
    const totals = new Array<number>(SCENARIO_COUNT).fill(0);
    for (const vehicle of this.vehicles) {
      for (let i = 0; i < SCENARIO_COUNT; i += 1) {
        totals[i] = (totals[i] ?? 0) + (vehicle.scenarioStarts[i] ?? 0);
      }
    }
    return totals;
  }

  /** Завершенные разгрузки по машинам. */
  tripsByVehicle(): number[] {
    return this.vehicles.map((vehicle) => vehicle.trips);
  }

  private createVehicle(vehicle: Vehicle): VehicleSim {
    return new VehicleSim(
      vehicle,
      this.seed,
      this.route === undefined ? {} : { route: this.route },
    );
  }

  private advance(index: number, t: number, writer: SnapshotWriter, live: boolean): void {
    const vehicle = this.vehicles[index];
    if (vehicle === undefined) {
      return;
    }
    const frame = this.frame;
    const result = vehicle.advance(t, this.profile, live, this.scenarios, frame);
    const completed = vehicle.completedBuffer;
    if (completed !== null) {
      vehicle.completedBuffer = null;
      completed.vehicleIndex = index;
      this.pending.push(completed);
    }
    if (result !== FRAME_EMIT) {
      writer.skipFrame(index, t);
      return;
    }
    writer.beginFrame(index, t);
    for (let m = 0; m < METRIC_COUNT; m += 1) {
      writer.setValue(m, frame.values[m] ?? 0, (frame.quality[m] ?? 0) as Quality);
    }
    writer.setFlags(vehicle.alarms, vehicle.warnings, vehicle.state);
    const zone = vehicle.zoneCode();
    writer.setZone(zone === 0 ? null : ((PIT_ZONE_KINDS[zone - 1] ?? null) as PitZoneKind | null));
    writer.commitFrame();
  }
}
