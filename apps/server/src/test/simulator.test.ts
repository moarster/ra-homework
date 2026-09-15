/** Симулятор телеметрии: детерминизм, коридор, правдоподобие, сценарии, хаос, дозаливка. */

import {
  type ChaosLevel,
  generateFleet,
  METRIC_INDEX,
  METRIC_ORDER,
  metricSeverity,
  PIT_ROUTES,
  QUALITY,
  type Quality,
  SYSTEM_STATE,
  type Vehicle,
} from '@ra/contracts';
import { describe, expect, it } from 'vitest';
import { chaosProfile } from '../sim/simulator/chaos-profile.js';
import { SIM_PARAMS } from '../sim/simulator/params.js';
import {
  buildRouteGeometry,
  distanceToRoute,
  halfWidthAt,
  type RouteGeometry,
  toLocalX,
  toLocalY,
} from '../sim/simulator/route-geometry.js';
import { MANDATORY_SCENARIOS, SCENARIO_CODES } from '../sim/simulator/scenarios.js';
import { SITE_UTC_OFFSET_SECONDS } from '../sim/simulator/shift.js';
import { TelemetrySimulator } from '../sim/simulator/telemetry-simulator.js';
import type { BackfillBatch, SnapshotWriter } from '../sim/source.js';

const METRIC_COUNT = METRIC_ORDER.length;
const M = METRIC_INDEX;

/** 09:00 по времени объекта: после пересменки, до обеда - двухчасовое окно без перерывов. */
const T0 = Math.floor(Date.UTC(2026, 8, 14, 9, 0, 0) / 1000) - SITE_UTC_OFFSET_SECONDS;

const BIT_REFUELING = 1 << (SYSTEM_STATE.find((flag) => flag.code === 'REFUELING')?.bit ?? 0);

interface Frame {
  index: number;
  t: number;
  values: Float64Array;
  quality: Uint8Array;
  alarms: number;
  warnings: number;
  state: number;
}

/** Писатель, отдающий каждый кадр обработчику; буферы кадра переиспользуются. */
class VisitorWriter implements SnapshotWriter {
  private readonly frame: Frame = {
    index: 0,
    t: 0,
    values: new Float64Array(METRIC_COUNT),
    quality: new Uint8Array(METRIC_COUNT),
    alarms: 0,
    warnings: 0,
    state: 0,
  };

  constructor(
    private readonly onFrame: (frame: Frame) => void,
    private readonly onSkip: (index: number, t: number) => void = () => {},
  ) {}

  beginFrame(vehicleIndex: number, simTimeSec: number): void {
    this.frame.index = vehicleIndex;
    this.frame.t = simTimeSec;
    this.frame.values.fill(Number.NaN);
    this.frame.quality.fill(QUALITY.NOT_AVAILABLE);
  }

  setValue(metricIndex: number, value: number, quality: Quality): void {
    this.frame.values[metricIndex] = value;
    this.frame.quality[metricIndex] = quality;
  }

  setMissing(metricIndex: number, quality: Quality): void {
    this.frame.quality[metricIndex] = quality;
  }

  setFlags(alarms: number, warnings: number, state: number): void {
    this.frame.alarms = alarms;
    this.frame.warnings = warnings;
    this.frame.state = state;
  }

  setZone(): void {}

  commitFrame(): void {
    this.onFrame(this.frame);
  }

  skipFrame(vehicleIndex: number, simTimeSec: number): void {
    this.onSkip(vehicleIndex, simTimeSec);
  }
}

interface RunOptions {
  seed: number;
  vehicles: number;
  seconds: number;
  chaos: ChaosLevel;
  scenarios?: boolean;
  route?: RouteGeometry;
  /** Шагами реального времени (с буферами провалов связи), а не предысторией. */
  live?: boolean;
  onFrame?: (frame: Frame) => void;
  onSkip?: (index: number, t: number) => void;
  onBackfill?: (batch: BackfillBatch) => void;
}

function run(options: RunOptions): { sim: TelemetrySimulator; fleet: Vehicle[] } {
  const fleet = generateFleet(options.vehicles, options.seed);
  const sim = new TelemetrySimulator({
    scenarios: options.scenarios ?? true,
    ...(options.route === undefined ? {} : { route: options.route }),
  });
  sim.init({ vehicles: fleet, seed: options.seed, startTime: T0, historySeconds: 0 });
  sim.setChaos(options.chaos);
  const writer = new VisitorWriter(options.onFrame ?? (() => {}), options.onSkip);
  if (options.live) {
    for (let t = T0; t < T0 + options.seconds; t += 1) {
      sim.step(t, writer);
      for (const batch of sim.drainBackfill()) {
        options.onBackfill?.(batch);
      }
    }
  } else {
    sim.generateHistory(
      fleet.map((_, index) => index),
      T0,
      T0 + options.seconds,
      writer,
    );
  }
  return { sim, fleet };
}

/** Снимок кадров в плоский массив: удобно сравнивать прогоны целиком. */
function record(options: RunOptions): { frames: number[]; skipped: number[] } {
  const frames: number[] = [];
  const skipped: number[] = [];
  run({
    ...options,
    onFrame: (frame) => {
      frames.push(frame.index, frame.t, frame.alarms, frame.warnings, frame.state);
      for (let m = 0; m < METRIC_COUNT; m += 1) {
        frames.push(frame.values[m] ?? Number.NaN, frame.quality[m] ?? -1);
      }
    },
    onSkip: (index, t) => {
      skipped.push(index, t);
    },
  });
  return { frames, skipped };
}

function std(values: number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

describe('детерминизм', () => {
  it('два прогона 30 минут с одним seed дают идентичные значения', () => {
    const options: RunOptions = {
      seed: 42,
      vehicles: 3,
      seconds: 1800,
      chaos: 'CHAOS',
      live: true,
    };
    const a = record(options);
    const b = record(options);
    expect(a.frames.length).toBeGreaterThan(1800 * METRIC_COUNT);
    expect(a.frames).toEqual(b.frames);
    expect(a.skipped).toEqual(b.skipped);
  });

  it('разный seed дает разный прогон', () => {
    const a = record({ seed: 42, vehicles: 3, seconds: 300, chaos: 'NORMAL' });
    const b = record({ seed: 43, vehicles: 3, seconds: 300, chaos: 'NORMAL' });
    expect(a.frames).not.toEqual(b.frames);
  });

  it('добавление машин не меняет поведение существующих', () => {
    const firstVehicle = (count: number): number[] => {
      const values: number[] = [];
      run({
        seed: 7,
        vehicles: count,
        seconds: 1800,
        chaos: 'UGLY',
        onFrame: (frame) => {
          if (frame.index === 0) {
            values.push(frame.t, ...frame.values);
          }
        },
      });
      return values;
    };
    expect(firstVehicle(3)).toEqual(firstVehicle(12));
  });
});

describe('движение в коридоре', () => {
  it('координаты не дальше половины ширины коридора плюс 4 м от синтетической полилинии', () => {
    // Три точки: 600 м на восток, затем 580 м на северо-восток с изломом.
    const lat0 = 55.0;
    const lon0 = 88.46;
    const route = buildRouteGeometry([
      [lat0, lon0],
      [lat0, lon0 + 600 / 63_850],
      [lat0 + 500 / 111_320, lon0 + 900 / 63_850],
    ]);
    let checked = 0;
    let worst = 0;
    run({
      seed: 5,
      vehicles: 6,
      seconds: 4 * 3600,
      chaos: 'NORMAL',
      route,
      onFrame: (frame) => {
        if (frame.quality[M.POSITION_LATITUDE] !== QUALITY.GOOD) {
          return;
        }
        const x = toLocalX(frame.values[M.POSITION_LONGITUDE] ?? 0);
        const y = toLocalY(frame.values[M.POSITION_LATITUDE] ?? 0);
        const { distance, s } = distanceToRoute(route, x, y);
        const allowed =
          halfWidthAt(
            route,
            s,
            SIM_PARAMS.routeHalfWidthM,
            SIM_PARAMS.zoneHalfWidthM,
            SIM_PARAMS.zoneExtentM,
            SIM_PARAMS.zoneBlendM,
          ) + 4;
        worst = Math.max(worst, distance - allowed);
        checked += 1;
        const heading = frame.values[M.POSITION_HEADING] ?? -1;
        expect(heading).toBeGreaterThanOrEqual(0);
        expect(heading).toBeLessThan(360);
      },
    });
    expect(checked).toBeGreaterThan(6 * 3600);
    expect(worst).toBeLessThanOrEqual(0);
  });
});

/** Проверки фона обычной работы, общие для правдоподобия и хаоса. */
class Invariants {
  readonly lastHours: number[] = [];
  readonly lastFuelTotal: number[] = [];
  readonly lastFuelLevel: number[] = [];
  readonly lastRefuelAt: number[] = [];
  readonly stopped: number[] = [];
  violations: string[] = [];
  maxSpeed = 0;
  corridorExcess = 0;
  private readonly routes: RouteGeometry[];

  constructor(
    private readonly fleet: Vehicle[],
    private readonly corridorGain: number,
    private readonly gnssM: number,
  ) {
    this.routes = fleet.map((vehicle) =>
      buildRouteGeometry(PIT_ROUTES[vehicle.defaultRouteId].points),
    );
  }

  observe(frame: Frame, checkCorridor: boolean): void {
    const i = frame.index;
    for (let m = 0; m < METRIC_COUNT; m += 1) {
      const value = frame.values[m] ?? Number.NaN;
      if (!Number.isFinite(value) || value < 0) {
        this.violations.push(`${METRIC_ORDER[m]}=${value}`);
      }
    }
    const hours = frame.values[M.ENGINE_HOURS] ?? 0;
    if (hours < (this.lastHours[i] ?? 0)) {
      this.violations.push('моточасы убывают');
    }
    this.lastHours[i] = hours;
    const fuelTotal = frame.values[M.FUEL_TOTAL_CONSUMPTION] ?? 0;
    if (fuelTotal < (this.lastFuelTotal[i] ?? 0)) {
      this.violations.push('суммарный расход убывает');
    }
    this.lastFuelTotal[i] = fuelTotal;
    if ((frame.state & BIT_REFUELING) !== 0) {
      this.lastRefuelAt[i] = frame.t;
    }
    const level = frame.values[M.FUEL_LEVEL] ?? 0;
    const previous = this.lastFuelLevel[i];
    if (
      previous !== undefined &&
      level > previous + 1e-9 &&
      frame.t - (this.lastRefuelAt[i] ?? -1e9) > 10
    ) {
      this.violations.push('уровень топлива вырос вне заправки');
    }
    this.lastFuelLevel[i] = level;
    const speed = frame.values[M.POSITION_SPEED] ?? 0;
    this.maxSpeed = Math.max(this.maxSpeed, speed);
    this.stopped[i] = speed > 1 ? 0 : (this.stopped[i] ?? 0) + 1;

    const route = this.routes[i];
    if (
      checkCorridor &&
      route !== undefined &&
      frame.quality[M.POSITION_LATITUDE] === QUALITY.GOOD
    ) {
      const x = toLocalX(frame.values[M.POSITION_LONGITUDE] ?? 0);
      const y = toLocalY(frame.values[M.POSITION_LATITUDE] ?? 0);
      const { distance, s } = distanceToRoute(route, x, y);
      // У концов маршрута - коридор зоны: ломаная у зоны разгрузки может заворачивать, и ближайшая
      // точка проекции оказывается на участке дороги, хотя машина стоит в зоне.
      const last = route.pointCount - 1;
      const nearEnd =
        Math.hypot(x - (route.x[0] ?? 0), y - (route.y[0] ?? 0)) <= SIM_PARAMS.zoneBlendM ||
        Math.hypot(x - (route.x[last] ?? 0), y - (route.y[last] ?? 0)) <= SIM_PARAMS.zoneBlendM;
      const allowed =
        halfWidthAt(
          route,
          s,
          nearEnd ? SIM_PARAMS.zoneHalfWidthM : SIM_PARAMS.routeHalfWidthM,
          SIM_PARAMS.zoneHalfWidthM,
          SIM_PARAMS.zoneExtentM,
          SIM_PARAMS.zoneBlendM,
        ) *
          this.corridorGain +
        this.gnssM;
      this.corridorExcess = Math.max(this.corridorExcess, distance - allowed);
    }
  }

  context(frame: Frame): { rpm: number; speedKmh: number; stoppedSeconds: number } {
    return {
      rpm: frame.values[M.ENGINE_RPM] ?? 0,
      speedKmh: frame.values[M.POSITION_SPEED] ?? 0,
      stoppedSeconds: this.stopped[frame.index] ?? 0,
    };
  }

  vehicle(index: number): Vehicle {
    return this.fleet[index] as Vehicle;
  }
}

const BRAKES = [
  M.BRAKE_TEMPERATURE_FRONT_LEFT,
  M.BRAKE_TEMPERATURE_FRONT_RIGHT,
  M.BRAKE_TEMPERATURE_REAR_LEFT,
  M.BRAKE_TEMPERATURE_REAR_RIGHT,
];

describe('правдоподобие: 12 часов, 10 машин, хаос "норма"', () => {
  const fleet = generateFleet(10, 11);
  const invariants = new Invariants(fleet, 1, 4);
  let coolantSamples = 0;
  let coolantGreen = 0;
  let brakeSamples = 0;
  let brakeRed = 0;
  const { sim } = run({
    seed: 11,
    vehicles: 10,
    seconds: 12 * 3600,
    chaos: 'NORMAL',
    onFrame: (frame) => {
      invariants.observe(frame, false);
      const vehicle = invariants.vehicle(frame.index);
      const ctx = invariants.context(frame);
      if (frame.quality[M.ENGINE_COOLANT_TEMPERATURE] === QUALITY.GOOD) {
        coolantSamples += 1;
        const value = frame.values[M.ENGINE_COOLANT_TEMPERATURE];
        if (metricSeverity('ENGINE_COOLANT_TEMPERATURE', value, vehicle, ctx) === 0) {
          coolantGreen += 1;
        }
      }
      for (const index of BRAKES) {
        if (frame.quality[index] !== QUALITY.GOOD) {
          continue;
        }
        brakeSamples += 1;
        const metric = METRIC_ORDER[index] ?? 'BRAKE_TEMPERATURE_FRONT_LEFT';
        if (metricSeverity(metric, frame.values[index], vehicle, ctx) === 2) {
          brakeRed += 1;
        }
      }
    },
  });

  it('рейсов на машину 15-30', () => {
    for (const trips of sim.tripsByVehicle()) {
      expect(trips).toBeGreaterThanOrEqual(15);
      expect(trips).toBeLessThanOrEqual(30);
    }
  });

  it('счетчики монотонны, топливо не растет вне заправки, нет NaN и отрицательных', () => {
    expect(invariants.violations.slice(0, 5)).toEqual([]);
  });

  it('ОЖ в зеленой зоне не менее 90% времени, тормоза в красной не более 3%', () => {
    expect(coolantGreen / coolantSamples).toBeGreaterThanOrEqual(0.9);
    expect(brakeRed / brakeSamples).toBeLessThanOrEqual(0.03);
  });

  it('скорость не выше 45 км/ч', () => {
    expect(invariants.maxSpeed).toBeLessThanOrEqual(45);
  });
});

describe('сценарии', () => {
  it('за 12 часов хаос запускает все шесть обязательных сценариев, норма - заметно меньше', () => {
    const chaos = run({ seed: 21, vehicles: 10, seconds: 12 * 3600, chaos: 'CHAOS', live: true });
    const normal = run({ seed: 21, vehicles: 10, seconds: 12 * 3600, chaos: 'NORMAL', live: true });
    const chaosStarts = chaos.sim.scenarioStarts();
    for (const kind of MANDATORY_SCENARIOS) {
      expect(chaosStarts[kind] ?? 0, SCENARIO_CODES[kind]).toBeGreaterThan(0);
    }
    const total = (starts: number[]): number => starts.reduce((sum, value) => sum + value, 0);
    expect(total(normal.sim.scenarioStarts()) * 4).toBeLessThan(total(chaosStarts));
  });
});

describe('влияние хаоса на фон без сценариев', () => {
  const VEHICLES = 20;
  const SECONDS = 2 * 3600;

  function background(level: ChaosLevel) {
    const fleet = generateFleet(VEHICLES, 31);
    const profile = chaosProfile(level);
    const invariants = new Invariants(fleet, profile.corridorGain, profile.gnssJitterM);
    const coolant: number[] = [];
    const sums = new Array<number>(VEHICLES).fill(0);
    const counts = new Array<number>(VEHICLES).fill(0);
    let samples = 0;
    let outOfGreen = 0;
    run({
      seed: 31,
      vehicles: VEHICLES,
      seconds: SECONDS,
      chaos: level,
      scenarios: false,
      onFrame: (frame) => {
        invariants.observe(frame, true);
        if (frame.quality[M.ENGINE_COOLANT_TEMPERATURE] !== QUALITY.GOOD) {
          return;
        }
        const value = frame.values[M.ENGINE_COOLANT_TEMPERATURE] ?? 0;
        coolant.push(value);
        sums[frame.index] = (sums[frame.index] ?? 0) + value;
        counts[frame.index] = (counts[frame.index] ?? 0) + 1;
        const vehicle = invariants.vehicle(frame.index);
        const ctx = invariants.context(frame);
        samples += 1;
        if (
          metricSeverity('ENGINE_COOLANT_TEMPERATURE', value, vehicle, ctx) > 0 ||
          metricSeverity(
            'TRANSMISSION_OIL_TEMPERATURE',
            frame.values[M.TRANSMISSION_OIL_TEMPERATURE],
            vehicle,
            ctx,
          ) > 0 ||
          metricSeverity('ENGINE_OIL_PRESSURE', frame.values[M.ENGINE_OIL_PRESSURE], vehicle, ctx) >
            0
        ) {
          outOfGreen += 1;
        }
      },
    });
    const means = sums.map((sum, index) => sum / Math.max(1, counts[index] ?? 0));
    return {
      coolantStd: std(coolant),
      meansStd: std(means),
      outOfGreenShare: outOfGreen / samples,
      invariants,
    };
  }

  const normal = background('NORMAL');
  const chaos = background('CHAOS');

  it('при хаосе разброд заметно больше', () => {
    expect(chaos.coolantStd).toBeGreaterThanOrEqual(normal.coolantStd * 3);
    expect(chaos.meansStd).toBeGreaterThanOrEqual(normal.meansStd * 4);
    expect(chaos.outOfGreenShare).toBeGreaterThan(normal.outOfGreenShare);
  });

  it('счетчики монотонны, координаты в коридоре на обоих уровнях', () => {
    for (const result of [normal, chaos]) {
      expect(result.invariants.violations.slice(0, 5)).toEqual([]);
      // Допуск 1 м: проекция на ломаную сдвигает s там, где ширина коридора плавно меняется.
      expect(result.invariants.corridorExcess).toBeLessThanOrEqual(1);
    }
  });
});

describe('провал связи и дозаливка', () => {
  it('drainBackfill возвращает непрерывный набор кадров за весь период молчания', () => {
    const skipped = new Map<number, Set<number>>();
    const batches: BackfillBatch[] = [];
    run({
      seed: 8,
      vehicles: 10,
      seconds: 6 * 3600,
      chaos: 'CHAOS',
      live: true,
      onSkip: (index, t) => {
        let set = skipped.get(index);
        if (set === undefined) {
          set = new Set();
          skipped.set(index, set);
        }
        set.add(t);
      },
      onBackfill: (batch) => {
        batches.push(batch);
      },
    });
    expect(batches.length).toBeGreaterThan(0);
    for (const batch of batches) {
      expect(batch.count).toBe(batch.to - batch.from + 1);
      expect(batch.count).toBeGreaterThanOrEqual(120);
      const silent = skipped.get(batch.vehicleIndex);
      for (let t = batch.from; t <= batch.to; t += 1) {
        expect(silent?.has(t)).toBe(true);
      }
      for (let i = 0; i < batch.count * batch.metricCount; i += 1) {
        expect(Number.isFinite(batch.values[i])).toBe(true);
      }
      // В буфере живые кадры: счетчик моточасов не стоит на месте при работающем двигателе.
      const hoursAt = (i: number): number =>
        batch.values[i * batch.metricCount + M.ENGINE_HOURS] ?? 0;
      expect(hoursAt(batch.count - 1)).toBeGreaterThanOrEqual(hoursAt(0));
    }
  });
});
