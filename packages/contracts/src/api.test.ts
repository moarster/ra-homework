import { describe, expect, it } from 'vitest';
import {
  appConfigSchema,
  decodeSnapshot,
  dictionariesResponseSchema,
  encodeSnapshot,
  eventsQuerySchema,
  seriesQuerySchema,
  simPatchSchema,
  vehicleSnapshotSchema,
  vehiclesResponseSchema,
  wsControlMessageSchema,
  wsServerMessageSchema,
} from './api.js';
import { APP_CONFIG } from './config.js';
import { FLAG_CATALOGS } from './flags.js';
import { METRIC_GROUP_IDS, METRIC_GROUPS } from './metric-groups.js';
import { METRIC_IDS, METRIC_ORDER, METRICS } from './metrics.js';
import { PIT_ROUTES, PIT_ZONES, ROUTE_IDS } from './pit.js';
import { QUALITY } from './severity.js';
import { THRESHOLD_RULES } from './thresholds.js';
import { UNIT_GROUPS, UNIT_IDS, UNITS } from './units.js';
import { generateFleet, VEHICLE_MODEL_IDS, VEHICLE_MODELS } from './vehicles.js';

describe('компактный снапшот', () => {
  it('кодирует значения в порядке METRIC_ORDER', () => {
    const { v, q } = encodeSnapshot({
      ENGINE_RPM: { value: 1400, quality: QUALITY.GOOD },
      POSITION_SPEED: { value: 22.5, quality: QUALITY.GOOD },
    });
    expect(v).toHaveLength(METRIC_ORDER.length);
    expect(q).toHaveLength(METRIC_ORDER.length);
    expect(v[METRIC_ORDER.indexOf('ENGINE_RPM')]).toBe(1400);
    expect(q[METRIC_ORDER.indexOf('ENGINE_RPM')]).toBe(QUALITY.GOOD);
    expect(v[METRIC_ORDER.indexOf('FUEL_LEVEL')]).toBeNull();
    expect(q[METRIC_ORDER.indexOf('FUEL_LEVEL')]).toBe(QUALITY.NOT_AVAILABLE);
  });

  it('декодирование обратно к записи по показателям', () => {
    const values = {
      ENGINE_RPM: { value: 1400, quality: QUALITY.GOOD },
      FUEL_LEVEL: { value: 42, quality: QUALITY.STALE },
      CARGO_MASS: { value: null, quality: QUALITY.COMM_ERROR },
    } as const;
    const { v, q } = encodeSnapshot(values);
    const decoded = decodeSnapshot(v, q);
    expect(decoded.ENGINE_RPM).toEqual(values.ENGINE_RPM);
    expect(decoded.FUEL_LEVEL).toEqual(values.FUEL_LEVEL);
    expect(decoded.CARGO_MASS).toEqual(values.CARGO_MASS);
    expect(decoded.POSITION_HEADING).toEqual({ value: null, quality: QUALITY.NOT_AVAILABLE });
    expect(Object.keys(decoded)).toHaveLength(METRIC_ORDER.length);
  });

  it('снапшот проходит валидацию схемой', () => {
    const { v, q } = encodeSnapshot({ ENGINE_RPM: { value: 1400, quality: QUALITY.GOOD } });
    const parsed = vehicleSnapshotSchema.safeParse({
      id: 'v-12',
      t: 1_757_700_000,
      v,
      q,
      f: [0, 0, 3],
      st: 'HAULING',
      sev: 0,
      age: 1,
    });
    expect(parsed.success).toBe(true);
  });
});

describe('схемы параметров запроса', () => {
  it('приводит строки к числам и разбирает списки', () => {
    const parsed = seriesQuerySchema.parse({
      vehicleIds: 'v-12, v-07',
      metrics: 'ENGINE_RPM,FUEL_LEVEL',
      from: '1757700000',
      to: '1757703600',
    });
    expect(parsed.vehicleIds).toEqual(['v-12', 'v-07']);
    expect(parsed.metrics).toEqual(['ENGINE_RPM', 'FUEL_LEVEL']);
    expect(parsed.from).toBe(1_757_700_000);
    expect(parsed.maxPoints).toBe(1000);
  });

  it('отвергает неизвестный показатель и слишком большой maxPoints', () => {
    expect(
      seriesQuerySchema.safeParse({ metrics: 'NO_SUCH_METRIC', from: '1', to: '2' }).success,
    ).toBe(false);
    expect(seriesQuerySchema.safeParse({ from: '1', to: '2', maxPoints: '9000' }).success).toBe(
      false,
    );
  });

  it('события: степень только 1 или 2', () => {
    expect(eventsQuerySchema.parse({ from: '1', to: '2', severity: '2' }).severity).toBe(2);
    expect(eventsQuerySchema.safeParse({ from: '1', to: '2', severity: '3' }).success).toBe(false);
  });

  it('POST /api/sim принимает подмножество полей', () => {
    expect(simPatchSchema.parse({ chaos: 'UGLY' })).toEqual({ chaos: 'UGLY' });
    expect(simPatchSchema.safeParse({ chaos: 'WILD' }).success).toBe(false);
  });
});

describe('websocket', () => {
  it('различает сообщения по полю type', () => {
    const message = wsServerMessageSchema.parse({
      type: 'backfill',
      vehicleId: 'v-12',
      from: 1_757_700_000,
      to: 1_757_700_600,
    });
    expect(message.type).toBe('backfill');
    expect(wsServerMessageSchema.safeParse({ type: 'unknown' }).success).toBe(false);
  });

  it('состояние симуляции идет только по каналу управления', () => {
    const sim = {
      simTime: 1_757_700_000,
      historyFrom: 1_757_656_800,
      timeScale: 1,
      vehicleCount: 3,
      chaos: 'NORMAL',
      seed: 1,
      running: true,
    };
    expect(wsControlMessageSchema.safeParse({ type: 'sim', sim, changedBy: 'a' }).success).toBe(
      true,
    );
    expect(wsControlMessageSchema.safeParse({ type: 'viewers', count: 2 }).success).toBe(true);
    expect(wsServerMessageSchema.safeParse({ type: 'sim', sim }).success).toBe(false);
  });
});

describe('справочники и конфигурация проходят собственные схемы', () => {
  it('GET /api/dictionaries', () => {
    const payload = {
      metricOrder: METRIC_ORDER,
      metrics: METRIC_IDS.map((id) => METRICS[id]),
      metricGroups: METRIC_GROUP_IDS.map((id) => METRIC_GROUPS[id]),
      units: UNIT_IDS.map((id) => UNITS[id]),
      unitGroups: Object.values(UNIT_GROUPS),
      thresholds: THRESHOLD_RULES,
      flags: FLAG_CATALOGS,
      vehicleModels: VEHICLE_MODEL_IDS.map((id) => VEHICLE_MODELS[id]),
      routes: ROUTE_IDS.map((id) => PIT_ROUTES[id]),
      zones: PIT_ZONES,
    };
    const parsed = dictionariesResponseSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it('GET /api/config', () => {
    expect(appConfigSchema.safeParse(APP_CONFIG).success).toBe(true);
  });

  it('GET /api/vehicles', () => {
    expect(vehiclesResponseSchema.safeParse({ vehicles: generateFleet(60, 1) }).success).toBe(true);
  });
});
