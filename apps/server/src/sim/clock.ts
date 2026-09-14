/**
 * Часы симуляции: виртуальное время, текущее со скоростью `timeScale` (раздел 2 задания этапа).
 *
 * Шаг генерации - одна виртуальная секунда. Шаги выполняются пачками в одном таймере с
 * периодом 100 мс: при `timeScale = 60` за реальную секунду это 10 пачек по 6 шагов.
 * Так частота генерации не зависит от точности таймеров Node.
 *
 * Если процесс не успевает, шаги не пропускаются: накопленный долг остается в `debt`,
 * фиксируется отставание `lagSeconds` и пишется предупреждение в лог. Это и есть данные
 * для замера предельной скорости на этапе 6.
 */

/** Период таймера, миллисекунды. */
export const TICK_INTERVAL_MS = 100;

/** Сколько виртуальных секунд максимум выполняется за одну пачку: защита от залипания. */
const MAX_STEPS_PER_TICK = 600;

/** С какого долга в виртуальных секундах часы считаются отстающими. */
const LAG_WARN_SECONDS = 5;

export interface ClockMetrics {
  /** Текущее виртуальное время, unix seconds. */
  simTime: number;
  /** Невыполненный долг в виртуальных секундах. */
  lagSeconds: number;
  /** Максимальный долг за все время работы. */
  maxLagSeconds: number;
  /** Сколько виртуальных секунд сгенерировано с момента старта. */
  stepsDone: number;
  /** Доля реального времени, уходящая на генерацию, 0..1 (скользящая оценка). */
  load: number;
}

export interface SimClockOptions {
  startTime: number;
  timeScale: number;
  /** Выполнить одну виртуальную секунду. */
  onStep: (simTimeSec: number) => void;
  /** Вызывается после каждой пачки шагов: место для публикации в websocket. */
  onBatch?: (simTimeSec: number) => void;
  onLag?: (lagSeconds: number) => void;
}

export class SimClock {
  private simTimeValue: number;
  private timeScaleValue: number;
  private timer: NodeJS.Timeout | null = null;
  private debt = 0;
  private lag = 0;
  private maxLag = 0;
  private steps = 0;
  private loadValue = 0;
  private lastWarnAt = 0;
  private readonly onStep: (simTimeSec: number) => void;
  private readonly onBatch: ((simTimeSec: number) => void) | undefined;
  private readonly onLag: ((lagSeconds: number) => void) | undefined;

  constructor(options: SimClockOptions) {
    this.simTimeValue = options.startTime;
    this.timeScaleValue = options.timeScale;
    this.onStep = options.onStep;
    this.onBatch = options.onBatch;
    this.onLag = options.onLag;
  }

  get simTime(): number {
    return this.simTimeValue;
  }

  get timeScale(): number {
    return this.timeScaleValue;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  /** Смена скорости не перезапускает симуляцию и не рвет историю. */
  setTimeScale(scale: number): void {
    this.timeScaleValue = scale;
  }

  start(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => {
      this.tick();
    }, TICK_INTERVAL_MS);
    // Таймер не должен держать процесс живым сам по себе: сервер закрывается по сигналу.
    this.timer.unref();
  }

  stop(): void {
    if (this.timer === null) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  metrics(): ClockMetrics {
    return {
      simTime: this.simTimeValue,
      lagSeconds: this.lag,
      maxLagSeconds: this.maxLag,
      stepsDone: this.steps,
      load: this.loadValue,
    };
  }

  /** Выполнить пачку шагов вручную: используется в тестах и при генерации предыстории. */
  advance(seconds: number): void {
    for (let i = 0; i < seconds; i += 1) {
      this.simTimeValue += 1;
      this.steps += 1;
      this.onStep(this.simTimeValue);
    }
    this.onBatch?.(this.simTimeValue);
  }

  private tick(): void {
    const due = (this.timeScaleValue * TICK_INTERVAL_MS) / 1000;
    this.debt += due;
    const planned = Math.floor(this.debt);
    const steps = Math.min(planned, MAX_STEPS_PER_TICK);
    const startedAt = performance.now();
    for (let i = 0; i < steps; i += 1) {
      this.simTimeValue += 1;
      this.steps += 1;
      this.onStep(this.simTimeValue);
    }
    this.debt -= steps;
    const elapsed = performance.now() - startedAt;
    // Скользящее среднее загрузки: доля периода таймера, занятая генерацией.
    this.loadValue = this.loadValue * 0.8 + (elapsed / TICK_INTERVAL_MS) * 0.2;
    // Шаги не пропускаются: неотработанный долг остается в debt и виден как отставание.
    this.lag = this.debt;
    if (this.lag > this.maxLag) {
      this.maxLag = this.lag;
    }
    if (this.lag >= LAG_WARN_SECONDS && startedAt - this.lastWarnAt > 1000) {
      this.lastWarnAt = startedAt;
      this.onLag?.(this.lag);
    }
    this.onBatch?.(this.simTimeValue);
  }
}
