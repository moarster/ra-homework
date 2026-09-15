/**
 * Замер предельной скорости времени (этап 6, обещано в INIT.md).
 *
 * Для каждого числа машин поднимается свежий сервер из `apps/server/dist` (как в образе),
 * к нему подключается один websocket-клиент - как браузер оператора, - и скорость времени
 * последовательно повышается. На каждой комбинации снимаются приращения `/api/health`
 * за окно замера и размеры сообщений websocket.
 *
 * Комбинация пройдена, если виртуальные часы отстали от заданной скорости не больше чем
 * на 2% и RSS процесса укладывается в бюджет памяти (раздел 11 `SPEC.md`). Если две скорости
 * подряд не прошли, более высокие для этого числа машин не замеряются: генерация от
 * повышения скорости не ускоряется.
 *
 * Запуск (после `pnpm build`):
 *   node scripts/benchmark.ts
 * Переменные: BENCH_SECONDS (60), BENCH_COUNTS ("3,10,30,60"), BENCH_SCALES
 * ("1,2,5,10,30,60,120,300"), BENCH_PORT (3099), BENCH_HISTORY_SECONDS (86400).
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_ENTRY = join(ROOT, 'apps/server/dist/index.js');
const REPORT = join(ROOT, 'BENCHMARK.md');

function listFromEnv(name: string, fallback: number[]): number[] {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? fallback : raw.split(',').map(Number);
}

const SECONDS = Number(process.env.BENCH_SECONDS ?? 60);
const COUNTS = listFromEnv('BENCH_COUNTS', [3, 10, 30, 60]);
const SCALES = listFromEnv('BENCH_SCALES', [1, 2, 5, 10, 30, 60, 120, 300]);
const PORT = Number(process.env.BENCH_PORT ?? 3099);
/** 24 часа истории: именно для этой глубины задан бюджет памяти. */
const HISTORY_SECONDS = Number(process.env.BENCH_HISTORY_SECONDS ?? 86_400);

/** Допустимое отставание часов от заданной скорости. */
const MAX_LAG_RATIO = 0.02;
/** Минимальный допуск отставания в шагах: погрешность целочисленного виртуального времени. */
const QUANTUM_STEPS = 2;
/** Бюджет памяти сервера при 60 машинах и 24 ч истории (раздел 11 `SPEC.md`). */
const MEMORY_BUDGET_BYTES = 400 * 1024 * 1024;
/** Прогрев после смены скорости: переходный процесс не должен попадать в окно замера. */
const WARMUP_MS = 3000;

const BASE = `http://127.0.0.1:${PORT}`;

interface Health {
  simTime: number;
  clock: { lagSeconds: number; stepMsTotal: number; timedSteps: number };
  cpu: { userMicros: number; systemMicros: number };
  memory: { rssBytes: number };
}

interface Row {
  vehicles: number;
  scale: number;
  measured: boolean;
  speedRatio: number;
  lagSeconds: number;
  cpuPercent: number;
  rssMb: number;
  stepMs: number;
  wsAvgKb: number;
  wsMaxKb: number;
  tickHz: number;
  passed: boolean;
  note: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`);
  if (!response.ok) {
    throw new Error(`${path}: ${response.status}`);
  }
  return (await response.json()) as T;
}

async function postSim(body: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${BASE}/api/sim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`POST /api/sim: ${response.status} ${await response.text()}`);
  }
}

async function startServer(vehicles: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      LOG_LEVEL: 'warn',
      PORT: String(PORT),
      SIM_VEHICLES: String(vehicles),
      SIM_HISTORY_SECONDS: String(HISTORY_SECONDS),
      SIM_BENCHMARK: '1',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  // Сервер генерирует предысторию после старта: ждем, пока ответит и часы пойдут.
  const deadline = Date.now() + 180_000;
  let previous = -1;
  while (Date.now() < deadline) {
    await sleep(1000);
    try {
      const health = await getJson<Health>('/api/health');
      const sim = await getJson<{ running: boolean }>('/api/sim');
      if (sim.running && previous > 0 && health.simTime > previous) {
        return child;
      }
      previous = health.simTime;
    } catch {
      // Еще не поднялся.
    }
  }
  child.kill('SIGKILL');
  throw new Error('сервер не поднялся за 3 минуты');
}

/** Websocket-клиент, считающий размеры тиков. */
function connect(): Promise<{ socket: WebSocket; stats: { sizes: number[] } }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const stats = { sizes: [] as number[] };
    socket.addEventListener('message', (event) => {
      const data = event.data as string;
      if (data.startsWith('{"type":"tick"')) {
        stats.sizes.push(Buffer.byteLength(data));
      }
    });
    socket.addEventListener('open', () => resolve({ socket, stats }));
    socket.addEventListener('error', () => reject(new Error('websocket не подключился')));
  });
}

async function measure(vehicles: number, scale: number, stats: { sizes: number[] }): Promise<Row> {
  await postSim({ timeScale: scale });
  await sleep(WARMUP_MS);
  const h0 = await getJson<Health>('/api/health');
  const t0 = performance.now();
  stats.sizes.length = 0;
  await sleep(SECONDS * 1000);
  const h1 = await getJson<Health>('/api/health');
  const elapsedSec = (performance.now() - t0) / 1000;

  const sizes = stats.sizes.slice();
  const virtual = h1.simTime - h0.simTime;
  const expected = elapsedSec * scale;
  const speedRatio = virtual / expected;
  const cpuMicros =
    h1.cpu.userMicros + h1.cpu.systemMicros - (h0.cpu.userMicros + h0.cpu.systemMicros);
  const steps = h1.clock.timedSteps - h0.clock.timedSteps;
  const rss = h1.memory.rssBytes;
  /*
   * Виртуальное время целочисленное, а долг часов дробный: на x1 окно в 60 с дает 59 или 61
   * шаг в зависимости от того, в какой момент пачки снят `/api/health`. Поэтому допуск не
   * меньше двух шагов, иначе малые скорости "не проходили" бы из-за округления, а не нагрузки.
   */
  const lagOk = expected - virtual <= Math.max(expected * MAX_LAG_RATIO, QUANTUM_STEPS);
  const memoryOk = rss <= MEMORY_BUDGET_BYTES;
  return {
    vehicles,
    scale,
    measured: true,
    speedRatio,
    lagSeconds: h1.clock.lagSeconds,
    cpuPercent: (cpuMicros / 1e6 / elapsedSec) * 100,
    rssMb: rss / 1024 / 1024,
    stepMs: steps > 0 ? (h1.clock.stepMsTotal - h0.clock.stepMsTotal) / steps : 0,
    wsAvgKb: sizes.length > 0 ? sizes.reduce((a, b) => a + b, 0) / sizes.length / 1024 : 0,
    wsMaxKb: sizes.length > 0 ? Math.max(...sizes) / 1024 : 0,
    tickHz: sizes.length / elapsedSec,
    passed: lagOk && memoryOk,
    note: [lagOk ? '' : 'часы отстают', memoryOk ? '' : 'память сверх бюджета']
      .filter(Boolean)
      .join(', '),
  };
}

function skipped(vehicles: number, scale: number): Row {
  return {
    vehicles,
    scale,
    measured: false,
    speedRatio: 0,
    lagSeconds: 0,
    cpuPercent: 0,
    rssMb: 0,
    stepMs: 0,
    wsAvgKb: 0,
    wsMaxKb: 0,
    tickHz: 0,
    passed: false,
    note: 'не замерялось: две предыдущие скорости не прошли',
  };
}

const fmt = (value: number, digits: number) =>
  value.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });

function tableRows(rows: Row[]): string[] {
  return rows.map((r) =>
    r.measured
      ? `| ${r.vehicles} | x${r.scale} | ${fmt(r.speedRatio * 100, 1)}% | ${fmt(r.lagSeconds, 1)} | ${fmt(r.cpuPercent, 0)}% | ${fmt(r.rssMb, 0)} | ${fmt(r.stepMs, 3)} | ${fmt(r.wsAvgKb, 1)} / ${fmt(r.wsMaxKb, 1)} | ${fmt(r.tickHz, 2)} | ${r.passed ? 'да' : 'нет'} | ${r.note} |`
      : `| ${r.vehicles} | x${r.scale} | - | - | - | - | - | - | - | нет | ${r.note} |`,
  );
}

const HEADER = [
  '| Машин | Скорость | Факт. скорость часов | Долг часов, с | CPU (1 ядро = 100%) | RSS, МБ | Шаг генерации, мс | WS тик ср. / макс., КБ | Тиков в с | Пройдено | Примечание |',
  '|---|---|---|---|---|---|---|---|---|---|---|',
];

/** Раздел клиентских замеров снимается руками и при перезапуске скрипта сохраняется. */
function clientSection(): string {
  try {
    const text = readFileSync(REPORT, 'utf8');
    const match = text.match(/<!-- client:start -->[\s\S]*<!-- client:end -->/);
    if (match !== null) {
      return match[0];
    }
  } catch {
    // Отчета еще нет.
  }
  return '<!-- client:start -->\n## Клиент\n\nНе замерялся.\n<!-- client:end -->';
}

function writeReport(rows: Row[]): void {
  const limit = new Map<number, number>();
  for (const row of rows) {
    if (row.passed) {
      limit.set(row.vehicles, Math.max(limit.get(row.vehicles) ?? 0, row.scale));
    }
  }
  const summary = COUNTS.map((count) => `- ${count} машин: x${limit.get(count) ?? '-'}`).join('\n');
  const text = [
    '# Замер производительности',
    '',
    'Файл сгенерирован `scripts/benchmark.ts` (раздел серверного замера) и дополнен руками',
    '(раздел клиента).',
    '',
    `Машина: ${cpus()[0]?.model ?? 'неизвестный процессор'}, ${cpus().length} потоков, ${Math.round(totalmem() / 1024 ** 3)} ГБ ОЗУ; Node ${process.version}.`,
    `Окно замера ${SECONDS} с после прогрева ${WARMUP_MS / 1000} с, предыстория ${HISTORY_SECONDS / 3600} ч, один websocket-клиент, мера хаоса NORMAL.`,
    '',
    '## Как читать',
    '',
    '- **Факт. скорость часов** - прирост виртуального времени за окно, деленный на заданную скорость и реальное время. Пройдено, если недобор виртуального времени не больше 2% от ожидаемого или не больше двух виртуальных секунд - что больше (второй допуск нужен малым скоростям: виртуальное время целочисленное, и на x1 окно в 60 с дает 59-61 шаг).',
    '- **Долг часов** - невыполненные виртуальные секунды в конце окна (`clock.lagSeconds`).',
    '- **CPU** - процессорное время процесса сервера за окно; 100% - одно ядро целиком (Node генерирует в одном потоке).',
    '- **Шаг генерации** - реальное время одной виртуальной секунды для всего парка (все машины, хранилище, детектор событий).',
    `- **RSS** - память процесса в конце окна; бюджет ${MEMORY_BUDGET_BYTES / 1024 / 1024} МБ.`,
    '',
    '## Сервер',
    '',
    ...HEADER,
    ...tableRows(rows),
    '',
    '### Предельная пройденная скорость',
    '',
    summary,
    '',
    clientSection(),
    '',
  ].join('\n');
  writeFileSync(REPORT, text);
}

async function main(): Promise<void> {
  const rows: Row[] = [];
  for (const vehicles of COUNTS) {
    console.log(`\n== ${vehicles} машин: запуск сервера`);
    const server = await startServer(vehicles);
    const { socket, stats } = await connect();
    let failuresInRow = 0;
    try {
      for (const scale of SCALES) {
        if (failuresInRow >= 2) {
          rows.push(skipped(vehicles, scale));
          continue;
        }
        const row = await measure(vehicles, scale, stats);
        rows.push(row);
        failuresInRow = row.passed ? 0 : failuresInRow + 1;
        console.log(tableRows([row])[0]);
        writeReport(rows);
      }
    } finally {
      socket.close();
      server.kill('SIGTERM');
      await sleep(1500);
    }
  }
  console.log(`\n${[...HEADER, ...tableRows(rows)].join('\n')}`);
  writeReport(rows);
  console.log(`\nОтчет записан в ${REPORT}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
