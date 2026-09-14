/**
 * Цикл отрисовки оверлея: один canvas, один проход по кадру, порядок слоев из раздела 3 этапа
 * (хвосты, флажки, машины, флажок монитора). Всплывашки живут в DOM поверх canvas, поэтому
 * здесь их нет.
 *
 * Состояние между кадрами (сглаженный курс) хранится в самом рендерере: это не состояние
 * приложения, перерисовывать из-за него React нечего.
 */

import { METRIC_INDEX, SEVERITY, type Severity, type VehicleSnapshot } from '@ra/contracts';
import { isNoDataAlarm } from '../data/no-data.js';
import { tailStartIndex, type VehicleTail } from '../data/tail-store.js';
import type { MapProjector, ScreenPoint } from '../provider/types.js';
import { bandCount, drawTail } from './draw-tail.js';
import {
  drawMarkFlag,
  drawMonitorFlag,
  drawVehicle,
  iconScale,
  labelsVisible,
  type VehicleView,
} from './draw-vehicles.js';
import type { MapPalette } from './palette.js';

/**
 * Доля, на которую сглаженный курс подтягивается к новому значению за кадр. Меньше -
 * спокойнее, но машина дольше доворачивает после поворота. Экспоненциальное сглаживание
 * выбрано вместо среднего по трем точкам, потому что не требует хранить историю и одинаково
 * работает и на редких точках суточного трека, и на частых живых.
 */
const HEADING_SMOOTHING = 0.25;

/*
 * Радиусы притяжения курсора, пиксели. Элементы намеренно ловятся с запасом: в карьере
 * машина размером в два десятка пикселей едет по треку толщиной в три, и попадать в них
 * пиксель в пиксель - работа, а не управление. Радиусы разные, потому что разные и цели:
 * машина крупнее флажка, а трек - линия, у которой "промах" меряется поперек.
 */
export const VEHICLE_HIT_RADIUS = 22;
export const MARK_HIT_RADIUS = 15;
export const MONITOR_HIT_RADIUS = 15;
/** Радиус попадания по точке трека: половина ширины хвоста плюс запас. */
export const POINT_HIT_RADIUS = 10;

/** Запас за краем области, в пределах которого машина еще рисуется, пиксели. */
const VEHICLE_CULL_MARGIN_PX = 48;

/** Середина древка флажка над его точкой, пиксели: по ней флажок и ловится курсором. */
const FLAG_STEM_CENTER_PX = 8;

export interface VehicleMeta {
  vehicleId: string;
  sideNumber: string;
}

export interface FrameInput {
  /** Виртуальное время, на которое рисуется кадр. */
  now: number;
  /** Левая граница хвоста: `now` минус длина хвоста. */
  tailFrom: number;
  tails: ReadonlyMap<string, VehicleTail>;
  meta: ReadonlyMap<string, VehicleMeta>;
  /** Снапшот машины: функция, а не словарь - хранилище снапшотов mutable и словаря не держит. */
  snapshot: (vehicleId: string) => VehicleSnapshot | undefined;
  selectedVehicleId: string | null;
  monitorTs: number | null;
  /** То, на что наведен курсор: подсвечивается целиком. */
  hover: HoverTarget | null;
  palette: MapPalette;
  defaultZoom: number;
}

/**
 * Чей хвост рисуется. Когда машина выбрана, на карте остается только ее трек: пять десятков
 * чужих хвостов вдоль той же дороги не дают разглядеть тот единственный, ради которого машину
 * и выбрали. Сами машины при этом никуда не деваются - парк должен быть виден целиком.
 */
export function tailVisible(vehicleId: string, selectedVehicleId: string | null): boolean {
  return selectedVehicleId === null || selectedVehicleId === vehicleId;
}

export interface VehicleHit {
  vehicleId: string;
  x: number;
  y: number;
}

export interface MarkHit {
  vehicleId: string;
  t: number;
  code: string;
  severity: Severity;
  x: number;
  y: number;
}

/** Флажок монитора: такая же цель для курсора, как и остальные. */
export interface MonitorHit {
  vehicleId: string;
  t: number;
  x: number;
  y: number;
}

/**
 * То, на что наведен или по чему кликнут курсор.
 *
 * Приоритет разбора - машина, флажок события, флажок монитора, хвост. Он не случаен:
 * чем мельче и конкретнее объект, тем выше он должен стоять, иначе крупный хвост, вдоль
 * которого все и расставлено, перехватывал бы каждое наведение.
 */
export type HoverTarget =
  | { kind: 'vehicle'; vehicleId: string }
  | { kind: 'mark'; vehicleId: string; t: number; code: string; severity: Severity }
  | { kind: 'monitor'; vehicleId: string; t: number }
  | { kind: 'tail'; vehicleId: string; t: number; lat: number; lon: number; severity: Severity };

/** Совпадают ли две цели: наведение не должно пересоздавать состояние на каждый пиксель. */
export function sameTarget(a: HoverTarget | null, b: HoverTarget | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  if (a.kind !== b.kind || a.vehicleId !== b.vehicleId) {
    return false;
  }
  switch (a.kind) {
    case 'vehicle':
      return true;
    case 'mark':
      return a.t === (b as { t: number }).t && a.code === (b as { code: string }).code;
    default:
      return a.t === (b as { t: number }).t;
  }
}

/** Значение показателя из компактного снапшота или null. */
function metric(snapshot: VehicleSnapshot | undefined, index: number): number | null {
  if (snapshot === undefined) {
    return null;
  }
  return snapshot.v[index] ?? null;
}

/** Позиция и курс на момент `time`: интерполяция между точками трека. */
interface Sample {
  lat: number;
  lon: number;
  heading: number;
  severity: Severity;
  found: boolean;
}

const sample: Sample = { lat: 0, lon: 0, heading: 0, severity: SEVERITY.UNKNOWN, found: false };

/**
 * Выборка из хвоста на заданный момент. Между тиками позиция интерполируется, иначе при
 * четырех тиках в секунду машина ехала бы рывками (раздел 5 этапа).
 */
function sampleTail(tail: VehicleTail, time: number): Sample {
  sample.found = false;
  const count = tail.count;
  if (count === 0) {
    return sample;
  }
  const lastIndex = count - 1;
  const lastTime = tail.t[lastIndex] as number;
  if (time >= lastTime) {
    sample.lat = tail.lat[lastIndex] as number;
    sample.lon = tail.lon[lastIndex] as number;
    sample.heading = tail.heading[lastIndex] as number;
    sample.severity = tail.sev[lastIndex] as Severity;
    sample.found = true;
    return sample;
  }
  let lo = 0;
  let hi = lastIndex;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((tail.t[mid] as number) < time) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  const index = Math.max(1, lo);
  const previous = index - 1;
  const t0 = tail.t[previous] as number;
  const t1 = tail.t[index] as number;
  // Через разрыв интерполировать нельзя: машина там не ехала по прямой, данных просто нет.
  const k = t1 > t0 && tail.broken[index] !== 1 ? (time - t0) / (t1 - t0) : 0;
  const lat0 = tail.lat[previous] as number;
  const lon0 = tail.lon[previous] as number;
  sample.lat = lat0 + ((tail.lat[index] as number) - lat0) * k;
  sample.lon = lon0 + ((tail.lon[index] as number) - lon0) * k;
  sample.heading = tail.heading[k < 0.5 ? previous : index] as number;
  sample.severity = tail.sev[k < 0.5 ? previous : index] as Severity;
  sample.found = true;
  return sample;
}

/** Курс по вектору двух последних точек: страховка, когда `POSITION_HEADING` недоступен. */
function headingFromTrack(tail: VehicleTail, index: number): number | null {
  if (index < 1) {
    return null;
  }
  const lat1 = tail.lat[index] as number;
  const lon1 = tail.lon[index] as number;
  const lat0 = tail.lat[index - 1] as number;
  const lon0 = tail.lon[index - 1] as number;
  const dy = lat1 - lat0;
  const dx = (lon1 - lon0) * Math.cos((lat1 * Math.PI) / 180);
  if (dx === 0 && dy === 0) {
    return null;
  }
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

export class OverlayRenderer {
  /** Сглаженный курс по машинам, в виде вектора: усреднять градусы напрямую нельзя,
   *  переход через 360 дал бы разворот машины на месте. */
  private readonly headingSin = new Map<string, number>();
  private readonly headingCos = new Map<string, number>();

  /** Цели попадания курсора, пересобираются каждый кадр. */
  readonly vehicleHits: VehicleHit[] = [];
  readonly markHits: MarkHit[] = [];
  monitorHit: MonitorHit | null = null;

  private readonly point: ScreenPoint = { x: 0, y: 0 };

  reset(): void {
    this.headingSin.clear();
    this.headingCos.clear();
  }

  private smoothHeading(vehicleId: string, heading: number): number {
    const rad = (heading * Math.PI) / 180;
    const sin = Math.sin(rad);
    const cos = Math.cos(rad);
    const previousSin = this.headingSin.get(vehicleId);
    const previousCos = this.headingCos.get(vehicleId);
    if (previousSin === undefined || previousCos === undefined) {
      this.headingSin.set(vehicleId, sin);
      this.headingCos.set(vehicleId, cos);
      return heading;
    }
    const nextSin = previousSin + (sin - previousSin) * HEADING_SMOOTHING;
    const nextCos = previousCos + (cos - previousCos) * HEADING_SMOOTHING;
    this.headingSin.set(vehicleId, nextSin);
    this.headingCos.set(vehicleId, nextCos);
    return ((Math.atan2(nextSin, nextCos) * 180) / Math.PI + 360) % 360;
  }

  render(ctx: CanvasRenderingContext2D, projector: MapProjector, frame: FrameInput): void {
    // Полотно чистит вызывающая сторона: под оверлеем может лежать схема карьера,
    // нарисованная тем же canvas, и стирать ее здесь было бы нельзя.
    const { palette, selectedVehicleId } = frame;

    this.vehicleHits.length = 0;
    this.markHits.length = 0;
    this.monitorHit = null;

    const hover = frame.hover;

    const vehicleIds = [...frame.meta.keys()];
    const bands = bandCount(vehicleIds.length);
    const scale = iconScale(projector.zoom, frame.defaultZoom);
    const withLabels = labelsVisible(projector.zoom, vehicleIds.length);

    // Выбранная машина рисуется последней: ее хвост и пиктограмма должны лежать поверх.
    const order = vehicleIds.slice().sort((a, b) => {
      if (a === selectedVehicleId) {
        return 1;
      }
      if (b === selectedVehicleId) {
        return -1;
      }
      return 0;
    });

    const views: VehicleView[] = [];

    /* ----------------------------------------------------------- слой 1: хвосты */
    for (const vehicleId of order) {
      const tail = frame.tails.get(vehicleId);
      const selected = vehicleId === selectedVehicleId;
      if (tail !== undefined && tailVisible(vehicleId, selectedVehicleId)) {
        drawTail(ctx, projector, tail, {
          fromTime: frame.tailFrom,
          bands,
          palette,
          selected,
          highlighted: hover?.kind === 'tail' && hover.vehicleId === vehicleId,
        });
      }

      const view = this.buildView(vehicleId, frame, tail);
      if (view !== null) {
        views.push(view);
      }
    }

    /* ------------------------------------------------- слой 2: флажки битов на треке */
    for (const vehicleId of order) {
      const tail = frame.tails.get(vehicleId);
      // Флажки живут на хвосте: скрыт хвост - скрыты и они.
      if (tail === undefined || !tailVisible(vehicleId, selectedVehicleId)) {
        continue;
      }
      for (const mark of tail.marks) {
        // Флажок исчезает, когда хвост уходит дальше этой точки (раздел 6 этапа).
        if (mark.t < frame.tailFrom || mark.t > frame.now) {
          continue;
        }
        projector.project(mark.lat, mark.lon, this.point);
        const { x, y } = this.point;
        if (x < -30 || y < -30 || x > projector.width + 30 || y > projector.height + 30) {
          continue;
        }
        const hovered =
          hover?.kind === 'mark' &&
          hover.vehicleId === vehicleId &&
          hover.t === mark.t &&
          hover.code === mark.code;
        drawMarkFlag(ctx, x, y, mark.severity, palette, hovered);
        this.markHits.push({
          vehicleId,
          t: mark.t,
          code: mark.code,
          severity: mark.severity,
          x,
          y,
        });
      }
    }

    /* ----------------------------------------------------------- слой 3: машины */
    for (const view of views) {
      // Машина за краем области не рисуется и в цели попадания не попадает.
      projector.project(view.lat, view.lon, this.point);
      if (
        this.point.x < -VEHICLE_CULL_MARGIN_PX ||
        this.point.y < -VEHICLE_CULL_MARGIN_PX ||
        this.point.x > projector.width + VEHICLE_CULL_MARGIN_PX ||
        this.point.y > projector.height + VEHICLE_CULL_MARGIN_PX
      ) {
        continue;
      }
      const position = drawVehicle(ctx, projector, view, {
        palette,
        scale,
        withLabel: withLabels || view.selected,
        hovered: hover?.kind === 'vehicle' && hover.vehicleId === view.vehicleId,
      });
      this.vehicleHits.push({ vehicleId: view.vehicleId, x: position.x, y: position.y });
    }

    /* ------------------------------------------------------ слой 4: флажок монитора */
    if (frame.monitorTs !== null && selectedVehicleId !== null) {
      const tail = frame.tails.get(selectedVehicleId);
      if (tail !== undefined && frame.monitorTs >= frame.tailFrom && frame.monitorTs <= frame.now) {
        const at = sampleTail(tail, frame.monitorTs);
        if (at.found) {
          projector.project(at.lat, at.lon, this.point);
          const { x, y } = this.point;
          drawMonitorFlag(ctx, x, y, palette, hover?.kind === 'monitor');
          this.monitorHit = { vehicleId: selectedVehicleId, t: frame.monitorTs, x, y };
        }
      }
    }
  }

  /** Что и где рисовать для одной машины: позиция, курс, светофор, признак отсутствия данных. */
  private buildView(
    vehicleId: string,
    frame: FrameInput,
    tail: VehicleTail | undefined,
  ): VehicleView | null {
    const meta = frame.meta.get(vehicleId);
    if (meta === undefined) {
      return null;
    }
    const snapshot = frame.snapshot(vehicleId);
    const noData = isNoDataAlarm(snapshot);

    let lat: number | null = null;
    let lon: number | null = null;
    let heading = 0;

    if (tail !== undefined && tail.count > 0) {
      const at = sampleTail(tail, frame.now);
      lat = at.lat;
      lon = at.lon;
      heading = at.heading;
      if (heading === 0) {
        // Курс недоступен - считаем по вектору последних точек.
        heading = headingFromTrack(tail, tail.count - 1) ?? 0;
      }
    } else {
      // Трека за период нет, но последняя известная позиция есть: машина без данных
      // все равно должна быть видна на карте, иначе про нее нечего и спросить.
      lat = metric(snapshot, METRIC_INDEX.POSITION_LATITUDE);
      lon = metric(snapshot, METRIC_INDEX.POSITION_LONGITUDE);
      heading = metric(snapshot, METRIC_INDEX.POSITION_HEADING) ?? 0;
    }

    if (lat === null || lon === null) {
      return null;
    }

    return {
      vehicleId,
      sideNumber: meta.sideNumber,
      lat,
      lon,
      // Машина всегда красится по всем показателям, а не только по отслеживаемым
      // (раздел 5 этапа), поэтому светофор берется из снапшота, а не из точки трека.
      heading: this.smoothHeading(vehicleId, heading),
      severity: noData ? SEVERITY.UNKNOWN : (snapshot?.sev ?? SEVERITY.UNKNOWN),
      noData,
      selected: vehicleId === frame.selectedVehicleId,
    };
  }
}

/** Ближайшая к курсору машина в пределах радиуса. */
export function hitVehicle(hits: readonly VehicleHit[], x: number, y: number): VehicleHit | null {
  let best: VehicleHit | null = null;
  let bestDistance = VEHICLE_HIT_RADIUS * VEHICLE_HIT_RADIUS;
  for (const hit of hits) {
    const dx = hit.x - x;
    const dy = hit.y - y;
    const distance = dx * dx + dy * dy;
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = hit;
    }
  }
  return best;
}

/** Ближайший флажок в пределах радиуса. Флажок ловится по своему древку и полотнищу. */
export function hitMark(hits: readonly MarkHit[], x: number, y: number): MarkHit | null {
  let best: MarkHit | null = null;
  let bestDistance = MARK_HIT_RADIUS * MARK_HIT_RADIUS;
  for (const hit of hits) {
    const dx = hit.x - x;
    // Флажок нарисован вверх от точки: проверяем по середине древка.
    const dy = hit.y - FLAG_STEM_CENTER_PX - y;
    const distance = dx * dx + dy * dy;
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = hit;
    }
  }
  return best;
}

/** Флажок монитора ловится так же, как битовый: по середине древка. */
export function hitMonitor(hit: MonitorHit | null, x: number, y: number): MonitorHit | null {
  if (hit === null) {
    return null;
  }
  const dx = hit.x - x;
  const dy = hit.y - FLAG_STEM_CENTER_PX - y;
  return dx * dx + dy * dy <= MONITOR_HIT_RADIUS * MONITOR_HIT_RADIUS ? hit : null;
}

export interface TrackPointHit {
  vehicleId: string;
  t: number;
  lat: number;
  lon: number;
  severity: Severity;
}

/**
 * Ближайшая точка трека к курсору. Обход всех точек хвоста делается только по клику,
 * а не в кадре: на 60 машинах это десять тысяч точек, и в каждом кадре такой проход лишний.
 */
export function hitTrackPoint(
  tails: ReadonlyMap<string, VehicleTail>,
  projector: MapProjector,
  tailFrom: number,
  x: number,
  y: number,
  selectedVehicleId: string | null = null,
): TrackPointHit | null {
  const from: ScreenPoint = { x: 0, y: 0 };
  const to: ScreenPoint = { x: 0, y: 0 };
  let best: TrackPointHit | null = null;
  let bestDistance = POINT_HIT_RADIUS * POINT_HIT_RADIUS;

  for (const tail of tails.values()) {
    // Скрытый хвост курсор не ловит: невидимое не должно быть кликабельным.
    if (!tailVisible(tail.vehicleId, selectedVehicleId)) {
      continue;
    }
    const start = tailStartIndex(tail, tailFrom);
    for (let i = start; i < tail.count - 1; i += 1) {
      // Через разрыв линии нет - ловить там нечего.
      if (tail.broken[i + 1] === 1) {
        continue;
      }
      projector.project(tail.lat[i] as number, tail.lon[i] as number, from);
      projector.project(tail.lat[i + 1] as number, tail.lon[i + 1] as number, to);

      /*
       * Расстояние до отрезка, а не до его концов. Точки трека стоят через десятки метров,
       * и на ближнем зуме между соседними точками сотни пикселей: измеряя расстояние до
       * точек, курсор ловил бы хвост только у самих точек, а между ними линия оказывалась
       * бы «дырявой» - при том что нарисована она сплошной.
       */
      const segmentX = to.x - from.x;
      const segmentY = to.y - from.y;
      const lengthSquared = segmentX * segmentX + segmentY * segmentY;
      const k =
        lengthSquared === 0
          ? 0
          : Math.min(
              1,
              Math.max(0, ((x - from.x) * segmentX + (y - from.y) * segmentY) / lengthSquared),
            );
      const dx = from.x + segmentX * k - x;
      const dy = from.y + segmentY * k - y;
      const distance = dx * dx + dy * dy;
      if (distance > bestDistance) {
        continue;
      }
      bestDistance = distance;
      // Монитор встает на настоящую точку трека, поэтому берется ближний конец отрезка.
      const index = k < 0.5 ? i : i + 1;
      best = {
        vehicleId: tail.vehicleId,
        t: tail.t[index] as number,
        lat: tail.lat[index] as number,
        lon: tail.lon[index] as number,
        severity: tail.sev[index] as Severity,
      };
    }
  }
  return best;
}

/**
 * Что под курсором - единственная точка входа для наведения и для щелчка.
 *
 * Порядок разбора и есть приоритет: машина, флажок события, флажок монитора, хвост.
 * Обе стороны - и наведение, и клик - обязаны разбирать цели одинаково, иначе подсветится
 * одно, а откроется другое.
 */
export function pickTarget(
  renderer: OverlayRenderer,
  tails: ReadonlyMap<string, VehicleTail>,
  projector: MapProjector,
  tailFrom: number,
  selectedVehicleId: string | null,
  x: number,
  y: number,
): HoverTarget | null {
  const vehicle = hitVehicle(renderer.vehicleHits, x, y);
  if (vehicle !== null) {
    return { kind: 'vehicle', vehicleId: vehicle.vehicleId };
  }
  const mark = hitMark(renderer.markHits, x, y);
  if (mark !== null) {
    return {
      kind: 'mark',
      vehicleId: mark.vehicleId,
      t: mark.t,
      code: mark.code,
      severity: mark.severity,
    };
  }
  const monitor = hitMonitor(renderer.monitorHit, x, y);
  if (monitor !== null) {
    return { kind: 'monitor', vehicleId: monitor.vehicleId, t: monitor.t };
  }
  const point = hitTrackPoint(tails, projector, tailFrom, x, y, selectedVehicleId);
  if (point !== null) {
    return {
      kind: 'tail',
      vehicleId: point.vehicleId,
      t: point.t,
      lat: point.lat,
      lon: point.lon,
      severity: point.severity,
    };
  }
  return null;
}
