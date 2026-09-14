/**
 * Оверлей карты: один canvas, один цикл `requestAnimationFrame` и слой всплывашек в DOM.
 *
 * Данные в цикл отрисовки попадают через ref, а не через пропсы: точки трека приезжают
 * четыре раза в секунду, и перерисовывать из-за них дерево React незачем - меняется только
 * картинка внутри canvas. React здесь отвечает за всплывашки и за жизненный цикл, кадр
 * рисуется вне его.
 */

import { APP_CONFIG, type MetricId } from '@ra/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore, useMonitorTs, useSelectedVehicleId, useTheme } from '@/shared/store';
import { snapshotStore } from '@/shared/ws';
import { isNoDataAlarm } from './data/no-data.js';
import type { MapData, MapVehicle } from './data/use-map-data.js';
import { drawPitSchematic } from './overlay/draw-fallback.js';
import { mapPalette } from './overlay/palette.js';
import {
  type HoverTarget,
  type MarkHit,
  OverlayRenderer,
  pickTarget,
  sameTarget,
} from './overlay/renderer.js';
import { MarkPopup } from './popups/MarkPopup.js';
import { VehiclePopup } from './popups/VehiclePopup.js';
import type { MapProvider } from './provider/types.js';
import { markSelectionFromMap } from './selection-origin.js';

/** Отступ всплывашки от точки привязки, пиксели. */
const POPUP_OFFSET = 18;
/** Минимальный зазор от краев области, пиксели. */
const POPUP_EDGE = 8;

/**
 * Задержка отрисовки в долях интервала между тиками. Кадр рисуется чуть в прошлом, чтобы
 * позиция между точками интерполировалась, а не экстраполировалась: иначе машина убегала бы
 * вперед по прямой и дергалась назад на каждом тике.
 */
const RENDER_LAG_TICKS = 1.1;
/** Интервал публикации тиков сервером, секунды реального времени (раздел 8 `SPEC.md`). */
const TICK_INTERVAL_SECONDS = 0.25;

/** Сдвиг указателя, после которого нажатие считается перетаскиванием карты, а не щелчком. */
const DRAG_THRESHOLD_PX = 4;

type Popup =
  | {
      kind: 'vehicle';
      vehicleId: string;
      lat: number;
      lon: number;
      expanded: boolean;
      at: number | null;
    }
  | {
      kind: 'mark';
      vehicleId: string;
      lat: number;
      lon: number;
      code: string;
      severity: MarkHit['severity'];
      t: number;
    };

export interface MapCanvasProps {
  provider: MapProvider;
  data: MapData;
  /** Подложка не доступна: рисуем схему карьера вместо снимка. */
  schematic: boolean;
  /** Элемент карты, на котором слушается указатель. */
  interactionTarget: HTMLElement | null;
}

export function MapCanvas({ provider, data, schematic, interactionTarget }: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<OverlayRenderer | null>(null);
  if (rendererRef.current === null) {
    rendererRef.current = new OverlayRenderer();
  }
  const renderer = rendererRef.current;

  const theme = useTheme();
  const selectedVehicleId = useSelectedVehicleId();
  const monitorTs = useMonitorTs();
  const [popup, setPopup] = useState<Popup | null>(null);
  /** Цель под курсором: подсвечивается в кадре отрисовки. */
  const [hover, setHover] = useState<HoverTarget | null>(null);

  /**
   * Все, что нужно кадру, в одном ref. Цикл отрисовки не пересоздается при каждом изменении
   * данных - он просто читает свежее содержимое.
   */
  const frameRef = useRef({ data, theme, selectedVehicleId, monitorTs, schematic, popup, hover });
  frameRef.current = { data, theme, selectedVehicleId, monitorTs, schematic, popup, hover };

  /* --------------------------------------------------------------- цикл отрисовки */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      return;
    }

    let frame = 0;
    let width = 0;
    let height = 0;
    let ratio = 0;

    const draw = () => {
      frame = requestAnimationFrame(draw);
      const projector = provider.createProjector();
      if (projector === null) {
        return;
      }

      // Размер полотна согласуется с devicePixelRatio, иначе на HiDPI все мыльное.
      const nextRatio = Math.min(window.devicePixelRatio || 1, 2);
      if (projector.width !== width || projector.height !== height || nextRatio !== ratio) {
        width = projector.width;
        height = projector.height;
        ratio = nextRatio;
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

      const current = frameRef.current;
      const palette = mapPalette(current.theme);

      ctx.clearRect(0, 0, width, height);
      if (current.schematic) {
        // Тайлов нет: вместо снимка под машинами рисуется схема карьера из справочника.
        drawPitSchematic(ctx, projector, palette);
      }

      const simState = useAppStore.getState().sim;
      const lag = RENDER_LAG_TICKS * TICK_INTERVAL_SECONDS * simState.timeScale;
      const now = simState.running
        ? snapshotStore.interpolatedSimTime() - lag
        : snapshotStore.getSimTime();

      renderer.render(ctx, projector, {
        now,
        tailFrom: now - current.data.tailSeconds,
        tails: current.data.tails.entries(),
        meta: current.data.meta,
        snapshot: (vehicleId) => snapshotStore.getSnapshot(vehicleId),
        selectedVehicleId: current.selectedVehicleId,
        monitorTs: current.monitorTs,
        hover: current.hover,
        palette,
        defaultZoom: APP_CONFIG.pit.defaultZoom,
      });

      // Всплывашка привязана к координатам, а не к пикселям: при движении карты она едет
      // вместе со своей машиной. Позиция ставится стилем, без перерисовки React.
      const node = popupRef.current;
      const anchor = current.popup;
      if (node !== null && anchor !== null) {
        const screen = projector.project(anchor.lat, anchor.lon, { x: 0, y: 0 });
        const maxLeft = Math.max(POPUP_EDGE, width - node.offsetWidth - POPUP_EDGE);
        const maxTop = Math.max(POPUP_EDGE, height - node.offsetHeight - POPUP_EDGE);
        const left = Math.min(Math.max(screen.x + POPUP_OFFSET, POPUP_EDGE), maxLeft);
        const top = Math.min(Math.max(screen.y - node.offsetHeight / 2, POPUP_EDGE), maxTop);
        node.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
      }
    };

    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [provider, renderer]);

  // Смена парка обнуляет сглаживание курса: иначе новая машина доворачивалась бы от чужого угла.
  useEffect(() => {
    renderer.reset();
  }, [renderer]);

  /* ------------------------------------------------------------------ интерактив */

  /** Что сейчас под курсором. Наведение и щелчок разбирают цели одной и той же функцией. */
  const pickAt = useCallback(
    (x: number, y: number) => {
      const projector = provider.createProjector();
      if (projector === null) {
        return null;
      }
      const current = frameRef.current;
      const simState = useAppStore.getState().sim;
      const now = simState.running
        ? snapshotStore.interpolatedSimTime()
        : snapshotStore.getSimTime();
      return pickTarget(
        renderer,
        current.data.tails.entries(),
        projector,
        now - current.data.tailSeconds,
        current.selectedVehicleId,
        x,
        y,
      );
    },
    [provider, renderer],
  );

  /** Голова хвоста машины: к ней привязывается всплывашка наведения. */
  const vehicleAnchor = useCallback((vehicleId: string): { lat: number; lon: number } | null => {
    const tail = frameRef.current.data.tails.get(vehicleId);
    const index = tail === undefined ? -1 : tail.count - 1;
    if (tail === undefined || index < 0) {
      return null;
    }
    return { lat: tail.lat[index] as number, lon: tail.lon[index] as number };
  }, []);

  const onPointerMoveAt = useCallback(
    (x: number, y: number) => {
      const target = pickAt(x, y);
      // Курсор возвращается карте, когда цели под ним нет: перетаскивание рисует свой.
      provider.setCursor(target === null ? null : 'pointer');
      setHover((current) => (sameTarget(current, target) ? current : target));

      setPopup((current) => {
        // Развернутая всплывашка живет до явного закрытия: наведение ее не трогает.
        if (current !== null && current.kind === 'vehicle' && current.expanded) {
          return current;
        }
        if (current !== null && current.kind === 'mark') {
          return current;
        }
        // По наведению всплывашка показывается только у машины: у хвоста и флажков она
        // открывается щелчком, иначе она мелькала бы вдоль всего трека.
        if (target === null || target.kind !== 'vehicle') {
          return null;
        }
        if (
          current !== null &&
          current.kind === 'vehicle' &&
          current.vehicleId === target.vehicleId
        ) {
          return current;
        }
        const anchor = vehicleAnchor(target.vehicleId);
        if (anchor === null) {
          return null;
        }
        return {
          kind: 'vehicle',
          vehicleId: target.vehicleId,
          lat: anchor.lat,
          lon: anchor.lon,
          expanded: false,
          at: null,
        };
      });
    },
    [pickAt, provider, vehicleAnchor],
  );

  const onClickAt = useCallback(
    (x: number, y: number) => {
      const store = useAppStore.getState();
      const target = pickAt(x, y);

      if (target === null) {
        setPopup(null);
        return;
      }

      if (target.kind === 'mark') {
        const tail = frameRef.current.data.tails.get(target.vehicleId);
        const mark = tail?.marks.find((item) => item.t === target.t && item.code === target.code);
        setPopup({
          kind: 'mark',
          vehicleId: target.vehicleId,
          lat: mark?.lat ?? 0,
          lon: mark?.lon ?? 0,
          code: target.code,
          severity: target.severity,
          t: target.t,
        });
        return;
      }

      if (target.kind === 'vehicle') {
        const anchor = vehicleAnchor(target.vehicleId);
        // Клик по машине открывает ее страницу справа (раздел 7 этапа).
        markSelectionFromMap();
        store.selectVehicle(target.vehicleId);
        setPopup({
          kind: 'vehicle',
          vehicleId: target.vehicleId,
          lat: anchor?.lat ?? 0,
          lon: anchor?.lon ?? 0,
          expanded: true,
          at: null,
        });
        return;
      }

      if (target.kind === 'monitor') {
        // Монитор уже стоит в этой точке: щелчок по его флажку просто показывает, что в ней.
        const tail = frameRef.current.data.tails.get(target.vehicleId);
        const anchor = tail === undefined ? null : vehicleAnchor(target.vehicleId);
        setPopup({
          kind: 'vehicle',
          vehicleId: target.vehicleId,
          lat: anchor?.lat ?? 0,
          lon: anchor?.lon ?? 0,
          expanded: true,
          at: target.t,
        });
        return;
      }

      // Клик по точке трека - то же, что клик по машине, плюс монитор на момент точки.
      // Порядок важен: `selectVehicle` сбрасывает монитор при смене машины.
      markSelectionFromMap();
      store.selectVehicle(target.vehicleId);
      store.setMonitorTs(target.t);
      setPopup({
        kind: 'vehicle',
        vehicleId: target.vehicleId,
        lat: target.lat,
        lon: target.lon,
        expanded: true,
        at: target.t,
      });
    },
    [pickAt, vehicleAnchor],
  );

  /** Курсор ушел с карты: снимаем подсветку, возвращаем курсор карте, прячем всплывашку. */
  const onPointerLeaveMap = useCallback(() => {
    provider.setCursor(null);
    setHover(null);
    setPopup((item) => (item !== null && item.kind === 'vehicle' && !item.expanded ? null : item));
  }, [provider]);

  /**
   * Указатель слушается на самом элементе карты, а не на слое поверх нее.
   *
   * Слой поверх карты перехватывал бы события до MapLibre, и карта перестала бы
   * перетаскиваться и зумиться колесом - то есть перестала бы быть картой. Здесь события
   * всплывают от canvas карты, MapLibre обрабатывает их как обычно, а мы читаем координаты
   * для попадания по машинам и точкам трека.
   */
  useEffect(() => {
    const target = interactionTarget;
    if (target === null) {
      return;
    }
    // Перетаскивание не должно считаться щелчком: карту возят по снимку постоянно.
    let downX = 0;
    let downY = 0;
    let dragged = false;

    const local = (event: PointerEvent | MouseEvent) => {
      const rect = target.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const onPointerDown = (event: PointerEvent) => {
      downX = event.clientX;
      downY = event.clientY;
      dragged = false;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (
        event.buttons !== 0 &&
        Math.hypot(event.clientX - downX, event.clientY - downY) > DRAG_THRESHOLD_PX
      ) {
        dragged = true;
      }
      const { x, y } = local(event);
      onPointerMoveAt(x, y);
    };
    const onClick = (event: MouseEvent) => {
      if (dragged) {
        return;
      }
      const { x, y } = local(event);
      onClickAt(x, y);
    };
    target.addEventListener('pointerdown', onPointerDown);
    target.addEventListener('pointermove', onPointerMove);
    target.addEventListener('click', onClick);
    target.addEventListener('pointerleave', onPointerLeaveMap);
    return () => {
      target.removeEventListener('pointerdown', onPointerDown);
      target.removeEventListener('pointermove', onPointerMove);
      target.removeEventListener('click', onClick);
      target.removeEventListener('pointerleave', onPointerLeaveMap);
    };
  }, [interactionTarget, onPointerMoveAt, onClickAt, onPointerLeaveMap]);

  // Escape закрывает всплывашку - так же, как в поповерах дизайн-системы.
  useEffect(() => {
    if (popup === null) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPopup(null);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [popup]);

  const onSelectMetric = useCallback((metricId: MetricId) => {
    // Показатель во всплывашке открывает страницу машины и ставит фокус на нужный график.
    useAppStore.getState().setFocusMetric(metricId);
  }, []);

  const popupVehicle: MapVehicle | undefined =
    popup === null ? undefined : data.vehicles.get(popup.vehicleId);

  return (
    /*
     * Весь оверлей прозрачен для указателя: события забирает карта под ним, а мы слушаем их
     * на ней же. Ловит указатель только сама всплывашка - в ней есть ссылки и кнопки.
     */
    <div className="pointer-events-none absolute inset-0">
      <canvas ref={canvasRef} className="absolute inset-0" />
      {popup !== null && popupVehicle !== undefined && (
        <div
          ref={popupRef}
          className="pointer-events-auto absolute top-0 left-0 z-20 will-change-transform"
        >
          {popup.kind === 'vehicle' ? (
            <VehiclePopup
              vehicle={popupVehicle}
              snapshot={snapshotStore.getSnapshot(popup.vehicleId)}
              expanded={popup.expanded}
              noData={isNoDataAlarm(snapshotStore.getSnapshot(popup.vehicleId))}
              at={popup.at}
              onSelectMetric={onSelectMetric}
            />
          ) : (
            <MarkPopup
              code={popup.code}
              severity={popup.severity}
              t={popup.t}
              sideNumber={popupVehicle.sideNumber}
            />
          )}
        </div>
      )}
    </div>
  );
}
