import { describe, expect, it } from 'vitest';
import { VEHICLE_STATUSES } from './derived.js';
import { metricGroupIcon, metricIcon, PLACEHOLDER_ICON, vehicleStatusIcon } from './icons.js';
import { METRIC_GROUPS } from './metric-groups.js';
import { METRICS } from './metrics.js';

const metricIds = Object.keys(METRICS);
const groupIds = Object.keys(METRIC_GROUPS);

const all: [string, string][] = [
  ...metricIds.map((id): [string, string] => [`metric:${id}`, metricIcon(id)]),
  ...groupIds.map((id): [string, string] => [`group:${id}`, metricGroupIcon(id)]),
  ...VEHICLE_STATUSES.map((id): [string, string] => [`status:${id}`, vehicleStatusIcon(id)]),
];

describe('иконки', () => {
  it('покрывают 30 показателей, 6 групп и 7 статусов', () => {
    expect(metricIds).toHaveLength(30);
    expect(groupIds).toHaveLength(6);
    expect(VEHICLE_STATUSES).toHaveLength(7);
  });

  it('у каждого идентификатора своя иконка, не заглушка', () => {
    for (const [id, svg] of all) {
      expect(svg, id).not.toBe(PLACEHOLDER_ICON);
    }
    expect(new Set(all.map(([, svg]) => svg)).size).toBe(all.length);
  });

  it('соблюдают правила набора: контур currentColor, без цветов и style', () => {
    for (const [id, svg] of all) {
      expect(svg, id).toMatch(/^<svg [^>]*viewBox="0 0 24 24"/);
      expect(svg, id).toContain('fill="none"');
      expect(svg, id).toContain('stroke="currentColor"');
      expect(svg, id).toContain('stroke-linecap="round"');
      expect(svg, id).toContain('stroke-linejoin="round"');
      expect(svg, id).not.toContain('style=');
      expect(svg, id).not.toMatch(/#[0-9a-f]{3,6}\b/i);
      // Единственная заливка - `none` на корне: вложенные фигуры не заливаются.
      expect(svg.match(/fill="/g), id).toHaveLength(1);
      const width = Number(svg.match(/stroke-width="([\d.]+)"/)?.[1]);
      expect(width, id).toBeGreaterThanOrEqual(1.5);
      expect(width, id).toBeLessThanOrEqual(1.75);
    }
  });

  it('четыре тормоза различаются рисунком', () => {
    const brakes = [
      'BRAKE_TEMPERATURE_FRONT_LEFT',
      'BRAKE_TEMPERATURE_FRONT_RIGHT',
      'BRAKE_TEMPERATURE_REAR_LEFT',
      'BRAKE_TEMPERATURE_REAR_RIGHT',
    ].map(metricIcon);
    expect(new Set(brakes).size).toBe(4);
  });

  it('справочник показателей хранит ту же строку', () => {
    for (const id of metricIds) {
      expect(METRICS[id as keyof typeof METRICS].icon).toBe(metricIcon(id));
    }
  });

  it('неизвестный идентификатор получает заглушку', () => {
    expect(metricIcon('UNKNOWN')).toBe(PLACEHOLDER_ICON);
    expect(metricGroupIcon('UNKNOWN')).toBe(PLACEHOLDER_ICON);
    expect(vehicleStatusIcon('UNKNOWN')).toBe(PLACEHOLDER_ICON);
  });
});
