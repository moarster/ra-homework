/**
 * и симулятора телеметрии: справочники, нормативы, чистые функции и zod-схемы API.
 *
 * Пакет не зависит ни от Node API, ни от DOM и работает в обеих средах.
 */

export * from './api.js';
export * from './config.js';
export * from './derived.js';
export * from './events.js';
export * from './flags.js';
export * from './icons.js';
/**
 * Модель уровня приема данных со шлюза. Вынесена в пространство имен `ingest`,
 * чтобы ее типы не смешивались с контрактами выдачи в интерфейс.
 */
export * as ingest from './ingest.js';
export * from './metric-groups.js';
export * from './metrics.js';
export * from './pit.js';
export * from './severity.js';
export * from './thresholds.js';
export * from './units.js';
export * from './vehicles.js';
