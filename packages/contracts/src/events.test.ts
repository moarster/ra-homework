import { describe, expect, it } from 'vitest';
import { EVENT_METRICS, eventMetric, SERVER_EVENT_CODES } from './events.js';
import { ALARMS, WARNINGS } from './flags.js';
import { isMetricId } from './metrics.js';

describe('показатель события', () => {
  it('явный показатель события главнее каталога', () => {
    expect(eventMetric('COOLANT_OVERHEAT', 'ENGINE_OIL_TEMPERATURE')).toBe(
      'ENGINE_OIL_TEMPERATURE',
    );
  });

  it('событие норматива несет показатель в коде', () => {
    expect(eventMetric('THRESHOLD:TRANSMISSION_SYSTEM_PRESSURE')).toBe(
      'TRANSMISSION_SYSTEM_PRESSURE',
    );
    expect(eventMetric('THRESHOLD:NOT_A_METRIC')).toBeNull();
  });

  it('биты и серверные события - по каталогу; без показателя перехода нет', () => {
    expect(eventMetric('BRAKE_OVERHEAT')).toBe('BRAKE_TEMPERATURE_MAX');
    expect(eventMetric('NO_DATA')).toBe('TIME_SINCE_LAST_DATA');
    expect(eventMetric('FIRE_ALARM')).toBeNull();
    expect(eventMetric('toString')).toBeNull();
  });

  it('каталог ссылается только на известные коды и показатели', () => {
    const codes = new Set([
      ...ALARMS.map((flag) => flag.code),
      ...WARNINGS.map((flag) => flag.code),
      ...SERVER_EVENT_CODES,
    ]);
    for (const [code, metric] of Object.entries(EVENT_METRICS)) {
      expect(codes.has(code), code).toBe(true);
      expect(isMetricId(metric), metric).toBe(true);
    }
  });
});
