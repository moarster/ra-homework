/** Название системы: левый якорь полоски. */

import { TruckIcon } from './icons.js';

export function SystemTitle({ compact }: { compact: boolean }) {
  return (
    <div className="flex items-center gap-2 pr-1">
      <span className="text-primary-text">
        <TruckIcon />
      </span>
      {!compact && (
        <span className="text-[13px] font-semibold tracking-tight whitespace-nowrap text-fg">
          Мониторинг самосвалов
        </span>
      )}
    </div>
  );
}
