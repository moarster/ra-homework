import { describe, expect, it } from 'vitest';
import { type Density, DensityPlanner } from './density.js';

/** Ширина содержимого в каждой плотности: как если бы полоска рендерилась по-настоящему. */
const WIDTHS: Record<Density, number> = { full: 1500, tight: 1380, dense: 1000, compact: 700 };

/** Прогоняет полоску до устойчивого состояния, как это делает цепочка замеров в браузере. */
function settle(planner: DensityPlanner, start: Density, available: number, widths = WIDTHS) {
  let density = start;
  for (let step = 0; step < 10; step += 1) {
    const next = planner.next({ density, contentWidth: widths[density] }, available);
    if (next === density) {
      return density;
    }
    density = next;
  }
  throw new Error('полоска не пришла в устойчивое состояние');
}

describe('плотность полоски', () => {
  it('сворачивается ровно настолько, насколько не хватает места', () => {
    expect(settle(new DensityPlanner(), 'full', 1600)).toBe('full');
    expect(settle(new DensityPlanner(), 'full', 1400)).toBe('tight');
    expect(settle(new DensityPlanner(), 'full', 1262)).toBe('dense');
    expect(settle(new DensityPlanner(), 'full', 900)).toBe('compact');
  });

  it('разворачивается обратно при росте ширины без лишних проб', () => {
    const planner = new DensityPlanner();
    expect(settle(planner, 'full', 900)).toBe('compact');
    // Места под dense еще нет: разница уже известна, пробовать не нужно.
    expect(planner.next({ density: 'compact', contentWidth: 700 }, 990)).toBe('compact');
    expect(settle(planner, 'compact', 1262)).toBe('dense');
    expect(settle(planner, 'dense', 1600)).toBe('full');
  });

  it('не мечется, когда содержимое более полной плотности выросло', () => {
    const planner = new DensityPlanner();
    expect(settle(planner, 'full', 1262)).toBe('dense');
    // Выбран монитор: у всех плотностей появилась кнопка "к последней точке".
    const wider = { full: 1650, tight: 1530, dense: 1150, compact: 850 };
    expect(settle(planner, 'dense', 1262, wider)).toBe('dense');
    expect(settle(planner, 'dense', 1160, wider)).toBe('dense');
    expect(settle(planner, 'dense', 1100, wider)).toBe('compact');
  });
});
