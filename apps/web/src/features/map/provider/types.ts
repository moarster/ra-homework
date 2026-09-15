/**
 * Абстракция поставщика карты.
 *
 * Оверлей треков ничего не знает о MapLibre: он берет у провайдера проектор (перевод координат
 * в пиксели области) и подписывается на изменение вида. Замена MapLibre на Яндекс.Карты - это
 * вторая реализация `MapProvider`, а не переписывание оверлея: весь рендер треков, машин,
 * флажков и попадания курсора работает через этот интерфейс.
 */

/** Прямоугольник [[юг, запад], [север, восток]] - тот же формат, что `PIT_BOUNDS`. */
export type LatLonBounds = [[number, number], [number, number]];

/** Пиксельные координаты внутри области карты, в CSS-пикселях от левого верхнего угла. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Снимок вида карты, умеющий переводить координаты в пиксели.
 *
 * Это именно снимок, а не живой объект: за кадр отрисовки вид не меняется, поэтому все
 * параметры проекции считаются один раз, а `project` остается несколькими арифметическими
 * операциями без обращения к карте и без выделения объектов. При 60 машинах за кадр
 * проецируется более десяти тысяч точек, и вызов `map.project()` на каждую съел бы кадр.
 */
export interface MapProjector {
  /** Записывает пиксели точки в переданный объект и возвращает его же. */
  project(lat: number, lon: number, out: ScreenPoint): ScreenPoint;
  unproject(x: number, y: number): { lat: number; lon: number };
  /** Размер области в CSS-пикселях. */
  readonly width: number;
  readonly height: number;
  readonly zoom: number;
  /** Метров на пиксель в центре вида: нужен для размеров в метрах (радиусы зон). */
  readonly metersPerPixel: number;
}

export interface MapProviderOptions {
  center: [lat: number, lon: number];
  zoom: number;
  minZoom: number;
  maxZoom: number;
  bounds: LatLonBounds;
}

export type MapTileStatus = 'loading' | 'ready' | 'failed';

/**
 * Подложка: живые тайлы поставщика или сохраненный снимок карьера, привязанный к координатам
 * (автономный режим: демонстрация не зависит от сети и от доступности стороннего сервиса).
 */
export type MapImageryMode = 'tiles' | 'offline';

export interface MapProvider {
  /** Создает карту внутри контейнера. */
  mount(container: HTMLElement, options: MapProviderOptions): void;
  destroy(): void;

  /** Снимок текущего вида для кадра отрисовки. */
  createProjector(): MapProjector | null;

  getZoom(): number;
  /**
   * Курсор над картой. Ставится через провайдера, а не стилем на контейнере: MapLibre держит
   * собственный курсор на своем элементе, и стиль снаружи он перебивает.
   */
  setCursor(cursor: string | null): void;
  /** Изменение зума на дельту с анимацией: кнопки плюс и минус. */
  zoomBy(delta: number): void;
  /** Возврат к обзору карьера. */
  resetView(): void;
  /** Плавный переход так, чтобы прямоугольник поместился в области с отступами. */
  fitBounds(bounds: LatLonBounds, paddingPx: number): void;

  /** Подписка на любое изменение вида (сдвиг, зум, изменение размера). */
  onViewChange(listener: () => void): () => void;
  /** Подписка на состояние подложки: загрузка, готово, тайлы недоступны. */
  onTileStatusChange(listener: (status: MapTileStatus) => void): () => void;
  getTileStatus(): MapTileStatus;
  /**
   * Переключение подложки. Возврат к тайлам сбрасывает статус в `loading` и заново
   * отсчитывает время ожидания: сеть могла появиться.
   */
  setImageryMode(mode: MapImageryMode): void;
}
