/**
 * Настройка TanStack Query. Справочники и конфигурация кешируются бесконечно (они неизменны
 * в пределах запуска сервера), телеметрия - обычным образом, с отменой запросов при смене периода.
 */

import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './client.js';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Окно периода меняется само; лишние перезапросы по фокусу окна только мешают.
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // Ошибки запроса повторять бессмысленно: ответ не изменится.
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
            return false;
          }
          return failureCount < 2;
        },
        staleTime: 10_000,
        gcTime: 5 * 60_000,
      },
    },
  });
}
