/**
 * Клиент websocket: подключение по тумблеру real-time, переподключение с нарастающей задержкой,
 * буферизация тиков и применение их к хранилищу не чаще одного раза за кадр.
 *
 * Разбор сообщений идет по дискриминированному объединению из контрактов. Полная проверка
 * схемой выполняется для всех сообщений, кроме тиков: тик при 60 машинах весит около 120 КБ,
 * и проверять его четыре раза в секунду означало бы съесть весь бюджет 8 мс на обработку.
 * Поэтому первый тик соединения проверяется схемой целиком (контракт сервера подтвержден),
 * а дальше применяется дешевая структурная проверка.
 */

import {
  type SimState,
  type TrackPoint,
  type VehicleSnapshot,
  wsServerMessageSchema,
} from '@ra/contracts';
import { websocketUrl } from '../api/base-url.js';
import type { ConnectionStatus } from '../store/types.js';
import { snapshotStore, type TickPayload, type WsEvent } from './snapshot-store.js';

/** Задержки переподключения, миллисекунды: растут до полуминуты и дальше не увеличиваются. */
export const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 15_000, 30_000];

/** Как часто шлем ping, миллисекунды реального времени. */
export const PING_INTERVAL_MS = 15_000;

/**
 * Страховочный таймер применения тиков, миллисекунды. `requestAnimationFrame` не срабатывает,
 * пока вкладка скрыта или не отрисовывается, и без страховки тики копились бы в буфере,
 * а по возвращении прилетали пачкой в сотню штук и выносили бюджет обработки.
 */
const FLUSH_FALLBACK_MS = 250;

export interface WsHandlers {
  onStatus: (status: ConnectionStatus) => void;
  /** Состояние симуляции из `hello`. Дальнейшие изменения приходят по каналу управления. */
  onSim: (sim: SimState) => void;
  /** Пришел `hello`: снапшот уже применен, надо добрать пропущенный интервал через REST. */
  onHello: (sim: SimState) => void;
  onBackfill: (vehicleId: string, from: number, to: number) => void;
  onEvents: (opened: WsEvent[], closed: WsEvent[]) => void;
}

/** Структурная проверка тика: дешевая замена схеме для горячего пути. */
function looksLikeTick(value: unknown): value is {
  type: 'tick';
  t: number;
  vehicles: { id: string; snapshot: VehicleSnapshot; pos: TrackPoint[] }[];
} {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { t?: unknown; vehicles?: unknown };
  return typeof candidate.t === 'number' && Array.isArray(candidate.vehicles);
}

export class WsClient {
  private socket: WebSocket | null = null;
  private readonly handlers: WsHandlers;

  /** Тики, накопленные с прошлого кадра. */
  private pending: TickPayload[] = [];
  private pendingDecodeMs = 0;
  private frame: number | null = null;
  private flushTimer: number | null = null;

  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private attempt = 0;
  /** Флаг "нас попросили быть на связи": отличает закрытие по тумблеру от обрыва. */
  private wanted = false;
  private validatedTick = false;

  constructor(handlers: WsHandlers) {
    this.handlers = handlers;
  }

  connect(): void {
    this.wanted = true;
    if (this.socket !== null) {
      return;
    }
    this.openSocket();
  }

  disconnect(): void {
    this.wanted = false;
    this.clearTimers();
    this.cancelFrame();
    this.pending = [];
    const socket = this.socket;
    this.socket = null;
    if (socket !== null) {
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      socket.onopen = null;
      socket.close();
    }
    snapshotStore.freeze();
    this.handlers.onStatus('offline');
  }

  private openSocket(): void {
    this.validatedTick = false;
    this.handlers.onStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    const socket = new WebSocket(websocketUrl('ws'));
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      snapshotStore.resetStats();
      this.handlers.onStatus('online');
      this.pingTimer = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping' }));
        }
      }, PING_INTERVAL_MS);
    };

    socket.onmessage = (event: MessageEvent<string>) => {
      this.handleMessage(event.data);
    };

    socket.onerror = () => {
      // Подробности ошибки браузер не отдает; реакция одна - закрытие и переподключение.
      socket.close();
    };

    socket.onclose = () => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      this.clearTimers();
      if (!this.wanted) {
        this.handlers.onStatus('offline');
        return;
      }
      this.handlers.onStatus('reconnecting');
      const delay = RECONNECT_DELAYS_MS[
        Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)
      ] as number;
      this.attempt += 1;
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = null;
        if (this.wanted) {
          this.openSocket();
        }
      }, delay);
    };
  }

  private handleMessage(raw: string): void {
    const startedAt = performance.now();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Битое сообщение выбрасываем: разрывать соединение из-за одного кадра не нужно.
      return;
    }
    const type = (parsed as { type?: unknown }).type;

    if (type === 'tick') {
      if (!this.validatedTick) {
        const validated = wsServerMessageSchema.safeParse(parsed);
        if (!validated.success) {
          throw new Error(`Тик websocket не соответствует контракту: ${validated.error.message}`);
        }
        this.validatedTick = true;
      } else if (!looksLikeTick(parsed)) {
        return;
      }
      const tick = parsed as TickPayload;
      this.pending.push(tick);
      this.pendingDecodeMs += performance.now() - startedAt;
      snapshotStore.noteTickReceived(raw.length);
      this.scheduleFlush();
      return;
    }

    const message = wsServerMessageSchema.safeParse(parsed);
    if (!message.success) {
      return;
    }
    switch (message.data.type) {
      case 'hello': {
        snapshotStore.setSimState(message.data.sim);
        snapshotStore.replaceSnapshots(message.data.snapshot, message.data.sim.simTime);
        this.handlers.onSim(message.data.sim);
        this.handlers.onHello(message.data.sim);
        break;
      }
      case 'events': {
        snapshotStore.pushEvents(message.data.opened, message.data.closed);
        this.handlers.onEvents(message.data.opened, message.data.closed);
        break;
      }
      case 'backfill': {
        this.handlers.onBackfill(message.data.vehicleId, message.data.from, message.data.to);
        break;
      }
      case 'pong': {
        break;
      }
      default: {
        break;
      }
    }
  }

  /**
   * Тики применяются раз в кадр: так 4 сообщения в секунду дают максимум 4 применения.
   * Кадр и страховочный таймер заводятся вместе, срабатывает тот, что раньше.
   */
  private scheduleFlush(): void {
    if (this.frame === null) {
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        this.flush();
      });
    }
    if (this.flushTimer === null) {
      this.flushTimer = window.setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, FLUSH_FALLBACK_MS);
    }
  }

  private flush(): void {
    if (this.pending.length === 0) {
      return;
    }
    const ticks = this.pending;
    this.pending = [];
    const decodeMs = this.pendingDecodeMs;
    this.pendingDecodeMs = 0;
    snapshotStore.applyTicks(ticks, decodeMs);
  }

  private cancelFrame(): void {
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    if (this.flushTimer !== null) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.pendingDecodeMs = 0;
  }

  private clearTimers(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
