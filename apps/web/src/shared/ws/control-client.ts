/**
 * Клиент канала управления `/ws/sim`: состояние симуляции и число зрителей стенда.
 *
 * В отличие от потока данных не зависит от тумблера real-time: симуляция одна на всех,
 * и изменение ее параметров другим зрителем должно дойти, даже если поток данных выключен.
 * Подключается один раз на приложение и переподключается сам.
 */

import { type SimState, wsControlMessageSchema } from '@ra/contracts';
import { websocketUrl } from '../api/base-url.js';
import { PING_INTERVAL_MS, RECONNECT_DELAYS_MS } from './ws-client.js';

export interface ControlHandlers {
  /** `changedBy` - вкладка-автор изменения; нет - изменение сделал сервер. */
  onSim: (sim: SimState, changedBy: string | undefined) => void;
  onViewers: (count: number) => void;
  /** Канал потерян: число зрителей больше не достоверно. */
  onDisconnected: () => void;
}

export class ControlClient {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private attempt = 0;
  private wanted = false;

  constructor(private readonly handlers: ControlHandlers) {}

  connect(): void {
    this.wanted = true;
    if (this.socket === null && this.reconnectTimer === null) {
      this.open();
    }
  }

  disconnect(): void {
    this.wanted = false;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket !== null) {
      socket.onclose = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onopen = null;
      socket.close();
    }
  }

  private open(): void {
    const socket = new WebSocket(websocketUrl('ws/sim'));
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.pingTimer = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping' }));
        }
      }, PING_INTERVAL_MS);
    };

    socket.onmessage = (event: MessageEvent<string>) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      const message = wsControlMessageSchema.safeParse(parsed);
      if (!message.success) {
        return;
      }
      if (message.data.type === 'sim') {
        this.handlers.onSim(message.data.sim, message.data.changedBy);
      } else if (message.data.type === 'viewers') {
        this.handlers.onViewers(message.data.count);
      }
    };

    socket.onerror = () => {
      socket.close();
    };

    socket.onclose = () => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      this.clearTimers();
      this.handlers.onDisconnected();
      if (!this.wanted) {
        return;
      }
      const delay = RECONNECT_DELAYS_MS[
        Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)
      ] as number;
      this.attempt += 1;
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = null;
        if (this.wanted) {
          this.open();
        }
      }, delay);
    };
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
