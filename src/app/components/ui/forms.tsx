'use client';

import { forwardRef, useId, useRef } from 'react';
import type { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';
import { ChevronDownIcon, MinusIcon, PlusIcon } from '@/lib/icons';

const FIELD =
  'h-9 w-full rounded-md bg-surface-1 px-2.5 text-body text-fg border border-line ' +
  'placeholder:text-fg-3 hover:border-line-strong ' +
  'focus-ring focus-visible:border-line-strong ' +
  'disabled:opacity-40 disabled:cursor-not-allowed ' +
  'transition-colors duration-[var(--dur-fast)]';

function FieldShell({
  label, htmlFor, helper, error, optional, children,
}: { label?: string; htmlFor?: string; helper?: string; error?: string; optional?: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={htmlFor} className="text-label text-fg-2">
          {label}{optional && <span className="text-fg-3"> (optional)</span>}
        </label>
      )}
      {children}
      {(helper || error) && (
        <p className={cn('text-caption', error ? 'text-danger-text' : 'text-fg-3')} role={error ? 'alert' : undefined}>
          {error || helper}
        </p>
      )}
    </div>
  );
}

// ── TextField ────────────────────────────────────────────────────────────────
export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: string;
  helper?: string;
  error?: string;
  optional?: boolean;
  prefix?: ReactNode;     // e.g. '@'
  trailing?: ReactNode;
  containerClassName?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, helper, error, optional, prefix, trailing, className, containerClassName, id, ...rest },
  ref,
) {
  const auto = useId();
  const fieldId = id ?? auto;
  const input = (
    <input
      ref={ref}
      id={fieldId}
      aria-invalid={error ? true : undefined}
      className={cn(FIELD, Boolean(prefix) && 'pl-7', Boolean(trailing) && 'pr-9', error && 'border-danger-border', className)}
      {...rest}
    />
  );
  return (
    <div className={containerClassName}>
      <FieldShell label={label} htmlFor={fieldId} helper={helper} error={error} optional={optional}>
        {prefix || trailing ? (
          <div className="relative flex items-center">
            {prefix && <span className="absolute left-2.5 text-body text-fg-3 pointer-events-none">{prefix}</span>}
            {input}
            {trailing && <span className="absolute right-2.5 flex items-center">{trailing}</span>}
          </div>
        ) : input}
      </FieldShell>
    </div>
  );
});

// ── Textarea ─────────────────────────────────────────────────────────────────
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  helper?: string;
  error?: string;
}
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, helper, error, className, id, rows = 3, ...rest },
  ref,
) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <FieldShell label={label} htmlFor={fieldId} helper={helper} error={error}>
      <textarea
        ref={ref}
        id={fieldId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        className={cn(FIELD.replace('h-9', 'min-h-16 py-2'), 'resize-y leading-relaxed', error && 'border-danger-border', className)}
        {...rest}
      />
    </FieldShell>
  );
});

// ── Select (native, styled) ──────────────────────────────────────────────────
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  helper?: string;
  error?: string;
}
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, helper, error, className, id, children, ...rest },
  ref,
) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <FieldShell label={label} htmlFor={fieldId} helper={helper} error={error}>
      <div className="relative">
        <select
          ref={ref}
          id={fieldId}
          className={cn(FIELD, 'appearance-none pr-8 cursor-pointer', className)}
          {...rest}
        >
          {children}
        </select>
        <ChevronDownIcon size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-3 pointer-events-none" aria-hidden />
      </div>
    </FieldShell>
  );
});

// ── NumberField / Stepper ────────────────────────────────────────────────────
export interface NumberFieldProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  unit?: string;
  className?: string;
}
export function NumberField({ value, onChange, min = -Infinity, max = Infinity, step = 1, label, unit, className }: NumberFieldProps) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <div className={cn('inline-flex items-center gap-1', className)}>
      <button type="button" onClick={() => onChange(clamp(value - step))} aria-label={label ? `Decrease ${label}` : 'Decrease'}
        className="grid place-items-center size-7 rounded-md bg-surface-1 border border-line text-fg-2 hover:text-fg hover:border-line-strong focus-ring">
        <MinusIcon size={13} aria-hidden />
      </button>
      <span className="min-w-9 text-center text-mono tabular-nums text-fg">{value}{unit && <span className="text-fg-3">{unit}</span>}</span>
      <button type="button" onClick={() => onChange(clamp(value + step))} aria-label={label ? `Increase ${label}` : 'Increase'}
        className="grid place-items-center size-7 rounded-md bg-surface-1 border border-line text-fg-2 hover:text-fg hover:border-line-strong focus-ring">
        <PlusIcon size={13} aria-hidden />
      </button>
    </div>
  );
}

// ── Switch ───────────────────────────────────────────────────────────────────
export interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}
export function Switch({ checked, onChange, label, disabled, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 focus-ring',
        'transition-colors duration-[var(--dur-base)] disabled:opacity-40',
        checked ? 'bg-accent' : 'bg-zinc-700',
        className,
      )}
    >
      <span className={cn('size-4 rounded-full bg-white shadow-1 transition-transform duration-[var(--dur-base)] motion-reduce:transition-none', checked ? 'translate-x-4' : 'translate-x-0')} />
    </button>
  );
}

// ── Slider ───────────────────────────────────────────────────────────────────
export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  label?: string;
  unit?: string;
  neutral?: boolean;       // white fill instead of brand accent
  showValue?: boolean;
  className?: string;
}
export function Slider({ value, min, max, step = 1, onChange, label, unit, neutral, showValue = true, className }: SliderProps) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {label && <span className="text-label text-fg-2 shrink-0">{label}</span>}
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        aria-valuetext={unit ? `${value}${unit}` : undefined}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 min-w-0"
        style={{ ['--fill' as string]: `${pct}%`, ...(neutral ? { ['--fill-color' as string]: 'var(--white)' } : {}) }}
      />
      {showValue && <span className="text-mono tabular-nums text-fg-2 w-10 text-right shrink-0">{value}{unit}</span>}
    </div>
  );
}

// ── SegmentedControl (tabs) ──────────────────────────────────────────────────
export interface SegmentedItem<T extends string> { value: T; label: string; icon?: ReactNode; }
export interface SegmentedControlProps<T extends string> {
  items: SegmentedItem<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
  emphasis?: 'fill' | 'underline';   // fill = white-on-black mode switch; underline = in-panel group
  size?: 'sm' | 'md';
  className?: string;
}
export function SegmentedControl<T extends string>({ items, value, onChange, ariaLabel, emphasis = 'fill', size = 'sm', className }: SegmentedControlProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: React.KeyboardEvent, idx: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowRight' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
    onChange(items[next].value);
    (ref.current?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next])?.focus();
  };
  const h = size === 'md' ? 'h-8' : 'h-7';
  return (
    <div ref={ref} role="tablist" aria-label={ariaLabel}
      className={cn('inline-flex items-center gap-0.5 p-0.5 rounded-md bg-surface-1 border border-line', className)}>
      {items.map((it, idx) => {
        const selected = it.value === value;
        return (
          <button
            key={it.value}
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onKeyDown={e => onKey(e, idx)}
            onClick={() => onChange(it.value)}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 rounded-[5px] text-label focus-ring transition-colors duration-[var(--dur-fast)]', h,
              !selected && 'text-fg-2 hover:text-fg',
              emphasis === 'fill'
                ? selected && 'bg-action text-action-fg font-semibold'
                : selected && 'text-fg shadow-[inset_0_-2px_0_0_var(--accent)]',
            )}
          >
            {it.icon && <span aria-hidden className="inline-flex">{it.icon}</span>}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

// ── ColorField (hex text + native swatch) ────────────────────────────────────
export interface ColorFieldProps {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  className?: string;
}
export function ColorField({ value, onChange, label, className }: ColorFieldProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <input
        type="text"
        value={value}
        aria-label={label ? `${label} hex value` : 'Hex color'}
        onChange={e => onChange(e.target.value)}
        className="w-[72px] bg-surface-1 border border-line rounded-md px-1.5 py-1 text-mono tabular-nums text-fg-2 focus-ring focus-visible:border-line-strong"
      />
      <input
        type="color"
        value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
        aria-label={label ? `${label} swatch` : 'Color swatch'}
        onChange={e => onChange(e.target.value)}
        className="size-6 rounded-sm border border-line bg-transparent cursor-pointer p-0 focus-ring"
      />
    </div>
  );
}
