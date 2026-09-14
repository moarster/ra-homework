/**
 * Слайдер на родном `input[type=range]`: доступность и клавиатура достаются бесплатно,
 * остается только оформление дорожки токенами.
 */

import { cx } from './cx.js';

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  label: string;
  /** Текст значения справа, уже отформатированный с единицей. */
  valueText?: string;
  className?: string;
  disabled?: boolean;
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  valueText,
  className,
  disabled = false,
}: SliderProps) {
  const filled = max === min ? 0 : ((value - min) / (max - min)) * 100;
  return (
    <label className={cx('inline-flex items-center gap-2', className)}>
      <span className="text-[11px] text-fg-faint whitespace-nowrap">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={valueText}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        style={{
          background: `linear-gradient(to right, var(--primary-500) ${filled}%, var(--surface-active) ${filled}%)`,
        }}
        className={cx(
          'h-1.5 w-28 cursor-pointer appearance-none rounded-pill outline-offset-4',
          'disabled:cursor-not-allowed disabled:opacity-45',
          '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-3.5',
          '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white',
          '[&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-border-strong',
          '[&::-webkit-slider-thumb]:shadow-sm',
          '[&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full',
          '[&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:bg-white',
        )}
      />
      {valueText !== undefined && (
        <span className="tabular w-12 text-[12px] text-fg whitespace-nowrap">{valueText}</span>
      )}
    </label>
  );
}
