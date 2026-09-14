/**
 * Двусторонняя синхронизация состояния с адресной строкой.
 * Параметры: `v` машина, `p` период, `m` монитор, `rt` real-time, `t` отслеживаемые показатели,
 * `tail` хвост трека, `theme` тема, `split` геометрия сплиттера.
 */

import { isMetricId, type MetricId, PERIODS, type PeriodId } from '@ra/contracts';
import type { AppState, CollapsedPane, SplitState, ThemeName } from './types.js';

/** Подмножество состояния, которое переживает перезагрузку страницы. */
export type UrlState = Pick<
  AppState,
  | 'periodId'
  | 'realtime'
  | 'monitorTs'
  | 'selectedVehicleId'
  | 'trackedMetrics'
  | 'trackTailSeconds'
  | 'theme'
  | 'split'
>;

const PERIOD_IDS = new Set<string>(PERIODS.map((period) => period.id));

function parsePeriodId(raw: string | null): PeriodId | null {
  return raw !== null && PERIOD_IDS.has(raw) ? (raw as PeriodId) : null;
}

function parseInteger(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMetrics(raw: string | null): MetricId[] | null {
  if (raw === null) {
    return null;
  }
  const metrics = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .filter((item): item is MetricId => isMetricId(item));
  return metrics.length > 0 ? metrics : [];
}

function parseTheme(raw: string | null): ThemeName | null {
  return raw === 'light' || raw === 'dark' ? raw : null;
}

/** `split=52,left`: доля левой области и свернутая область. */
function parseSplit(raw: string | null): SplitState | null {
  if (raw === null) {
    return null;
  }
  const [percentRaw, collapsedRaw] = raw.split(',');
  const percent = Number.parseFloat(percentRaw ?? '');
  if (!Number.isFinite(percent)) {
    return null;
  }
  const collapsed: CollapsedPane =
    collapsedRaw === 'left' || collapsedRaw === 'right' ? collapsedRaw : 'none';
  return { leftPercent: percent, collapsed };
}

function formatSplit(split: SplitState): string {
  const percent = Math.round(split.leftPercent * 10) / 10;
  return split.collapsed === 'none' ? String(percent) : `${percent},${split.collapsed}`;
}

/** Читает состояние из адресной строки; отсутствующие параметры возвращаются как undefined. */
export function readUrlState(search: string): Partial<UrlState> {
  const params = new URLSearchParams(search);
  const result: Partial<UrlState> = {};

  const periodId = parsePeriodId(params.get('p'));
  if (periodId !== null) {
    result.periodId = periodId;
  }
  const realtime = params.get('rt');
  if (realtime !== null) {
    result.realtime = realtime !== '0' && realtime !== 'false';
  }
  const monitorTs = parseInteger(params.get('m'));
  if (monitorTs !== null) {
    result.monitorTs = monitorTs;
  }
  const vehicleId = params.get('v');
  if (vehicleId !== null && vehicleId.trim() !== '') {
    result.selectedVehicleId = vehicleId;
  }
  const trackedMetrics = parseMetrics(params.get('t'));
  if (trackedMetrics !== null) {
    result.trackedMetrics = trackedMetrics;
  }
  const tail = parseInteger(params.get('tail'));
  if (tail !== null) {
    result.trackTailSeconds = tail;
  }
  const theme = parseTheme(params.get('theme'));
  if (theme !== null) {
    result.theme = theme;
  }
  const split = parseSplit(params.get('split'));
  if (split !== null) {
    result.split = split;
  }
  return result;
}

/** Собирает строку запроса из состояния; значения по умолчанию в адрес не пишутся. */
export function writeUrlState(state: UrlState, defaults: UrlState): string {
  const params = new URLSearchParams();
  if (state.selectedVehicleId !== null) {
    params.set('v', state.selectedVehicleId);
  }
  if (state.periodId !== defaults.periodId) {
    params.set('p', state.periodId);
  }
  if (state.monitorTs !== null) {
    params.set('m', String(state.monitorTs));
  }
  if (state.realtime !== defaults.realtime) {
    params.set('rt', state.realtime ? '1' : '0');
  }
  if (state.trackedMetrics.length > 0) {
    params.set('t', state.trackedMetrics.join(','));
  }
  if (state.trackTailSeconds !== defaults.trackTailSeconds) {
    params.set('tail', String(state.trackTailSeconds));
  }
  params.set('theme', state.theme);
  if (
    state.split.leftPercent !== defaults.split.leftPercent ||
    state.split.collapsed !== defaults.split.collapsed
  ) {
    params.set('split', formatSplit(state.split));
  }
  const query = params.toString();
  return query.length > 0 ? `?${query}` : '';
}
