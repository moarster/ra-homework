/**
 * Правило аварии "нет данных" (критерий приемки 4 этапа: машина без данных дольше сорока
 * минут - серая в красном кольце, во всплывашке время последней передачи и телефон водителя).
 */

import { APP_CONFIG, type VehicleSnapshot } from '@ra/contracts';
import { describe, expect, it } from 'vitest';
import { isNoDataAlarm, NO_DATA_SECONDS } from './no-data.js';

function snapshot(age: number, status: VehicleSnapshot['st'] = 'NO_DATA'): VehicleSnapshot {
  return { id: 'v-12', t: 1_700_000_000, v: [], q: [], f: [0, 0, 0], st: status, sev: 3, age };
}

describe('авария "нет данных"', () => {
  it('порог берется из конфигурации, а не зашит числом', () => {
    expect(NO_DATA_SECONDS).toBe(APP_CONFIG.noDataAlarmMinutes * 60);
    expect(NO_DATA_SECONDS).toBe(2400);
  });

  it('машина без снапшота аварией не считается', () => {
    expect(isNoDataAlarm(undefined)).toBe(false);
  });

  it('свежая машина не в аварии', () => {
    expect(isNoDataAlarm(snapshot(0, 'HAULING'))).toBe(false);
  });

  /*
   * Главное, ради чего правило вынесено в отдельный модуль: статус `NO_DATA` сервер ставит
   * уже через несколько минут молчания, а красное кольцо означает именно сорокаминутную
   * аварию. Раньше рендерер смотрел на статус, а всплывашка на возраст, и машина попадала
   * в кольцо без объяснения, почему.
   */
  it('статус NO_DATA сам по себе аварией не является', () => {
    expect(isNoDataAlarm(snapshot(410))).toBe(false);
    expect(isNoDataAlarm(snapshot(NO_DATA_SECONDS - 1))).toBe(false);
  });

  it('молчание дольше сорока минут - авария', () => {
    expect(isNoDataAlarm(snapshot(NO_DATA_SECONDS))).toBe(true);
    expect(isNoDataAlarm(snapshot(NO_DATA_SECONDS + 3600))).toBe(true);
  });
});
