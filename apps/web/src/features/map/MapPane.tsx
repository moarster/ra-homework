/**
 * Левая область - карта карьера: спутниковый снимок, canvas-оверлей с треками и машинами,
 * элементы управления и всплывашки.
 *
 * Область не знает, что нарисовано справа: связь идет только через стор (раздел "Важное"
 * этапа). Отсюда наружу уходят `selectedVehicleId`, `monitorTs` и `focusMetric`, обратно
 * приходит выбранная машина - и карта перелетает к ее треку.
 */

import { APP_CONFIG } from '@ra/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useAppStore,
  usePeriodId,
  usePeriodSeconds,
  useSelectedVehicleId,
  useTrackTailSeconds,
} from '@/shared/store';
import { EmptyState, Panel } from '@/shared/ui';
import { MapControls } from './controls/MapControls.js';
import { TailSlider } from './controls/TailSlider.js';
import { useMapData } from './data/use-map-data.js';
import { NoImageryIcon, PitIcon } from './icons.js';
import { MapCanvas } from './MapCanvas.js';
import { MapLibreProvider } from './provider/maplibre-provider.js';
import type { LatLonBounds, MapProvider, MapTileStatus } from './provider/types.js';
import { takeSelectionFromMap } from './selection-origin.js';

/** Отступ при перелете к треку машины, пиксели: трек не должен упираться в края области. */
const FIT_PADDING_PX = 72;

/** Границы трека машины или null, если точек нет. */
function tailBounds(
  latitudes: Float64Array,
  longitudes: Float64Array,
  from: number,
  count: number,
): LatLonBounds | null {
  if (count <= from) {
    return null;
  }
  let south = Number.POSITIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  let west = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  for (let i = from; i < count; i += 1) {
    const lat = latitudes[i] as number;
    const lon = longitudes[i] as number;
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lon);
    east = Math.max(east, lon);
  }
  return [
    [south, west],
    [north, east],
  ];
}

export function MapPane() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  /** Тот же элемент, но как состояние: оверлею он нужен для подписки на указатель. */
  const [mapElement, setMapElement] = useState<HTMLDivElement | null>(null);
  const [provider, setProvider] = useState<MapProvider | null>(null);
  const [tileStatus, setTileStatus] = useState<MapTileStatus>('loading');

  const data = useMapData();
  const periodId = usePeriodId();
  const periodSeconds = usePeriodSeconds();
  const tailSliderSeconds = useTrackTailSeconds();
  const selectedVehicleId = useSelectedVehicleId();

  /* ------------------------------------------------------------- жизненный цикл карты */

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const instance = new MapLibreProvider();
    instance.mount(container, {
      center: APP_CONFIG.pit.center,
      zoom: APP_CONFIG.pit.defaultZoom,
      minZoom: APP_CONFIG.pit.minZoom,
      maxZoom: APP_CONFIG.pit.maxZoom,
      bounds: APP_CONFIG.pit.bounds,
    });
    setProvider(instance);
    setTileStatus(instance.getTileStatus());
    const unsubscribe = instance.onTileStatusChange(setTileStatus);
    return () => {
      unsubscribe();
      instance.destroy();
      setProvider(null);
    };
  }, []);

  /* ------------------------------------------- перелет к треку выбранной справа машины */

  /**
   * Машина, к треку которой карта уже перелетела. Без этой отметки перелет повторялся бы на
   * каждый новый ответ трека - то есть раз в несколько секунд, и карту нельзя было бы отвести
   * от выбранной машины руками.
   */
  const flownToRef = useRef<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: хвосты лежат в mutable-хранилище, момент их готовности виден только по `tracksReady`
  useEffect(() => {
    if (provider === null || selectedVehicleId === null) {
      flownToRef.current = null;
      return;
    }
    if (flownToRef.current === selectedVehicleId) {
      return;
    }
    // Машину выбрали кликом по самой карте - перелетать не надо.
    if (takeSelectionFromMap()) {
      flownToRef.current = selectedVehicleId;
      return;
    }
    /*
     * Трек мог еще не приехать: так бывает при открытии готовой ссылки с `?v=...`, когда
     * машина выбрана раньше, чем загрузился ответ трека. Тогда перелет откладывается до
     * следующего прохода - эффект повторится, когда `tracksReady` станет истинным.
     */
    const tail = data.tails.get(selectedVehicleId);
    if (tail === undefined || tail.count === 0) {
      return;
    }
    // В видимой области должен поместиться весь хвост, а не только его голова.
    let start = 0;
    const tailFrom = (tail.t[tail.count - 1] as number) - data.tailSeconds;
    while (start < tail.count && (tail.t[start] as number) < tailFrom) {
      start += 1;
    }
    const bounds = tailBounds(tail.lat, tail.lon, Math.min(start, tail.count - 1), tail.count);
    if (bounds !== null) {
      provider.fitBounds(bounds, FIT_PADDING_PX);
      flownToRef.current = selectedVehicleId;
    }
  }, [provider, selectedVehicleId, data.tracksReady]);

  const schematic = tileStatus === 'failed';

  const emptyMessage = useMemo(() => {
    if (!data.window.ready || data.loading) {
      return null;
    }
    if (data.meta.size === 0) {
      return 'Парк пуст: сервер еще не прислал ни одной машины.';
    }
    if (data.empty) {
      return 'Ни у одной машины нет данных за выбранный период. Увеличьте период или включите real-time.';
    }
    return null;
  }, [data.window.ready, data.loading, data.meta.size, data.empty]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-bg-deep">
      {/*
        Контейнер карты: MapLibre вставляет в него свой canvas и вешает на него класс
        `maplibregl-map`, у которого в собственной таблице стилей задан `position: relative`.
        Этот класс перебивает утилиту `absolute`, поэтому растягивать сам контейнер через
        `inset-0` нельзя - он схлопнется по высоте. Растягиваем обертку, а контейнеру даем
        размер в процентах.
      */}
      <div className="absolute inset-0">
        <div
          ref={(node) => {
            containerRef.current = node;
            setMapElement(node);
          }}
          className="h-full w-full"
        />
      </div>

      {provider !== null && (
        <MapCanvas
          provider={provider}
          data={data}
          schematic={schematic}
          interactionTarget={mapElement}
        />
      )}

      {/* Элементы управления и слайдер лежат в слое, прозрачном для указателя: клики по
          карте должны доходить до оверлея, а не гаснуть в пустой обертке. */}
      <div className="pointer-events-none absolute inset-0">
        {provider !== null && (
          <MapControls
            onZoomIn={() => provider.zoomBy(1)}
            onZoomOut={() => provider.zoomBy(-1)}
            onReset={() => provider.resetView()}
          />
        )}

        <TailSlider
          value={tailSliderSeconds}
          periodSeconds={periodSeconds}
          periodId={periodId}
          onChange={(seconds) => useAppStore.getState().setTrackTailSeconds(seconds)}
        />

        {/* Атрибуция обязательна по условиям использования слоя и должна быть видна. */}
        <div className="absolute right-3 bottom-3 rounded-control bg-surface-scrim px-2 py-0.5 text-[10px] text-white/85">
          {schematic ? 'Схема карьера: подложка недоступна' : 'Esri, Maxar, Earthstar Geographics'}
        </div>

        {schematic && (
          <Panel
            tone="float"
            overImagery
            className="pointer-events-auto absolute top-3 left-3 max-w-72 px-3 py-2 text-[12px]"
          >
            <div className="flex items-start gap-2">
              <span className="mt-0.5 size-4 shrink-0 text-fg-muted">
                <NoImageryIcon />
              </span>
              <span className="text-fg-muted">
                Спутниковый снимок не загрузился. Показана схема карьера из справочника; машины и
                треки продолжают идти.
              </span>
            </div>
          </Panel>
        )}

        {emptyMessage !== null && (
          <div className="pointer-events-auto absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center px-6">
            <Panel tone="float" overImagery className="max-w-sm p-4">
              <EmptyState
                icon={<PitIcon />}
                title="Нет данных для карты"
                description={emptyMessage}
              />
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}
