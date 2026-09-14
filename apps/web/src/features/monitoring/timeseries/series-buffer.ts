/**
 * Колоночный буфер серий одной машины: история из REST плюс живые тики websocket.
 *
 * История запрашивается один раз на машину и период, дальше буфер достраивается справа
 * из снапшотов, а окно скользит (раздел 4 этапа): повторный запрос всей серии на каждый тик
 * убил бы и сервер, и кадр.
 *
 * Живые значения сворачиваются в бакеты того же шага, что и история, по правилу агрегации
 * показателя из реестра. Поэтому при суточном периоде живой хвост не превращается в сотни
 * тысяч точек, а при ускорении x60 и пятиминутном периоде (тик раз в 15 виртуальных секунд)
 * между тиками не появляются ложные дыры: пустой бакет между двумя тиками - это не провал
 * связи, провал виден по качеству значения в самом снапшоте.
 */

import {
  METRICS,
  type MetricId,
  type PointValues,
  QUALITY,
  type SeriesResponse,
} from '@ra/contracts';

export interface SeriesColumn {
  avg: (number | null)[];
  min: (number | null)[];
  max: (number | null)[];
  /** Сколько годных значений вошло в бакет; 0 - дыра, линия рвется. */
  count: number[];
}

function emptyColumn(): SeriesColumn {
  return { avg: [], min: [], max: [], count: [] };
}

export class SeriesBuffer {
  readonly metrics: readonly MetricId[];
  private readonly periodSeconds: number;
  private readonly columns = new Map<MetricId, SeriesColumn>();
  private readonly listeners = new Set<() => void>();

  private x: number[] = [];
  private t0 = 0;
  private step = 1;
  private historyTo = 0;
  /** Время последнего принятого снапшота: более старые снапшоты уже учтены. */
  private lastSampleT = 0;
  private loaded = false;
  private version = 0;

  constructor(metrics: readonly MetricId[], periodSeconds: number) {
    this.metrics = metrics;
    this.periodSeconds = periodSeconds;
    for (const metric of metrics) {
      this.columns.set(metric, emptyColumn());
    }
  }

  /* ---------------------------------------------------------------- подписка */

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = (): number => this.version;

  /* ---------------------------------------------------------------- запись */

  /**
   * История из ответа серий. Бакеты, которые уже достроены тиками правее конца истории,
   * сохраняются: повторный запрос после `backfill` приходит с тем же окном, и без этого
   * живой хвост с момента открытия страницы пропадал бы.
   */
  setHistory(response: Pick<SeriesResponse, 'to' | 'step' | 'series'>): void {
    const bySeries = new Map(response.series.map((series) => [series.metric, series]));
    const first = response.series[0];
    const length = first?.avg.length ?? 0;
    const t0 = first?.t0 ?? 0;
    const step = Math.max(1, response.step);
    const nextX = Array.from({ length }, (_, index) => t0 + index * step);
    const historyLastX = nextX[nextX.length - 1] ?? Number.NEGATIVE_INFINITY;

    const tailFrom = this.x.findIndex((value) => value > historyLastX);
    const keepTail = tailFrom >= 0 && step === this.step;

    for (const metric of this.metrics) {
      const series = bySeries.get(metric);
      const previous = this.columns.get(metric) ?? emptyColumn();
      const column = emptyColumn();
      for (let i = 0; i < length; i += 1) {
        const count = series?.count[i] ?? 0;
        const avg = series?.avg[i] ?? null;
        const good = count > 0 && avg !== null;
        column.avg.push(good ? avg : null);
        column.min.push(good ? (series?.min[i] ?? avg) : null);
        column.max.push(good ? (series?.max[i] ?? avg) : null);
        column.count.push(good ? count : 0);
      }
      if (keepTail) {
        column.avg.push(...previous.avg.slice(tailFrom));
        column.min.push(...previous.min.slice(tailFrom));
        column.max.push(...previous.max.slice(tailFrom));
        column.count.push(...previous.count.slice(tailFrom));
      }
      this.columns.set(metric, column);
    }
    this.x = keepTail ? [...nextX, ...this.x.slice(tailFrom)] : nextX;
    this.t0 = t0;
    this.step = step;
    this.historyTo = response.to;
    this.lastSampleT = Math.max(this.lastSampleT, response.to);
    this.loaded = true;
    this.trim();
    this.bump();
  }

  /** Живой снапшот. Возвращает false, если точка уже учтена или история еще не загружена. */
  appendValues(t: number, values: PointValues): boolean {
    if (!this.loaded || t <= this.lastSampleT) {
      return false;
    }
    const bucketX = this.t0 + Math.floor((t - this.t0) / this.step) * this.step;
    const lastIndex = this.x.length - 1;
    const lastX = this.x[lastIndex];
    let index: number;
    if (lastX !== undefined && lastX === bucketX) {
      index = lastIndex;
    } else if (lastX === undefined || bucketX > lastX) {
      this.x.push(bucketX);
      for (const column of this.columns.values()) {
        column.avg.push(null);
        column.min.push(null);
        column.max.push(null);
        column.count.push(0);
      }
      index = lastIndex + 1;
    } else {
      return false;
    }

    for (const metric of this.metrics) {
      const sample = values[metric];
      if (sample === undefined || sample.quality !== QUALITY.GOOD || sample.value === null) {
        continue;
      }
      const value = sample.value;
      if (!Number.isFinite(value)) {
        continue;
      }
      const column = this.columns.get(metric);
      if (column !== undefined) {
        mergeInto(column, index, value, metric);
      }
    }
    this.lastSampleT = t;
    this.trim();
    this.bump();
    return true;
  }

  /* ---------------------------------------------------------------- чтение */

  isLoaded(): boolean {
    return this.loaded;
  }

  getStep(): number {
    return this.step;
  }

  get length(): number {
    return this.x.length;
  }

  xs(): readonly number[] {
    return this.x;
  }

  column(metric: MetricId): SeriesColumn | undefined {
    return this.columns.get(metric);
  }

  /** Окно на экране: правая граница - последний известный момент, ширина - период. */
  window(): { from: number; to: number } {
    const to = Math.max(this.historyTo, this.lastSampleT);
    return { from: to - this.periodSeconds, to };
  }

  /**
   * Индекс бакета, содержащего момент `t` (последний бакет с началом не позже `t`);
   * null - последний бакет. -1 - момент левее данных.
   */
  indexAt(t: number | null): number {
    const last = this.x.length - 1;
    if (t === null || last < 0) {
      return last;
    }
    if (t < (this.x[0] as number)) {
      return -1;
    }
    let lo = 0;
    let hi = last;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.x[mid] as number) <= t) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo;
  }

  valueAt(metric: MetricId, t: number | null): number | null {
    const index = this.indexAt(t);
    return index < 0 ? null : (this.columns.get(metric)?.avg[index] ?? null);
  }

  /** Значения всех показателей в бакете момента: вход для светофора и сравнительных чартов. */
  pointValues(t: number | null): PointValues {
    const index = this.indexAt(t);
    const result: PointValues = {};
    for (const metric of this.metrics) {
      const value = index < 0 ? null : (this.columns.get(metric)?.avg[index] ?? null);
      result[metric] =
        value === null
          ? { value: null, quality: QUALITY.NOT_AVAILABLE }
          : { value, quality: QUALITY.GOOD };
    }
    return result;
  }

  /** Первое годное значение в окне: база счетчика, показываемого приростом за период. */
  firstValue(metric: MetricId): number | null {
    const column = this.columns.get(metric);
    if (column === undefined) {
      return null;
    }
    for (const value of column.avg) {
      if (value !== null) {
        return value;
      }
    }
    return null;
  }

  /** Экстремумы показателя в окне: шкала величин без нормативов (например расхода). */
  extent(metric: MetricId): [number, number] | null {
    const column = this.columns.get(metric);
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < (column?.avg.length ?? 0); i += 1) {
      const lo = column?.min[i] ?? null;
      const hi = column?.max[i] ?? null;
      if (lo !== null && lo < min) {
        min = lo;
      }
      if (hi !== null && hi > max) {
        max = hi;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max) ? [min, max] : null;
  }

  /* ---------------------------------------------------------------- служебное */

  /** Бакеты, целиком ушедшие левее окна, выбрасываются. */
  private trim(): void {
    const from = this.window().from;
    let drop = 0;
    while (drop < this.x.length && (this.x[drop] as number) + this.step <= from) {
      drop += 1;
    }
    if (drop === 0) {
      return;
    }
    this.x.splice(0, drop);
    for (const column of this.columns.values()) {
      column.avg.splice(0, drop);
      column.min.splice(0, drop);
      column.max.splice(0, drop);
      column.count.splice(0, drop);
    }
  }

  private bump(): void {
    this.version += 1;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

/** Добавление значения в бакет по правилу агрегации показателя из реестра. */
function mergeInto(column: SeriesColumn, index: number, value: number, metric: MetricId): void {
  const count = column.count[index] ?? 0;
  const avg = column.avg[index] ?? null;
  if (count === 0 || avg === null) {
    column.avg[index] = value;
    column.min[index] = value;
    column.max[index] = value;
    column.count[index] = 1;
    return;
  }
  switch (METRICS[metric].aggregation) {
    case 'avg':
      column.avg[index] = avg + (value - avg) / (count + 1);
      break;
    case 'last':
      column.avg[index] = value;
      break;
    case 'max':
      column.avg[index] = Math.max(avg, value);
      break;
    case 'sum':
      column.avg[index] = avg + value;
      break;
  }
  column.min[index] = Math.min(column.min[index] ?? value, value);
  column.max[index] = Math.max(column.max[index] ?? value, value);
  column.count[index] = count + 1;
}
