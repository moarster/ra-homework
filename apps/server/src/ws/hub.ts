/**
 * Websocket-хаб (раздел 8 `SPEC.md`).
 *
 * При подключении клиент получает `hello` с состоянием симуляции, порядком показателей и
 * полным снапшотом. Дальше идут тики - не чаще 4 раз в секунду реального времени независимо
 * от скорости виртуального времени - и отдельные сообщения о событиях и дозаливке.
 * Изменения параметров симуляции идут не сюда, а в канал управления (`control.ts`):
 * поток данных закрывается тумблером real-time, а канал управления - нет.
 *
 * В тике едут все точки позиции с прошлого тика (иначе трек рвется при ускорении) и только
 * последние значения остальных показателей.
 */

import '@fastify/websocket';
import type { TelemetryEvent, TrackPoint, VehicleSnapshot, WsServerMessage } from '@ra/contracts';
import { METRIC_ORDER } from '@ra/contracts';
import type { FastifyInstance } from 'fastify';
import { SERVER_RULES } from '../server-config.js';
import type { EngineListener, SimEngine } from '../sim/engine.js';

interface Client {
  socket: WebSocketLike;
  /** Сколько тиков пропущено из-за переполнения буфера сокета. */
  skipped: number;
}

/** Минимум от websocket, который нужен хабу: так его можно проверить тестом без сети. */
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  readyState: number;
  bufferedAmount: number;
  on(event: string, listener: (...args: never[]) => void): void;
  ping?: () => void;
}

const OPEN = 1;

/** Допуск на дрожание таймера публикации, миллисекунды. */
const TICK_TOLERANCE_MS = 20;

const EMPTY_POSITIONS: TrackPoint[] = [];

/** Одна машина в тике: снапшот последних значений и все точки позиции с прошлого тика. */
interface TickVehicle {
  id: string;
  snapshot: VehicleSnapshot;
  pos: TrackPoint[];
}

export class WsHub implements Omit<EngineListener, 'onSim'> {
  private readonly clients = new Set<Client>();
  private lastTickAt = 0;
  private pingTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;

  constructor(private readonly engine: SimEngine) {}

  get clientCount(): number {
    return this.clients.size;
  }

  add(socket: WebSocketLike): Client {
    const client: Client = { socket, skipped: 0 };
    this.clients.add(client);
    this.send(client, {
      type: 'hello',
      sim: this.engine.simState(),
      config: { metricOrder: METRIC_ORDER },
      snapshot: this.engine.snapshots(),
    });
    return client;
  }

  remove(client: Client): void {
    this.clients.delete(client);
  }

  /**
   * Собственный таймер публикации: тик уходит ровно `tickRateHz` раз в секунду реального
   * времени. Привязывать публикацию к пачкам часов симуляции нельзя - их период 100 мс,
   * и при пороге 250 мс получалось бы 3,3 тика в секунду вместо четырех.
   */
  startTicks(): void {
    if (this.tickTimer !== null) {
      return;
    }
    this.tickTimer = setInterval(() => {
      this.publishTick();
    }, 1000 / SERVER_RULES.tickRateHz);
    this.tickTimer.unref();
  }

  startPing(): void {
    if (this.pingTimer !== null) {
      return;
    }
    this.pingTimer = setInterval(() => {
      for (const client of this.clients) {
        if (client.socket.readyState !== OPEN) {
          this.clients.delete(client);
          continue;
        }
        client.socket.ping?.();
      }
    }, SERVER_RULES.pingIntervalMs);
    this.pingTimer.unref();
  }

  stop(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    for (const client of this.clients) {
      client.socket.close();
    }
    this.clients.clear();
  }

  /* ------------------------------------------------------------ EngineListener */

  /**
   * Пачка шагов часов завершена. Публикация тика идет по своему таймеру, поэтому здесь
   * ничего делать не нужно: метод оставлен, чтобы движок не знал о расписании хаба.
   */
  onBatch(_simTime: number): void {}

  onEvents(opened: TelemetryEvent[], closed: TelemetryEvent[]): void {
    if (this.clients.size === 0) {
      return;
    }
    // События не пропускаются никогда, даже медленному клиенту.
    this.broadcast({ type: 'events', opened, closed }, true);
  }

  onBackfill(vehicleId: string, from: number, to: number): void {
    this.broadcast({ type: 'backfill', vehicleId, from, to }, true);
  }

  /* ------------------------------------------------------------ публикация */

  /** Тик не чаще `tickRateHz` раз в секунду реального времени. */
  publishTick(nowMs: number = Date.now()): boolean {
    // Защита от повторного вызова: таймер может сработать раньше из-за дрожания.
    const minInterval = 1000 / SERVER_RULES.tickRateHz - TICK_TOLERANCE_MS;
    if (nowMs - this.lastTickAt < minInterval) {
      return false;
    }
    this.lastTickAt = nowMs;
    if (this.clients.size === 0) {
      // Клиентов нет: буферы позиций все равно нужно освободить, иначе они растут.
      this.engine.drainPositions();
      return false;
    }
    const positions = this.engine.drainPositions();
    const vehicles: TickVehicle[] = this.engine.snapshots().map((snapshot) => ({
      id: snapshot.id,
      snapshot,
      pos: positions.get(snapshot.id) ?? EMPTY_POSITIONS,
    }));
    this.broadcast({ type: 'tick', t: this.engine.simTime, vehicles }, false);
    return true;
  }

  private broadcast(message: WsServerMessage, important: boolean): void {
    if (this.clients.size === 0) {
      return;
    }
    const payload = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.socket.readyState !== OPEN) {
        this.clients.delete(client);
        continue;
      }
      // Медленный клиент не должен копить очередь: тик пропускается, события - нет.
      if (!important && client.socket.bufferedAmount > SERVER_RULES.socketBufferLimitBytes) {
        client.skipped += 1;
        continue;
      }
      client.socket.send(payload);
    }
  }

  private send(client: Client, message: WsServerMessage): void {
    if (client.socket.readyState !== OPEN) {
      return;
    }
    client.socket.send(JSON.stringify(message));
  }
}

/** Регистрация маршрута `/ws`. */
export function registerWebsocket(app: FastifyInstance, hub: WsHub): void {
  app.get('/ws', { websocket: true }, (connection) => {
    const socket = connection as unknown as WebSocketLike;
    const client = hub.add(socket);
    socket.on('message', ((raw: Buffer | string) => {
      try {
        const parsed: unknown = JSON.parse(String(raw));
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          (parsed as { type?: unknown }).type === 'ping'
        ) {
          socket.send(JSON.stringify({ type: 'pong', t: Math.floor(Date.now() / 1000) }));
        }
      } catch {
        // Мусор от клиента игнорируется: разрывать соединение из-за него не нужно.
      }
    }) as (...args: never[]) => void);
    socket.on('close', (() => {
      hub.remove(client);
    }) as (...args: never[]) => void);
    socket.on('error', (() => {
      hub.remove(client);
    }) as (...args: never[]) => void);
  });
  hub.startPing();
  hub.startTicks();
}
