/**
 * Веб-меркатор: перевод координат в пиксели без обращения к карте.
 *
 * Карта зафиксирована на север (`bearing` и `pitch` равны нулю и меняться не могут),
 * поэтому проекция сводится к линейному преобразованию меркаторовых долей мира. Это дает
 * тот же результат, что `map.project()`, но без матричной математики и без создания объекта
 * на каждую точку - на треках это разница между 30 и 10 кадрами в секунду.
 */

/** Размер мира в пикселях на нулевом зуме: MapLibre использует тайлы 512 px. */
const WORLD_SIZE_AT_ZOOM_0 = 512;

/** Длина экватора, метры: из нее считается масштаб метров на пиксель. */
const EARTH_CIRCUMFERENCE_METERS = 40_075_016.686;

const MAX_MERCATOR_LATITUDE = 85.051129;

export function mercatorX(lon: number): number {
  return (lon + 180) / 360;
}

export function mercatorY(lat: number): number {
  const clamped = Math.min(Math.max(lat, -MAX_MERCATOR_LATITUDE), MAX_MERCATOR_LATITUDE);
  const rad = (clamped * Math.PI) / 180;
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / (2 * Math.PI);
}

export function lonFromMercatorX(x: number): number {
  return x * 360 - 180;
}

export function latFromMercatorY(y: number): number {
  const n = Math.PI * (1 - 2 * y);
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

export function worldSize(zoom: number): number {
  return WORLD_SIZE_AT_ZOOM_0 * 2 ** zoom;
}

/** Метров на пиксель на заданной широте и зуме. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (EARTH_CIRCUMFERENCE_METERS * Math.cos((lat * Math.PI) / 180)) / worldSize(zoom);
}
