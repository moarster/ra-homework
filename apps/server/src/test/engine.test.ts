/** Движок целиком: предыстория, снапшоты, серии, изменение параметров симуляции. */

import {
  codesToFlags,
  METRIC_ORDER,
  MIN_VEHICLES,
  PIT_CENTER,
  QUALITY,
  SYSTEM_STATE,
} from '@ra/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { SimEngine } from '../sim/engine.js';
import type { BackfillBatch, SnapshotWriter, TelemetrySource } from '../sim/source.js';
import { querySeries } from '../store/query.js';

const HISTORY_SECONDS = 1200;

const ENGINE_RUNNING = codesToFlags(['IGNITION_ON', 'ENGINE_RUNNING'], SYSTEM_STATE);

function createEngine(): SimEngine {
  const engine = new SimEngine({
    seed: 5,
    vehicleCount: MIN_VEHICLES,
    historySeconds: HISTORY_SECONDS,
  });
  engine.start();
  engine.clock.stop();
  return engine;
}

let engine: SimEngine | null = null;

afterEach(() => {
  engine?.stop();
  engine = null;
});

describe('предыстория при старте', () => {
  it('парк из трех машин сразу имеет снапшоты с правдоподобными значениями', () => {
    engine = createEngine();
    const snapshots = engine.snapshots();
    expect(snapshots.length).toBe(MIN_VEHICLES);
    for (const snapshot of snapshots) {
      expect(snapshot.v.length).toBe(23);
      expect(snapshot.q.length).toBe(23);
      expect(snapshot.age).toBeLessThan(60);
      expect(['HAULING', 'RETURNING', 'LOADING', 'UNLOADING', 'IDLING', 'PARKED']).toContain(
        snapshot.st,
      );
    }
  });

  it('история за весь период предыстории доступна сериями', () => {
    engine = createEngine();
    const to = engine.simTime;
    const response = querySeries(engine.store, {
      vehicleIds: ['v-12'],
      metrics: ['ENGINE_COOLANT_TEMPERATURE'],
      from: to - HISTORY_SECONDS,
      to,
      maxPoints: 1000,
    });
    const series = response.series[0];
    const filled = series?.count.filter((count) => count > 0).length ?? 0;
    // Часть точек может отсутствовать из-за провалов связи, но большая часть периода есть.
    expect(filled).toBeGreaterThan((series?.count.length ?? 0) * 0.5);
  });

  it('производные показатели считает сервер: они есть в сериях', () => {
    engine = createEngine();
    const to = engine.simTime;
    const response = querySeries(engine.store, {
      vehicleIds: ['v-12'],
      metrics: ['BRAKE_TEMPERATURE_MAX', 'PAYLOAD_RATIO', 'VEHICLE_STATUS'],
      from: to - 600,
      to,
      maxPoints: 600,
    });
    expect(response.series.length).toBe(3);
    for (const series of response.series) {
      expect(series.count.some((count) => count > 0)).toBe(true);
    }
  });
});

describe('изменение параметров симуляции', () => {
  it('смена скорости времени не рвет историю', () => {
    engine = createEngine();
    const before = querySeries(engine.store, {
      vehicleIds: ['v-12'],
      metrics: ['ENGINE_RPM'],
      from: engine.simTime - 600,
      to: engine.simTime,
      maxPoints: 600,
    });
    engine.patch({ timeScale: 60 });
    const after = querySeries(engine.store, {
      vehicleIds: ['v-12'],
      metrics: ['ENGINE_RPM'],
      from: engine.simTime - 600,
      to: engine.simTime,
      maxPoints: 600,
    });
    expect(engine.simState().timeScale).toBe(60);
    expect(after.series[0]?.count).toEqual(before.series[0]?.count);
  });

  it('недопустимая скорость времени отклоняется', () => {
    engine = createEngine();
    expect(() => engine?.patch({ timeScale: 7 })).toThrow();
  });

  it('увеличение парка сохраняет историю существующих машин', () => {
    engine = createEngine();
    const before = engine.snapshotOf('v-12');
    engine.patch({ vehicleCount: 6 });
    expect(engine.store.count).toBe(6);
    expect(engine.snapshotOf('v-12')).toEqual(before);
    expect(engine.store.get('v-12')?.tiers.window('m1')).not.toBeNull();
  });

  it('уменьшение парка сразу после увеличения не оставляет часы остановленными', async () => {
    engine = createEngine();
    engine.clock.start();
    engine.patch({ vehicleCount: 8 });
    // Часы остановлены на время фоновой генерации предыстории новых машин.
    expect(engine.simState().running).toBe(false);
    engine.patch({ vehicleCount: MIN_VEHICLES });
    expect(engine.simState().running).toBe(true);
    // Снятая генерация не должна ожить на следующем проходе цикла событий.
    await new Promise((resolve) => setImmediate(resolve));
    expect(engine.simState().running).toBe(true);
    expect(engine.store.count).toBe(MIN_VEHICLES);
  });

  it('уменьшение парка убирает машины из хранилища и журнала', () => {
    engine = createEngine();
    engine.patch({ vehicleCount: 6 });
    engine.patch({ vehicleCount: MIN_VEHICLES });
    expect(engine.store.count).toBe(MIN_VEHICLES);
    expect(engine.store.ids()).toEqual(['v-12', 'v-07', 'v-21']);
  });
});

describe('провал связи и дозаливка', () => {
  it('во время провала связи данных нет, после дозаливки дыра закрывается', () => {
    // Источник под управлением теста: провал связи задан явно, а не выпадает случайно.
    const source = new GapSource();
    engine = new SimEngine({
      seed: 3,
      vehicleCount: MIN_VEHICLES,
      historySeconds: 60,
      source,
    });
    engine.start();
    engine.clock.stop();
    const active = engine;
    const backfills: { vehicleId: string; from: number; to: number }[] = [];
    active.listener = {
      onEvents: () => {},
      onSim: () => {},
      onBackfill: (vehicleId, from, to) => {
        backfills.push({ vehicleId, from, to });
      },
      onBatch: () => {},
    };

    const gapFrom = active.simTime + 10;
    source.planGap(gapFrom, gapFrom + 120);
    active.clock.advance(10);
    // Провал идет 120 секунд: последний шаг остается внутри него.
    active.clock.advance(119);

    const during = querySeries(active.store, {
      vehicleIds: ['v-12'],
      metrics: ['ENGINE_RPM'],
      from: gapFrom,
      to: gapFrom + 120,
      maxPoints: 5000,
    });
    // Дыра: значений нет, интерполяции нет.
    expect(during.series[0]?.count.every((count) => count === 0)).toBe(true);
    expect(during.series[0]?.avg.every((value) => value === null)).toBe(true);

    // Еще один шаг: связь вернулась, буфер дозаливается.
    active.clock.advance(2);
    expect(backfills.length).toBe(MIN_VEHICLES);
    const after = querySeries(active.store, {
      vehicleIds: ['v-12'],
      metrics: ['ENGINE_RPM'],
      from: gapFrom,
      to: gapFrom + 120,
      maxPoints: 5000,
    });
    expect(after.series[0]?.count.filter((count) => count > 0).length).toBe(120);
    const backfilled = active.journal
      .query({ from: gapFrom, to: active.simTime, limit: 100 })
      .filter((event) => event.code === 'DATA_BACKFILLED');
    expect(backfilled.length).toBe(MIN_VEHICLES);
  });
});

/**
 * Источник телеметрии для теста дозаливки: обычные кадры с постоянными значениями,
 * заданный провал связи и накопленный за него буфер.
 */
class GapSource implements TelemetrySource {
  private vehicleCount = 0;
  private gapFrom = Number.POSITIVE_INFINITY;
  private gapTo = Number.POSITIVE_INFINITY;
  private buffered: BackfillBatch[] = [];
  private readonly pending = new Map<number, BackfillBatch>();

  init(options: { vehicles: { id: string }[] }): void {
    this.vehicleCount = options.vehicles.length;
  }

  setVehicleCount(count: number): void {
    this.vehicleCount = count;
  }

  setChaos(): void {}

  planGap(from: number, to: number): void {
    this.gapFrom = from;
    this.gapTo = to;
    this.pending.clear();
  }

  generateHistory(indexes: number[], from: number, to: number, writer: SnapshotWriter): void {
    for (let t = from; t < to; t += 1) {
      for (const index of indexes) {
        this.emit(index, t, writer);
      }
    }
  }

  step(simTimeSec: number, writer: SnapshotWriter): void {
    for (let index = 0; index < this.vehicleCount; index += 1) {
      if (simTimeSec >= this.gapFrom && simTimeSec < this.gapTo) {
        this.buffer(index, simTimeSec);
        writer.skipFrame(index, simTimeSec);
        continue;
      }
      if (simTimeSec >= this.gapTo && this.pending.size > 0) {
        this.flush();
      }
      this.emit(index, simTimeSec, writer);
    }
  }

  drainBackfill(): BackfillBatch[] {
    const batches = this.buffered;
    this.buffered = [];
    return batches;
  }

  private emit(index: number, t: number, writer: SnapshotWriter): void {
    writer.beginFrame(index, t);
    for (let m = 0; m < METRIC_ORDER.length; m += 1) {
      writer.setValue(m, VALUES[m] ?? 0, QUALITY.GOOD);
    }
    writer.setFlags(0, 0, ENGINE_RUNNING);
    writer.setZone(null);
    writer.commitFrame();
  }

  /** Кадр провала кладется в буфер машины: колоночно, как это делает заглушка. */
  private buffer(index: number, t: number): void {
    let batch = this.pending.get(index);
    if (batch === undefined) {
      const count = this.gapTo - this.gapFrom;
      batch = {
        vehicleId: `index-${index}`,
        vehicleIndex: index,
        from: t,
        to: t,
        count: 0,
        metricCount: METRIC_ORDER.length,
        values: new Float32Array(count * METRIC_ORDER.length),
        quality: new Uint8Array(count * METRIC_ORDER.length),
        alarms: new Uint16Array(count),
        warnings: new Uint16Array(count),
        state: new Uint16Array(count),
        zone: new Int8Array(count),
      };
      this.pending.set(index, batch);
    }
    const offset = batch.count * METRIC_ORDER.length;
    for (let m = 0; m < METRIC_ORDER.length; m += 1) {
      batch.values[offset + m] = VALUES[m] ?? 0;
      batch.quality[offset + m] = QUALITY.GOOD;
    }
    batch.state[batch.count] = ENGINE_RUNNING;
    batch.to = t;
    batch.count += 1;
  }

  private flush(): void {
    for (const batch of this.pending.values()) {
      this.buffered.push(batch);
    }
    this.pending.clear();
  }
}

/** Постоянные значения кадра: все в зеленой зоне, машина едет груженой. */
const VALUES: number[] = METRIC_ORDER.map((metric) => {
  switch (metric) {
    case 'ENGINE_RPM':
      return 1400;
    case 'ENGINE_COOLANT_TEMPERATURE':
      return 88;
    case 'ENGINE_OIL_PRESSURE':
      return 3.6;
    case 'ENGINE_OIL_TEMPERATURE':
      return 98;
    case 'ENGINE_HOURS':
      return 1000;
    case 'TRANSMISSION_OIL_TEMPERATURE':
      return 95;
    case 'TRANSMISSION_SYSTEM_PRESSURE':
      return 14.5;
    case 'FUEL_LEVEL':
      return 70;
    case 'CARGO_MASS':
      return 130_000;
    case 'FRONT_AXLE_LOAD':
      return 236_000 * 0.33;
    case 'REAR_AXLE_LOAD':
      return 236_000 * 0.67;
    case 'POSITION_SPEED':
      return 18;
    case 'POSITION_LATITUDE':
      return PIT_CENTER[0];
    case 'POSITION_LONGITUDE':
      return PIT_CENTER[1];
    default:
      return 0;
  }
});
