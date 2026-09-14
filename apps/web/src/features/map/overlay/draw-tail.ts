/**
 * Кометный хвост трека.
 *
 * Три требования раздела 4 этапа тянут в разные стороны: цвет задается каждой точкой,
 * затухание - непрерывная функция вдоль хвоста, а рисовать надо сегментами, а не точками.
 * Решение - разбить хвост на полосы по возрасту: внутри полосы ширина и прозрачность
 * постоянны, поэтому полоса рисуется одним `stroke`, а смена цвета светофора внутри полосы
 * просто начинает новый прогон. На практике прогонов выходит немного: светофор меняется
 * редко, а полос фиксированное число.
 */

import type { Severity } from '@ra/contracts';
import { tailStartIndex, type VehicleTail } from '../data/tail-store.js';
import type { MapProjector, ScreenPoint } from '../provider/types.js';
import type { MapPalette } from './palette.js';

/**
 * Сколько полос по возрасту. Больше полос - глаже затухание и больше вызовов `stroke`:
 * число прогонов на машину не меньше числа полос. При большом парке полос меньше - на
 * 60 машинах разница в плавности затухания не видна, а вызовов становится втрое меньше.
 */
const BANDS_FEW_VEHICLES = 18;
const BANDS_MANY_VEHICLES = 8;
const MANY_VEHICLES = 12;

/** Доля хвоста от головы, после которой начинается сужение. */
const NARROW_FROM = 2 / 3;
/** Доля хвоста от головы, после которой начинается затухание прозрачности. */
const FADE_FROM = 0.5;

/** Ширина линии у головы и у самого края хвоста, доли базовой ширины. */
const WIDTH_AT_TAIL = 0.22;
const ALPHA_AT_TAIL = 0.1;

/** Запас за краем области, в пределах которого прогон все еще рисуется, пиксели. */
const CULL_MARGIN_PX = 24;

/**
 * Во сколько раз ярче становится подсвеченный хвост. Именно прозрачность, а не цвет:
 * цвет здесь несет смысл - это светофор точки, и подменять его на «цвет наведения» нельзя.
 */
const HIGHLIGHT_ALPHA_BOOST = 2.2;

/** Базовая ширина хвоста в пикселях у головы. */
const BASE_WIDTH_PX = 3.4;
/** Ширина хвоста выбранной машины: ее трек должен читаться поверх остальных. */
const SELECTED_WIDTH_PX = 4.6;

export function bandCount(vehicleCount: number): number {
  return vehicleCount > MANY_VEHICLES ? BANDS_MANY_VEHICLES : BANDS_FEW_VEHICLES;
}

/** Ширина в доле от базовой: сужение только в последней трети (раздел 4 этапа). */
export function widthFactor(age: number): number {
  if (age <= NARROW_FROM) {
    return 1;
  }
  const k = (age - NARROW_FROM) / (1 - NARROW_FROM);
  return 1 + (WIDTH_AT_TAIL - 1) * k;
}

/** Прозрачность: снижается начиная с середины хвоста. */
export function alphaFactor(age: number): number {
  if (age <= FADE_FROM) {
    return 1;
  }
  const k = (age - FADE_FROM) / (1 - FADE_FROM);
  return 1 + (ALPHA_AT_TAIL - 1) * k;
}

export interface DrawTailOptions {
  fromTime: number;
  bands: number;
  palette: MapPalette;
  selected: boolean;
  /** Курсор наведен на этот хвост: подсвечивается весь трек целиком, а не одна точка. */
  highlighted: boolean;
}

const point: ScreenPoint = { x: 0, y: 0 };

/**
 * Рисует хвост одной машины. Возвращает индекс головной точки или -1, если рисовать нечего:
 * вызывающая сторона берет из него позицию машины, чтобы не искать ее второй раз.
 */
export function drawTail(
  ctx: CanvasRenderingContext2D,
  projector: MapProjector,
  tail: VehicleTail,
  options: DrawTailOptions,
): number {
  const start = tailStartIndex(tail, options.fromTime);
  const last = tail.count - 1;
  const span = last - start;
  if (span < 1) {
    return last >= 0 ? last : -1;
  }

  const { bands, palette, selected, highlighted } = options;
  /*
   * Подсветка утолщает и проявляет весь хвост разом: наведение относится к треку целиком,
   * а не к точке под курсором, поэтому подсвечивать надо то, что будет выбрано.
   */
  const baseWidth = (selected ? SELECTED_WIDTH_PX : BASE_WIDTH_PX) * (highlighted ? 1.5 : 1);
  const alphaBoost = highlighted ? HIGHLIGHT_ALPHA_BOOST : 1;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  /** Полоса возраста точки: 0 у головы, `bands - 1` у края хвоста. */
  const bandOf = (index: number): number => {
    const age = (last - index) / span;
    return Math.min(bands - 1, Math.floor(age * bands));
  };

  const strokeRun = (from: number, to: number, band: number, severity: Severity): void => {
    if (to <= from) {
      return;
    }
    // Возраст середины полосы: ширина и прозрачность внутри полосы постоянны.
    const age = (band + 0.5) / bands;
    // Габариты прогона копятся по ходу построения пути: отдельного прохода это не стоит,
    // а растеризацию заведомо невидимого куска трека экономит. На ближнем зуме за экраном
    // остается почти весь хвост, и без отсечения рисовались бы все шестьдесят целиком.
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    ctx.beginPath();
    for (let i = from; i <= to; i += 1) {
      projector.project(tail.lat[i] as number, tail.lon[i] as number, point);
      if (point.x < minX) {
        minX = point.x;
      }
      if (point.x > maxX) {
        maxX = point.x;
      }
      if (point.y < minY) {
        minY = point.y;
      }
      if (point.y > maxY) {
        maxY = point.y;
      }
      if (i === from) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    }
    if (
      maxX < -CULL_MARGIN_PX ||
      maxY < -CULL_MARGIN_PX ||
      minX > projector.width + CULL_MARGIN_PX ||
      minY > projector.height + CULL_MARGIN_PX
    ) {
      return;
    }
    ctx.lineWidth = baseWidth * widthFactor(age);
    ctx.globalAlpha = Math.min(1, alphaFactor(age) * alphaBoost);
    ctx.strokeStyle = palette.severity[severity];
    ctx.stroke();
  };

  let runStart = start;
  let runBand = bandOf(start);
  let runSeverity = tail.sev[start] as Severity;

  for (let i = start + 1; i <= last; i += 1) {
    const severity = tail.sev[i] as Severity;
    const band = bandOf(i);
    if (tail.broken[i] === 1) {
      // Разрыв данных линией не соединяется и пунктиром не обозначается: пунктир читался бы
      // как проеханный участок, а машина там как раз не отмечалась. Обрыв честнее.
      strokeRun(runStart, i - 1, runBand, runSeverity);
      runStart = i;
    } else if (band !== runBand || severity !== runSeverity) {
      // Прогон заканчивается на текущей точке, следующий с нее же начинается: общая точка
      // не дает шва между полосами.
      strokeRun(runStart, i, runBand, runSeverity);
      runStart = i;
    }
    runBand = band;
    runSeverity = severity;
  }
  strokeRun(runStart, last, runBand, runSeverity);

  ctx.globalAlpha = 1;
  return last;
}
