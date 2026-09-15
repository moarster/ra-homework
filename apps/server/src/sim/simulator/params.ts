/**
 * Числовые параметры симулятора: цели режимов, инерция, шум, цикл рейса, сценарии.
 *
 * Здесь нет ни одного порога светофора: нормативы берутся из `@ra/contracts`. Числа
 * целевых значений - отправная точка из `5_PROMPT_SIMULATOR.md` (раздел 4); там, где
 * исходное число давало неестественную картинку, оно поправлено и причина записана рядом.
 */

import {
  type PhysicalMetricId,
  PIT_AMBIENT_TEMPERATURE_C,
  ROUTE_CORRIDOR_HALF_WIDTH_METERS,
  ZONE_CORRIDOR_HALF_WIDTH_METERS,
} from '@ra/contracts';

/** Режим работы - состояние конечного автомата рейса. Числа - индексы в таблицах целей. */
export const MODE = {
  PARKED: 0,
  IDLING: 1,
  LOADING: 2,
  HAULING: 3,
  UNLOADING: 4,
  RETURNING: 5,
} as const;

export type Mode = (typeof MODE)[keyof typeof MODE];

export const MODE_COUNT = 6;

export const AMBIENT_C = PIT_AMBIENT_TEMPERATURE_C;

/** Каналы модели "цель режима плюс инерция": индексы в типизированных массивах машины. */
export const CH = {
  RPM: 0,
  COOLANT: 1,
  OIL_TEMP: 2,
  OIL_PRESSURE: 3,
  TRANS_TEMP: 4,
  TRANS_PRESSURE: 5,
  BRAKE_FL: 6,
  BRAKE_FR: 7,
  BRAKE_RL: 8,
  BRAKE_RR: 9,
  FUEL_RATE: 10,
} as const;

export const CHANNEL_COUNT = 11;

export const CHANNEL_METRICS: PhysicalMetricId[] = [
  'ENGINE_RPM',
  'ENGINE_COOLANT_TEMPERATURE',
  'ENGINE_OIL_TEMPERATURE',
  'ENGINE_OIL_PRESSURE',
  'TRANSMISSION_OIL_TEMPERATURE',
  'TRANSMISSION_SYSTEM_PRESSURE',
  'BRAKE_TEMPERATURE_FRONT_LEFT',
  'BRAKE_TEMPERATURE_FRONT_RIGHT',
  'BRAKE_TEMPERATURE_REAR_LEFT',
  'BRAKE_TEMPERATURE_REAR_RIGHT',
  'FUEL_INSTANT_CONSUMPTION',
];

/** Признак "остывает к воздуху": вместо числа в таблице целей. */
const COOL = Number.NaN;

/**
 * Цели по режимам: [PARKED, IDLING, LOADING, HAULING, UNLOADING, RETURNING].
 * NaN - показатель остывает к температуре воздуха.
 *
 * Правки исходной таблицы:
 * - ОЖ на груженом ходу 96 -> 90, масло двигателя 110 -> 101, ГМП 105 -> 98: исходные числа
 *   лежат на границе или внутри желтой зоны норматива, и при хаосе "норма" каждая машина на
 *   каждом груженом ходу желтела бы. Термостат держит ОЖ ровно - разница между режимами у
 *   нее небольшая;
 * - обороты при разгрузке 1000 -> 1100: ровно на 1000 об/мин переключается контекст норматива
 *   давления масла, и шум оборотов дергал бы его туда-обратно;
 * - тормоза на порожнем ходу 190 -> 170: при 190 машина на хаосе "норма" работает вплотную
 *   к желтой зоне 200.
 */
export const MODE_TARGETS: number[][] = [
  /* RPM */ [0, 720, 950, 1750, 1100, 1250],
  /* COOLANT */ [COOL, 84, 85, 90, 88, 87],
  /* OIL_TEMP */ [COOL, 92, 94, 101, 99, 98],
  /* OIL_PRESSURE - по кривой от оборотов */ [0, 0, 0, 0, 0, 0],
  /* TRANS_TEMP */ [COOL, 76, 78, 98, 88, 86],
  /* TRANS_PRESSURE - по кривой от оборотов */ [0, 0, 0, 0, 0, 0],
  /* BRAKE_FL */ [COOL, COOL, COOL, 120, COOL, 170],
  /* BRAKE_FR */ [COOL, COOL, COOL, 120, COOL, 170],
  /* BRAKE_RL */ [COOL, COOL, COOL, 120, COOL, 170],
  /* BRAKE_RR */ [COOL, COOL, COOL, 120, COOL, 170],
  /* FUEL_RATE, л/ч для 1715 кВт */ [0, 18, 30, 235, 35, 60],
];

/** Номинальная мощность, к которой привязан расход в таблице целей, кВт. */
export const FUEL_REFERENCE_POWER_KW = 1715;

/**
 * Давление масла двигателя как функция оборотов: точки взяты из столбцов режимов исходной
 * таблицы. Давление держит насос, поэтому оно следует за оборотами почти без запаздывания;
 * иначе на каждом трогании обороты уходили за 1000 (рабочие зоны норматива) раньше, чем
 * давление успевало подняться, и точка на секунды желтела.
 */
export const OIL_PRESSURE_CURVE: number[] = [
  0, 0, 150, 1.4, 720, 2.6, 950, 3.1, 1100, 3.6, 1250, 4.2, 1750, 4.9, 2300, 5.3,
];

/**
 * Давление в системе трансмиссии от оборотов. При заглушенном двигателе давление держит
 * гидроаккумулятор: у норматива нет контекста "двигатель заглушен", и честный ноль делал бы
 * красной каждую машину на стоянке. Холостой ход поднят с 12,2 до 13,2 бар: 12,2 лежит у самой
 * границы желтой зоны 12.
 */
export const TRANS_PRESSURE_CURVE: number[] = [
  0, 12.4, 720, 13.2, 950, 13.5, 1100, 13.8, 1250, 15, 1750, 16.2, 2300, 16.8,
];

/** Инерция каналов при работающем двигателе, секунды. */
export const CHANNEL_TAU: number[] = [8, 200, 320, 1, 260, 2, 120, 120, 120, 120, 20];

/**
 * Инерция остывания при заглушенном двигателе, секунды. Двигатель в 60 литров не остывает
 * за три минуты: с исходной инерцией 200 с за обед ОЖ падала бы до температуры воздуха.
 */
export const CHANNEL_COOLING_TAU: number[] = [8, 1500, 1800, 1, 1600, 2, 420, 420, 420, 420, 20];

/** Амплитуда медленного дрейфа, доля значения (при множителе хаоса 1). */
export const DRIFT_AMPLITUDE: number[] = [
  0.01, 0.015, 0.015, 0.02, 0.015, 0.015, 0.02, 0.02, 0.02, 0.02, 0.03,
];

/** Амплитуда быстрого шума, доля значения (при множителе хаоса 1). */
export const NOISE_AMPLITUDE: number[] = [
  0.008, 0.002, 0.002, 0.012, 0.003, 0.008, 0.004, 0.004, 0.004, 0.004, 0.02,
];

export const SIM_PARAMS = {
  /** Постоянная времени медленного дрейфа, с. */
  driftTauSeconds: 600,
  /** Постоянная времени быстрого шума, с: шум сглажен, одиночный кадр не выбрасывает. */
  noiseTauSeconds: 3,
  /** Переход индивидуальных смещений и целей к новому уровню хаоса: 3 tau = 2-5 минут. */
  chaosBlendTauSeconds: [40, 100] as [number, number],
  /** Трогание: обороты выходят на холостой ход за это время, с. */
  engineStartSeconds: 3,

  /* --- движение ------------------------------------------------------------------------- */
  routeHalfWidthM: ROUTE_CORRIDOR_HALF_WIDTH_METERS,
  zoneHalfWidthM: ZONE_CORRIDOR_HALF_WIDTH_METERS,
  /** На этом расстоянии от концов маршрута действует ширина коридора зоны, м. */
  zoneExtentM: 40,
  /** Дальше этого расстояния от концов - ширина коридора дороги; между ними плавно, м. */
  zoneBlendM: 100,
  /** Постоянная времени бокового блуждания в коридоре, с. */
  corridorTauSeconds: [20, 40] as [number, number],
  /** Сглаживание бокового смещения на ходу, с: трек виляет мягко. */
  lateralSmoothSeconds: 6,
  /** Постоянная времени шума приемника ГНСС, с. */
  gnssTauSeconds: 5,
  /** Точка остановки в зоне: радиус от конца маршрута, м. */
  stopRadiusM: [20, 30] as [number, number],
  /** Разгон, км/ч за секунду (0,4 м/с2). */
  accelKmhPerSecond: 1.44,
  /** Торможение, км/ч за секунду. */
  decelKmhPerSecond: 1.8,
  /** Замедление, по которому считается скорость подъезда к точке остановки, м/с2. */
  stopDecelMps2: 0.35,
  /** Курс считается по перемещению за это число секунд. */
  headingWindowSeconds: 3,
  /** Меньшее перемещение за окно курса не меняет курс, м. */
  headingMinDisplacementM: 1.5,
  /** Скорость груженой, км/ч. */
  haulSpeedKmh: [16, 22] as [number, number],
  /** Скорость порожней, км/ч. Исходные 26-32 уходили за границу желтой зоны 30. */
  returnSpeedKmh: [24, 28] as [number, number],
  /** Уклон, на котором груженая машина идет на ретардере, проценты. */
  retarderGradePercent: -2,

  /* --- цикл рейса ----------------------------------------------------------------------- */
  loadingSeconds: [150, 240] as [number, number],
  loadingSteps: [4, 6] as [number, number],
  unloadingSeconds: [60, 90] as [number, number],
  bodyRiseSeconds: 25,
  bodyLowerSeconds: 20,
  bodyPeakDeg: [45, 50] as [number, number],
  /** Скорость опускания платформы на ходу, градусы в секунду. */
  bodyLowerRateDeg: 2.5,
  /**
   * Короче этого рейс не бывает: машина ждет в очереди у экскаватора. Короткий маршрут
   * верхнего горизонта иначе давал бы сорок рейсов за смену. 24, а не 20 минут: за 12 часов
   * набегает до трех перерывов, и при 20 минутах выходило больше 30 рейсов.
   */
  minTripSeconds: 24 * 60,
  /** Короче этого холостой ход не вставляется, с. */
  minIdleSeconds: 20,
  /** Верхняя граница одной вставки холостого хода, с. */
  maxIdleSeconds: 25 * 60,
  /** Масса груза: доля номинала в центре разброса. 1,02, чтобы разброс 6% не задевал 95%. */
  payloadCenter: 1.02,
  /** Доля передней оси: порожняя от снаряженной массы, груженая от полной. */
  frontShareEmpty: 0.47,
  frontShareLoaded: 0.33,
  /** Разброс доли передней оси между рейсами при разбросе массы 6%. */
  frontShareJitter: 0.01,
  /** Шум весов, доля массы (при множителе хаоса 1). */
  weighNoise: 0.003,

  /* --- смены, заправка ------------------------------------------------------------------ */
  /** Начала пересменок, часы по времени объекта. */
  shiftChangeHours: [8, 20],
  shiftChangeSeconds: [20 * 60, 40 * 60] as [number, number],
  /** Обеды - середина смены. */
  lunchHours: [2, 14],
  lunchSeconds: [30 * 60, 40 * 60] as [number, number],
  /** Машина встает на перерыв, если приехала на остановку не раньше чем за это время, с. */
  breakLeadSeconds: 5 * 60,
  refuelBelowPercent: 15,
  refuelToPercent: [95, 100] as [number, number],
  refuelSeconds: 600,
  initialFuelPercent: [40, 95] as [number, number],
  /** Начальный суммарный расход: литров на моточас при мощности 1715 кВт. */
  lifetimeLitersPerHour: 110,

  /* --- качество кадров ------------------------------------------------------------------ */
  slowPeriodSeconds: 5,
  invalidBurstSeconds: [1, 3] as [number, number],

  /* --- биты ----------------------------------------------------------------------------- */
  /** Бит взводится, когда показатель вне зеленой зоны столько секунд подряд. */
  flagRaiseSeconds: 5,
  /** Бит снимается после стольких секунд подряд в зеленой зоне. */
  flagClearSeconds: 15,
} as const;

/** Параметры сценариев отклонений. */
export const SCENARIO_PARAMS = {
  /** Отложенный сценарий, не дождавшийся своего режима, отменяется, с. */
  pendingTimeoutSeconds: 3600,
  /**
   * S1. Добавка к цели ГМП, C. Исходные +25 не доводили ГМП до красной зоны на коротком
   * маршруте, поэтому добавка больше, а инерция на время сценария короче.
   */
  transHeatC: 32,
  transHeatTauSeconds: 150,
  transHeatTailSeconds: 300,
  /** S2. Цель всех тормозов на обратном ходу, C. */
  brakeOverheatC: [340, 400] as [number, number],
  /** S3. Добавка одному колесу, C, длительность, доля нарастания. */
  stuckBrakeC: 150,
  stuckBrakeSeconds: [2 * 3600, 6 * 3600] as [number, number],
  stuckBrakeRampShare: 0.3,
  /** На стоянке подклинивший тормоз греется слабее, чем на ходу. */
  stuckBrakeStandingShare: 0.4,
  /** S4. Масса груза, доля номинала. */
  overloadRatio: [1.22, 1.35] as [number, number],
  /**
   * S5. Падение давления масла: множитель к нормальному давлению. 0,25-0,37 дает 1,2-1,8 бар
   * на груженом ходу и красную зону на холостом.
   */
  oilPressureFactor: [0.25, 0.37] as [number, number],
  oilSharpSeconds: 30,
  oilSharpTauSeconds: 5,
  oilCrawlSeconds: [3 * 3600, 6 * 3600] as [number, number],
  oilSharpShare: 0.5,
  /** S10. Слив топлива на стоянке, проценты и длительность. */
  theftPercent: [6, 15] as [number, number],
  theftSeconds: [600, 1200] as [number, number],
  /** S9. Превышение скорости. */
  overspeedFactor: 1.5,
  overspeedSeconds: [20, 120] as [number, number],
  /** Превышение начинается только там, где до остановки далеко, м. */
  overspeedMinRemainingM: 500,
  /** S8. Движение с поднятой платформой. */
  bodyUpDeg: [16, 25] as [number, number],
  bodyUpSeconds: [10, 60] as [number, number],
  /** S7. Кривая загрузка: доля передней оси. */
  skewFrontShare: [0.42, 0.48] as [number, number],
} as const;
