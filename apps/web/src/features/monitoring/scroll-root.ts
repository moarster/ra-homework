/**
 * Прокручиваемый элемент правой области. Нужен двоим: виртуализации полотна (корень
 * IntersectionObserver - именно он, а не окно) и автоскроллу к графику по `focusMetric`.
 */

import { createContext, type RefObject, useContext, useEffect, useState } from 'react';

export const ScrollRootContext = createContext<RefObject<HTMLDivElement | null> | null>(null);

export function useScrollRoot(): RefObject<HTMLDivElement | null> | null {
  return useContext(ScrollRootContext);
}

/**
 * Запас сверху и снизу видимой области, пиксели: график монтируется чуть раньше, чем
 * въедет в кадр, иначе при прокрутке было бы видно пустое место на месте графика.
 */
const IN_VIEW_MARGIN_PX = 480;

/** Виден ли элемент в прокручиваемой области (с запасом). */
export function useInView(element: Element | null): boolean {
  const root = useScrollRoot();
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (element === null) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry !== undefined) {
          setInView(entry.isIntersecting);
        }
      },
      { root: root?.current ?? null, rootMargin: `${IN_VIEW_MARGIN_PX}px 0px` },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [element, root]);

  return inView;
}
