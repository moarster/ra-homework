/**
 * Заглушка пользователя. Демонстрационный элемент: реальная авторизация вне периметра
 * прототипа, в промышленном контуре вход идет через Active Directory.
 */

import { cx, Tooltip } from '@/shared/ui';
import { UserIcon } from './icons.js';

/** Демонстрационный пользователь: роль важнее имени - она объясняет, кто смотрит на экран. */
const DEMO_USER = {
  name: 'А. В. Ковалев',
  role: 'Служба главного механика',
} as const;

export function UserChip({ compact }: { compact: boolean }) {
  return (
    <Tooltip
      placement="bottom-end"
      content={
        <span className="block">
          <span className="block font-medium">{DEMO_USER.name}</span>
          <span className="block text-fg-muted">{DEMO_USER.role}</span>
          <span className="mt-1 block text-fg-faint">
            Демонстрационный пользователь. В промышленном контуре вход выполняется через Active
            Directory предприятия.
          </span>
        </span>
      }
    >
      <button
        type="button"
        className={cx(
          'flex h-7 items-center gap-2 rounded-pill border border-border-base bg-surface-weak',
          'pr-2.5 pl-1.5 text-left hover:bg-surface-hover cursor-help',
        )}
      >
        <span className="flex size-5 items-center justify-center rounded-full bg-primary-soft text-primary-text">
          <UserIcon />
        </span>
        {!compact && (
          <span className="leading-none">
            <span className="block text-[11px] font-medium whitespace-nowrap text-fg">
              {DEMO_USER.name}
            </span>
            <span className="block text-[10px] whitespace-nowrap text-fg-faint">
              {DEMO_USER.role}
            </span>
          </span>
        )}
      </button>
    </Tooltip>
  );
}
