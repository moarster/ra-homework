/** Регистрация всех маршрутов API. */

import type { FastifyInstance } from 'fastify';
import { registerConfigRoute } from './config.js';
import type { RouteContext } from './context.js';
import { registerDictionariesRoute } from './dictionaries.js';
import { registerEventsRoute } from './events.js';
import { registerHealthRoute } from './health.js';
import { registerSimRoutes } from './sim.js';
import { registerSummaryRoute } from './summary.js';
import { registerTelemetryRoutes } from './telemetry.js';
import { registerVehiclesRoute } from './vehicles.js';

export function registerRoutes(app: FastifyInstance, context: RouteContext): void {
  registerHealthRoute(app, context);
  registerConfigRoute(app);
  registerDictionariesRoute(app);
  registerVehiclesRoute(app, context);
  registerTelemetryRoutes(app, context);
  registerEventsRoute(app, context);
  registerSummaryRoute(app, context);
  registerSimRoutes(app, context);
}

export type { RouteContext };
