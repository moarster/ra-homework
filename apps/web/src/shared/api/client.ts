/**
 * Типизированный клиент REST. Прямых `fetch` в компонентах нет (раздел 12.8 `SPEC.md`):
 * каждый ответ проверяется zod-схемой из контрактов, поэтому расхождение сервера и фронта
 * обнаруживается на границе, а не где-то в отрисовке.
 */

import { errorResponseSchema } from '@ra/contracts';
import type { z } from 'zod';

/** В разработке путь проксируется Vite на сервер, в сборке - отдается тем же источником. */
const API_BASE = '/api';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Значение параметра запроса; массивы едут через запятую, как ожидает сервер. */
export type QueryValue = string | number | boolean | readonly string[] | undefined | null;

export function buildQuery(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length > 0) {
        search.set(key, value.join(','));
      }
      continue;
    }
    search.set(key, String(value));
  }
  const query = search.toString();
  return query.length > 0 ? `?${query}` : '';
}

export interface RequestOptions {
  params?: Record<string, QueryValue>;
  signal?: AbortSignal;
  method?: 'GET' | 'POST';
  body?: unknown;
}

async function readError(response: Response): Promise<ApiError> {
  try {
    const payload: unknown = await response.json();
    const parsed = errorResponseSchema.safeParse(payload);
    if (parsed.success) {
      return new ApiError(response.status, parsed.data.error.code, parsed.data.error.message);
    }
  } catch {
    // Ответ без тела или не JSON: остается только статус.
  }
  return new ApiError(response.status, 'HTTP_ERROR', `Сервер ответил ${response.status}`);
}

export async function request<Schema extends z.ZodTypeAny>(
  path: string,
  schema: Schema,
  options: RequestOptions = {},
): Promise<z.infer<Schema>> {
  const { params = {}, signal, method = 'GET', body } = options;
  const response = await fetch(`${API_BASE}${path}${buildQuery(params)}`, {
    method,
    ...(signal !== undefined ? { signal } : {}),
    ...(body !== undefined
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  if (!response.ok) {
    throw await readError(response);
  }
  const payload: unknown = await response.json();
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(
      response.status,
      'INVALID_RESPONSE',
      `Ответ ${path} не прошел проверку схемы: ${parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.')} ${issue.message}`)
        .join('; ')}`,
    );
  }
  return parsed.data as z.infer<Schema>;
}
