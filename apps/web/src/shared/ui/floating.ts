/**
 * Позиционирование всплывающих слоев. Своя реализация вместо библиотеки: нужны ровно
 * две раскладки (под элементом и над ним) с переворотом при нехватке места и прижатием
 * к краю окна.
 */

import { useCallback, useEffect, useState } from 'react';

export type Placement = 'bottom-start' | 'bottom-end' | 'bottom' | 'top';

export interface FloatingPosition {
  left: number;
  top: number;
  /** Итоговая раскладка после переворота: нужна для направления появления. */
  placement: Placement;
}

/** Зазор между элементом и всплывающим слоем, пиксели. */
const GAP = 8;
/** Минимальный отступ от края окна, пиксели. */
const EDGE = 8;

export function computePosition(
  anchor: DOMRect,
  floating: { width: number; height: number },
  placement: Placement,
): FloatingPosition {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const belowTop = anchor.bottom + GAP;
  const aboveTop = anchor.top - GAP - floating.height;
  const flipped =
    placement !== 'top' && belowTop + floating.height > viewportHeight - EDGE && aboveTop > EDGE;
  const resolved: Placement = flipped ? 'top' : placement;
  const top = resolved === 'top' ? Math.max(EDGE, aboveTop) : belowTop;

  let left: number;
  switch (placement) {
    case 'bottom-end':
      left = anchor.right - floating.width;
      break;
    case 'bottom':
    case 'top':
      left = anchor.left + anchor.width / 2 - floating.width / 2;
      break;
    default:
      left = anchor.left;
      break;
  }
  left = Math.min(Math.max(left, EDGE), Math.max(EDGE, viewportWidth - floating.width - EDGE));

  return { left, top, placement: resolved };
}

/**
 * Следит за положением элемента-якоря, пока слой открыт: при прокрутке и изменении размеров
 * окна слой не должен уезжать от своей кнопки.
 */
export function useFloatingPosition(
  anchor: HTMLElement | null,
  floating: HTMLElement | null,
  open: boolean,
  placement: Placement,
): FloatingPosition | null {
  const [position, setPosition] = useState<FloatingPosition | null>(null);

  const update = useCallback(() => {
    if (anchor === null || floating === null) {
      return;
    }
    const rect = anchor.getBoundingClientRect();
    setPosition(
      computePosition(
        rect,
        { width: floating.offsetWidth, height: floating.offsetHeight },
        placement,
      ),
    );
  }, [anchor, floating, placement]);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    const observer = new ResizeObserver(update);
    if (floating !== null) {
      observer.observe(floating);
    }
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      observer.disconnect();
    };
  }, [open, update, floating]);

  return position;
}
