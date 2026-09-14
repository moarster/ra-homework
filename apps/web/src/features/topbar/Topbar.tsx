/**
 * Верхняя полоска: единственный общий элемент управления на экране. Навигации и меню нет,
 * поэтому все, что относится к обеим областям, живет здесь.
 *
 * Полоска обязана оставаться тонкой в одну строку, поэтому она следит за своей шириной
 * и упрощает элементы по мере ее нехватки (см. `density.ts`).
 */

import { useLayoutEffect, useRef, useState } from 'react';
import { cx, Panel } from '@/shared/ui';
import { type Density, densityForWidth, showsLabels, simInPopover } from './density.js';
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
  const [density, setDensity] = useState<Density>('full');

  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null) {
      return;
    }
    setDensity(densityForWidth(node.clientWidth));
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) {
        setDensity(densityForWidth(entry.contentRect.width));
      }
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);

  const compact = density === 'compact';

  return (
    <Panel
      ref={ref}
      tone="glass"
      className={cx(
        'z-20 flex h-12 w-full min-w-0 shrink-0 items-center gap-2.5 px-3',
        'overflow-hidden rounded-none border-x-0 border-t-0',
      )}
    >
      <SystemTitle compact={compact} />
      <Divider />
      <PeriodSelect showLabel={showsLabels(density)} />
      <Divider />
      <SimClock compact={compact} />
      <Divider />
      <RealtimeToggle showLabel={showsLabels(density)} />
      <Divider />
      <TrackedMetrics compact={compact} />

      {/* Все, что правее, прижато к концу полоски. */}
      <div className="ml-auto flex items-center gap-2.5 pl-2">
        <SimControls inPopover={simInPopover(density)} />
        <ThemeSwitch />
        <UserChip compact={compact} />
      </div>
    </Panel>
  );
}
