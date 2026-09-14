/** Хаб websocket: hello, частота тиков, медленный клиент, события. */

import { MIN_VEHICLES, type WsServerMessage } from '@ra/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { SERVER_RULES } from '../server-config.js';
import { SimEngine } from '../sim/engine.js';
import { type WebSocketLike, WsHub } from '../ws/hub.js';

/** Поддельный сокет: собирает отправленные сообщения и умеет притворяться медленным. */
class FakeSocket implements WebSocketLike {
  readonly sent: WsServerMessage[] = [];
  readyState = 1;
  bufferedAmount = 0;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as WsServerMessage);
  }

  close(): void {
    this.readyState = 3;
  }

  on(): void {}

  messagesOfType(type: string): WsServerMessage[] {
    return this.sent.filter((message) => message.type === type);
  }
}

let engine: SimEngine | null = null;

afterEach(() => {
  engine?.stop();
  engine = null;
});

function createEngine(): SimEngine {
  const created = new SimEngine({ seed: 9, vehicleCount: MIN_VEHICLES, historySeconds: 300 });
  created.start();
  created.clock.stop();
  return created;
}

describe('websocket-хаб', () => {
  it('при подключении отдает hello с состоянием симуляции, порядком показателей и снапшотом', () => {
    engine = createEngine();
    const hub = new WsHub(engine);
    const socket = new FakeSocket();
    hub.add(socket);
    const hello = socket.sent[0];
    expect(hello?.type).toBe('hello');
    if (hello?.type !== 'hello') {
      throw new Error('ожидалось hello');
    }
    expect(hello.config.metricOrder.length).toBe(23);
    expect(hello.snapshot.length).toBe(MIN_VEHICLES);
    expect(hello.sim.vehicleCount).toBe(MIN_VEHICLES);
  });

  it('тик отправляется не чаще четырех раз в секунду реального времени', () => {
    engine = createEngine();
    const hub = new WsHub(engine);
    const socket = new FakeSocket();
    hub.add(socket);
    const startedAt = 1_000_000;
    expect(hub.publishTick(startedAt)).toBe(true);
    // Попытка через 100 мс: слишком рано.
    expect(hub.publishTick(startedAt + 100)).toBe(false);
    expect(hub.publishTick(startedAt + 1000 / SERVER_RULES.tickRateHz)).toBe(true);
    expect(socket.messagesOfType('tick').length).toBe(2);
  });

  it('в тике едут все точки позиции с прошлого тика', () => {
    engine = createEngine();
    const hub = new WsHub(engine);
    const socket = new FakeSocket();
    hub.add(socket);
    hub.publishTick(1_000_000);
    engine.clock.advance(10);
    hub.publishTick(1_001_000);
    const ticks = socket.messagesOfType('tick');
    const lastTick = ticks[ticks.length - 1];
    if (lastTick?.type !== 'tick') {
      throw new Error('ожидался tick');
    }
    const totalPositions = lastTick.vehicles.reduce((sum, item) => sum + item.pos.length, 0);
    expect(totalPositions).toBeGreaterThan(0);
    expect(totalPositions).toBeLessThanOrEqual(10 * MIN_VEHICLES);
    for (const item of lastTick.vehicles) {
      expect(item.pos.length).toBeLessThanOrEqual(SERVER_RULES.maxTickPositions);
    }
  });

  it('медленному клиенту тик пропускается, а события - нет', () => {
    engine = createEngine();
    const hub = new WsHub(engine);
    const socket = new FakeSocket();
    hub.add(socket);
    socket.bufferedAmount = SERVER_RULES.socketBufferLimitBytes * 2;
    hub.publishTick(2_000_000);
    expect(socket.messagesOfType('tick').length).toBe(0);
    hub.onEvents(
      [
        {
          id: 'e1',
          vehicleId: 'v-12',
          source: 'alarmBit',
          code: 'COOLANT_OVERHEAT',
          severity: 2,
          title: 'Перегрев',
          startedAt: 1,
          endedAt: null,
        },
      ],
      [],
    );
    expect(socket.messagesOfType('events').length).toBe(1);
  });

  it('закрытый сокет убирается из рассылки', () => {
    engine = createEngine();
    const hub = new WsHub(engine);
    const socket = new FakeSocket();
    hub.add(socket);
    socket.readyState = 3;
    hub.publishTick(3_000_000);
    expect(hub.clientCount).toBe(0);
  });
});
