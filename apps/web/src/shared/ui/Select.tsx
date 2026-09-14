/**
 * Выпадающий список в духе Grafana: кнопка с текущим значением и список вариантов.
 * Свой, а не `<select>`, потому что вариантам нужны иконки, подписи и группировка;
 * клавиатура поддержана руками (стрелки, Home/End, Enter, Escape).
 */

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { cx } from './cx.js';
import { Popover, usePopoverAnchor } from './Popover.js';

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
  /** Второй строкой: пояснение варианта. */
  hint?: string;
  icon?: ReactNode;
}

export interface SelectProps<T extends string | number> {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  /** Доступное имя списка. */
  label: string;
  /** Показывать подпись-заголовок слева от кнопки. */
  showLabel?: boolean;
  /** Ширина кнопки в символах: фиксирует ширину, чтобы полоска не дергалась. */
  className?: string;
  disabled?: boolean;
  /** Чем рисовать кнопку, если нужно не только название варианта. */
  renderTrigger?: (option: SelectOption<T> | undefined) => ReactNode;
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
  showLabel = false,
  className,
  disabled = false,
  renderTrigger,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const { ref, anchor } = usePopoverAnchor();
  const listRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(
      0,
      options.findIndex((option) => option.value === value),
    ),
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setActiveIndex(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
    // Фокус уезжает в список, иначе стрелки будут прокручивать страницу.
    // Таймер, а не кадр: кадры не выдаются в скрытой вкладке, и список остался бы без фокуса.
    const timer = window.setTimeout(() => listRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open, options, value]);

  const commit = (index: number) => {
    const option = options[index];
    if (option !== undefined) {
      onChange(option.value);
    }
    setOpen(false);
    anchor?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, options.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        commit(activeIndex);
        break;
      default:
        break;
    }
  };

  return (
    <>
      {showLabel && <span className="text-[11px] text-fg-faint whitespace-nowrap">{label}</span>}
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cx(
          'inline-flex h-7 items-center gap-1.5 rounded-control border border-border-base',
          'bg-surface-weak px-2 text-[12px] text-fg hover:bg-surface-hover',
          'cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap',
          className,
        )}
      >
        {renderTrigger !== undefined ? (
          renderTrigger(selected)
        ) : (
          <>
            {selected?.icon}
            <span>{selected?.label ?? '-'}</span>
          </>
        )}
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-3.5 shrink-0 text-fg-faint"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <Popover open={open} onOpenChange={setOpen} anchor={anchor} className="min-w-44">
        {/* Списку нужен фокус: без него стрелки прокручивали бы страницу, а не список. */}
        <div
          ref={listRef}
          role="listbox"
          aria-label={label}
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="flex max-h-80 flex-col gap-0.5 overflow-y-auto outline-none"
        >
          {options.map((option, index) => (
            <button
              key={String(option.value)}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => commit(index)}
              onMouseEnter={() => setActiveIndex(index)}
              className={cx(
                'flex items-center gap-2 rounded-control px-2 py-1.5 text-left text-[12px]',
                'cursor-pointer',
                index === activeIndex ? 'bg-surface-hover' : '',
                option.value === value ? 'text-primary-text font-medium' : 'text-fg',
              )}
            >
              {option.icon}
              <span className="flex-1">
                {option.label}
                {option.hint !== undefined && (
                  <span className="block text-[11px] text-fg-faint">{option.hint}</span>
                )}
              </span>
              {option.value === value && (
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="size-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <path d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}
