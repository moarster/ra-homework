/** Канал управления: состояние симуляции при подключении, чужие изменения, число зрителей. */

import { MIN_VEHICLES, type WsControlMessage } from '@ra/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { SimEngine } from '../sim/engine.js';
import { ControlHub } from '../ws/control.js';
import type { WebSocketLike } from '../ws/hub.js';

class FakeSocket implements WebSocketLike {
  readonly sent: WsControlMessage[] = [];
  readyState = 1;
  bufferedAmount = 0;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as WsControlMessage);
  }

  close(): void {
    this.readyState = 3;
  }

  on(): void {}

  last<T extends WsControlMessage['type']>(type: T): Extract<WsControlMessage, { type: T }> {
    const found = this.sent.filter((message) => message.type === type).at(-1);
    if (found === undefined) {
      throw new Error(`нет сообщения ${type}`);
    }
    return found as Extract<WsControlMessage, { type: T }>;
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

describe('канал управления', () => {
  it('при подключении отдает состояние симуляции и число зрителей', () => {
    engine = createEngine();
    const control = new ControlHub(engine);
    const socket = new FakeSocket();
    control.add(socket);
    expect(socket.last('sim').sim.vehicleCount).toBe(MIN_VEHICLES);
    expect(socket.last('viewers').count).toBe(1);
  });

  it('изменение параметров уходит всем зрителям вместе с автором', () => {
    engine = createEngine();
    const control = new ControlHub(engine);
    engine.listener = {
      onBatch: () => {},
      onEvents: () => {},
      onBackfill: () => {},
      onSim: (sim, changedBy) => control.onSim(sim, changedBy),
    };
    const first = new FakeSocket();
    const second = new FakeSocket();
    control.add(first);
    control.add(second);
    expect(first.last('viewers').count).toBe(2);

    engine.patch({ chaos: 'UGLY' }, 'tab-a');
    expect(second.last('sim').sim.chaos).toBe('UGLY');
    expect(second.last('sim').changedBy).toBe('tab-a');
  });

  it('уход зрителя уменьшает счетчик у остальных', () => {
    engine = createEngine();
    const control = new ControlHub(engine);
    const first = new FakeSocket();
    const second = new FakeSocket();
    const client = control.add(first);
    control.add(second);
    control.remove(client);
    expect(second.last('viewers').count).toBe(1);
    expect(control.viewerCount).toBe(1);
  });
});
