import { describe, expect, it } from 'vitest';
import { compareFleet, type FleetEntry, fleetCounts } from './fleet.js';

const entry = (
  sideNumber: string,
  severity: FleetEntry['severity'],
  status: FleetEntry['status'],
) => ({ id: `v-${sideNumber}`, sideNumber, severity, status }) satisfies FleetEntry;

describe('порядок парка', () => {
  it('аварии, предупреждения, серые, зеленые; внутри группы - по бортовому номеру', () => {
    const fleet = [
      entry('21', 0, 'HAULING'),
      entry('07', 3, 'NO_DATA'),
      entry('12', 1, 'HAULING'),
      entry('03', 2, 'IDLING'),
      entry('10', 0, 'PARKED'),
      entry('2', 2, 'HAULING'),
    ];
    expect([...fleet].sort(compareFleet).map((item) => item.sideNumber)).toEqual([
      '2',
      '03',
      '12',
      '07',
      '10',
      '21',
    ]);
  });

  it('статус NO_DATA делает машину серой, даже если светофор последней точки известен', () => {
    const fleet = [entry('01', 0, 'HAULING'), entry('02', 2, 'NO_DATA')];
    expect([...fleet].sort(compareFleet).map((item) => item.sideNumber)).toEqual(['02', '01']);
    expect(fleetCounts(fleet)).toMatchObject({ alarms: 0, noData: 1 });
  });
});

describe('сводка парка', () => {
  it('в работе - на связи и с запущенным двигателем', () => {
    const counts = fleetCounts([
      entry('01', 0, 'HAULING'),
      entry('02', 2, 'IDLING'),
      entry('03', 0, 'PARKED'),
      entry('04', 3, 'NO_DATA'),
      entry('05', 1, 'LOADING'),
    ]);
    expect(counts).toEqual({ total: 5, working: 3, alarms: 1, warnings: 1, noData: 1 });
  });
});
