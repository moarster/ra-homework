/**
 * Поповер: слой, открываемый щелчком. Закрывается щелчком снаружи и Escape,
 * фокус возвращается на кнопку-якорь.
 */

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx.js';
import { type Placement, useFloatingPosition } from './floating.js';

/**
 * Счетчик слоев. Поповеры бывают вложенными (список внутри поповера группы симуляции),
 * и щелчок по внутреннему слою не должен закрывать внешний: слой с большим номером
 * считается лежащим внутри, а не снаружи.
 */
let layerCounter = 0;

/** Атрибут, по которому слой узнается в обработчике щелчка снаружи. */
const LAYER_ATTRIBUTE = 'data-popover-layer';

function layerOf(node: Node | null): number | null {
  const element = node instanceof Element ? node : (node?.parentElement ?? null);
  const layer = element?.closest(`[${LAYER_ATTRIBUTE}]`);
  if (layer === null || layer === undefined) {
    return null;
  }
  const value = Number.parseInt(layer.getAttribute(LAYER_ATTRIBUTE) ?? '', 10);
  return Number.isFinite(value) ? value : null;
}

export interface PopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Кнопка-якорь: рисуется вызывающей стороной, сюда приходит ее элемент. */
  anchor: HTMLElement | null;
  placement?: Placement;
  className?: string;
  children: ReactNode;
}

export function Popover({
  open,
  onOpenChange,
  anchor,
  placement = 'bottom-start',
  className,
  children,
}: PopoverProps) {
  const [floating, setFloating] = useState<HTMLDivElement | null>(null);
  const position = useFloatingPosition(anchor, floating, open, placement);
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  const layerRef = useRef<number | null>(null);
  if (open && layerRef.current === null) {
    layerCounter += 1;
    layerRef.current = layerCounter;
  }
  if (!open && layerRef.current !== null) {
    layerRef.current = null;
  }
  const layer = layerRef.current ?? 0;

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target === null) {
        return;
      }
      if (floating?.contains(target) === true || anchor?.contains(target) === true) {
        return;
      }
      // Щелчок по слою, открытому позже нашего, - это щелчок внутри, а не снаружи.
      const targetLayer = layerOf(target);
      if (targetLayer !== null && targetLayer > layer) {
        return;
      }
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
        anchor?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, floating, anchor, close, layer]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div
      ref={setFloating}
      {...{ [LAYER_ATTRIBUTE]: layer }}
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: position === null ? 'hidden' : 'visible',
      }}
      className={cx('glass-float fixed z-40 rounded-panel p-2 text-fg', className)}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Кнопка-якорь плюс поповер: самый частый случай, чтобы не дублировать ref в каждом месте. */
export function usePopoverAnchor() {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const setRef = useCallback((node: HTMLButtonElement | null) => {
    ref.current = node;
    setAnchor(node);
  }, []);
  return { ref: setRef, anchor };
}
