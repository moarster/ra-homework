/**
 * Проверка websocket-потока: печатает hello, частоту тиков, число точек позиции на машину
 * и размер сообщений. Запуск: node scripts/ws-probe.mjs [адрес] [секунд]
 */

const url = process.argv[2] ?? 'ws://localhost:3001/ws';
const seconds = Number(process.argv[3] ?? 10);

const socket = new WebSocket(url);
let ticks = 0;
let bytes = 0;
let positions = 0;
let maxPositionsPerVehicle = 0;
let events = 0;
let startedAt = 0;

socket.addEventListener('open', () => {
  console.log('соединение открыто', url);
  socket.send(JSON.stringify({ type: 'ping' }));
});

socket.addEventListener('message', (event) => {
  const raw = String(event.data);
  bytes += raw.length;
  const message = JSON.parse(raw);
  if (message.type === 'hello') {
    startedAt = Date.now();
    console.log(
      'hello: машин',
      message.snapshot.length,
      'показателей',
      message.config.metricOrder.length,
      `скорость времени x${message.sim.timeScale}`,
    );
    return;
  }
  if (message.type === 'tick') {
    ticks += 1;
    for (const vehicle of message.vehicles) {
      positions += vehicle.pos.length;
      if (vehicle.pos.length > maxPositionsPerVehicle) {
        maxPositionsPerVehicle = vehicle.pos.length;
      }
    }
    return;
  }
  if (message.type === 'events') {
    events += message.opened.length + message.closed.length;
    return;
  }
  console.log('сообщение', message.type, message.vehicleId ?? '');
});

socket.addEventListener('error', (error) => {
  console.error('ошибка websocket', error.message ?? error);
});

setTimeout(() => {
  const elapsed = (Date.now() - startedAt) / 1000;
  console.log('тиков', ticks, '=', (ticks / elapsed).toFixed(2), 'в секунду');
  console.log(
    'точек позиции всего',
    positions,
    'максимум на машину в тике',
    maxPositionsPerVehicle,
  );
  console.log('событий', events);
  console.log(
    'трафик',
    (bytes / 1024).toFixed(0),
    'КБ =',
    (bytes / 1024 / elapsed).toFixed(0),
    'КБ/с',
  );
  socket.close();
  process.exit(0);
}, seconds * 1000);
