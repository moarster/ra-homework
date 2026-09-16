/**
 * Префикс адреса, под которым стенд опубликован за обратным прокси (`moarse.ru/ra`).
 *
 * Сервер снимает префикс сам, а не полагается на прокси: так один и тот же образ проверяется
 * локально ровно по тем адресам, что и на стенде. Запросы без префикса тоже обслуживаются -
 * на них опирается проверка здоровья контейнера.
 */

/** `ra`, `/ra/`, `/ra` -> `/ra`; пусто или `/` -> пустая строка. */
export function normalizeBasePath(raw: string): string {
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, '');
  return trimmed === '' ? '' : `/${trimmed}`;
}

/** Адрес запроса без префикса: `/ra/api/sim?x=1` -> `/api/sim?x=1`, `/ra` -> `/`. */
export function stripBasePath(url: string, basePath: string): string {
  if (basePath === '' || !url.startsWith(basePath)) {
    return url;
  }
  const rest = url.slice(basePath.length);
  if (rest === '') {
    return '/';
  }
  if (rest.startsWith('/')) {
    return rest;
  }
  // `/ra?x=1` - корень с параметрами; `/rafoo` - чужой путь, его не трогаем.
  return rest.startsWith('?') ? `/${rest}` : url;
}
