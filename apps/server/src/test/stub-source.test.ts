/** Детерминизм заглушки и правдоподобие значений. */

import {
  generateFleet,
  METRIC_INDEX,
  METRIC_ORDER,
  metricSeverity,
  PIT_BOUNDS,
  type Quality,
  VEHICLE_MODELS,
} from '@ra/contracts';
import { describe, expect, it } from 'vitest';
import type { SnapshotWriter } from '../sim/source.js';
import { StubTelemetrySource } from '../sim/stub-source.js';

const T0 = 1_700_000_000;

/** Записывает все кадры в плоский массив: с ним удобно сравнивать прогоны. */
class RecordingWriter implements SnapshotWriter {
  readonly frames: { index: number; t: number; values: number[]; quality: number[] }[] = [];
  readonly skipped: { index: number; t: number }[] = [];
  private current: { index: number; t: number; values: number[]; quality: number[] } | null = null;

  beginFrame(vehicleIndex: number, simTimeSec: number): void {
    this.current = {
      index: vehicleIndex,
      t: simTimeSec,
      values: new Array(METRIC_ORDER.length).fill(Number.NaN),
      quality: new Array(METRIC_ORDER.length).fill(3),
    };
  }

  setValue(metricIndex: number, value: number, quality: Quality): void {
    if (this.current === null) {
      return;
    }
    this.current.values[metricIndex] = value;
    this.current.quality[metricIndex] = quality;
  }

  setMissing(metricIndex: number, quality: Quality): void {
    if (this.current !== null) {
      this.current.quality[metricIndex] = quality;
    }
  }

  setFlags(): void {}
  setZone(): void {}

  commitFrame(): void {
    if (this.current !== null) {
      this.frames.push(this.current);
      this.current = null;
    }
  }

  skipFrame(vehicleIndex: number, simTimeSec: number): void {
    this.skipped.push({ index: vehicleIndex, t: simTimeSec });
  }
}

function run(seed: number, seconds: number, vehicleCount = 3): RecordingWriter {
  const vehicles = generateFleet(vehicleCount, seed);
  const source = new StubTelemetrySource();
  source.init({ vehicles, seed, startTime: T0, historySeconds: seconds });
  const writer = new RecordingWriter();
  source.generateHistory(
    vehicles.map((_, index) => index),
    T0 - seconds,
    T0,
    writer,
  );
  return writer;
}

describe('детерминизм заглушки', () => {
  it('одинаковый seed дает одинаковый прогон', () => {
    const a = run(42, 600);
    const b = run(42, 600);
    expect(a.frames.length).toBe(b.frames.length);
    expect(a.frames.length).toBeGreaterThan(0);
    expect(a.frames).toEqual(b.frames);
  });

  it('разный seed дает разный прогон', () => {
    const a = run(42, 600);
    const b = run(43, 600);
    expect(a.frames).not.toEqual(b.frames);
  });

  it('состояние машины не зависит от числа машин в парке: seed привязан к машине', () => {
    const small = run(7, 300, 3);
    const large = run(7, 300, 12);
    const firstOfSmall = small.frames.filter((frame) => frame.index === 0);
    const firstOfLarge = large.frames.filter((frame) => frame.index === 0);
    expect(firstOfSmall).toEqual(firstOfLarge);
  });
});

describe('правдоподобие значений', () => {
  const writer = run(11, 3600);
  const frames = writer.frames.filter((frame) => frame.index === 0);
  const vehicle = generateFleet(3, 11)[0];
  const model = VEHICLE_MODELS[vehicle?.modelId ?? 'BELAZ_75131'];

  // Границы берутся из контрактов, а не переписываются числами: выверка координат карьера
  // на этапе 3 сдвинула объект, и тест с зашитыми числами такую правку не переживает.
  it('координаты остаются в границах карьера', () => {
    const [[south, west], [north, east]] = PIT_BOUNDS;
    for (const frame of frames) {
      expect(frame.values[METRIC_INDEX.POSITION_LATITUDE]).toBeGreaterThan(south);
      expect(frame.values[METRIC_INDEX.POSITION_LATITUDE]).toBeLessThan(north);
      expect(frame.values[METRIC_INDEX.POSITION_LONGITUDE]).toBeGreaterThan(west);
      expect(frame.values[METRIC_INDEX.POSITION_LONGITUDE]).toBeLessThan(east);
    }
  });

  it('машина не едет быстрее паспортной скорости и не едет назад', () => {
    for (const frame of frames) {
      const speed = frame.values[METRIC_INDEX.POSITION_SPEED] ?? 0;
      expect(speed).toBeGreaterThanOrEqual(0);
      expect(speed).toBeLessThanOrEqual(model.maxSpeedKmh);
    }
  });

  it('счетчики наработки и расхода монотонны', () => {
    let hours = -1;
    let fuel = -1;
    for (const frame of frames) {
      const nextHours = frame.values[METRIC_INDEX.ENGINE_HOURS] ?? 0;
      const nextFuel = frame.values[METRIC_INDEX.FUEL_TOTAL_CONSUMPTION] ?? 0;
      expect(nextHours).toBeGreaterThanOrEqual(hours);
      expect(nextFuel).toBeGreaterThanOrEqual(fuel);
      hours = nextHours;
      fuel = nextFuel;
    }
  });

  it('показатели с частотой 0,2 Гц обновляются раз в пять секунд, между ними STALE', () => {
    const fresh = frames.filter((frame) => frame.quality[METRIC_INDEX.FUEL_LEVEL] === 0).length;
    const stale = frames.filter((frame) => frame.quality[METRIC_INDEX.FUEL_LEVEL] === 4).length;
    expect(stale).toBeGreaterThan(fresh * 3);
    expect(fresh).toBeGreaterThan(frames.length / 6);
  });

  it('обычная работа идет в зеленой зоне: отклонения - исключение, а не норма', () => {
    const rpm = frames.map((frame) => frame.values[METRIC_INDEX.ENGINE_RPM] ?? 0);
    const bad = rpm.filter(
      (value) => metricSeverity('ENGINE_RPM', value, vehicle ?? { modelId: 'BELAZ_75131' }) > 0,
    );
    expect(bad.length).toBe(0);
  });
});
