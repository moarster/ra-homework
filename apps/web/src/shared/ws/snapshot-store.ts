/**
 * Mutable-хранилище снапшотов машин - намеренно **вне** React-состояния.
 *
 * При 60 машинах и четырех тиках в секунду пересоздание объектов состояния React обходится
 * дороже самой отрисовки: на каждый тик пришлось бы заново собирать массив из 60 снапшотов
 * и разбудить все подписанные компоненты. Здесь данные меняются на месте, а компоненты
 * подписываются точечно - на весь парк или на одну машину (`useSyncExternalStore`).
 *
 * Бюджет обработки тика - 8 мс (раздел 11 `SPEC.md`), фактическое время видно в отладочной панели.
 */

import {
  APP_CONFIG,
  type SimState,
  type TrackPoint,
  type VehicleSnapshot,
  type WsServerMessage,
} from '@ra/contracts';

/**
 * Событие в том виде, в котором его выводит zod-схема контрактов. Берется из объединения
 * сообщений, а не из интерфейса `TelemetryEvent`: при `exactOptionalPropertyTypes` это
 * разные типы, и единственный честный источник здесь - схема, которой провалидировано сообщение.
 */
export type WsEvent = Extract<WsServerMessage, { type: 'events' }>['opened'][number];

/** Сколько живых точек позиции держим на машину: максимальный хвост трека / шаг точки. */
const MAX_LIVE_POSITIONS = Math.ceil(
  APP_CONFIG.track.maxTailSeconds / APP_CONFIG.track.pointStepSeconds,
);

/** Сколько последних событий держим для отладочной панели. */
const MAX_RECENT_EVENTS = 10;

/** Окно усреднения частоты тиков, миллисекунды реального времени. */
const TICK_RATE_WINDOW_MS = 3000;

export interface SnapshotStats {
  /** Число машин в снапшоте. */
  vehicles: number;
  /** Тиков в секунду реального времени. */
  tickRateHz: number;
  /** Размер последнего сообщения websocket, байты. */
  lastMessageBytes: number;
  /** Разбор и проверка последней пачки сообщений, миллисекунды. */
  lastDecodeMs: number;
  /** Применение последней пачки к хранилищу, миллисекунды. */
  lastApplyMs: number;
  /** Разбор плюс применение: именно это число сравнивается с бюджетом 8 мс. */
  lastTotalMs: number;
  /** Худшее суммарное время с момента подключения, миллисекунды. */
  maxTotalMs: number;
  /** Сколько тиков пришло с момента подключения. */
  ticksReceived: number;
  /** Сколько точек позиции пришло в последней пачке. */
  lastPositionPoints: number;
}

/** Тик в том виде, в котором его применяет хранилище. */
export interface TickPayload {
  t: number;
  vehicles: { id: string; snapshot: VehicleSnapshot; pos: TrackPoint[] }[];
}

class SnapshotStore {
  private readonly snapshots = new Map<string, VehicleSnapshot>();
  private readonly positions = new Map<string, TrackPoint[]>();
  private readonly listeners = new Set<() => void>();
  private readonly vehicleListeners = new Map<string, Set<() => void>>();
  private readonly vehicleVersions = new Map<string, number>();
  private readonly tickTimestamps: number[] = [];

  private version = 0;
  private recentEvents: WsEvent[] = [];

  /** Виртуальное время последнего известного тика или ответа сервера. */
  /** Размер последнего принятого сообщения и число тиков, ждущих применения. */
  private pendingBytes = 0;
  private pendingReceived = 0;

  private simTime = 0;
  /** Реальное время (мс), когда это виртуальное время было получено: нужно для интерполяции. */
  private simTimeAtRealMs = 0;
  private timeScale = 1;
  private running = false;

  private stats: SnapshotStats = {
    vehicles: 0,
    tickRateHz: 0,
    lastMessageBytes: 0,
    lastDecodeMs: 0,
    lastApplyMs: 0,
    lastTotalMs: 0,
    maxTotalMs: 0,
    ticksReceived: 0,
    lastPositionPoints: 0,
  };

  /* ---------------------------------------------------------------- подписка */

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = (): number => this.version;

  /** Подписка на одну машину: плашка в списке перерисовывается только от своего тика. */
  subscribeVehicle(vehicleId: string, listener: () => void): () => void {
    const set = this.vehicleListeners.get(vehicleId) ?? new Set<() => void>();
    set.add(listener);
    this.vehicleListeners.set(vehicleId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.vehicleListeners.delete(vehicleId);
      }
    };
  }

  getVehicleVersion(vehicleId: string): number {
    return this.vehicleVersions.get(vehicleId) ?? 0;
  }

  /* ---------------------------------------------------------------- чтение */

  getSnapshot(vehicleId: string): VehicleSnapshot | undefined {
    return this.snapshots.get(vehicleId);
  }

  /** Идентификаторы машин в снапшоте, в порядке поступления. */
  getVehicleIds(): string[] {
    return [...this.snapshots.keys()];
  }

  getPositions(vehicleId: string): readonly TrackPoint[] {
    return this.positions.get(vehicleId) ?? [];
  }

  getStats(): SnapshotStats {
    return this.stats;
  }

  getRecentEvents(): readonly WsEvent[] {
    return this.recentEvents;
  }

  /** Последнее известное виртуальное время без интерполяции. */
  getSimTime(): number {
    return this.simTime;
  }

  /**
   * Виртуальное время "сейчас": между тиками оно доезжает интерполяцией по реальным часам,
   * иначе при ускорении x60 время в полоске шло бы рывками по четыре раза в секунду.
   */
  interpolatedSimTime(): number {
    if (!this.running || this.simTimeAtRealMs === 0) {
      return this.simTime;
    }
    const elapsedMs = Date.now() - this.simTimeAtRealMs;
    return this.simTime + (elapsedMs / 1000) * this.timeScale;
  }

  /* ---------------------------------------------------------------- запись */

  /** Параметры хода времени: приходят в `hello`, `sim` и из `GET /api/sim`. */
  setSimState(sim: SimState): void {
    this.simTime = sim.simTime;
    this.simTimeAtRealMs = Date.now();
    this.timeScale = sim.timeScale;
    this.running = sim.running;
    this.bump();
  }

  /** Время остановлено: часы в полоске замирают на последней точке. */
  freeze(): void {
    this.simTime = Math.floor(this.interpolatedSimTime());
    this.running = false;
    this.bump();
  }

  /** Полная замена снапшота: `hello` по websocket и `GET /api/telemetry/latest`. */
  replaceSnapshots(snapshots: readonly VehicleSnapshot[], simTime: number): void {
    this.snapshots.clear();
    for (const snapshot of snapshots) {
      this.snapshots.set(snapshot.id, snapshot);
      this.vehicleVersions.set(snapshot.id, (this.vehicleVersions.get(snapshot.id) ?? 0) + 1);
    }
    // Машины, исчезнувшие из парка (уменьшили число машин), теряют и живой трек.
    for (const vehicleId of [...this.positions.keys()]) {
      if (!this.snapshots.has(vehicleId)) {
        this.positions.delete(vehicleId);
      }
    }
    if (simTime > this.simTime) {
      this.simTime = simTime;
      this.simTimeAtRealMs = Date.now();
    }
    this.stats = { ...this.stats, vehicles: this.snapshots.size };
    this.notifyAllVehicles();
    this.bump();
  }

  /**
   * Применение пачки тиков, накопленной за кадр. Пачка, а не отдельное сообщение:
   * четыре сообщения в секунду не должны давать четыре перерисовки дерева.
   */
  /**
   * Отметка о приходе тика. Считается на приеме, а не на применении: частота тиков - свойство
   * потока, и она не должна зависеть от того, когда браузер нашел время отрисовать кадр.
   * Store при этом не будится - иначе четыре сообщения в секунду снова давали бы четыре обхода дерева.
   */
  noteTickReceived(messageBytes: number): void {
    const now = Date.now();
    this.tickTimestamps.push(now);
    while (
      this.tickTimestamps.length > 0 &&
      now - (this.tickTimestamps[0] as number) > TICK_RATE_WINDOW_MS
    ) {
      this.tickTimestamps.shift();
    }
    this.pendingBytes = messageBytes;
    this.pendingReceived += 1;
  }

  applyTicks(ticks: readonly TickPayload[], decodeMs: number): void {
    if (ticks.length === 0) {
      return;
    }
    const startedAt = performance.now();
    const touched = new Set<string>();
    let positionPoints = 0;

    for (const tick of ticks) {
      for (const entry of tick.vehicles) {
        this.snapshots.set(entry.id, entry.snapshot);
        touched.add(entry.id);
        if (entry.pos.length > 0) {
          positionPoints += entry.pos.length;
          const tail = this.positions.get(entry.id);
          if (tail === undefined) {
            this.positions.set(entry.id, entry.pos.slice(-MAX_LIVE_POSITIONS));
          } else {
            tail.push(...entry.pos);
            if (tail.length > MAX_LIVE_POSITIONS) {
              tail.splice(0, tail.length - MAX_LIVE_POSITIONS);
            }
          }
        }
      }
      if (tick.t > this.simTime) {
        this.simTime = tick.t;
        this.simTimeAtRealMs = Date.now();
      }
    }

    for (const vehicleId of touched) {
      this.vehicleVersions.set(vehicleId, (this.vehicleVersions.get(vehicleId) ?? 0) + 1);
    }

    const applyMs = performance.now() - startedAt;
    const totalMs = applyMs + decodeMs;
    this.stats = {
      vehicles: this.snapshots.size,
      tickRateHz: (this.tickTimestamps.length / TICK_RATE_WINDOW_MS) * 1000,
      lastMessageBytes: this.pendingBytes,
      lastDecodeMs: decodeMs,
      lastApplyMs: applyMs,
      lastTotalMs: totalMs,
      maxTotalMs: Math.max(this.stats.maxTotalMs, totalMs),
      ticksReceived: this.stats.ticksReceived + this.pendingReceived,
      lastPositionPoints: positionPoints,
    };
    this.pendingReceived = 0;

    // Подписчики машин будятся первыми: им нужны свежие данные раньше общего дерева.
    for (const vehicleId of touched) {
      const set = this.vehicleListeners.get(vehicleId);
      if (set !== undefined) {
        for (const listener of set) {
          listener();
        }
      }
    }
    this.bump();
  }

  /** События websocket: для отладочной панели и будущей ленты событий. */
  pushEvents(opened: readonly WsEvent[], closed: readonly WsEvent[]): void {
    if (opened.length === 0 && closed.length === 0) {
      return;
    }
    this.recentEvents = [...opened, ...closed, ...this.recentEvents].slice(0, MAX_RECENT_EVENTS);
    this.bump();
  }

  /** Сброс счетчиков: при новом подключении прежние измерения не имеют смысла. */
  resetStats(): void {
    this.tickTimestamps.length = 0;
    this.pendingReceived = 0;
    this.stats = {
      ...this.stats,
      tickRateHz: 0,
      lastDecodeMs: 0,
      lastApplyMs: 0,
      lastTotalMs: 0,
      maxTotalMs: 0,
      ticksReceived: 0,
      lastPositionPoints: 0,
    };
    this.bump();
  }

  private notifyAllVehicles(): void {
    for (const set of this.vehicleListeners.values()) {
      for (const listener of set) {
        listener();
      }
    }
  }

  private bump(): void {
    this.version += 1;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

/** Единственный экземпляр на приложение. */
export const snapshotStore = new SnapshotStore();

export type { SnapshotStore };
