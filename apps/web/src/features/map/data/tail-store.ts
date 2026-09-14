/**
 * Хвосты треков в форме, удобной циклу отрисовки.
 *
 * Трек собирается из двух источников: история приезжает ответом `GET /api/telemetry/track`,
 * свежие точки - тиками websocket (`snapshotStore.getPositions`).
 *
 * Хранилище намеренно mutable и наращивается по месту. Пересборка хвостов из ответа плюс
 * живого буфера на каждом тике означала бы при 60 машинах десятки тысяч скопированных точек
 * и несколько сотен новых типизированных массивов четыре раза в секунду - это тот же расход,
 * от которого в `shared/ws/snapshot-store.ts` уводили снапшоты. Здесь история кладется один
 * раз на ответ сервера, а живые точки дописываются в хвост массива.
 *
 * Точки лежат по столбцам в типизированных массивах, а не массивом объектов: цикл отрисовки
 * обходит их целиком каждый кадр.
 */

import type { Severity, TrackPoint, TrackResponse } from '@ra/contracts';

/** Флажок бита на треке. */
export interface TrackMark {
  vehicleId: string;
  t: number;
  lat: number;
  lon: number;
  code: string;
  severity: Severity;
}

export interface VehicleTail {
  vehicleId: string;
  /** Времена точек, строго возрастают. */
  readonly t: Float64Array;
  readonly lat: Float64Array;
  readonly lon: Float64Array;
  /** Курс из `POSITION_HEADING`, градусы. */
  readonly heading: Float64Array;
  readonly sev: Uint8Array;
  /** 1 - перед этой точкой трек рвется (разрыв данных), соединять с предыдущей нельзя. */
  readonly broken: Uint8Array;
  readonly count: number;
  readonly marks: TrackMark[];
}

/**
 * Минимальный разрыв, который рвет линию, секунды. Считается от фактического шага точек,
 * потому что сервер прореживает трек тем сильнее, чем длиннее период (раздел 5.3 `SPEC.md`):
 * на сутках нормальный шаг - минуты, и фиксированный порог рвал бы сплошной трек.
 */
const BREAK_FACTOR = 5;
const MIN_BREAK_SECONDS = 60;

/** Запас емкости сверх истории: сюда дописываются живые точки. */
const SPARE_CAPACITY = 256;

/**
 * Сколько устаревших точек накопить, прежде чем сдвигать массив. Обрезать хвост в каждом
 * кадре нельзя: граница окна едет непрерывно, и сдвиг ради одной точки съел бы выигрыш.
 */
const TRIM_BATCH = 64;

class MutableTail {
  vehicleId: string;
  t: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  heading: Float64Array;
  sev: Uint8Array;
  broken: Uint8Array;
  count = 0;
  marks: TrackMark[] = [];
  /** Порог разрыва для этого трека, секунды: зависит от прореживания ответа. */
  breakSeconds = MIN_BREAK_SECONDS;

  constructor(vehicleId: string, capacity: number) {
    this.vehicleId = vehicleId;
    this.t = new Float64Array(capacity);
    this.lat = new Float64Array(capacity);
    this.lon = new Float64Array(capacity);
    this.heading = new Float64Array(capacity);
    this.sev = new Uint8Array(capacity);
    this.broken = new Uint8Array(capacity);
  }

  private grow(needed: number): void {
    if (needed <= this.t.length) {
      return;
    }
    const capacity = Math.max(needed, this.t.length * 2);
    const t = new Float64Array(capacity);
    t.set(this.t.subarray(0, this.count));
    const lat = new Float64Array(capacity);
    lat.set(this.lat.subarray(0, this.count));
    const lon = new Float64Array(capacity);
    lon.set(this.lon.subarray(0, this.count));
    const heading = new Float64Array(capacity);
    heading.set(this.heading.subarray(0, this.count));
    const sev = new Uint8Array(capacity);
    sev.set(this.sev.subarray(0, this.count));
    const broken = new Uint8Array(capacity);
    broken.set(this.broken.subarray(0, this.count));
    this.t = t;
    this.lat = lat;
    this.lon = lon;
    this.heading = heading;
    this.sev = sev;
    this.broken = broken;
  }

  reset(capacity: number): void {
    this.count = 0;
    this.marks = [];
    this.grow(capacity);
  }

  push(point: TrackPoint): void {
    this.grow(this.count + 1);
    const index = this.count;
    if (index > 0) {
      const previous = this.t[index - 1] as number;
      this.broken[index] = point[0] - previous > this.breakSeconds ? 1 : 0;
    } else {
      this.broken[index] = 0;
    }
    this.t[index] = point[0];
    this.lat[index] = point[1];
    this.lon[index] = point[2];
    this.heading[index] = point[3];
    this.sev[index] = point[4];
    this.count = index + 1;
  }

  /** Помечает разрывы по интервалам `gaps` из ответа сервера. */
  markGaps(gaps: readonly (readonly [number, number])[]): void {
    if (gaps.length === 0) {
      return;
    }
    for (let i = 1; i < this.count; i += 1) {
      const from = this.t[i - 1] as number;
      const to = this.t[i] as number;
      for (const gap of gaps) {
        if (gap[0] < to && gap[1] > from) {
          this.broken[i] = 1;
          break;
        }
      }
    }
  }

  /** Сдвигает начало хвоста, выбрасывая точки старше `from`. */
  trim(from: number): void {
    let drop = 0;
    while (drop < this.count && (this.t[drop] as number) < from) {
      drop += 1;
    }
    if (drop < TRIM_BATCH) {
      return;
    }
    const rest = this.count - drop;
    this.t.copyWithin(0, drop, this.count);
    this.lat.copyWithin(0, drop, this.count);
    this.lon.copyWithin(0, drop, this.count);
    this.heading.copyWithin(0, drop, this.count);
    this.sev.copyWithin(0, drop, this.count);
    this.broken.copyWithin(0, drop, this.count);
    this.count = rest;
    if (rest > 0) {
      // Первая точка ни с чем не соединяется, признак разрыва на ней больше не нужен.
      this.broken[0] = 0;
    }
    this.marks = this.marks.filter((mark) => mark.t >= from);
  }

  lastTime(): number {
    return this.count === 0 ? Number.NEGATIVE_INFINITY : (this.t[this.count - 1] as number);
  }
}

/** Медиана интервалов: устойчива к одиночным большим разрывам. */
function medianDelta(points: readonly TrackPoint[]): number {
  if (points.length < 3) {
    return 0;
  }
  const deltas: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    deltas.push((points[i] as TrackPoint)[0] - (points[i - 1] as TrackPoint)[0]);
  }
  deltas.sort((a, b) => a - b);
  return deltas[deltas.length >> 1] ?? 0;
}

export class TailStore {
  private readonly tails = new Map<string, MutableTail>();
  /** Ответ трека, по которому собрана история: смена ссылки означает пересборку. */
  private historyToken: TrackResponse | undefined;
  private version = 0;

  getVersion(): number {
    return this.version;
  }

  /**
   * Загрузка истории. Полностью пересобирает хвосты - это происходит на смене периода,
   * отслеживаемых показателей или при сдвиге окна (раз в несколько секунд), а не в кадре.
   */
  setHistory(track: TrackResponse | undefined, from: number, to: number): boolean {
    if (track === this.historyToken) {
      return false;
    }
    this.historyToken = track;
    const seen = new Set<string>();
    for (const entry of track?.tracks ?? []) {
      seen.add(entry.vehicleId);
      const tail =
        this.tails.get(entry.vehicleId) ??
        new MutableTail(entry.vehicleId, entry.points.length + SPARE_CAPACITY);
      this.tails.set(entry.vehicleId, tail);
      tail.reset(entry.points.length + SPARE_CAPACITY);
      tail.breakSeconds = Math.max(MIN_BREAK_SECONDS, medianDelta(entry.points) * BREAK_FACTOR);
      for (const point of entry.points) {
        if (point[0] >= from && point[0] <= to) {
          tail.push(point);
        }
      }
      tail.markGaps(entry.gaps);
      tail.marks = entry.marks
        .filter((mark) => mark.t >= from && mark.t <= to)
        .map((mark) => ({
          vehicleId: entry.vehicleId,
          t: mark.t,
          lat: mark.lat,
          lon: mark.lon,
          code: mark.code,
          severity: mark.severity,
        }));
    }
    // Машины, пропавшие из ответа (уменьшили парк, сменили период), теряют хвост.
    for (const vehicleId of [...this.tails.keys()]) {
      if (!seen.has(vehicleId)) {
        this.tails.delete(vehicleId);
      }
    }
    this.version += 1;
    return true;
  }

  /** Дописывает живые точки с прошлого раза: все, что новее последней известной. */
  appendLive(vehicleId: string, points: readonly TrackPoint[], to: number): void {
    if (points.length === 0) {
      return;
    }
    let tail = this.tails.get(vehicleId);
    if (tail === undefined) {
      // Машина появилась в снапшоте раньше, чем доехал ответ трека.
      tail = new MutableTail(vehicleId, SPARE_CAPACITY);
      this.tails.set(vehicleId, tail);
    }
    const last = tail.lastTime();
    let appended = false;
    for (const point of points) {
      if (point[0] > last && point[0] <= to) {
        tail.push(point);
        appended = true;
      }
    }
    if (appended) {
      this.version += 1;
    }
  }

  /** Выбрасывает точки, ушедшие за левую границу окна. */
  trim(from: number): void {
    for (const tail of this.tails.values()) {
      tail.trim(from);
    }
  }

  /** Добавляет флажок бита, пришедший сообщением `events`, на текущую позицию машины. */
  addMark(mark: TrackMark): void {
    const tail = this.tails.get(mark.vehicleId);
    if (tail === undefined) {
      return;
    }
    if (tail.marks.some((item) => item.t === mark.t && item.code === mark.code)) {
      return;
    }
    tail.marks.push(mark);
    this.version += 1;
  }

  /** Хвосты для кадра отрисовки. Объекты те же самые: копий здесь не делается. */
  entries(): ReadonlyMap<string, VehicleTail> {
    return this.tails;
  }

  get(vehicleId: string): VehicleTail | undefined {
    return this.tails.get(vehicleId);
  }

  clear(): void {
    this.tails.clear();
    this.historyToken = undefined;
    this.version += 1;
  }
}

/**
 * Индекс первой точки хвоста: первая точка со временем не раньше `fromTime`.
 * Двоичный поиск, потому что вызывается в каждом кадре на каждую машину.
 */
export function tailStartIndex(tail: VehicleTail, fromTime: number): number {
  let lo = 0;
  let hi = tail.count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((tail.t[mid] as number) < fromTime) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}
