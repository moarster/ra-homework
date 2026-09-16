/**
 * Верхняя полоска: единственный общий элемент управления на экране. Навигации и меню нет,
 * поэтому все, что относится к обеим областям, живет здесь.
 *
 * Полоска обязана оставаться тонкой в одну строку, поэтому она меряет свое содержимое
 * и упрощает элементы ровно настолько, насколько не хватает ширины (см. `density.ts`).
 */

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { cx, Panel } from '@/shared/ui';
import { type Density, DensityPlanner, isCondensed, showsLabels, simInPopover } from './density.js';
import { PeriodSelect } from './PeriodSelect.js';
import { RealtimeToggle } from './RealtimeToggle.js';
import { SimClock } from './SimClock.js';
import { SimControls } from './SimControls.js';
import { SystemTitle } from './SystemTitle.js';
import { ThemeSwitch } from './ThemeSwitch.js';
import { TrackedMetrics } from './TrackedMetrics.js';
import { UserChip } from './UserChip.js';

/** Вертикальный разделитель групп: полоска читается как несколько блоков, а не каша. */
function Divider() {
  return <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border-base" />;
}

export function Topbar() {
  const ref = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const [density, setDensity] = useState<Density>('full');
  const planner = useRef(new DensityPlanner());
  /** Плотность, которую сейчас показывает DOM; null - новая плотность еще не отрисована. */
  const rendered = useRef<Density | null>(null);

  /*
   * Замер читает только refs, поэтому функция стабильна. Содержимое групп меняется и без
   * перерисовки полоски (монитор, статус соединения, отслеживаемые), за этим следит
   * ResizeObserver на группах.
   */
  const measure = useCallback(() => {
    const panel = ref.current;
    const start = startRef.current;
    const end = endRef.current;
    const current = rendered.current;
    if (panel === null || start === null || end === null || current === null) {
      return;
    }
    const style = window.getComputedStyle(panel);
    const available =
      panel.clientWidth -
      Number.parseFloat(style.paddingLeft) -
      Number.parseFloat(style.paddingRight);
    if (available <= 0) {
      return;
    }
    const gap = Number.parseFloat(style.columnGap) || 0;
    const contentWidth =
      start.getBoundingClientRect().width + end.getBoundingClientRect().width + gap;
    const next = planner.current.next({ density: current, contentWidth }, available);
    if (next !== current) {
      rendered.current = null;
      setDensity(next);
    }
  }, []);

  // Замер после каждой отрисовки: смена плотности меняет ширину, и следующий замер решает,
  // хватает ли места. Обновление из `useLayoutEffect` отрисовывается синхронно, до кадра.
  useLayoutEffect(() => {
    rendered.current = density;
    measure();
  });

  useLayoutEffect(() => {
    const observer = new ResizeObserver(measure);
    for (const node of [ref.current, startRef.current, endRef.current]) {
      if (node !== null) {
        observer.observe(node);
      }
    }
    return () => {
      observer.disconnect();
    };
  }, [measure]);

  const condensed = isCondensed(density);

  return (
    <Panel
      ref={ref}
      tone="glass"
      className={cx(
        'z-20 flex h-12 w-full min-w-0 shrink-0 items-center gap-2.5 px-3',
        'overflow-hidden rounded-none border-x-0 border-t-0',
      )}
    >
      {/* Группы не сжимаются: их ширина - это и есть замер содержимого. */}
      <div ref={startRef} className="flex shrink-0 items-center gap-2.5">
        <SystemTitle compact={condensed} />
        <Divider />
        <PeriodSelect showLabel={showsLabels(density)} />
        <Divider />
        <SimClock compact={condensed} />
        <Divider />
        <RealtimeToggle showLabel={showsLabels(density)} />
        <Divider />
        <TrackedMetrics compact={condensed} />
      </div>

      {/* Все, что правее, прижато к концу полоски. */}
      <div ref={endRef} className="ml-auto flex shrink-0 items-center gap-2.5 pl-2">
        <SimControls inPopover={simInPopover(density)} />
        <ThemeSwitch />
        <UserChip compact={condensed} />
      </div>
    </Panel>
  );
}
