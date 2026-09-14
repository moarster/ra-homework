/**
 * Схема карьера на случай, когда тайлы недоступны.
 *
 * Демонстрация не должна разваливаться без интернета (раздел 1 этапа): вместо пустого серого
 * поля рисуется контур карьера из `pit.ts` - границы области, технологические маршруты и зоны.
 * Машины и треки при этом продолжают ездить: они берут данные с сервера, а не из тайлов.
 */

import { PIT_BOUNDS, PIT_ROUTES, PIT_ZONES, ROUTE_IDS } from '@ra/contracts';
import type { MapProjector, ScreenPoint } from '../provider/types.js';
import type { MapPalette } from './palette.js';

const point: ScreenPoint = { x: 0, y: 0 };

export function drawPitSchematic(
  ctx: CanvasRenderingContext2D,
  projector: MapProjector,
  palette: MapPalette,
): void {
  ctx.save();
  ctx.fillStyle = palette.backdrop;
  ctx.fillRect(0, 0, projector.width, projector.height);

  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = palette.outline;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Границы области.
  const [[south, west], [north, east]] = PIT_BOUNDS;
  projector.project(north, west, point);
  const left = point.x;
  const top = point.y;
  projector.project(south, east, point);
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(left, top, point.x - left, point.y - top);
  ctx.setLineDash([]);

  // Технологические дороги.
  ctx.lineWidth = 5;
  for (const id of ROUTE_IDS) {
    const route = PIT_ROUTES[id];
    ctx.beginPath();
    for (let i = 0; i < route.points.length; i += 1) {
      const routePoint = route.points[i];
      if (routePoint === undefined) {
        continue;
      }
      projector.project(routePoint[0], routePoint[1], point);
      if (i === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    }
    ctx.stroke();
  }

  // Зоны: погрузка, разгрузка, стоянка, заправка.
  ctx.lineWidth = 1.5;
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = palette.outline;
  for (const zone of PIT_ZONES) {
    projector.project(zone.center[0], zone.center[1], point);
    const radius = Math.max(6, zone.radiusMeters / projector.metersPerPixel);
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillText(zone.name, point.x + radius + 6, point.y);
  }

  ctx.restore();
}
