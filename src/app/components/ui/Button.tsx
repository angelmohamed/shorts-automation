'use client';

import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';
import { SpinnerIcon } from '@/lib/icons';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'oauth';
type Size = 'sm' | 'md';

const BASE =
  'relative inline-flex items-center justify-center gap-1.5 select-none whitespace-nowrap rounded-md font-medium text-label ' +
  'transition-[background-color,border-color,color,opacity,transform] duration-[var(--dur-fast)] ease-[var(--ease-standard)] ' +
  'focus-ring disabled:opacity-40 disabled:pointer-events-none disabled:cursor-not-allowed';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-action text-action-fg hover:bg-action-hover active:bg-action-active border border-transparent',
  secondary: 'bg-surface-2 text-fg border border-line hover:border-line-strong hover:bg-active active:bg-active',
  ghost: 'bg-transparent text-fg-2 hover:bg-hover hover:text-fg active:bg-active border border-transparent',
  danger: 'bg-danger-tint text-danger-text border border-danger-border hover:bg-danger-tint-hover active:bg-danger-tint-hover',
  success: 'bg-success text-white border border-transparent hover:brightness-110 active:brightness-95',
  oauth: 'bg-white text-black border border-transparent hover:bg-zinc-100 active:bg-zinc-200',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-2.5',
  md: 'h-9 px-3.5',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, leadingIcon, trailingIcon, fullWidth, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && 'w-full', 'touch:min-h-11', className)}
      {...rest}
    >
      {loading && (
        <span className="absolute inset-0 grid place-items-center">
          <SpinnerIcon size={size === 'sm' ? 13 : 15} className="animate-spin motion-reduce:animate-none" aria-hidden />
        </span>
      )}
      <span className={cn('inline-flex items-center gap-1.5', loading && 'invisible')}>
        {leadingIcon && <span className="shrink-0" aria-hidden>{leadingIcon}</span>}
        {children}
        {trailingIcon && <span className="shrink-0" aria-hidden>{trailingIcon}</span>}
      </span>
    </button>
  );
});

type IconVariant = 'ghost' | 'secondary' | 'danger';
type IconSize = 'sm' | 'md';

const ICON_SIZES: Record<IconSize, string> = { sm: 'size-7', md: 'size-8' };
const ICON_VARIANTS: Record<IconVariant, string> = {
  ghost: 'text-fg-2 hover:text-fg hover:bg-hover active:bg-active',
  secondary: 'text-fg-2 bg-surface-2 border border-line hover:text-fg hover:border-line-strong',
  danger: 'text-fg-3 hover:text-danger-text hover:bg-danger-tint',
};

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: ReactNode;
  label: string;          // accessible name (also a good tooltip via title)
  variant?: IconVariant;
  size?: IconSize;
  active?: boolean;       // toggled state → aria-pressed + accent tint
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = 'ghost', size = 'md', active, className, type = 'button', title, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={title ?? label}
      aria-pressed={active ?? undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-md shrink-0',
        'transition-[background-color,color,transform] duration-[var(--dur-fast)] ease-[var(--ease-standard)]',
        'focus-ring disabled:opacity-40 disabled:pointer-events-none',
        ICON_SIZES[size], ICON_VARIANTS[variant],
        active && 'text-accent-text bg-accent-tint hover:bg-accent-tint-hover',
        className,
      )}
      {...rest}
    >
      <span aria-hidden className="inline-flex">{icon}</span>
    </button>
  );
});
