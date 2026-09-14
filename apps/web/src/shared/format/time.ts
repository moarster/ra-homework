/**
 * Время показывается в часовом поясе объекта (раздел 11.6 `CONTEXT.md`), а не браузера:
 * диспетчер и механик в Москве должны видеть время карьера.
 */

import { APP_CONFIG } from '@ra/contracts';

const TIMEZONE = APP_CONFIG.timezone;

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const timeFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const shortTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const weekdayFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: TIMEZONE,
  weekday: 'short',
});

const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,
  timeZoneName: 'shortOffset',
});

/** Unix seconds -> Date. Все времена в проекте - секунды виртуального времени. */
function toDate(seconds: number): Date {
  return new Date(Math.round(seconds) * 1000);
}

/** `13.09.2026` */
export function formatDate(seconds: number): string {
  return dateFormatter.format(toDate(seconds));
}

/** `05:17:22` - до секунды, для крупных часов в полоске. */
export function formatTime(seconds: number): string {
  return timeFormatter.format(toDate(seconds));
}

/** `05:17` */
export function formatShortTime(seconds: number): string {
  return shortTimeFormatter.format(toDate(seconds));
}

/** `вс` */
export function formatWeekday(seconds: number): string {
  return weekdayFormatter.format(toDate(seconds));
}

/** Подпись часового пояса объекта: `UTC+7`. Смещение берется у среды, а не задается руками. */
export function timezoneLabel(seconds: number): string {
  const part = offsetFormatter
    .formatToParts(toDate(seconds))
    .find((item) => item.type === 'timeZoneName');
  const raw = part?.value ?? 'GMT';
  return raw.replace('GMT', 'UTC').replace('UTC+0', 'UTC').replace(/^UTC$/, 'UTC+0');
}

/** Короткое название пояса для подсказки: `Asia/Novokuznetsk`. */
export const TIMEZONE_NAME = TIMEZONE;

/** `3 ч 12 мин`, `45 с` - длительности в интерфейсе пишутся так. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) {
    return `${seconds} с`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} мин`;
  }
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) {
    return restMinutes === 0 ? `${hours} ч` : `${hours} ч ${restMinutes} мин`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days} сут` : `${days} сут ${restHours} ч`;
}

/** `1,2 МБ`, `118 КБ` - размеры сообщений в отладочной панели. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${Math.round(bytes)} Б`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0).replace('.', ',')} КБ`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} МБ`;
}
