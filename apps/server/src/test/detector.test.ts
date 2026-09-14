/** Гистерезис детектора событий, биты и серверные события. */

import { codesToFlags, EVENT_RULES, QUALITY, type Severity, SYSTEM_STATE } from '@ra/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { EventDetector } from '../events/detector.js';
import { EventJournal } from '../events/journal.js';
import { STORED_METRIC_COUNT, storedMetricIndex } from '../store/stored-metrics.js';

const T0 = 1_700_000_000;
const VEHICLE = 'v-12';
const COOLANT = storedMetricIndex('ENGINE_COOLANT_TEMPERATURE');
const FUEL = storedMetricIndex('FUEL_LEVEL');
const ENGINE_RUNNING = codesToFlags(['ENGINE_RUNNING'], SYSTEM_STATE);

interface FrameOptions {
  severity?: Severity;
  value?: number;
  alarms?: number;
  warnings?: number;
  state?: number;
  metricIndex?: number;
}

function frame(t: number, options: FrameOptions = {}) {
  const values = new Float64Array(STORED_METRIC_COUNT);
  const quality = new Uint8Array(STORED_METRIC_COUNT);
  const severities = new Uint8Array(STORED_METRIC_COUNT);
  quality.fill(QUALITY.NOT_AVAILABLE);
  severities.fill(3);
  const index = options.metricIndex ?? COOLANT;
  values[index] = options.value ?? 100;
  quality[index] = QUALITY.GOOD;
  severities[index] = options.severity ?? 0;
  return {
    vehicleId: VEHICLE,
    t,
    values,
    quality,
    severities,
    alarms: options.alarms ?? 0,
    warnings: options.warnings ?? 0,
    state: options.state ?? ENGINE_RUNNING,
  };
}

describe('события по нормативам', () => {
  let journal: EventJournal;
  let detector: EventDetector;

  beforeEach(() => {
    journal = new EventJournal();
    detector = new EventDetector(journal);
  });

  it('не открывает событие на дребезге короче 10 секунд', () => {
    for (let i = 0; i < EVENT_RULES.openAfterSeconds - 1; i += 1) {
      detector.observe(frame(T0 + i, { severity: 1 }));
    }
    detector.observe(frame(T0 + EVENT_RULES.openAfterSeconds, { severity: 0 }));
    expect(journal.size).toBe(0);
  });

  it('открывает событие после 10 секунд вне зеленой зоны и ставит начало на выход из нее', () => {
    for (let i = 0; i <= EVENT_RULES.openAfterSeconds; i += 1) {
      detector.observe(frame(T0 + i, { severity: 1 }));
    }
    const events = journal.forVehicle(VEHICLE);
    expect(events.length).toBe(1);
    expect(events[0]?.source).toBe('threshold');
    expect(events[0]?.code).toBe('THRESHOLD:ENGINE_COOLANT_TEMPERATURE');
    expect(events[0]?.severity).toBe(1);
    expect(events[0]?.startedAt).toBe(T0);
    expect(events[0]?.endedAt).toBeNull();
  });

  it('повышает степень события, если показатель ушел из желтой зоны в красную', () => {
    for (let i = 0; i <= EVENT_RULES.openAfterSeconds; i += 1) {
      detector.observe(frame(T0 + i, { severity: 1, value: 100 }));
    }
    detector.observe(frame(T0 + 30, { severity: 2, value: 130 }));
    const event = journal.forVehicle(VEHICLE)[0];
    expect(event?.severity).toBe(2);
    expect(event?.peakValue).toBe(130);
    expect(event?.peakAt).toBe(T0 + 30);
  });

  it('закрывает событие через 30 секунд зеленой зоны, отмечая концом момент возврата', () => {
    for (let i = 0; i <= EVENT_RULES.openAfterSeconds; i += 1) {
      detector.observe(frame(T0 + i, { severity: 2 }));
    }
    const returnedAt = T0 + 20;
    for (let i = 0; i < EVENT_RULES.closeAfterSeconds; i += 1) {
      detector.observe(frame(returnedAt + i, { severity: 0 }));
    }
    expect(journal.forVehicle(VEHICLE)[0]?.endedAt).toBeNull();
    detector.observe(frame(returnedAt + EVENT_RULES.closeAfterSeconds, { severity: 0 }));
    expect(journal.forVehicle(VEHICLE)[0]?.endedAt).toBe(returnedAt);
  });

  it('не открывает второе событие по тому же показателю, пока первое активно', () => {
    for (let i = 0; i <= 100; i += 1) {
      // Показатель то в желтой зоне, то в зеленой, но не 30 секунд подряд.
      detector.observe(frame(T0 + i, { severity: i % 20 < 15 ? 1 : 0 }));
    }
    expect(journal.forVehicle(VEHICLE).length).toBe(1);
  });

  it('разрыв данных прерывает непрерывность: событие не получает начало из-под провала', () => {
    detector.observe(frame(T0, { severity: 2 }));
    detector.observeGap(VEHICLE);
    const resumedAt = T0 + 3600;
    for (let i = 0; i <= EVENT_RULES.openAfterSeconds; i += 1) {
      detector.observe(frame(resumedAt + i, { severity: 2 }));
    }
    const event = journal.forVehicle(VEHICLE)[0];
    expect(event?.startedAt).toBe(resumedAt);
  });
});

describe('события по битам', () => {
  it('взведенный бит открывает событие, снятый - закрывает', () => {
    const journal = new EventJournal();
    const detector = new EventDetector(journal);
    const alarms = codesToFlags(
      ['COOLANT_OVERHEAT'],
      [{ bit: 1, code: 'COOLANT_OVERHEAT', name: '', severity: 2 }],
    );
    detector.observe(frame(T0, { alarms }));
    const opened = journal.forVehicle(VEHICLE)[0];
    expect(opened?.source).toBe('alarmBit');
    expect(opened?.code).toBe('COOLANT_OVERHEAT');
    expect(opened?.severity).toBe(2);
    detector.observe(frame(T0 + 60, { alarms: 0 }));
    expect(journal.forVehicle(VEHICLE)[0]?.endedAt).toBe(T0 + 60);
  });
});

describe('серверные события', () => {
  it('нет данных дольше 40 минут - авария NO_DATA, дозаливка ее закрывает', () => {
    const journal = new EventJournal();
    const detector = new EventDetector(journal);
    const lastGoodAt = T0;
    detector.observeSilence(VEHICLE, T0 + EVENT_RULES.noDataMinutes * 60 - 1, lastGoodAt);
    expect(journal.size).toBe(0);
    detector.observeSilence(VEHICLE, T0 + EVENT_RULES.noDataMinutes * 60, lastGoodAt);
    const event = journal.forVehicle(VEHICLE)[0];
    expect(event?.code).toBe('NO_DATA');
    expect(event?.startedAt).toBe(lastGoodAt);
    expect(event?.endedAt).toBeNull();

    const backfilledTo = T0 + 3000;
    detector.observeBackfill(VEHICLE, lastGoodAt, backfilledTo);
    expect(journal.forVehicle(VEHICLE)[0]?.endedAt).toBe(backfilledTo);
    expect(journal.forVehicle(VEHICLE).some((item) => item.code === 'DATA_BACKFILLED')).toBe(true);
  });

  it('падение уровня топлива больше 5% при заглушенном двигателе - подозрение на слив', () => {
    const journal = new EventJournal();
    const detector = new EventDetector(journal);
    detector.observe(frame(T0, { metricIndex: FUEL, value: 80, state: 0 }));
    detector.observe(frame(T0 + 60, { metricIndex: FUEL, value: 76, state: 0 }));
    expect(journal.size).toBe(0);
    detector.observe(frame(T0 + 120, { metricIndex: FUEL, value: 74, state: 0 }));
    const event = journal.forVehicle(VEHICLE)[0];
    expect(event?.code).toBe('FUEL_THEFT_SUSPECTED');
    expect(event?.startedAt).toBe(T0 + 120);
  });

  it('при работающем двигателе падение уровня топлива событием не считается', () => {
    const journal = new EventJournal();
    const detector = new EventDetector(journal);
    detector.observe(frame(T0, { metricIndex: FUEL, value: 80 }));
    detector.observe(frame(T0 + 600, { metricIndex: FUEL, value: 40 }));
    expect(journal.size).toBe(0);
  });
});
