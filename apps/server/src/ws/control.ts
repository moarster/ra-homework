/**
 * Канал управления `/ws/sim`: состояние симуляции и число зрителей стенда.
 *
 * Отделен от потока данных `/ws`. Тумблер real-time закрывает поток данных, но симуляция
 * одна на всех, кто открыл стенд: если другой зритель поменял число машин или скорость,
 * это должно дойти до каждой вкладки независимо от тумблера. Сообщения редкие и маленькие,
 * поэтому пропусков, как у тиков, здесь нет.
 */

import '@fastify/websocket';
import type { SimState, WsControlMessage } from '@ra/contracts';
import type { FastifyInstance } from 'fastify';
import { SERVER_RULES } from '../server-config.js';
import type { SimEngine } from '../sim/engine.js';
import type { WebSocketLike } from './hub.js';

const OPEN = 1;

interface ControlClient {
  socket: WebSocketLike;
  /** Ответил ли клиент на прошлый ping: иначе соединение считается мертвым. */
  alive: boolean;
}

export class ControlHub {
  private readonly clients = new Set<ControlClient>();
  private pingTimer: NodeJS.Timeout | null = null;

  constructor(private readonly engine: SimEngine) {}

  /** Открытые вкладки стенда. Уснувший ноутбук выпадает из счета через один-два ping. */
  get viewerCount(): number {
    return this.clients.size;
  }

  add(socket: WebSocketLike): ControlClient {
    const client: ControlClient = { socket, alive: true };
    this.clients.add(client);
    socket.on('pong', (() => {
      client.alive = true;
    }) as (...args: never[]) => void);
    this.send(client, { type: 'sim', sim: this.engine.simState() });
    this.broadcastViewers();
    return client;
  }

  remove(client: ControlClient): void {
    if (this.clients.delete(client)) {
      this.broadcastViewers();
    }
  }

  onSim(sim: SimState, changedBy?: string): void {
    this.broadcast({ type: 'sim', sim, ...(changedBy !== undefined ? { changedBy } : {}) });
  }

  startPing(): void {
    if (this.pingTimer !== null) {
      return;
    }
    this.pingTimer = setInterval(() => {
      let dropped = false;
      for (const client of this.clients) {
        const { socket } = client;
        // Без ответа на прошлый ping соединение полуоткрыто: зритель ушел, не попрощавшись.
        if (socket.readyState !== OPEN || (socket.ping !== undefined && !client.alive)) {
          this.clients.delete(client);
          socket.close();
          dropped = true;
          continue;
        }
        client.alive = false;
        socket.ping?.();
      }
      if (dropped) {
        this.broadcastViewers();
      }
    }, SERVER_RULES.pingIntervalMs);
    this.pingTimer.unref();
  }

  stop(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    for (const client of this.clients) {
      client.socket.close();
    }
    this.clients.clear();
  }

  private broadcastViewers(): void {
    this.broadcast({ type: 'viewers', count: this.clients.size });
  }

  private broadcast(message: WsControlMessage): void {
    if (this.clients.size === 0) {
      return;
    }
    const payload = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.socket.readyState === OPEN) {
        client.socket.send(payload);
      }
    }
  }

  private send(client: ControlClient, message: WsControlMessage): void {
    if (client.socket.readyState === OPEN) {
      client.socket.send(JSON.stringify(message));
    }
  }
}

/** Регистрация маршрута `/ws/sim`. */
export function registerControlWebsocket(app: FastifyInstance, control: ControlHub): void {
  app.get('/ws/sim', { websocket: true }, (connection) => {
    const socket = connection as unknown as WebSocketLike;
    const client = control.add(socket);
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
        // Мусор от клиента игнорируется, как и в потоке данных.
      }
    }) as (...args: never[]) => void);
    socket.on('close', (() => {
      control.remove(client);
    }) as (...args: never[]) => void);
    socket.on('error', (() => {
      control.remove(client);
    }) as (...args: never[]) => void);
  });
  control.startPing();
}
