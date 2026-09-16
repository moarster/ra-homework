/**
 * `GET /api/sim` и `POST /api/sim` - чтение и изменение параметров симуляции.
 *
 * Изменение числа машин не сбрасывает историю существующих машин; новые приходят
 * с предысторией. Скорость ограничена числом машин (`maxTimeScaleFor`): явная скорость выше
 * предела отклоняется, а рост парка сам снижает скорость до предела.
 *
 * Симуляция одна на всех зрителей стенда. Заголовок `x-viewer-id` (случайный идентификатор
 * вкладки) уходит в канал управления вместе с новым состоянием, чтобы остальные вкладки
 * поняли, что параметры поменял кто-то другой.
 */

import {
  CHAOS_LEVELS,
  MAX_VEHICLES,
  MIN_VEHICLES,
  maxTimeScaleFor,
  simPatchSchema,
  TIME_SCALES,
} from '@ra/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { badRequest, parseQuery } from '../errors.js';
import { isAllowedTimeScale } from '../sim/engine.js';
import type { RouteContext } from './context.js';

/** Идентификатор вкладки: генерирует фронтенд, сервер только передает его дальше. */
const VIEWER_ID_PATTERN = /^[\w-]{1,64}$/;

function viewerIdOf(request: FastifyRequest): string | undefined {
  const raw = request.headers['x-viewer-id'];
  return typeof raw === 'string' && VIEWER_ID_PATTERN.test(raw) ? raw : undefined;
}

export function registerSimRoutes(app: FastifyInstance, context: RouteContext): void {
  app.get('/api/sim', () => context.engine.simState());

  app.post('/api/sim', (request) => {
    const patch = parseQuery(simPatchSchema, request.body ?? {});
    if (
      patch.timeScale !== undefined &&
      !isAllowedTimeScale(patch.timeScale, context.anyTimeScale === true)
    ) {
      throw badRequest(
        `скорость времени должна быть одной из: ${TIME_SCALES.join(', ')}`,
        'INVALID_TIME_SCALE',
      );
    }
    if (
      patch.vehicleCount !== undefined &&
      (patch.vehicleCount < MIN_VEHICLES || patch.vehicleCount > MAX_VEHICLES)
    ) {
      throw badRequest(
        `число машин должно быть от ${MIN_VEHICLES} до ${MAX_VEHICLES}`,
        'INVALID_VEHICLE_COUNT',
      );
    }
    if (patch.chaos !== undefined && !CHAOS_LEVELS.some((level) => level.id === patch.chaos)) {
      throw badRequest('недопустимая мера хаоса', 'INVALID_CHAOS');
    }
    const count = patch.vehicleCount ?? context.engine.store.count;
    if (
      patch.timeScale !== undefined &&
      context.anyTimeScale !== true &&
      patch.timeScale > maxTimeScaleFor(count)
    ) {
      throw badRequest(
        `при ${count} машинах скорость времени не выше x${maxTimeScaleFor(count)}`,
        'TIME_SCALE_LIMIT',
      );
    }
    return context.engine.patch(patch, viewerIdOf(request));
  });
}
