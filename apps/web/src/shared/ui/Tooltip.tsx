/**
 * Всплывашка-подсказка. Появляется по наведению и по фокусу: в тонкой полоске многие элементы
 * сворачиваются в иконки, и подсказка становится единственным способом узнать их смысл.
 *
 * Подсказка уступает место тому, что открывает сам элемент: после нажатия на якорь она прячется
 * до ухода указателя, и не появляется, пока у якоря открыт список или поповер
 * (`aria-expanded="true"` на нем или внутри). Иначе она ложилась поверх выпадающего списка.
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
  /** Якорь нажали: подсказка молчит, пока указатель не уйдет с него. */
  const suppressed = useRef(false);
  const id = useId();
  const position = useFloatingPosition(anchor, floating, open, placement);

  const expanded = () =>
    anchor !== null &&
    (anchor.getAttribute('aria-expanded') === 'true' ||
      anchor.querySelector('[aria-expanded="true"]') !== null);

  const show = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
    }
    if (suppressed.current) {
      return;
    }
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (!suppressed.current && !expanded()) {
        setOpen(true);
      }
    }, delayMs);
  };
  const hide = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    setOpen(false);
  };

  const childProps = children.props as {
    ref?: Ref<HTMLElement>;
    onPointerDown?: (event: unknown) => void;
    onKeyDown?: (event: unknown) => void;
  };
  const childRef = childProps.ref;
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
    onMouseLeave: () => {
      suppressed.current = false;
      hide();
    },
    onPointerDown: (event: unknown) => {
      suppressed.current = true;
      hide();
      childProps.onPointerDown?.(event);
    },
    onKeyDown: (event: unknown) => {
      hide();
      childProps.onKeyDown?.(event);
    },
    onFocus: () => {
      if (!suppressed.current && !expanded()) {
        setOpen(true);
      }
    },
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
              'glass-popup fixed z-50 max-w-72 rounded-control px-2.5 py-1.5',
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
