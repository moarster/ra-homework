/**
 * Модель телеметрии уровня приема данных со шлюза.
 *
 * ВАЖНО: это контракт ПРИЕМА (как данные приходили бы с борта по MQTT от шлюза),
 * а не контракт выдачи в интерфейс. В самом дашборде этот формат не используется:
 * он слишком многословен - час данных по трем машинам это около 25 МБ JSON против 1 МБ
 * в колоночном виде. Формат выдачи описан в `api.ts` (компактный снапшот и серии),
 * обоснование - в разделе 5 `SPEC.md`.
 *
 * Файл перенесен из корня репозитория (`telemetry.ts`); комментарии сохранены.
 */

/**
 * Телеметрия карьерного самосвала.
 *
 *
 * Для обычных числовых параметров используется единый
 * TelemetryMeasurementDto.
 *
 * Битовые поля вынесены в отдельный TelemetryFlagsDto,
 * поскольку bitmask семантически отличается от числового измерения.
 *
 * Внутри системы для каждого параметра используется одна
 * каноническая единица измерения. Если Modbus отдаёт значение
 * в другой единице, преобразование выполняется на ingestion-слое.
 */

/**
 * Идентификатор физического параметра телеметрии.
 */
export enum TelemetryMetric {
  // Двигатель
  ENGINE_RPM = 'ENGINE_RPM',
  ENGINE_COOLANT_TEMPERATURE = 'ENGINE_COOLANT_TEMPERATURE',
  ENGINE_OIL_PRESSURE = 'ENGINE_OIL_PRESSURE',
  ENGINE_OIL_TEMPERATURE = 'ENGINE_OIL_TEMPERATURE',
  ENGINE_HOURS = 'ENGINE_HOURS',

  // Трансмиссия и ходовая
  TRANSMISSION_GEAR = 'TRANSMISSION_GEAR',
  TRANSMISSION_OIL_TEMPERATURE = 'TRANSMISSION_OIL_TEMPERATURE',
  TRANSMISSION_SYSTEM_PRESSURE = 'TRANSMISSION_SYSTEM_PRESSURE',
  BRAKE_TEMPERATURE_FRONT_LEFT = 'BRAKE_TEMPERATURE_FRONT_LEFT',
  BRAKE_TEMPERATURE_FRONT_RIGHT = 'BRAKE_TEMPERATURE_FRONT_RIGHT',
  BRAKE_TEMPERATURE_REAR_LEFT = 'BRAKE_TEMPERATURE_REAR_LEFT',
  BRAKE_TEMPERATURE_REAR_RIGHT = 'BRAKE_TEMPERATURE_REAR_RIGHT',

  // Топливо
  FUEL_LEVEL = 'FUEL_LEVEL',
  FUEL_INSTANT_CONSUMPTION = 'FUEL_INSTANT_CONSUMPTION',
  FUEL_TOTAL_CONSUMPTION = 'FUEL_TOTAL_CONSUMPTION',

  // Груз и оси
  CARGO_MASS = 'CARGO_MASS',
  FRONT_AXLE_LOAD = 'FRONT_AXLE_LOAD',
  REAR_AXLE_LOAD = 'REAR_AXLE_LOAD',
  BODY_ANGLE = 'BODY_ANGLE',

  // Позиционирование
  POSITION_LATITUDE = 'POSITION_LATITUDE',
  POSITION_LONGITUDE = 'POSITION_LONGITUDE',
  POSITION_SPEED = 'POSITION_SPEED',
  POSITION_HEADING = 'POSITION_HEADING',
}

/**
 * Канонические единицы измерения.
 *
 * Значение value в TelemetryMeasurementDto всегда выражено
 * в unit, указанной здесь.
 */
export enum TelemetryUnit {
  /** Обороты двигателя в минуту. */
  RPM = 'RPM',

  /** Температура в градусах Цельсия. */
  CELSIUS = 'CELSIUS',

  /** Давление в барах. */
  BAR = 'BAR',

  /** Наработка двигателя в часах. */
  HOUR = 'HOUR',

  /** Номер включённой передачи. */
  GEAR = 'GEAR',

  /** Относительный уровень топлива, 0..100 %. */
  PERCENT = 'PERCENT',

  /** Мгновенный расход топлива, литров в час. */
  LITERS_PER_HOUR = 'LITERS_PER_HOUR',

  /** Объём топлива, литры. */
  LITER = 'LITER',

  /** Масса в килограммах. */
  KILOGRAM = 'KILOGRAM',

  /** Угол в градусах. */
  DEGREE = 'DEGREE',

  /** Географическая широта в градусах. */
  DEGREE_LATITUDE = 'DEGREE_LATITUDE',

  /** Географическая долгота в градусах. */
  DEGREE_LONGITUDE = 'DEGREE_LONGITUDE',

  /** Скорость в километрах в час. */
  KILOMETERS_PER_HOUR = 'KILOMETERS_PER_HOUR',
}

/**
 * Качество полученного значения.
 *
 * Важно отличать, например, реальное значение 0 от ситуации,
 * когда значение вообще не удалось получить.
 */
export enum TelemetryQuality {
  /** Значение успешно получено и считается достоверным. */
  GOOD = 'GOOD',

  /** Устройство ответило, но само значение помечено как недостоверное. */
  INVALID = 'INVALID',

  /** Не удалось прочитать соответствующий Modbus-регистр. */
  COMMUNICATION_ERROR = 'COMMUNICATION_ERROR',

  /** Значение отсутствует. */
  NOT_AVAILABLE = 'NOT_AVAILABLE',

  /** Значение существует, но слишком старое для текущего момента. */
  STALE = 'STALE',
}

/**
 * Источник телеметрии.
 *
 * Большинство параметров приходят из бортового контроллера
 * через Modbus. Параметры позиционирования получаются
 * встроенным GNSS-приёмником шлюза.
 */
export enum TelemetrySource {
  MODBUS = 'MODBUS',
  GNSS = 'GNSS',
}

/**
 * Обычный числовой замер телеметрии.
 *
 * Один объект = одно значение одного физического параметра
 * в конкретный момент времени.
 *
 * Например:
 *
 * {
 *   vehicleId: "BELAZ-01",
 *   timestamp: "2026-09-12T18:13:42.123Z",
 *   metric: "ENGINE_COOLANT_TEMPERATURE",
 *   value: 87.4,
 *   unit: "CELSIUS",
 *   quality: "GOOD",
 *   source: "MODBUS"
 * }
 */
export interface TelemetryMeasurementDto {
  /** Идентификатор самосвала. */
  vehicleId: string;

  /** Момент времени, к которому относится измерение. */
  timestamp: string;

  /** Измеряемый физический параметр. */
  metric: TelemetryMetric;

  /** Значение в канонической единице измерения. */
  value: number;

  /** Единица измерения значения. */
  unit: TelemetryUnit;

  /** Качество измерения. */
  quality: TelemetryQuality;

  /** Источник значения. */
  source: TelemetrySource;

  /**
   * Адрес первого Modbus-регистра, из которого получено значение.
   *
   * Поле не является частью бизнес-семантики телеметрии.
   * Оно полезно для диагностики и может отсутствовать,
   * например для GNSS-данных.
   */
  registerAddress?: number;
}

/**
 * Тип битового набора.
 *
 * Каждый бит внутри flags имеет отдельное значение.
 */
export enum TelemetryFlagMetric {
  /** Аварийные состояния. */
  ALARMS = 'ALARMS',

  /** Предупреждения. */
  WARNINGS = 'WARNINGS',

  /** Состояния систем самосвала. */
  SYSTEM_STATE = 'SYSTEM_STATE',
}

/**
 * Битовое поле телеметрии.
 *
 * Например:
 *
 *   flags = 5
 *
 * В двоичном представлении:
 *
 *   00000101
 *
 * Это означает, что активны биты 0 и 2.
 */
export interface TelemetryFlagsDto {
  /** Идентификатор самосвала. */
  vehicleId: string;

  /** Момент времени, к которому относится состояние. */
  timestamp: string;

  /** Тип битового поля. */
  metric: TelemetryFlagMetric;

  /**
   * Значение битового поля.
   *
   * Используется number, поскольку JavaScript безопасно
   * работает с целыми числами только до 2^53 - 1.
   *
   * Если протокол предусматривает битовые поля шире 53 бит,
   * здесь следует использовать bigint или строковое представление.
   */
  flags: number;

  /** Качество полученного значения. */
  quality: TelemetryQuality;

  /** Источник значения. */
  source: TelemetrySource;

  /** Адрес Modbus-регистра. */
  registerAddress?: number;
}

/**
 * Полный снимок состояния самосвала.
 *
 * Snapshot объединяет значения, полученные в рамках одного
 * цикла опроса/одного временного среза.
 *
 * Это удобнее для передачи от gateway к серверу, чем отправлять
 * каждое из 40 значений отдельным HTTP-сообщением.
 */
export interface TelemetrySnapshotDto {
  /** Идентификатор самосвала. */
  vehicleId: string;

  /**
   * Временная метка снимка.
   *
   * Для измерений используется именно timestamp самого
   * измерения, а не время получения сообщения сервером.
   */
  timestamp: string;

  /** Числовые параметры телеметрии. */
  measurements: TelemetryMeasurementDto[];

  /** Битовые поля состояния и аварий. */
  flags: TelemetryFlagsDto[];
}
