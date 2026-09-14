/**
 * Хранилище позиций: широта, долгота, курс и светофор с шагом 1 секунда за 24 часа
 * (раздел 6 `SPEC.md`). Отдельно от показателей, потому что трек нужен целиком за сутки,
 * а сырой уровень показателей живет только 30 минут.
 *
 * Координаты хранятся как смещение от центра карьера в микроградусах (Float32):
 * при смещении до 2 км это точность лучше сантиметра, тогда как Float32 на самих
 * градусах дает погрешность около полуметра.
 */

import { PIT_CENTER, QUALITY, type Quality, type Severity } from '@ra/contracts';

/** Глубина хранения позиций, секунды. */
export const POSITION_CAPACITY_SECONDS = 24 * 3600;

const MICRO = 1e6;

/** Курс хранится в десятых долях градуса: 0..3600. */
const HEADING_SCALE = 10;

export interface PositionSample {
  t: number;
  lat: number;
  lon: number;
  heading: number;
  sev: Severity;
}

export class PositionRing {
  private readonly capacity: number;
  private readonly latMicro: Float32Array;
  private readonly lonMicro: Float32Array;
  private readonly heading: Uint16Array;
  private readonly severity: Uint8Array;
  private readonly quality: Uint8Array;
  private head = Number.NEGATIVE_INFINITY;

  constructor(capacity: number = POSITION_CAPACITY_SECONDS) {
    this.capacity = capacity;
    this.latMicro = new Float32Array(capacity);
    this.lonMicro = new Float32Array(capacity);
    this.heading = new Uint16Array(capacity);
    this.severity = new Uint8Array(capacity);
    this.quality = new Uint8Array(capacity);
    this.quality.fill(QUALITY.NOT_AVAILABLE);
    this.severity.fill(3);
  }

  private slot(timeSec: number): number {
    return ((timeSec % this.capacity) + this.capacity) % this.capacity;
  }

  private clearSlot(slot: number): void {
    this.quality[slot] = QUALITY.NOT_AVAILABLE;
    this.severity[slot] = 3;
  }

  /** Продвинуть окно до секунды, освободив пройденные слоты. */
  advance(timeSec: number): void {
    if (this.head === Number.NEGATIVE_INFINITY) {
      this.head = timeSec;
      this.clearSlot(this.slot(timeSec));
      return;
    }
    if (timeSec <= this.head) {
      return;
    }
    const span = Math.min(timeSec - this.head, this.capacity);
    for (let i = 0; i < span; i += 1) {
      this.clearSlot(this.slot(timeSec - i));
    }
    this.head = timeSec;
  }

  has(timeSec: number): boolean {
    return (
      this.head !== Number.NEGATIVE_INFINITY &&
      timeSec <= this.head &&
      timeSec > this.head - this.capacity
    );
  }

  get headTime(): number {
    return this.head;
  }

  get tailTime(): number {
    return this.head === Number.NEGATIVE_INFINITY ? 0 : this.head - this.capacity + 1;
  }

  write(timeSec: number, lat: number, lon: number, headingDeg: number, sev: Severity): void {
    if (!this.has(timeSec)) {
      return;
    }
    const slot = this.slot(timeSec);
    this.latMicro[slot] = (lat - PIT_CENTER[0]) * MICRO;
    this.lonMicro[slot] = (lon - PIT_CENTER[1]) * MICRO;
    const normalized = ((headingDeg % 360) + 360) % 360;
    this.heading[slot] = Math.round(normalized * HEADING_SCALE);
    this.severity[slot] = sev;
    this.quality[slot] = QUALITY.GOOD;
  }

  /** Есть ли позиция на эту секунду. */
  isGood(timeSec: number): boolean {
    return this.has(timeSec) && this.quality[this.slot(timeSec)] === QUALITY.GOOD;
  }

  /** Позиция на секунду или null, если данных нет. Заполняет переданный объект. */
  read(timeSec: number, out: PositionSample): PositionSample | null {
    if (!this.isGood(timeSec)) {
      return null;
    }
    const slot = this.slot(timeSec);
    out.t = timeSec;
    out.lat = PIT_CENTER[0] + (this.latMicro[slot] ?? 0) / MICRO;
    out.lon = PIT_CENTER[1] + (this.lonMicro[slot] ?? 0) / MICRO;
    out.heading = (this.heading[slot] ?? 0) / HEADING_SCALE;
    out.sev = (this.severity[slot] ?? 3) as Severity;
    return out;
  }

  severityAt(timeSec: number): Severity {
    if (!this.isGood(timeSec)) {
      return 3;
    }
    return (this.severity[this.slot(timeSec)] ?? 3) as Severity;
  }

  qualityAt(timeSec: number): Quality {
    if (!this.has(timeSec)) {
      return QUALITY.NOT_AVAILABLE;
    }
    return (this.quality[this.slot(timeSec)] ?? QUALITY.NOT_AVAILABLE) as Quality;
  }

  byteLength(): number {
    return (
      this.latMicro.byteLength +
      this.lonMicro.byteLength +
      this.heading.byteLength +
      this.severity.byteLength +
      this.quality.byteLength
    );
  }
}

export function emptyPositionSample(): PositionSample {
  return { t: 0, lat: 0, lon: 0, heading: 0, sev: 3 };
}
