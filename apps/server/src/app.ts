/**
 * Сборка приложения Fastify: логирование, CORS для dev-сервера Vite, обработчик ошибок,
 * маршруты API, websocket и, в собранном образе, статика фронтенда.
 */

import fastifyCors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ServerEnv } from './env.js';
import { registerErrorHandler } from './errors.js';
import { registerRoutes } from './routes/index.js';
import { SimEngine } from './sim/engine.js';
import { registerStatic } from './static.js';
import { registerWebsocket, WsHub } from './ws/hub.js';

export interface BuiltApp {
  app: FastifyInstance;
  engine: SimEngine;
  hub: WsHub;
}

export async function buildApp(env: ServerEnv): Promise<BuiltApp> {
  const app = Fastify({
    logger: env.prettyLogs
      ? {
          level: env.logLevel,
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : { level: env.logLevel },
  });

  const engine = new SimEngine({
    seed: env.seed,
    vehicleCount: env.vehicleCount,
    historySeconds: env.historySeconds,
    timeScale: env.timeScale,
    chaos: env.chaos,
    anyTimeScale: env.benchmark,
    log: (message, details) => {
      app.log.info(details ?? {}, message);
    },
  });
  const hub = new WsHub(engine);
  engine.listener = hub;

  await app.register(fastifyCors, {
    origin: env.corsOrigins.length === 0 ? true : env.corsOrigins,
  });
  await app.register(fastifyWebsocket);

  registerErrorHandler(app);
  registerRoutes(app, { engine, anyTimeScale: env.benchmark });
  registerWebsocket(app, hub);
  if (env.staticDir !== null) {
    registerStatic(app, env.staticDir);
  }

  engine.start();
  app.log.info({ vehicles: engine.store.count, simTime: engine.simTime }, 'симуляция запущена');

  app.addHook('onClose', async () => {
    engine.stop();
    hub.stop();
  });

  return { app, engine, hub };
}
