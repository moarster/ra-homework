/** Тумблер. Подпись слева, состояние справа: так читается в одну строку полоски. */

import { cx } from './cx.js';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  /** Показывать подпись рядом; при нехватке ширины ее убирают. */
  showLabel?: boolean;
  disabled?: boolean;
  className?: string;
}

export function Toggle({
  checked,
  onChange,
  label,
  showLabel = true,
  disabled = false,
  className,
}: ToggleProps) {
  return (
    <label
      className={cx(
        'inline-flex items-center gap-2 select-none',
        disabled ? 'opacity-45' : 'cursor-pointer',
        className,
      )}
    >
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        className="sr-only peer"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span
        aria-hidden="true"
        className={cx(
          'relative h-5 w-9 shrink-0 rounded-pill border transition-colors',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2',
          'peer-focus-visible:outline-[var(--primary-500)]',
          checked ? 'bg-primary border-primary' : 'bg-surface-active border-border-base',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 size-3.5 rounded-full bg-white shadow-sm transition-[left]',
            checked ? 'left-[18px]' : 'left-0.5',
          )}
        />
      </span>
      {showLabel && <span className="text-[12px] text-fg-muted whitespace-nowrap">{label}</span>}
    </label>
  );
}
