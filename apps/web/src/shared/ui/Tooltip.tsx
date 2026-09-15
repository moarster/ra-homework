/**
 * Всплывашка-подсказка. Появляется по наведению и по фокусу: в тонкой полоске многие элементы
 * сворачиваются в иконки, и подсказка становится единственным способом узнать их смысл.
 */

import {
  cloneElement,
  type ReactElement,
  type ReactNode,
  type Ref,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx.js';
import { type Placement, useFloatingPosition } from './floating.js';

export interface TooltipProps {
  content: ReactNode;
  placement?: Placement;
  /** Элемент-якорь: получает обработчики и `aria-describedby`. */
  children: ReactElement<Record<string, unknown>>;
  /** Задержка появления, миллисекунды. */
  delayMs?: number;
}

/**
 * Подсказка ставит на элемент-якорь свой ref, но у якоря может быть и собственный
 * (например кнопка, к которой привязан поповер). Оба ref должны получить узел.
 */
function composeRefs<T>(own: (node: T | null) => void, foreign: Ref<T> | undefined) {
  return (node: T | null) => {
    own(node);
    if (typeof foreign === 'function') {
      foreign(node);
    } else if (foreign !== null && foreign !== undefined) {
      (foreign as { current: T | null }).current = node;
    }
  };
}

export function Tooltip({ content, placement = 'bottom', children, delayMs = 250 }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [floating, setFloating] = useState<HTMLDivElement | null>(null);
  const timer = useRef<number | null>(null);
  const id = useId();
  const position = useFloatingPosition(anchor, floating, open, placement);

  const show = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
    }
    timer.current = window.setTimeout(() => setOpen(true), delayMs);
  };
  const hide = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    setOpen(false);
  };

  const childRef = (children.props as { ref?: Ref<HTMLElement> }).ref;
  const setRef = useCallback((node: HTMLElement | null) => {
    setAnchor(node);
  }, []);

  /*
   * Составной ref обязан быть стабильным между рендерами. Новая функция на каждый рендер
   * заставляет React отцепить старый ref (setAnchor(null)) и прицепить новый (setAnchor(узел)):
   * оба вызова меняют состояние, и рендер порождает следующий. Под подсказками в панели карты,
   * которая перерисовывается на каждый тик, это при 60 машинах на x300 упиралось в
   * "Maximum update depth exceeded".
   */
  const ref = useMemo(() => composeRefs(setRef, childRef), [setRef, childRef]);

  const anchorProps: Record<string, unknown> = {
    ref,
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: () => setOpen(true),
    onBlur: hide,
    'aria-describedby': open ? id : undefined,
  };

  return (
    <>
      {cloneElement(children, anchorProps)}
      {open &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            ref={setFloating}
            style={{
              left: position?.left ?? 0,
              top: position?.top ?? 0,
              visibility: position === null ? 'hidden' : 'visible',
            }}
            className={cx(
              'glass-float fixed z-50 max-w-72 rounded-control px-2.5 py-1.5',
              'text-[12px] leading-snug text-fg pointer-events-none',
            )}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
