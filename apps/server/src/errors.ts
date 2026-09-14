/** Единый формат ошибок API: `{ error: { code, message } }` (раздел 7 `SPEC.md`). */

import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError, type ZodTypeAny, type z } from 'zod';

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function badRequest(message: string, code = 'BAD_REQUEST'): ApiError {
  return new ApiError(400, code, message);
}

export function notFound(message: string, code = 'NOT_FOUND'): ApiError {
  return new ApiError(404, code, message);
}

/** Читаемое описание ошибки валидации: путь до поля и текст. */
function describeZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      return path === '' ? issue.message : `${path}: ${issue.message}`;
    })
    .join('; ');
}

/** Разбор параметров запроса zod-схемой из контрактов. */
export function parseQuery<S extends ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(400, 'INVALID_QUERY', describeZodError(result.error));
  }
  return result.data;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      void reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
      return;
    }
    if (error instanceof ZodError) {
      void reply.status(400).send({
        error: { code: 'INVALID_QUERY', message: describeZodError(error) },
      });
      return;
    }
    const fastifyError = error as FastifyError;
    const statusCode = fastifyError.statusCode ?? 500;
    if (statusCode >= 500) {
      app.log.error({ err: fastifyError }, 'необработанная ошибка запроса');
    }
    void reply.status(statusCode).send({
      error: {
        code: fastifyError.code ?? 'INTERNAL_ERROR',
        message: statusCode >= 500 ? 'Внутренняя ошибка сервера' : fastifyError.message,
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `Маршрут не найден: ${request.method} ${request.url}` },
    });
  });
}
