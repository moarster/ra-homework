/**
 * Машины и флажки на оверлее.
 *
 * Пиктограмма рисуется путем прямо в canvas, а не спрайтом и не маркером карты: маркеры
 * карты на 60 машинах - это 60 DOM-узлов, которые браузер пересчитывает на каждое движение
 * карты (раздел "Важное" этапа).
 */

import { SEVERITY, type Severity } from '@ra/contracts';
import type { MapProjector, ScreenPoint } from '../provider/types.js';
import type { MapPalette } from './palette.js';

/** Длина пиктограммы в пикселях на зуме по умолчанию. */
const BASE_LENGTH_PX = 26;
/** Отношение ширины к длине: самосвал заметно длиннее, чем шире. */
const WIDTH_RATIO = 0.52;
/** Пределы масштаба пиктограммы: на дальнем зуме не булавка, на ближнем не танкер. */
const MIN_SCALE = 0.62;
const MAX_SCALE = 1.5;

/** С какого зума и при каком числе машин подписи бортовых номеров скрываются. */
const LABEL_MIN_ZOOM = 14.5;
const LABEL_MAX_VEHICLES = 24;

export interface VehicleView {
  vehicleId: string;
  sideNumber: string;
  lat: number;
  lon: number;
  /** Курс, градусы от севера по часовой стрелке; уже сглаженный. */
  heading: number;
  severity: Severity;
  /** Нет данных дольше норматива: серая машина в красном кольце. */
  noData: boolean;
  selected: boolean;
}

/** Масштаб пиктограммы от зума: на каждый зум ниже стартового - на четверть мельче. */
export function iconScale(zoom: number, defaultZoom: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, 1 + (zoom - defaultZoom) * 0.22));
}

export function labelsVisible(zoom: number, vehicleCount: number): boolean {
  // Подписи при малом зуме и большом парке превращаются в кашу (раздел 5 этапа).
  return zoom >= LABEL_MIN_ZOOM || vehicleCount <= LABEL_MAX_VEHICLES;
}

/**
 * Контур самосвала, направленный вверх (курс 0 - на север). У пиктограммы выраженный перед
 * (узкая кабина) и зад (широкий кузов с бортом), иначе на карте не видно, куда машина едет.
 */
function truckPath(ctx: CanvasRenderingContext2D, length: number, width: number): void {
  const halfLength = length / 2;
  const halfWidth = width / 2;
  const nose = halfWidth * 0.62;
  ctx.beginPath();
  ctx.moveTo(-nose, -halfLength);
  ctx.lineTo(nose, -halfLength);
  ctx.lineTo(halfWidth * 0.74, -halfLength * 0.46);
  ctx.lineTo(halfWidth, -halfLength * 0.2);
  ctx.lineTo(halfWidth, halfLength * 0.84);
  ctx.lineTo(halfWidth * 0.88, halfLength);
  ctx.lineTo(-halfWidth * 0.88, halfLength);
  ctx.lineTo(-halfWidth, halfLength * 0.84);
  ctx.lineTo(-halfWidth, -halfLength * 0.2);
  ctx.lineTo(-halfWidth * 0.74, -halfLength * 0.46);
  ctx.closePath();
}

const point: ScreenPoint = { x: 0, y: 0 };

export interface DrawVehicleOptions {
  palette: MapPalette;
  scale: number;
  withLabel: boolean;
  /** Курсор наведен на эту машину. */
  hovered: boolean;
}

export function drawVehicle(
  ctx: CanvasRenderingContext2D,
  projector: MapProjector,
  vehicle: VehicleView,
  options: DrawVehicleOptions,
): ScreenPoint {
  const { palette, scale } = options;
  projector.project(vehicle.lat, vehicle.lon, point);
  const x = point.x;
  const y = point.y;

  const length = BASE_LENGTH_PX * scale;
  const width = length * WIDTH_RATIO;
  const fill = vehicle.noData
    ? palette.severity[SEVERITY.UNKNOWN]
    : palette.severity[vehicle.severity];

  ctx.save();
  ctx.translate(x, y);

  if (options.hovered) {
    // Подсветка наведения - ореол под пиктограммой: он не спорит со светофорной заливкой
    // и не мешает отличить выбранную машину от той, что просто под курсором.
    ctx.beginPath();
    ctx.arc(0, 0, length * 0.9, 0, Math.PI * 2);
    ctx.fillStyle = palette.hoverHalo;
    ctx.fill();
  }

  if (vehicle.selected) {
    // Кольцо выбора рисуется до поворота: оно не должно вращаться вместе с машиной.
    ctx.beginPath();
    ctx.arc(0, 0, length * 0.78, 0, Math.PI * 2);
    ctx.strokeStyle = palette.selection;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  if (vehicle.noData) {
    // Красное кольцо: авария NO_DATA, машина при этом серая (раздел 5 этапа).
    ctx.beginPath();
    ctx.arc(0, 0, length * 0.62, 0, Math.PI * 2);
    ctx.strokeStyle = palette.noDataRing;
    ctx.lineWidth = 2.5 * Math.min(1.2, scale);
    ctx.stroke();
  }

  ctx.rotate((vehicle.heading * Math.PI) / 180);
  truckPath(ctx, length, width);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = palette.vehicleStroke;
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Светлая полоса поперек кабины: читается как перед даже на мелком масштабе.
  ctx.beginPath();
  ctx.moveTo(-width * 0.3, -length * 0.34);
  ctx.lineTo(width * 0.3, -length * 0.34);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = Math.max(1.2, length * 0.09);
  ctx.stroke();
  ctx.restore();

  if (options.withLabel) {
    ctx.save();
    ctx.font = `600 ${Math.round(11 * Math.min(1.25, scale))}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = palette.labelShadow;
    ctx.lineJoin = 'round';
    const labelX = x + length * 0.58;
    ctx.strokeText(vehicle.sideNumber, labelX, y);
    ctx.fillStyle = palette.label;
    ctx.fillText(vehicle.sideNumber, labelX, y);
    ctx.restore();
  }

  return { x, y };
}

/** Флажок битового события на треке. */
export function drawMarkFlag(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  severity: Severity,
  palette: MapPalette,
  hovered = false,
): void {
  const scale = hovered ? 1.35 : 1;
  const height = 15 * scale;
  const width = 9 * scale;
  ctx.save();
  ctx.translate(x, y);
  if (hovered) {
    ctx.beginPath();
    ctx.arc(0, -height / 2, height * 0.75, 0, Math.PI * 2);
    ctx.fillStyle = palette.hoverHalo;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -height);
  ctx.strokeStyle = palette.vehicleStroke;
  ctx.lineWidth = 2.6;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -height);
  ctx.lineTo(width, -height + 3.2);
  ctx.lineTo(0, -height + 6.4);
  ctx.closePath();
  ctx.fillStyle = palette.severity[severity];
  ctx.fill();
  ctx.strokeStyle = palette.vehicleStroke;
  ctx.lineWidth = 1.1;
  ctx.stroke();
  ctx.restore();
}

/**
 * Флажок монитора: намеренно другой формы и цвета, чем битовые флажки. Монитор - это отметка
 * времени, а не событие, и путать их на треке нельзя (раздел 6 этапа).
 */
export function drawMonitorFlag(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  palette: MapPalette,
  hovered = false,
): void {
  const scale = hovered ? 1.3 : 1;
  const height = 19 * scale;
  ctx.save();
  ctx.translate(x, y);
  if (hovered) {
    ctx.beginPath();
    ctx.arc(0, -height / 2, height * 0.7, 0, Math.PI * 2);
    ctx.fillStyle = palette.hoverHalo;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(0, 2);
  ctx.lineTo(0, -height);
  ctx.strokeStyle = palette.vehicleStroke;
  ctx.lineWidth = 3.4;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, 2);
  ctx.lineTo(0, -height);
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -height, 4.2 * scale, 0, Math.PI * 2);
  ctx.fillStyle = palette.accent;
  ctx.fill();
  ctx.strokeStyle = palette.vehicleStroke;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.restore();
}
