/** `GET /api/vehicles` - список машин с НСИ. */

import type { VehiclesResponse } from '@ra/contracts';
import type { FastifyInstance } from 'fastify';
import type { RouteContext } from './context.js';

export function registerVehiclesRoute(app: FastifyInstance, context: RouteContext): void {
  app.get(
    '/api/vehicles',
    (): VehiclesResponse => ({
      vehicles: context.engine.store.vehicles.map((entry) => entry.vehicle),
    }),
  );
}
