/**
 * Реализация `MapProvider` на MapLibre GL с растровым спутниковым слоем Esri World Imagery
 * и запасным слоем - одним сохраненным снимком карьера (автономный режим этапа 6).
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
  setWorkerUrl,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { appUrl } from '@/shared/api/base-url.js';
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
  MapImageryMode,
  MapProjector,
  MapProvider,
  MapProviderOptions,
  MapTileStatus,
  ScreenPoint,
} from './types.js';

const IMAGERY_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

/**
 * Атрибуция обязательна по условиям использования слоя и должна быть видна в обоих режимах.
 * Текст - `copyrightText` самого сервиса (Maxar в нем переименован в Vantor).
 */
export const IMAGERY_ATTRIBUTION = 'Esri, Vantor, Earthstar Geographics';

/**
 * Сохраненный снимок области `PIT_BOUNDS`: 2048 x 2048 px в веб-меркаторе, получен одним
 * запросом `MapServer/export` того же сервиса. Выгрузка тайлов у Esri World Imagery запрещена
 * (`exportTilesAllowed: false`), поэтому запасной слой - единственное изображение, а не пачка
 * тайлов. Экстент ответа совпал с запрошенным, поэтому углы берутся из `PIT_BOUNDS`.
 */
const OFFLINE_IMAGERY_URL = appUrl('offline/pit-imagery.jpg');

/**
 * Сколько ошибок загрузки тайлов подряд считать отказом подложки. Одиночная ошибка - обычное
 * дело (тайл не доехал, сеть моргнула), и показывать из-за нее заглушку неправильно.
 */
const TILE_FAILURE_THRESHOLD = 6;

/**
 * Если за это время не пришел ни один тайл, подложка считается недоступной. Без таймаута
 * "сеть есть, но сервис висит" выглядело бы вечной загрузкой: ошибок нет, тайлов тоже.
 * 8 секунд оказалось мало: на нагруженной машине первый тайл однажды не успел, и карта
 * ушла в автономный режим при живой сети.
 */
const TILE_TIMEOUT_MS = 12_000;

/*
 * Воркер MapLibre 6 - отдельный ES-модуль, который библиотека ищет рядом со своим файлом
 * (`import.meta.url`). В сборке Vite библиотека вливается в общий бандл, файла рядом нет,
 * и на его месте сервер отдавал `index.html`: воркер не запускался, карта оставалась пустой
 * даже в автономном режиме. Vite собирает воркер отдельным файлом и подставляет его адрес.
 */
setWorkerUrl(maplibreWorkerUrl);

/** Длительность перелетов, миллисекунды. */
const FLY_DURATION_MS = 650;

/** `PIT_BOUNDS` -> углы изображения MapLibre: [запад, север], [восток, север], ... по часовой. */
function imageCorners(
  bounds: LatLonBounds,
): [[number, number], [number, number], [number, number], [number, number]] {
  const [[south, west], [north, east]] = bounds;
  return [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ];
}

function style(bounds: LatLonBounds): StyleSpecification {
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
      offline: {
        type: 'image',
        url: OFFLINE_IMAGERY_URL,
        coordinates: imageCorners(bounds),
      },
    },
    layers: [
      // Подложка под тайлами: пока тайлы не доехали, область не должна быть прозрачной дырой.
      { id: 'backdrop', type: 'background', paint: { 'background-color': '#2b3a38' } },
      { id: 'imagery', type: 'raster', source: 'imagery' },
      {
        id: 'offline-imagery',
        type: 'raster',
        source: 'offline',
        layout: { visibility: 'none' },
        paint: { 'raster-fade-duration': 0 },
      },
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
  private tileTimer: ReturnType<typeof setTimeout> | null = null;
  private imageryMode: MapImageryMode = 'tiles';
  /** Стиль разобран: до этого менять видимость слоев нельзя. */
  private styleReady = false;
  private resizeObserver: ResizeObserver | null = null;

  mount(container: HTMLElement, options: MapProviderOptions): void {
    this.options = options;
    const map = new MapLibreMap({
      container,
      style: style(options.bounds),
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

    map.on('style.load', () => {
      this.styleReady = true;
      this.applyImageryMode();
    });

    map.on('error', (event: ErrorEvent & { sourceId?: string }) => {
      // Сюда приходят и ошибки тайлов, и ошибки стиля. Интересны только первые.
      const sourceId = event.sourceId;
      if (this.imageryMode !== 'tiles' || sourceId === 'offline') {
        return;
      }
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
    this.startTileTimer();

    // MapLibre следит за размером окна, но не за размером своего контейнера: сплиттер
    // меняет ширину области, не трогая окно, и без наблюдателя карта осталась бы прежней.
    this.resizeObserver = new ResizeObserver(() => {
      map.resize();
    });
    this.resizeObserver.observe(container);
  }

  destroy(): void {
    this.stopTileTimer();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.viewListeners.clear();
    this.tileListeners.clear();
    this.map?.remove();
    this.map = null;
    this.styleReady = false;
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

  setImageryMode(mode: MapImageryMode): void {
    if (this.imageryMode === mode) {
      return;
    }
    this.imageryMode = mode;
    if (mode === 'tiles') {
      // Вторая попытка: ошибки прошлой сессии не должны сразу вернуть автономный режим.
      this.tileErrors = 0;
      if (this.tileStatus !== 'ready') {
        this.setTileStatus('loading');
        this.startTileTimer();
      }
    } else {
      this.stopTileTimer();
    }
    this.applyImageryMode();
  }

  private applyImageryMode(): void {
    const map = this.map;
    if (map === null || !this.styleReady) {
      return;
    }
    const offline = this.imageryMode === 'offline';
    // Скрытый слой тайлов не запрашивает тайлы: без сети карта не долбит сервис ошибками.
    map.setLayoutProperty('imagery', 'visibility', offline ? 'none' : 'visible');
    map.setLayoutProperty('offline-imagery', 'visibility', offline ? 'visible' : 'none');
  }

  private startTileTimer(): void {
    this.stopTileTimer();
    this.tileTimer = setTimeout(() => {
      this.tileTimer = null;
      if (this.imageryMode === 'tiles' && this.tileStatus === 'loading') {
        this.setTileStatus('failed');
      }
    }, TILE_TIMEOUT_MS);
  }

  private stopTileTimer(): void {
    if (this.tileTimer !== null) {
      clearTimeout(this.tileTimer);
      this.tileTimer = null;
    }
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
