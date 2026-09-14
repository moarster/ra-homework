/**
 * `GET /api/sim` и `POST /api/sim` - чтение и изменение параметров симуляции.
 *
 * Изменение числа машин не сбрасывает историю существующих машин; новые приходят
 * с предысторией.
 */

import {
  CHAOS_LEVELS,
  MAX_VEHICLES,
  MIN_VEHICLES,
  simPatchSchema,
  TIME_SCALES,
} from '@ra/contracts';
import type { FastifyInstance } from 'fastify';
import { badRequest, parseQuery } from '../errors.js';
import type { RouteContext } from './context.js';

export function registerSimRoutes(app: FastifyInstance, context: RouteContext): void {
  app.get('/api/sim', () => context.engine.simState());

  app.post('/api/sim', (request) => {
    const patch = parseQuery(simPatchSchema, request.body ?? {});
    if (patch.timeScale !== undefined && !TIME_SCALES.includes(patch.timeScale)) {
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
    return context.engine.patch(patch);
  });
}
