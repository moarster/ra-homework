/**
 * Реализация `MapProvider` на MapLibre GL с растровым спутниковым слоем Esri World Imagery.
 *
 * Карта здесь намеренно обрезана в возможностях: только спутник, только север, только внутри
 * границ карьера. Поворот и наклон выключены не ради вкуса, а потому что оверлей треков
 * проецирует точки собственным веб-меркатором (см. `mercator.ts`); повернутая или наклоненная
 * карта разошлась бы с оверлеем.
 */

import {
  type ErrorEvent,
  Map as MapLibreMap,
  type MapSourceDataEvent,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  latFromMercatorY,
  lonFromMercatorX,
  mercatorX,
  mercatorY,
  metersPerPixel,
  worldSize,
} from './mercator.js';
import type {
  LatLonBounds,
  MapProjector,
  MapProvider,
  MapProviderOptions,
  MapTileStatus,
  ScreenPoint,
} from './types.js';

const IMAGERY_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

/** Атрибуция обязательна по условиям использования слоя и должна быть видна. */
const IMAGERY_ATTRIBUTION = 'Esri, Maxar, Earthstar Geographics';

/**
 * Сколько ошибок загрузки тайлов подряд считать отказом подложки. Одиночная ошибка - обычное
 * дело (тайл не доехал, сеть моргнула), и показывать из-за нее заглушку неправильно.
 */
const TILE_FAILURE_THRESHOLD = 6;

/** Длительность перелетов, миллисекунды. */
const FLY_DURATION_MS = 650;

function style(): StyleSpecification {
  return {
    version: 8,
    sources: {
      imagery: {
        type: 'raster',
        tiles: [IMAGERY_TILES],
        tileSize: 256,
        /*
         * Последний уровень с настоящим снимком на этот объект - 18-й: начиная с 19-го Esri
         * отдает одну и ту же заглушку "map data not yet available" весом в пару килобайт
         * (проверено запросами по координатам карьера). Без этого ограничения на максимальном
         * приближении карта пустела.
         *
         * Тайлы 256 px в 512-й схеме MapLibre запрашиваются уровнем выше зума карты, так что
         * настоящий снимок кончается на зуме карты 17. Ограничение не мешает приблизиться до
         * `PIT_MAX_ZOOM`: выше MapLibre растягивает последний настоящий тайл, и снимок мылит,
         * но не исчезает.
         */
        maxzoom: 18,
        attribution: IMAGERY_ATTRIBUTION,
      },
    },
    layers: [
      // Подложка под тайлами: пока тайлы не доехали, область не должна быть прозрачной дырой.
      { id: 'backdrop', type: 'background', paint: { 'background-color': '#2b3a38' } },
      { id: 'imagery', type: 'raster', source: 'imagery' },
    ],
  };
}

/** `PIT_BOUNDS` -> формат MapLibre: [[запад, юг], [восток, север]]. */
function toLngLatBounds(bounds: LatLonBounds): [[number, number], [number, number]] {
  const [[south, west], [north, east]] = bounds;
  return [
    [west, south],
    [east, north],
  ];
}

/** Неизменяемый снимок вида: см. пояснение к `MapProjector`. */
function createProjector(
  centerLat: number,
  centerLon: number,
  zoom: number,
  width: number,
  height: number,
): MapProjector {
  const size = worldSize(zoom);
  const originX = mercatorX(centerLon) * size - width / 2;
  const originY = mercatorY(centerLat) * size - height / 2;
  return {
    width,
    height,
    zoom,
    metersPerPixel: metersPerPixel(centerLat, zoom),
    project(lat: number, lon: number, out: ScreenPoint): ScreenPoint {
      out.x = mercatorX(lon) * size - originX;
      out.y = mercatorY(lat) * size - originY;
      return out;
    },
    unproject(x: number, y: number) {
      return {
        lat: latFromMercatorY((y + originY) / size),
        lon: lonFromMercatorX((x + originX) / size),
      };
    },
  };
}

export class MapLibreProvider implements MapProvider {
  private map: MapLibreMap | null = null;
  private options: MapProviderOptions | null = null;

  private readonly viewListeners = new Set<() => void>();
  private readonly tileListeners = new Set<(status: MapTileStatus) => void>();

  private tileStatus: MapTileStatus = 'loading';
  private tileErrors = 0;
  private resizeObserver: ResizeObserver | null = null;

  mount(container: HTMLElement, options: MapProviderOptions): void {
    this.options = options;
    const map = new MapLibreMap({
      container,
      style: style(),
      center: [options.center[1], options.center[0]],
      zoom: options.zoom,
      minZoom: options.minZoom,
      maxZoom: options.maxZoom,
      maxBounds: toLngLatBounds(options.bounds),
      bearing: 0,
      pitch: 0,
      // Свои кнопки в стиле дизайн-системы: штатные контролы скрыты (задача 1 этапа).
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchZoomRotate: true,
      renderWorldCopies: false,
      // Плавное проявление тайлов только мешает: оверлей уже нарисован поверх.
      fadeDuration: 0,
    });
    this.map = map;

    // Поворот запрещен полностью: оверлей считает проекцию для карты, смотрящей на север.
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();

    const notify = () => {
      for (const listener of this.viewListeners) {
        listener();
      }
    };
    map.on('move', notify);
    map.on('zoom', notify);
    map.on('resize', notify);

    map.on('error', (event: ErrorEvent & { sourceId?: string }) => {
      // Сюда приходят и ошибки тайлов, и ошибки стиля. Интересны только первые.
      const sourceId = event.sourceId;
      if (sourceId === 'imagery' || sourceId === undefined) {
        this.tileErrors += 1;
        if (this.tileErrors >= TILE_FAILURE_THRESHOLD) {
          this.setTileStatus('failed');
        }
      }
    });
    /*
     * Подложка считается живой только когда доехал настоящий тайл.
     *
     * Ориентироваться на `isSourceLoaded` нельзя: у растрового источника, заданного списком
     * `tiles`, метаданные загружать нечего, и флаг становится истинным сразу - даже если ни
     * один тайл не пришел. Именно поэтому первая версия проверки не срабатывала: счетчик
     * ошибок обнулялся тем же событием, которое его должно было подтвердить.
     */
    map.on('sourcedata', (event: MapSourceDataEvent) => {
      if (event.sourceId !== 'imagery') {
        return;
      }
      const tile = event.tile as { state?: string } | undefined;
      if (tile?.state !== 'loaded') {
        return;
      }
      this.tileErrors = 0;
      this.setTileStatus('ready');
    });

    // MapLibre следит за размером окна, но не за размером своего контейнера: сплиттер
    // меняет ширину области, не трогая окно, и без наблюдателя карта осталась бы прежней.
    this.resizeObserver = new ResizeObserver(() => {
      map.resize();
    });
    this.resizeObserver.observe(container);
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.viewListeners.clear();
    this.tileListeners.clear();
    this.map?.remove();
    this.map = null;
  }

  createProjector(): MapProjector | null {
    const map = this.map;
    if (map === null) {
      return null;
    }
    const center = map.getCenter();
    const canvas = map.getCanvas();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) {
      return null;
    }
    return createProjector(center.lat, center.lng, map.getZoom(), width, height);
  }

  getZoom(): number {
    return this.map?.getZoom() ?? this.options?.zoom ?? 0;
  }

  setCursor(cursor: string | null): void {
    const canvas = this.map?.getCanvas();
    if (canvas !== undefined) {
      canvas.style.cursor = cursor ?? '';
    }
  }

  zoomBy(delta: number): void {
    const map = this.map;
    if (map === null) {
      return;
    }
    map.easeTo({ zoom: map.getZoom() + delta, duration: 200 });
  }

  resetView(): void {
    const map = this.map;
    const options = this.options;
    if (map === null || options === null) {
      return;
    }
    map.easeTo({
      center: [options.center[1], options.center[0]],
      zoom: options.zoom,
      duration: FLY_DURATION_MS,
    });
  }

  fitBounds(bounds: LatLonBounds, paddingPx: number): void {
    this.map?.fitBounds(toLngLatBounds(bounds), {
      padding: paddingPx,
      duration: FLY_DURATION_MS,
      // Приближать вплотную к одной точке не нужно: трек из одной точки выглядел бы как
      // максимальный зум на пустом месте.
      maxZoom: (this.options?.maxZoom ?? 18) - 1,
    });
  }

  onViewChange(listener: () => void): () => void {
    this.viewListeners.add(listener);
    return () => {
      this.viewListeners.delete(listener);
    };
  }

  onTileStatusChange(listener: (status: MapTileStatus) => void): () => void {
    this.tileListeners.add(listener);
    return () => {
      this.tileListeners.delete(listener);
    };
  }

  getTileStatus(): MapTileStatus {
    return this.tileStatus;
  }

  private setTileStatus(status: MapTileStatus): void {
    if (this.tileStatus === status) {
      return;
    }
    this.tileStatus = status;
    for (const listener of this.tileListeners) {
      listener(status);
    }
  }
}
