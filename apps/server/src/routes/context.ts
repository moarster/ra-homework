/** Общий контекст маршрутов: движок симуляции и его составные части. */

import { badRequest } from '../errors.js';
import type { SimEngine } from '../sim/engine.js';

export interface RouteContext {
  engine: SimEngine;
}

/** Глубина хранения позиций и минутных агрегатов, секунды: за ее пределами данных нет. */
const MAX_SPAN_SECONDS = 24 * 3600;

/** Проверка периода запроса. Времена - unix seconds виртуального времени. */
export function checkPeriod(from: number, to: number): void {
  if (to <= from) {
    throw badRequest('параметр to должен быть больше from', 'INVALID_PERIOD');
  }
  if (to - from > MAX_SPAN_SECONDS) {
    throw badRequest(
      `период не может превышать ${MAX_SPAN_SECONDS / 3600} часов`,
      'PERIOD_TOO_LONG',
    );
  }
}

/**
 * Разбор списка машин: пустой список означает "все машины".
 * Неизвестный идентификатор - ошибка, а не тихое игнорирование: иначе опечатка во
 * фронтенде выглядела бы как отсутствие данных.
 */
export function resolveVehicleIds(context: RouteContext, requested?: string[]): string[] {
  const all = context.engine.store.ids();
  if (requested === undefined || requested.length === 0) {
    return all;
  }
  const known = new Set(all);
  const unknown = requested.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw badRequest(`неизвестные машины: ${unknown.join(', ')}`, 'UNKNOWN_VEHICLE');
  }
  return requested;
}
