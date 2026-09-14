/** Сборка хвостов трека: склейка истории с живыми точками, разрывы, обрезка окна. */

import { SEVERITY, type TrackPoint, type TrackResponse } from '@ra/contracts';
import { describe, expect, it } from 'vitest';
import { TailStore, tailStartIndex } from './tail-store.js';

const T0 = 1_700_000_000;

/** Точка трека: [время, широта, долгота, курс, светофор]. */
function point(offsetSeconds: number, severity = SEVERITY.OK): TrackPoint {
  return [T0 + offsetSeconds, 55.006 + offsetSeconds * 1e-5, 88.46, 90, severity];
}

function response(
  points: TrackPoint[],
  extra: Partial<TrackResponse['tracks'][number]> = {},
): TrackResponse {
  return {
    tracks: [{ vehicleId: 'v-12', points, gaps: [], marks: [], ...extra }],
  };
}

describe('хранилище хвостов трека', () => {
  it('история кладется целиком и обрезается окном', () => {
    const store = new TailStore();
    store.setHistory(response([point(-10), point(0), point(10), point(20)]), T0, T0 + 10);
    const tail = store.get('v-12');
    expect(tail?.count).toBe(2);
    expect(tail?.t[0]).toBe(T0);
    expect(tail?.t[1]).toBe(T0 + 10);
  });

  it('повторная установка той же истории не пересобирает хвост', () => {
    const store = new TailStore();
    const data = response([point(0), point(5)]);
    expect(store.setHistory(data, T0, T0 + 100)).toBe(true);
    expect(store.setHistory(data, T0, T0 + 100)).toBe(false);
  });

  it('живые точки дописываются только новее последней известной', () => {
    const store = new TailStore();
    store.setHistory(response([point(0), point(5)]), T0, T0 + 1000);
    // В живом буфере лежат и уже известные точки, и новые: дублей быть не должно.
    store.appendLive('v-12', [point(0), point(5), point(10), point(15)], T0 + 1000);
    const tail = store.get('v-12');
    expect(tail?.count).toBe(4);
    expect(Array.from(tail?.t.subarray(0, 4) ?? [])).toEqual([T0, T0 + 5, T0 + 10, T0 + 15]);

    // Повторный проход по тому же буферу ничего не меняет.
    store.appendLive('v-12', [point(10), point(15)], T0 + 1000);
    expect(store.get('v-12')?.count).toBe(4);
  });

  it('машина, появившаяся раньше ответа трека, получает хвост из живых точек', () => {
    const store = new TailStore();
    store.appendLive('v-99', [point(0), point(5)], T0 + 1000);
    expect(store.get('v-99')?.count).toBe(2);
  });

  it('большой интервал между точками рвет трек', () => {
    const store = new TailStore();
    // Шаг пять секунд, потом провал на час: линия обязана порваться.
    store.setHistory(
      response([point(0), point(5), point(10), point(3610), point(3615)]),
      T0,
      T0 + 4000,
    );
    const tail = store.get('v-12');
    expect(tail?.broken[0]).toBe(0);
    expect(tail?.broken[1]).toBe(0);
    expect(tail?.broken[2]).toBe(0);
    // Точка после провала не соединяется с предыдущей.
    expect(tail?.broken[3]).toBe(1);
    expect(tail?.broken[4]).toBe(0);
  });

  it('интервал gaps из ответа рвет трек даже при мелком шаге точек', () => {
    const store = new TailStore();
    store.setHistory(
      response([point(0), point(5), point(10), point(15)], { gaps: [[T0 + 6, T0 + 9]] }),
      T0,
      T0 + 1000,
    );
    const tail = store.get('v-12');
    expect(tail?.broken[2]).toBe(1);
    expect(tail?.broken[1]).toBe(0);
    expect(tail?.broken[3]).toBe(0);
  });

  it('обрезка выбрасывает точки старше границы окна', () => {
    const store = new TailStore();
    const points = Array.from({ length: 200 }, (_, i) => point(i * 5));
    store.setHistory(response(points), T0, T0 + 2000);
    expect(store.get('v-12')?.count).toBe(200);

    // Обрезка идет пачками: одна устаревшая точка сдвига массива не стоит.
    store.trim(T0 + 5);
    expect(store.get('v-12')?.count).toBe(200);

    store.trim(T0 + 500);
    const tail = store.get('v-12');
    expect(tail?.count).toBe(100);
    expect(tail?.t[0]).toBe(T0 + 500);
    // Первая точка ни с чем не соединяется: признак разрыва на ней снят.
    expect(tail?.broken[0]).toBe(0);
  });

  it('машины, пропавшие из ответа, теряют хвост', () => {
    const store = new TailStore();
    store.setHistory(response([point(0), point(5)]), T0, T0 + 1000);
    expect(store.get('v-12')).toBeDefined();
    store.setHistory({ tracks: [] }, T0, T0 + 1000);
    expect(store.get('v-12')).toBeUndefined();
  });

  it('флажки берутся из ответа и не дублируются', () => {
    const store = new TailStore();
    store.setHistory(
      response([point(0), point(5)], {
        marks: [
          {
            t: T0 + 2,
            lat: 55.006,
            lon: 88.46,
            code: 'COOLANT_OVERHEAT',
            severity: SEVERITY.ALARM,
          },
        ],
      }),
      T0,
      T0 + 1000,
    );
    const mark = {
      vehicleId: 'v-12',
      t: T0 + 2,
      lat: 55.006,
      lon: 88.46,
      code: 'COOLANT_OVERHEAT',
      severity: SEVERITY.ALARM,
    };
    store.addMark(mark);
    expect(store.get('v-12')?.marks).toHaveLength(1);
  });

  it('начало хвоста ищется двоичным поиском по времени', () => {
    const store = new TailStore();
    store.setHistory(response(Array.from({ length: 50 }, (_, i) => point(i * 10))), T0, T0 + 1000);
    const tail = store.get('v-12');
    if (tail === undefined) {
      throw new Error('хвост не собран');
    }
    expect(tailStartIndex(tail, T0)).toBe(0);
    expect(tailStartIndex(tail, T0 + 100)).toBe(10);
    // Между точками берется первая, которая не раньше границы.
    expect(tailStartIndex(tail, T0 + 105)).toBe(11);
    expect(tailStartIndex(tail, T0 + 10_000)).toBe(tail.count);
  });
});
