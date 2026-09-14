/**
 * Граница между сервером и источником телеметрии (раздел 9 `SPEC.md`).
 *
 * Сервер не знает, как устроена физика машины: он только просит источник сгенерировать
 * очередную виртуальную секунду и складывает полученные значения в хранилище. Заглушка
 * этапа 1 и полноценный симулятор этапа 5 взаимозаменяемы: подмена сводится к замене
 * одной строки в `createSource`.
 *
 * Источник пишет только физические показатели в порядке `METRIC_ORDER`. Производные
 * считает сервер, статус и светофор - тоже: это его зона ответственности, а не физики.
 */

import type { ChaosLevel, PitZoneKind, Quality, Vehicle } from '@ra/contracts';

export interface SourceInitOptions {
  vehicles: Vehicle[];
  seed: number;
  /** Виртуальное время, с которого начинается "настоящее время" симуляции. */
  startTime: number;
  /** Сколько секунд предыстории сгенерировать назад от `startTime`. */
  historySeconds: number;
}

/**
 * Приемник кадров. Реализуется сервером, вызывается источником внутри `step`.
 * Индексы показателей - индексы в `METRIC_ORDER`.
 */
export interface SnapshotWriter {
  /** Начать кадр машины. */
  beginFrame(vehicleIndex: number, simTimeSec: number): void;
  setValue(metricIndex: number, value: number, quality: Quality): void;
  /** Значения нет: датчик не ответил. */
  setMissing(metricIndex: number, quality: Quality): void;
  setFlags(alarms: number, warnings: number, state: number): void;
  /** Зона карьера, в которой стоит машина, или null. */
  setZone(zone: PitZoneKind | null): void;
  commitFrame(): void;
  /** Кадра нет вовсе: провал связи. Дыра в данных. */
  skipFrame(vehicleIndex: number, simTimeSec: number): void;
}

/**
 * Накопленный за провал связи буфер в колоночном виде.
 *
 * Кадры идут подряд по секундам от `from` до `to` включительно; значение показателя `m`
 * кадра `i` лежит в `values[i * metricCount + m]`. Объект на кадр не создается сознательно:
 * дозаливка сорока минут по 60 машинам - это 144 000 кадров.
 */
export interface BackfillBatch {
  vehicleId: string;
  vehicleIndex: number;
  from: number;
  to: number;
  /** Число кадров в буфере. */
  count: number;
  /** Число показателей в кадре (длина `METRIC_ORDER`). */
  metricCount: number;
  values: Float32Array;
  quality: Uint8Array;
  alarms: Uint16Array;
  warnings: Uint16Array;
  state: Uint16Array;
  /** Индекс вида зоны в `PIT_ZONE_KINDS` плюс единица; 0 - машина вне зон. */
  zone: Int8Array;
}

export interface TelemetrySource {
  /** Инициализация: справочник машин, seed, начало виртуального времени, глубина предыстории. */
  init(options: SourceInitOptions): void;

  setVehicleCount(count: number): void;
  setChaos(level: ChaosLevel): void;

  /**
   * Сгенерировать предысторию перечисленных машин за период `[fromTime, toTime)`.
   *
   * Вызывается сервером при старте (все машины) и при увеличении парка (только новые):
   * машина обязана прийти с историей, а не с пустотой. Кадры пишутся тем же writer в
   * хронологическом порядке, поэтому сервер не отличает их от обычных шагов.
   */
  generateHistory(
    vehicleIndexes: number[],
    fromTime: number,
    toTime: number,
    writer: SnapshotWriter,
  ): void;

  /**
   * Сгенерировать одну виртуальную секунду.
   * Пишет значения напрямую в буферы writer, не создавая объектов на значение.
   */
  step(simTimeSec: number, writer: SnapshotWriter): void;

  /** Данные, задержанные провалом связи и готовые к дозаливке. Вызывается после каждого `step`. */
  drainBackfill(): BackfillBatch[];
}
