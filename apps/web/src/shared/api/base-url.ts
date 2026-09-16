/**
 * Адреса относительно места публикации. Стенд живет под префиксом (`moarse.ru/ra/`),
 * который Vite подставляет в `import.meta.env.BASE_URL` при сборке (`BASE_PATH`);
 * в разработке это `/`, и `/api`, `/ws` проксирует dev-сервер.
 */

const BASE_URL = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

/** Путь внутри приложения: `appUrl('api')` -> `/ra/api`. */
export function appUrl(path: string): string {
  return `${BASE_URL}${path.replace(/^\/+/, '')}`;
}

/** Адрес websocket того же источника: `wss://moarse.ru/ra/ws`. */
export function websocketUrl(path: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${appUrl(path)}`;
}
