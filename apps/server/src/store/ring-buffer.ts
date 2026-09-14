/**
 * Кольцевые буферы уровней хранилища на типизированных массивах (раздел 6 `SPEC.md`).
 *
 * Один экземпляр `VehicleTiers` - одна машина. Внутри три уровня: сырые данные 1 Гц,
 * агрегаты по 10 секунд и по минуте. Объекты на значение не создаются: все три уровня -
 * плоские типизированные массивы, адресуемые как `slot * metricCount + metricIndex`.
 *
 * Адресация по времени - абсолютный индекс бакета `floor(t / step)`. Слот в кольце -
 * `index % capacity`. При продвижении головы освобождаемые слоты обнуляются, поэтому
 * содержимое слота всегда относится к индексу из окна `(head - capacity, head]`.
 */

import { type MetricAggregation, QUALITY, type Quality, type Severity } from '@ra/contracts';
import { STORED_METRIC_COUNT } from './stored-metrics.js';

export type StoreTier = 'raw' | 's10' | 'm1';

export interface TierConfig {
  id: StoreTier;
  /** Шаг бакета, секунды. */
  stepSeconds: number;
  /** Число бакетов в кольце. */
  capacity: number;
}

/** Три уровня из таблицы раздела 6 `SPEC.md`. */
export const TIERS: Record<StoreTier, TierConfig> = {
  raw: { id: 'raw', stepSeconds: 1, capacity: 30 * 60 },
  s10: { id: 's10', stepSeconds: 10, capacity: (6 * 3600) / 10 },
  m1: { id: 'm1', stepSeconds: 60, capacity: (24 * 3600) / 60 },
};

export const TIER_IDS: StoreTier[] = ['raw', 's10', 'm1'];

/** Голова кольца до первой записи: индекс бакета заведомо меньше любого реального. */
const EMPTY_HEAD = Number.NEGATIVE_INFINITY;

/** Сырой уровень: значение, качество и степень отклонения на каждую секунду. */
class RawRing {
  readonly capacity: number;
  readonly values: Float32Array;
  readonly quality: Uint8Array;
  readonly severity: Uint8Array;
  private head = EMPTY_HEAD;

  constructor(capacity: number) {
    this.capacity = capacity;
    const size = capacity * STORED_METRIC_COUNT;
    this.values = new Float32Array(size);
    this.quality = new Uint8Array(size);
    this.severity = new Uint8Array(size);
    this.values.fill(Number.NaN);
    this.quality.fill(QUALITY.NOT_AVAILABLE);
    this.severity.fill(3);
  }

  get headIndex(): number {
    return this.head;
  }

  /** Первый индекс, который еще лежит в кольце. */
  get tailIndex(): number {
    return this.head === EMPTY_HEAD ? EMPTY_HEAD : this.head - this.capacity + 1;
  }

  private clearSlot(slot: number): void {
    const base = slot * STORED_METRIC_COUNT;
    for (let m = 0; m < STORED_METRIC_COUNT; m += 1) {
      this.values[base + m] = Number.NaN;
      this.quality[base + m] = QUALITY.NOT_AVAILABLE;
      this.severity[base + m] = 3;
    }
  }

  /** Продвинуть голову до индекса, освободив пройденные слоты. */
  advance(index: number): void {
    if (this.head === EMPTY_HEAD) {
      this.head = index;
      this.clearSlot(this.slot(index));
      return;
    }
    if (index <= this.head) {
      return;
    }
    const span = Math.min(index - this.head, this.capacity);
    for (let i = 0; i < span; i += 1) {
      this.clearSlot(this.slot(index - i));
    }
    this.head = index;
  }

  slot(index: number): number {
    return ((index % this.capacity) + this.capacity) % this.capacity;
  }

  /** Лежит ли индекс в текущем окне кольца. */
  has(index: number): boolean {
    return this.head !== EMPTY_HEAD && index <= this.head && index > this.head - this.capacity;
  }

  /** Смещение начала слота или -1, если индекс уже вне окна кольца. */
  baseOf(index: number): number {
    return this.has(index) ? this.slot(index) * STORED_METRIC_COUNT : -1;
  }

  writeAt(base: number, metricIndex: number, value: number, quality: Quality, sev: Severity): void {
    const offset = base + metricIndex;
    this.values[offset] = value;
    this.quality[offset] = quality;
    this.severity[offset] = sev;
  }

  offsetOf(index: number, metricIndex: number): number {
    return this.slot(index) * STORED_METRIC_COUNT + metricIndex;
  }
}

/** Агрегированный уровень: avg, min, max, sev и число исходных точек GOOD. */
class AggRing {
  readonly capacity: number;
  readonly avg: Float32Array;
  readonly min: Float32Array;
  readonly max: Float32Array;
  readonly sev: Uint8Array;
  readonly count: Uint8Array;
  private head = EMPTY_HEAD;

  constructor(capacity: number) {
    this.capacity = capacity;
    const size = capacity * STORED_METRIC_COUNT;
    this.avg = new Float32Array(size);
    this.min = new Float32Array(size);
    this.max = new Float32Array(size);
    this.sev = new Uint8Array(size);
    this.count = new Uint8Array(size);
    this.avg.fill(Number.NaN);
    this.min.fill(Number.NaN);
    this.max.fill(Number.NaN);
    this.sev.fill(3);
  }

  get headIndex(): number {
    return this.head;
  }

  get tailIndex(): number {
    return this.head === EMPTY_HEAD ? EMPTY_HEAD : this.head - this.capacity + 1;
  }

  private clearSlot(slot: number): void {
    const base = slot * STORED_METRIC_COUNT;
    for (let m = 0; m < STORED_METRIC_COUNT; m += 1) {
      this.avg[base + m] = Number.NaN;
      this.min[base + m] = Number.NaN;
      this.max[base + m] = Number.NaN;
      this.sev[base + m] = 3;
      this.count[base + m] = 0;
    }
  }

  advance(index: number): void {
    if (this.head === EMPTY_HEAD) {
      this.head = index;
      this.clearSlot(this.slot(index));
      return;
    }
    if (index <= this.head) {
      return;
    }
    const span = Math.min(index - this.head, this.capacity);
    for (let i = 0; i < span; i += 1) {
      this.clearSlot(this.slot(index - i));
    }
    this.head = index;
  }

  slot(index: number): number {
    return ((index % this.capacity) + this.capacity) % this.capacity;
  }

  has(index: number): boolean {
    return this.head !== EMPTY_HEAD && index <= this.head && index > this.head - this.capacity;
  }

  offsetOf(index: number, metricIndex: number): number {
    return this.slot(index) * STORED_METRIC_COUNT + metricIndex;
  }

  /**
   * Инкрементальная свертка одной исходной точки в бакет.
   *
   * `avg` ведется как текущее среднее (`avg += (x - avg) / count`), поэтому дозаливка
   * задним числом в уже закрытый бакет пересчитывает агрегат правильно и без второго проходa.
   * Для показателей с агрегацией `last`, `max` и `sum` в поле `avg` лежит соответствующая
   * величина: контракт серий требует поле `avg`, а смысл свертки задает реестр показателей.
   */
  /** Смещение начала слота или -1, если индекс уже вне окна кольца. */
  baseOf(index: number): number {
    return this.has(index) ? this.slot(index) * STORED_METRIC_COUNT : -1;
  }

  accumulateAt(
    base: number,
    metricIndex: number,
    value: number,
    sev: Severity,
    aggregation: MetricAggregation,
  ): void {
    const offset = base + metricIndex;
    const previousCount = this.count[offset] ?? 0;
    // Uint8: 60 сырых точек в минутном бакете - максимум, переполнения быть не может.
    const nextCount = previousCount + 1;
    this.count[offset] = nextCount;
    if (previousCount === 0) {
      this.avg[offset] = value;
      this.min[offset] = value;
      this.max[offset] = value;
      this.sev[offset] = sev;
      return;
    }
    const previousAvg = this.avg[offset] ?? value;
    switch (aggregation) {
      case 'avg':
        this.avg[offset] = previousAvg + (value - previousAvg) / nextCount;
        break;
      case 'last':
        this.avg[offset] = value;
        break;
      case 'max':
        this.avg[offset] = Math.max(previousAvg, value);
        break;
      case 'sum':
        this.avg[offset] = previousAvg + value;
        break;
    }
    this.min[offset] = Math.min(this.min[offset] ?? value, value);
    this.max[offset] = Math.max(this.max[offset] ?? value, value);
    const previousSev = this.sev[offset] ?? 3;
    this.sev[offset] = previousSev === 3 ? sev : Math.max(previousSev, sev === 3 ? 0 : sev);
  }
}

export interface BucketView {
  avg: number | null;
  min: number | null;
  max: number | null;
  sev: Severity;
  count: number;
}

/** Три уровня одной машины. */
export class VehicleTiers {
  private readonly raw = new RawRing(TIERS.raw.capacity);
  private readonly s10 = new AggRing(TIERS.s10.capacity);
  private readonly m1 = new AggRing(TIERS.m1.capacity);
  /**
   * Индексы бакетов открытой секунды. Считаются один раз в `openTime` и переиспользуются
   * всеми показателями кадра: деление и взятие остатка по тридцати показателям на трех
   * уровнях - это 270 лишних операций на кадр, а кадров до 3600 в реальную секунду.
   */
  private rawIndex = 0;
  private s10Index = 0;
  private m1Index = 0;
  private rawBase = -1;
  private s10Base = -1;
  private m1Base = -1;

  /** Открыть бакеты на момент времени: вызывается один раз на секунду до записи значений. */
  openTime(timeSec: number): void {
    this.rawIndex = Math.floor(timeSec / TIERS.raw.stepSeconds);
    this.s10Index = Math.floor(timeSec / TIERS.s10.stepSeconds);
    this.m1Index = Math.floor(timeSec / TIERS.m1.stepSeconds);
    this.raw.advance(this.rawIndex);
    this.s10.advance(this.s10Index);
    this.m1.advance(this.m1Index);
    this.rawBase = this.raw.baseOf(this.rawIndex);
    this.s10Base = this.s10.baseOf(this.s10Index);
    this.m1Base = this.m1.baseOf(this.m1Index);
  }

  /**
   * Записать одну точку открытой секунды. Значение с качеством не GOOD в агрегаты не идет
   * (дыра остается дырой), но в сыром уровне сохраняется вместе с качеством - это нужно,
   * чтобы отличать STALE от дыры.
   */
  write(
    metricIndex: number,
    value: number,
    quality: Quality,
    sev: Severity,
    aggregation: MetricAggregation,
  ): void {
    if (this.rawBase >= 0) {
      this.raw.writeAt(this.rawBase, metricIndex, value, quality, sev);
    }
    if (quality !== QUALITY.GOOD || !Number.isFinite(value)) {
      return;
    }
    if (this.s10Base >= 0) {
      this.s10.accumulateAt(this.s10Base, metricIndex, value, sev, aggregation);
    }
    if (this.m1Base >= 0) {
      this.m1.accumulateAt(this.m1Base, metricIndex, value, sev, aggregation);
    }
  }

  /** Границы окна уровня в секундах или null, если в уровень еще ничего не писали. */
  window(tier: StoreTier): { from: number; to: number } | null {
    const config = TIERS[tier];
    const ring = tier === 'raw' ? this.raw : tier === 's10' ? this.s10 : this.m1;
    if (ring.headIndex === EMPTY_HEAD) {
      return null;
    }
    return {
      from: ring.tailIndex * config.stepSeconds,
      to: (ring.headIndex + 1) * config.stepSeconds,
    };
  }

  /** Значение бакета уровня. Индекс - абсолютный номер бакета этого уровня. */
  bucket(tier: StoreTier, index: number, metricIndex: number, out: BucketView): BucketView {
    if (tier === 'raw') {
      if (!this.raw.has(index)) {
        out.avg = null;
        out.min = null;
        out.max = null;
        out.sev = 3;
        out.count = 0;
        return out;
      }
      const offset = this.raw.offsetOf(index, metricIndex);
      const quality = this.raw.quality[offset] ?? QUALITY.NOT_AVAILABLE;
      const value = this.raw.values[offset] ?? Number.NaN;
      const good = quality === QUALITY.GOOD && Number.isFinite(value);
      out.avg = good ? value : null;
      out.min = out.avg;
      out.max = out.avg;
      out.sev = good ? ((this.raw.severity[offset] ?? 3) as Severity) : 3;
      out.count = good ? 1 : 0;
      return out;
    }
    const ring = tier === 's10' ? this.s10 : this.m1;
    if (!ring.has(index)) {
      out.avg = null;
      out.min = null;
      out.max = null;
      out.sev = 3;
      out.count = 0;
      return out;
    }
    const offset = ring.offsetOf(index, metricIndex);
    const count = ring.count[offset] ?? 0;
    out.count = count;
    if (count === 0) {
      out.avg = null;
      out.min = null;
      out.max = null;
      out.sev = 3;
      return out;
    }
    out.avg = ring.avg[offset] ?? null;
    out.min = ring.min[offset] ?? null;
    out.max = ring.max[offset] ?? null;
    out.sev = (ring.sev[offset] ?? 3) as Severity;
    return out;
  }

  /** Сырое значение и его качество на секунду: нужно детектору и сводке. */
  rawSample(timeSec: number, metricIndex: number): { value: number; quality: Quality } | null {
    const index = Math.floor(timeSec);
    if (!this.raw.has(index)) {
      return null;
    }
    const offset = this.raw.offsetOf(index, metricIndex);
    return {
      value: this.raw.values[offset] ?? Number.NaN,
      quality: (this.raw.quality[offset] ?? QUALITY.NOT_AVAILABLE) as Quality,
    };
  }

  /** Объем занятой памяти, байты. */
  byteLength(): number {
    return (
      this.raw.values.byteLength +
      this.raw.quality.byteLength +
      this.raw.severity.byteLength +
      this.s10.avg.byteLength * 3 +
      this.s10.sev.byteLength +
      this.s10.count.byteLength +
      this.m1.avg.byteLength * 3 +
      this.m1.sev.byteLength +
      this.m1.count.byteLength
    );
  }
}

export function emptyBucketView(): BucketView {
  return { avg: null, min: null, max: null, sev: 3, count: 0 };
}
