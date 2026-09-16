/**
 * Сборка приложения Fastify: логирование, CORS для dev-сервера Vite, обработчик ошибок,
 * маршруты API, websocket и, в собранном образе, статика фронтенда.
 */

import fastifyCors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { stripBasePath } from './base-path.js';
import type { ServerEnv } from './env.js';
import { registerErrorHandler } from './errors.js';
import { registerRoutes } from './routes/index.js';
import { SimEngine } from './sim/engine.js';
import { registerStatic } from './static.js';
import { ControlHub, registerControlWebsocket } from './ws/control.js';
import { registerWebsocket, WsHub } from './ws/hub.js';

export interface BuiltApp {
  app: FastifyInstance;
  engine: SimEngine;
  hub: WsHub;
  control: ControlHub;
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
    // Стенд живет под префиксом (`moarse.ru/ra`): маршруты объявлены без него.
    rewriteUrl: (request) => stripBasePath(request.url ?? '/', env.basePath),
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
  const control = new ControlHub(engine);
  engine.listener = {
    onBatch: (simTime) => hub.onBatch(simTime),
    onEvents: (opened, closed) => hub.onEvents(opened, closed),
    onBackfill: (vehicleId, from, to) => hub.onBackfill(vehicleId, from, to),
    onSim: (sim, changedBy) => control.onSim(sim, changedBy),
  };

  await app.register(fastifyCors, {
    origin: env.corsOrigins.length === 0 ? true : env.corsOrigins,
  });
  await app.register(fastifyWebsocket, {
    options: {
      /*
       * Стенд смотрят через интернет: тик при 60 машинах весит около 36 КБ и идет четыре раза
       * в секунду каждому зрителю. JSON тика сжимается втрое за доли миллисекунды на уровне 1.
       */
      perMessageDeflate: { threshold: 1024, zlibDeflateOptions: { level: 1 } },
    },
  });

  registerErrorHandler(app);
  registerRoutes(app, { engine, anyTimeScale: env.benchmark });
  registerWebsocket(app, hub);
  registerControlWebsocket(app, control);
  if (env.staticDir !== null) {
    registerStatic(app, env.staticDir);
  }

  engine.start();
  app.log.info({ vehicles: engine.store.count, simTime: engine.simTime }, 'симуляция запущена');

  app.addHook('onClose', async () => {
    engine.stop();
    hub.stop();
    control.stop();
  });

  return { app, engine, hub, control };
}
