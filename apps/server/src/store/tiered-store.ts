/**
 * Хранилище телеметрии в памяти: на каждую машину три уровня показателей, кольцо позиций
 * и последнее состояние для компактного снапшота.
 *
 * Хранилище ничего не знает о том, откуда приходят данные: его вызывает движок симуляции,
 * получая кадры от `TelemetrySource`.
 */

import {
  METRICS,
  QUALITY,
  type Quality,
  type Severity,
  VEHICLE_MODELS,
  type Vehicle,
  type VehicleModel,
  type VehicleStatus,
} from '@ra/contracts';
import { emptyPositionSample, PositionRing, type PositionSample } from './position-store.js';
import {
  type BucketView,
  emptyBucketView,
  type StoreTier,
  TIERS,
  VehicleTiers,
} from './ring-buffer.js';
import { STORED_METRIC_COUNT, STORED_METRICS } from './stored-metrics.js';

/** Последнее известное состояние машины: основа снапшота REST и websocket. */
export interface LatestState {
  /** Время последнего принятого кадра (в том числе кадра без данных). */
  t: number;
  /** Значения в порядке `STORED_METRICS`. */
  values: Float64Array;
  quality: Uint8Array;
  alarms: number;
  warnings: number;
  state: number;
  /** Время последней точки с качеством GOOD или null. */
  lastGoodAt: number | null;
  status: VehicleStatus;
  sev: Severity;
  /** Сколько секунд машина стоит: нужно контекстным нормативам тормозов. */
  stoppedSeconds: number;
}

export interface StoredVehicle {
  vehicle: Vehicle;
  model: VehicleModel;
  tiers: VehicleTiers;
  positions: PositionRing;
  latest: LatestState;
}

function createLatest(): LatestState {
  const values = new Float64Array(STORED_METRIC_COUNT);
  values.fill(Number.NaN);
  const quality = new Uint8Array(STORED_METRIC_COUNT);
  quality.fill(QUALITY.NOT_AVAILABLE);
  return {
    t: 0,
    values,
    quality,
    alarms: 0,
    warnings: 0,
    state: 0,
    lastGoodAt: null,
    status: 'NO_DATA',
    sev: 3,
    stoppedSeconds: 0,
  };
}

/** Способ свертки в бакет по реестру показателей - берется один раз при старте. */
const AGGREGATIONS = STORED_METRICS.map((id) => METRICS[id].aggregation);

export class TelemetryStore {
  private readonly byId = new Map<string, StoredVehicle>();
  private order: StoredVehicle[] = [];

  /** Привести состав хранилища к переданному парку. История существующих машин сохраняется. */
  setVehicles(vehicles: Vehicle[]): { added: Vehicle[]; removed: string[] } {
    const added: Vehicle[] = [];
    const keep = new Set<string>();
    for (const vehicle of vehicles) {
      keep.add(vehicle.id);
      if (!this.byId.has(vehicle.id)) {
        this.byId.set(vehicle.id, {
          vehicle,
          model: VEHICLE_MODELS[vehicle.modelId],
          tiers: new VehicleTiers(),
          positions: new PositionRing(),
          latest: createLatest(),
        });
        added.push(vehicle);
      }
    }
    const removed: string[] = [];
    for (const id of this.byId.keys()) {
      if (!keep.has(id)) {
        removed.push(id);
      }
    }
    for (const id of removed) {
      this.byId.delete(id);
    }
    this.order = vehicles
      .map((vehicle) => this.byId.get(vehicle.id))
      .filter((entry): entry is StoredVehicle => entry !== undefined);
    return { added, removed };
  }

  get vehicles(): StoredVehicle[] {
    return this.order;
  }

  get count(): number {
    return this.order.length;
  }

  at(index: number): StoredVehicle | undefined {
    return this.order[index];
  }

  get(id: string): StoredVehicle | undefined {
    return this.byId.get(id);
  }

  require(id: string): StoredVehicle {
    const entry = this.byId.get(id);
    if (entry === undefined) {
      throw new Error(`машина не найдена: ${id}`);
    }
    return entry;
  }

  /** Идентификаторы в порядке парка. */
  ids(): string[] {
    return this.order.map((entry) => entry.vehicle.id);
  }

  /** Открыть бакеты машины на секунду: делается до записи значений этой секунды. */
  openTime(index: number, timeSec: number): void {
    const entry = this.order[index];
    if (entry === undefined) {
      return;
    }
    entry.tiers.openTime(timeSec);
    entry.positions.advance(timeSec);
  }

  /** Записать значение в открытую секунду машины: до этого вызывается `openTime`. */
  writeSample(
    index: number,
    metricIndex: number,
    value: number,
    quality: Quality,
    sev: Severity,
  ): void {
    this.order[index]?.tiers.write(
      metricIndex,
      value,
      quality,
      sev,
      AGGREGATIONS[metricIndex] ?? 'avg',
    );
  }

  writePosition(
    index: number,
    timeSec: number,
    lat: number,
    lon: number,
    heading: number,
    sev: Severity,
  ): void {
    this.order[index]?.positions.write(timeSec, lat, lon, heading, sev);
  }

  /** Суммарный объем буферов, байты: идет в `/api/health`. */
  byteLength(): number {
    let total = 0;
    for (const entry of this.order) {
      total += entry.tiers.byteLength() + entry.positions.byteLength();
    }
    return total;
  }
}

export type { BucketView, PositionSample, StoreTier };
export { emptyBucketView, emptyPositionSample, STORED_METRIC_COUNT, STORED_METRICS, TIERS };
