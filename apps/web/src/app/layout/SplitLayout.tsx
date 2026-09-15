/**
 * Сплиттер двух областей. Граница тащится мышью и клавиатурой, любая область сворачивается
 * целиком, двойной щелчок возвращает 50/50. Минимальная ширина области - 360 px, она считается
 * от фактической ширины контейнера, а не от ширины окна.
 */

import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAppStore, useSplit } from '@/shared/store';
import { cx, IconButton, Tooltip } from '@/shared/ui';

/** Минимальная ширина области, пиксели. */
const MIN_PANE_PX = 360;
/** Шаг изменения с клавиатуры, проценты. */
const KEY_STEP_PERCENT = 2;
/** Крупный шаг (с Shift), проценты. */
const KEY_BIG_STEP_PERCENT = 10;
/** Окно двойного щелчка по границе, миллисекунды. */
const DOUBLE_CLICK_MS = 400;

export interface SplitLayoutProps {
  left: ReactNode;
  right: ReactNode;
  /** Подписи областей: идут в доступные имена и подсказки кнопок сворачивания. */
  leftLabel: string;
  rightLabel: string;
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={direction === 'left' ? 'M14 6l-6 6 6 6' : 'M10 6l6 6-6 6'} />
    </svg>
  );
}

export function SplitLayout({ left, right, leftLabel, rightLabel }: SplitLayoutProps) {
  const split = useSplit();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  /**
   * Время прошлого нажатия на границу. Двойной щелчок ловится вручную: захват указателя
   * (`setPointerCapture`) мешает браузеру складывать нажатия в событие `dblclick`.
   */
  const lastPressAtRef = useRef(0);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (node === null) {
      return;
    }
    setContainerWidth(node.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);

  /** Границы допустимой доли: обе области не уже 360 px. */
  const minPercent = containerWidth > 0 ? Math.min((MIN_PANE_PX / containerWidth) * 100, 50) : 20;
  const maxPercent = 100 - minPercent;

  const clamp = useCallback(
    (percent: number) => Math.min(Math.max(percent, minPercent), maxPercent),
    [minPercent, maxPercent],
  );

  const setPercent = useCallback(
    (percent: number) => {
      useAppStore.getState().setSplitPercent(clamp(percent));
    },
    [clamp],
  );

  // Сужение окна не должно оставлять область уже минимума.
  useEffect(() => {
    if (containerWidth === 0 || split.collapsed !== 'none') {
      return;
    }
    const clamped = clamp(split.leftPercent);
    if (Math.abs(clamped - split.leftPercent) > 0.01) {
      useAppStore.getState().setSplitPercent(clamped);
    }
  }, [containerWidth, clamp, split.leftPercent, split.collapsed]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (split.collapsed !== 'none') {
      return;
    }
    const now = Date.now();
    if (now - lastPressAtRef.current < DOUBLE_CLICK_MS) {
      lastPressAtRef.current = 0;
      useAppStore.getState().resetSplit();
      return;
    }
    lastPressAtRef.current = now;
    draggingRef.current = true;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || containerRef.current === null) {
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    setPercent(((event.clientX - rect.left) / rect.width) * 100);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? KEY_BIG_STEP_PERCENT : KEY_STEP_PERCENT;
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        setPercent(split.leftPercent - step);
        break;
      case 'ArrowRight':
        event.preventDefault();
        setPercent(split.leftPercent + step);
        break;
      case 'Home':
        event.preventDefault();
        setPercent(minPercent);
        break;
      case 'End':
        event.preventDefault();
        setPercent(maxPercent);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        useAppStore.getState().resetSplit();
        break;
      default:
        break;
    }
  };

  const leftCollapsed = split.collapsed === 'left';
  const rightCollapsed = split.collapsed === 'right';
  const leftWidth = leftCollapsed ? '0%' : rightCollapsed ? '100%' : `${clamp(split.leftPercent)}%`;

  return (
    <div ref={containerRef} className="relative flex min-h-0 flex-1">
      <section
        aria-label={leftLabel}
        aria-hidden={leftCollapsed}
        style={{ width: leftWidth }}
        className={cx(
          'relative min-w-0 overflow-hidden',
          leftCollapsed && 'pointer-events-none',
          // Во время перетаскивания переход выключен: иначе граница отстает от курсора.
          dragging ? '' : 'transition-[width] duration-200',
        )}
      >
        {left}
      </section>

      {/* Граница: тонкая линия с широкой зоной захвата и кнопками сворачивания. */}
      {/* biome-ignore lint/a11y/useSemanticElements: <hr> не может содержать кнопки сворачивания
          и не принимает фокус, а перетаскиваемому разделителю нужно и то и другое */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Граница областей"
        aria-valuenow={Math.round(leftCollapsed ? 0 : rightCollapsed ? 100 : split.leftPercent)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className={cx(
          'group relative z-10 flex w-2 shrink-0 touch-none items-center justify-center select-none',
          'outline-offset-[-2px]',
          split.collapsed === 'none' ? 'cursor-col-resize' : 'cursor-default',
        )}
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border-base group-hover:bg-primary/60"
        />
        {/* stopPropagation: иначе pointerdown всплывает к разделителю, тот захватывает
            указатель через setPointerCapture, и клик по кнопке ретаргетится на разделитель,
            не долетая до onClick кнопки. */}
        <div
          onPointerDown={(event) => event.stopPropagation()}
          className="glass-float absolute top-1/2 z-10 flex -translate-y-1/2 flex-col gap-0.5 rounded-control p-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <Tooltip
            content={leftCollapsed ? `Показать: ${leftLabel}` : `Свернуть: ${leftLabel}`}
            placement="bottom"
          >
            <IconButton
              label={leftCollapsed ? `Показать: ${leftLabel}` : `Свернуть: ${leftLabel}`}
              icon={<ChevronIcon direction="left" />}
              onClick={() => useAppStore.getState().setCollapsed(leftCollapsed ? 'none' : 'left')}
            />
          </Tooltip>
          <Tooltip
            content={rightCollapsed ? `Показать: ${rightLabel}` : `Свернуть: ${rightLabel}`}
            placement="bottom"
          >
            <IconButton
              label={rightCollapsed ? `Показать: ${rightLabel}` : `Свернуть: ${rightLabel}`}
              icon={<ChevronIcon direction="right" />}
              onClick={() => useAppStore.getState().setCollapsed(rightCollapsed ? 'none' : 'right')}
            />
          </Tooltip>
        </div>
      </div>

      {/*
        Правая область объявлена контейнером запросов: ее содержимое адаптируется к своей
        ширине, а не к ширине окна (раздел 11.4 CONTEXT.md).
      */}
      <section
        aria-label={rightLabel}
        aria-hidden={rightCollapsed}
        className={cx(
          '@container/monitor relative min-w-0 flex-1 overflow-hidden',
          rightCollapsed && 'pointer-events-none',
        )}
      >
        {right}
      </section>
    </div>
  );
}
