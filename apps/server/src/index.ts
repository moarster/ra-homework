/** Точка входа сервера: поднимает Fastify и корректно закрывается по сигналу. */

import { buildApp } from './app.js';
import { readEnv } from './env.js';

async function main(): Promise<void> {
  const env = readEnv();
  const { app } = await buildApp(env);

  const shutdown = (signal: string): void => {
    app.log.info({ signal }, 'остановка сервера');
    void app
      .close()
      .then(() => {
        process.exit(0);
      })
      .catch((error: unknown) => {
        app.log.error({ err: error }, 'ошибка при остановке');
        process.exit(1);
      });
  };

  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });

  await app.listen({ port: env.port, host: env.host });
}

main().catch((error: unknown) => {
  console.error('не удалось запустить сервер', error);
  process.exit(1);
});
