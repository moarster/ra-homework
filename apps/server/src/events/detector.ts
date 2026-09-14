/**
 * Детектор событий: свертка битов и выходов за нормативы в интервалы (раздел 5.4 `SPEC.md`).
 *
 * Правила:
 * - бит взведен - событие открывается, снят - закрывается;
 * - показатель вне зеленой зоны непрерывно дольше 10 виртуальных секунд - открывается событие
 *   `threshold`; возврат в зеленую зону дольше 30 секунд - закрывается. Гистерезис нужен,
 *   чтобы дребезг на границе зоны не порождал сотни событий;
 * - серверные события: `NO_DATA`, `DATA_BACKFILLED`, `FUEL_THEFT_SUSPECTED`.
 *
 * "Непрерывно" считается по виртуальному времени, а не по числу точек: у показателей с
 * частотой 0,2 Гц между обновлениями стоит последнее известное значение (качество STALE),
 * и его степень отклонения продолжает действовать.
 */

import {
  ALARMS,
  decodeFlags,
  EVENT_RULES,
  eventTitle,
  isStateSet,
  METRICS,
  QUALITY,
  SERVER_EVENTS,
  type Severity,
  type TelemetryEvent,
  thresholdEventCode,
  WARNINGS,
} from '@ra/contracts';
import { STORED_METRICS } from '../store/stored-metrics.js';
import type { EventJournal } from './journal.js';

/**
 * Показатели, по которым открываются события норматива: участвующие в светофоре, кроме
 * `TIME_SINCE_LAST_DATA` - его выход за норматив описывается серверным событием `NO_DATA`,
 * и второе событие о том же было бы дублем.
 */
const THRESHOLD_METRIC_INDEXES: number[] = STORED_METRICS.map((id, index) =>
  METRICS[id].severityRelevant && id !== 'TIME_SINCE_LAST_DATA' ? index : -1,
).filter((index) => index >= 0);

export interface DetectorFrame {
  vehicleId: string;
  t: number;
  /** Значения в порядке `STORED_METRICS`. */
  values: Float64Array;
  /** Качество значений в том же порядке. */
  quality: Uint8Array;
  /** Степень отклонения по показателям в том же порядке. */
  severities: Uint8Array;
  alarms: number;
  warnings: number;
  state: number;
}

/** Состояние детектора по одной машине. */
class VehicleDetectorState {
  alarms = 0;
  warnings = 0;
  /** Открытые события битов по ключу "источник|код": ключ строится только на смене бита. */
  readonly open = new Map<string, TelemetryEvent>();
  /**
   * Открытые события нормативов по индексу показателя. Массив, а не Map: проверка
   * "есть ли открытое событие" делается для каждого показателя каждую секунду, и сборка
   * строкового ключа в этом месте была самой дорогой операцией всего горячего пути.
   */
  readonly thresholdOpen: (TelemetryEvent | null)[];
  /** Открытое событие подозрения на слив топлива. */
  fuelTheft: TelemetryEvent | null = null;
  /** Открытое событие отсутствия данных. */
  noData: TelemetryEvent | null = null;
  /** С какого момента показатель вне зеленой зоны; -1 - в зеленой. */
  readonly outSince: Float64Array;
  /** С какого момента показатель вернулся в зеленую зону; -1 - вне зеленой. */
  readonly greenSince: Float64Array;
  /** Худшая степень за текущий выход. */
  readonly worst: Uint8Array;
  /** Уровень топлива, от которого считается падение при заглушенном двигателе. */
  fuelBaseline: number | null = null;
  /** Был ли разрыв данных с прошлого кадра: непрерывность выхода за норматив прервана. */
  continuityBroken = false;

  constructor(metricCount: number) {
    this.thresholdOpen = new Array<TelemetryEvent | null>(metricCount).fill(null);
    this.outSince = new Float64Array(metricCount).fill(-1);
    this.greenSince = new Float64Array(metricCount).fill(-1);
    this.worst = new Uint8Array(metricCount);
  }
}

const FUEL_LEVEL_INDEX = STORED_METRICS.indexOf('FUEL_LEVEL');

export class EventDetector {
  private readonly states = new Map<string, VehicleDetectorState>();
  private readonly openedBuffer: TelemetryEvent[] = [];
  private readonly closedBuffer: TelemetryEvent[] = [];

  constructor(private readonly journal: EventJournal) {}

  private stateOf(vehicleId: string): VehicleDetectorState {
    const existing = this.states.get(vehicleId);
    if (existing !== undefined) {
      return existing;
    }
    const created = new VehicleDetectorState(STORED_METRICS.length);
    this.states.set(vehicleId, created);
    return created;
  }

  forget(vehicleId: string): void {
    this.states.delete(vehicleId);
  }

  /** Открытые и закрытые с прошлого вызова события: уходят в websocket. */
  drain(): { opened: TelemetryEvent[]; closed: TelemetryEvent[] } {
    if (this.openedBuffer.length === 0 && this.closedBuffer.length === 0) {
      return EMPTY_DRAIN;
    }
    const result = { opened: this.openedBuffer.slice(), closed: this.closedBuffer.slice() };
    this.openedBuffer.length = 0;
    this.closedBuffer.length = 0;
    return result;
  }

  /** Обработать точку машины. */
  observe(frame: DetectorFrame): void {
    const state = this.stateOf(frame.vehicleId);
    state.continuityBroken = false;
    this.observeFlags(state, frame);
    this.observeThresholds(state, frame);
    this.observeFuel(state, frame);
    if (state.noData !== null) {
      this.close(state.noData, frame.t);
      state.noData = null;
    }
  }

  /**
   * Данных за секунду не было: непрерывность выхода за норматив прервана.
   *
   * Без этого сброса событие, открывшееся после возврата связи, получило бы начало
   * из времени до провала - то есть длительность, в которую попал весь провал.
   * Уже открытые события не закрываются: машина могла остаться неисправной.
   */
  observeGap(vehicleId: string): void {
    const state = this.stateOf(vehicleId);
    if (state.continuityBroken) {
      return;
    }
    state.continuityBroken = true;
    state.outSince.fill(-1);
    state.greenSince.fill(-1);
    state.fuelBaseline = null;
  }

  /** Нет данных дольше 40 минут - серверная авария. Вызывается раз в секунду на машину. */
  observeSilence(vehicleId: string, simTimeSec: number, lastGoodAt: number | null): void {
    const state = this.stateOf(vehicleId);
    if (state.noData !== null) {
      return;
    }
    const silenceSeconds = lastGoodAt === null ? Number.POSITIVE_INFINITY : simTimeSec - lastGoodAt;
    if (silenceSeconds < EVENT_RULES.noDataMinutes * 60) {
      return;
    }
    // Событие ставится на момент, когда данные пропали, а не когда это заметили.
    const startedAt =
      lastGoodAt === null ? simTimeSec - EVENT_RULES.noDataMinutes * 60 : lastGoodAt;
    const definition = SERVER_EVENTS.NO_DATA;
    const event = this.journal.add({
      vehicleId,
      source: 'server',
      code: definition.code,
      severity: 2,
      title: definition.name,
      startedAt,
      endedAt: null,
    });
    state.noData = event;
    this.openedBuffer.push(event);
  }

  /** Пришел накопленный буфер: информационное событие, закрывающее `NO_DATA`. */
  observeBackfill(vehicleId: string, from: number, to: number): void {
    const state = this.stateOf(vehicleId);
    if (state.noData !== null) {
      this.close(state.noData, to);
      state.noData = null;
    }
    const definition = SERVER_EVENTS.DATA_BACKFILLED;
    // Информационное событие не имеет степени 1 или 2 в контракте события, поэтому
    // записывается как предупреждение: в журнале оно должно быть видно.
    const event = this.journal.add({
      vehicleId,
      source: 'server',
      code: definition.code,
      severity: 1,
      title: definition.name,
      startedAt: from,
      endedAt: to,
    });
    this.openedBuffer.push(event);
    this.closedBuffer.push(event);
  }

  /**
   * Восстановить события по битам из дозалитого буфера.
   *
   * Полноценный прогон детектора по дозалитым кадрам не делается: события норматива
   * требуют состояния машины времени, которое уже ушло вперед. Биты же самодостаточны -
   * интервал их взведения виден прямо в буфере, поэтому аварии и предупреждения за провал
   * связи в журнале появляются (ограничение зафиксировано в разделе 5.4 `SPEC.md`).
   */
  replayFlags(
    vehicleId: string,
    from: number,
    alarms: Uint16Array,
    warnings: Uint16Array,
    count: number,
  ): void {
    this.replayField(vehicleId, from, alarms, count, 'alarmBit', ALARMS, 2);
    this.replayField(vehicleId, from, warnings, count, 'warningBit', WARNINGS, 1);
  }

  private replayField(
    vehicleId: string,
    from: number,
    field: Uint16Array,
    count: number,
    source: 'alarmBit' | 'warningBit',
    catalog: typeof ALARMS,
    severity: 1 | 2,
  ): void {
    for (const flag of catalog) {
      const mask = 1 << flag.bit;
      let startedAt = -1;
      for (let i = 0; i < count; i += 1) {
        const raised = ((field[i] ?? 0) & mask) !== 0;
        if (raised && startedAt < 0) {
          startedAt = from + i;
        } else if (!raised && startedAt >= 0) {
          this.addClosedEvent(vehicleId, source, flag.code, severity, startedAt, from + i - 1);
          startedAt = -1;
        }
      }
      if (startedAt >= 0) {
        this.addClosedEvent(vehicleId, source, flag.code, severity, startedAt, from + count - 1);
      }
    }
  }

  private addClosedEvent(
    vehicleId: string,
    source: 'alarmBit' | 'warningBit',
    code: string,
    severity: 1 | 2,
    startedAt: number,
    endedAt: number,
  ): void {
    const event = this.journal.add({
      vehicleId,
      source,
      code,
      severity,
      title: eventTitle(source, code),
      startedAt,
      endedAt,
    });
    this.openedBuffer.push(event);
    this.closedBuffer.push(event);
  }

  private observeFlags(state: VehicleDetectorState, frame: DetectorFrame): void {
    if (frame.alarms !== state.alarms) {
      this.diffFlags(state, frame, 'alarmBit', state.alarms, frame.alarms, ALARMS, 2);
      state.alarms = frame.alarms;
    }
    if (frame.warnings !== state.warnings) {
      this.diffFlags(state, frame, 'warningBit', state.warnings, frame.warnings, WARNINGS, 1);
      state.warnings = frame.warnings;
    }
  }

  private diffFlags(
    state: VehicleDetectorState,
    frame: DetectorFrame,
    source: 'alarmBit' | 'warningBit',
    previous: number,
    next: number,
    catalog: typeof ALARMS,
    severity: 1 | 2,
  ): void {
    const raised = next & ~previous;
    const cleared = previous & ~next;
    for (const flag of decodeFlags(raised, catalog)) {
      this.openEvent(state, {
        vehicleId: frame.vehicleId,
        source,
        code: flag.code,
        severity,
        title: eventTitle(source, flag.code),
        startedAt: frame.t,
        endedAt: null,
      });
    }
    for (const flag of decodeFlags(cleared, catalog)) {
      this.closeEvent(state, `${source}|${flag.code}`, frame.t);
    }
  }

  private observeThresholds(state: VehicleDetectorState, frame: DetectorFrame): void {
    for (const metricIndex of THRESHOLD_METRIC_INDEXES) {
      const quality = frame.quality[metricIndex] ?? QUALITY.NOT_AVAILABLE;
      if (quality === QUALITY.COMM_ERROR || quality === QUALITY.NOT_AVAILABLE) {
        continue;
      }
      const severity = (frame.severities[metricIndex] ?? 3) as Severity;
      const metric = STORED_METRICS[metricIndex];
      if (metric === undefined || severity === 3) {
        continue;
      }
      if (severity === 0) {
        state.outSince[metricIndex] = -1;
        const greenSince = state.greenSince[metricIndex] ?? -1;
        if (greenSince < 0) {
          state.greenSince[metricIndex] = frame.t;
          continue;
        }
        const open = state.thresholdOpen[metricIndex];
        if (
          open !== null &&
          open !== undefined &&
          frame.t - greenSince >= EVENT_RULES.closeAfterSeconds
        ) {
          // Событие закрывается моментом возврата в зеленую зону, а не концом гистерезиса.
          this.close(open, frame.t - EVENT_RULES.closeAfterSeconds);
          state.thresholdOpen[metricIndex] = null;
          state.worst[metricIndex] = 0;
        }
        continue;
      }
      state.greenSince[metricIndex] = -1;
      const outSince = state.outSince[metricIndex] ?? -1;
      if (outSince < 0) {
        state.outSince[metricIndex] = frame.t;
        state.worst[metricIndex] = severity;
      }
      const worst = Math.max(state.worst[metricIndex] ?? 0, severity);
      state.worst[metricIndex] = worst;
      const since = state.outSince[metricIndex] ?? frame.t;
      const existing = state.thresholdOpen[metricIndex];
      const value = frame.values[metricIndex] ?? Number.NaN;
      if (existing === null || existing === undefined) {
        if (frame.t - since < EVENT_RULES.openAfterSeconds) {
          continue;
        }
        const code = thresholdEventCode(metric);
        const opened = this.journal.add({
          vehicleId: frame.vehicleId,
          source: 'threshold',
          code,
          metric,
          severity: worst === 2 ? 2 : 1,
          title: eventTitle('threshold', code),
          startedAt: since,
          endedAt: null,
          peakValue: value,
          peakAt: frame.t,
        });
        state.thresholdOpen[metricIndex] = opened;
        this.openedBuffer.push(opened);
        continue;
      }
      // Событие уже открыто: обновляем степень и пик.
      if (worst === 2) {
        existing.severity = 2;
      }
      this.updatePeak(existing, metric, value, frame.t);
    }
  }

  /** Пик события: худшее значение по опасному направлению показателя. */
  private updatePeak(event: TelemetryEvent, metric: string, value: number, t: number): void {
    if (!Number.isFinite(value)) {
      return;
    }
    const direction = METRICS[metric as keyof typeof METRICS]?.worseDirection ?? 'up';
    const current = event.peakValue;
    if (current === undefined) {
      event.peakValue = value;
      event.peakAt = t;
      return;
    }
    const worse =
      direction === 'down'
        ? value < current
        : direction === 'both'
          ? Math.abs(value) > Math.abs(current)
          : value > current;
    if (worse) {
      event.peakValue = value;
      event.peakAt = t;
    }
  }

  /** Падение уровня топлива больше 5% при заглушенном двигателе - подозрение на слив. */
  private observeFuel(state: VehicleDetectorState, frame: DetectorFrame): void {
    if (FUEL_LEVEL_INDEX < 0) {
      return;
    }
    const engineRunning = isStateSet(frame.state, 'ENGINE_RUNNING');
    const level = frame.values[FUEL_LEVEL_INDEX] ?? Number.NaN;
    if (engineRunning || !Number.isFinite(level)) {
      state.fuelBaseline = null;
      if (state.fuelTheft !== null) {
        this.close(state.fuelTheft, frame.t);
        state.fuelTheft = null;
      }
      return;
    }
    if (state.fuelBaseline === null) {
      state.fuelBaseline = level;
      return;
    }
    if (level > state.fuelBaseline) {
      // Заправка: базовая точка сдвигается вверх.
      state.fuelBaseline = level;
      return;
    }
    if (state.fuelBaseline - level < EVENT_RULES.fuelTheftDropPercent) {
      return;
    }
    if (state.fuelTheft !== null) {
      return;
    }
    const definition = SERVER_EVENTS.FUEL_THEFT_SUSPECTED;
    const event = this.journal.add({
      vehicleId: frame.vehicleId,
      source: 'server',
      code: definition.code,
      metric: 'FUEL_LEVEL',
      severity: 1,
      title: definition.name,
      startedAt: frame.t,
      endedAt: null,
      peakValue: level,
      peakAt: frame.t,
    });
    state.fuelTheft = event;
    this.openedBuffer.push(event);
  }

  /** Открыть событие бита: ключ строится только в момент смены бита. */
  private openEvent(
    state: VehicleDetectorState,
    event: Omit<TelemetryEvent, 'id'>,
  ): TelemetryEvent | null {
    const key = `${event.source}|${event.code}`;
    if (state.open.has(key)) {
      return null;
    }
    const stored = this.journal.add(event);
    state.open.set(key, stored);
    this.openedBuffer.push(stored);
    return stored;
  }

  private closeEvent(state: VehicleDetectorState, key: string, t: number): boolean {
    const event = state.open.get(key);
    if (event === undefined) {
      return false;
    }
    state.open.delete(key);
    this.close(event, t);
    return true;
  }

  private close(event: TelemetryEvent, t: number): void {
    event.endedAt = Math.max(event.startedAt, t);
    this.closedBuffer.push(event);
  }

  /** Активные события машины: нужно сводке для расчета КТГ. */
  activeCodes(vehicleId: string): string[] {
    return Array.from(this.stateOf(vehicleId).open.keys());
  }
}

const EMPTY_DRAIN = { opened: [] as TelemetryEvent[], closed: [] as TelemetryEvent[] };
