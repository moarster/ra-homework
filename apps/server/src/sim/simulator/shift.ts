/**
 * Сменный график по времени объекта: пересменки в 08:00 и 20:00, обеды в середине смены.
 */

import { PIT_TIMEZONE } from '@ra/contracts';
import { SIM_PARAMS } from './params.js';

const DAY_SECONDS = 86_400;

/**
 * Смещение часового пояса объекта от UTC, секунды. Считается один раз при загрузке модуля:
 * в Новокузнецке нет перехода на летнее время, смещение постоянно.
 */
export const SITE_UTC_OFFSET_SECONDS = utcOffsetSeconds(PIT_TIMEZONE);

function utcOffsetSeconds(timeZone: string): number {
  const reference = Date.UTC(2026, 0, 1, 0, 0, 0);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(new Date(reference));
  const part = (type: string): number =>
    Number(parts.find((item) => item.type === type)?.value ?? 0);
  const local = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
  );
  return Math.round((local - reference) / 1000);
}

/** Час суток по времени объекта, 0..24 (дробный). */
export function siteHourOf(t: number): number {
  const local = (((t + SITE_UTC_OFFSET_SECONDS) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
  return local / 3600;
}

/** Все начала перерывов по порядку часов суток. */
const BREAK_HOURS: number[] = [...SIM_PARAMS.shiftChangeHours, ...SIM_PARAMS.lunchHours].sort(
  (a, b) => a - b,
);

const LONGEST_BREAK_SECONDS = Math.max(
  SIM_PARAMS.shiftChangeSeconds[1],
  SIM_PARAMS.lunchSeconds[1],
);

/**
 * Ближайшее штатное начало перерыва после `afterAnchor`, которое еще не закончилось к `t`.
 * Вызывается несколько раз в сутки на машину, не в горячем цикле.
 */
export function nextBreakAnchor(t: number, afterAnchor: number): number {
  const dayStart =
    Math.floor((t + SITE_UTC_OFFSET_SECONDS) / DAY_SECONDS) * DAY_SECONDS - SITE_UTC_OFFSET_SECONDS;
  for (let day = -1; day <= 2; day += 1) {
    for (const hour of BREAK_HOURS) {
      const anchor = dayStart + day * DAY_SECONDS + hour * 3600;
      if (anchor > afterAnchor && anchor + LONGEST_BREAK_SECONDS > t) {
        return anchor;
      }
    }
  }
  return dayStart + 3 * DAY_SECONDS;
}

/** Перерыв на этом начале - обед (иначе пересменка). */
export function isLunchAnchor(anchor: number): boolean {
  const hour = Math.round(siteHourOf(anchor));
  return (SIM_PARAMS.lunchHours as readonly number[]).includes(hour);
}
