/**
 * Каркас экрана: тонкая полоска общих элементов управления и две области под сплиттером.
 * Никакой навигации и меню нет - состояние экрана живет в сторе и в адресной строке.
 */

import { MapPane } from '@/features/map/MapPane.js';
import { MonitoringPane } from '@/features/monitoring/MonitoringPane.js';
import { Topbar } from '@/features/topbar/Topbar.js';
import { useRealtimeData } from './data/useRealtimeData.js';
import { ErrorBoundary } from './layout/ErrorBoundary.js';
import { SplitLayout } from './layout/SplitLayout.js';
import { useApplyTheme } from './theme/use-theme.js';

export function App() {
  useApplyTheme();
  useRealtimeData();

  return (
    // overflow-hidden обязателен: иначе полоска растянулась бы по содержимому
    // вместо того чтобы сжимать элементы (см. `density.ts`).
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-bg text-fg">
      <ErrorBoundary area="верхняя полоска">
        <Topbar />
      </ErrorBoundary>
      <SplitLayout
        leftLabel="Карта карьера"
        rightLabel="Мониторинг"
        left={
          <ErrorBoundary area="карта карьера">
            <MapPane />
          </ErrorBoundary>
        }
        right={
          <ErrorBoundary area="мониторинг">
            <MonitoringPane />
          </ErrorBoundary>
        }
      />
    </div>
  );
}
