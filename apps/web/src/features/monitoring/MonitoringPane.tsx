/**
 * Правая область - мониторинг: навигационный список машин или страница выбранной машины.
 * Страницы переключаются выбранной машиной в сторе, а не роутером: состояние экрана целиком
 * живет в сторе и в адресной строке. Область адаптируется к своей ширине (container queries),
 * а не к ширине окна.
 */

import { useLayoutEffect, useRef } from 'react';
import { DebugPanel } from '@/features/debug/DebugPanel.js';
import { useSelectedVehicleId } from '@/shared/store';
import { VehicleList } from './list/VehicleList.js';
import { ScrollRootContext } from './scroll-root.js';
import { VehiclePage } from './vehicle/VehiclePage.js';
import './monitoring.css';

/**
 * Отладочная панель видна только с `?debug=1`: в обычном показе она не нужна, но с нее
 * снимаются клиентские замеры (время обработки тика, частота тиков) для `BENCHMARK.md`.
 * Параметр читается один раз при загрузке и в состояние экрана не входит.
 */
const DEBUG_ENABLED = new URLSearchParams(window.location.search).get('debug') === '1';

export function MonitoringPane() {
  const selectedVehicleId = useSelectedVehicleId();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Новая страница начинается сверху, а не с прокрутки предыдущей.
  // biome-ignore lint/correctness/useExhaustiveDependencies: смена машины - и есть повод сбросить прокрутку
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [selectedVehicleId]);

  return (
    <div className="relative flex h-full w-full flex-col bg-bg">
      <ScrollRootContext value={scrollRef}>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pb-14">
          {selectedVehicleId === null ? (
            <VehicleList />
          ) : (
            // Ключ по машине: смена машины - новая страница с чистыми буферами и состоянием.
            <VehiclePage key={selectedVehicleId} vehicleId={selectedVehicleId} />
          )}
        </div>
      </ScrollRootContext>
      {DEBUG_ENABLED && <DebugPanel />}
    </div>
  );
}
