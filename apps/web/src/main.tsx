/** Точка входа: провайдеры данных, синхронизация состояния с адресом, монтирование каркаса. */

import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createQueryClient } from '@/shared/api';
import { installStoreSync } from '@/shared/store';
import { App } from './app/App.js';
import './app/theme/app.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Не найден корневой элемент #root');
}

installStoreSync();

const queryClient = createQueryClient();

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
