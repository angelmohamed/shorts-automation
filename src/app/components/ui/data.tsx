'use client';

import type { ReactNode } from 'react';
import { cn } from './cn';
import { CheckIcon } from '@/lib/icons';

// ── ListRow ──────────────────────────────────────────────────────────────────
export function ListRow({ leading, title, subtitle, trailing, selected, onClick, draggable, className, ...rest }: {
  leading?: ReactNode; title: ReactNode; subtitle?: ReactNode; trailing?: ReactNode; selected?: boolean;
  onClick?: () => void; draggable?: boolean; className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      onClick={onClick}
      draggable={draggable}
      data-selected={selected || undefined}
      // When the row is clickable, make it keyboard-operable too (Enter/Space). Conditional so non-interactive
      // rows stay out of the tab order. Declared before {...rest} so a consumer can still override any of these.
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
      } : undefined}
      className={cn(
        'group flex items-center gap-2.5 h-11 px-2.5 rounded-md transition-colors duration-[var(--dur-fast)]',
        onClick && 'cursor-pointer',
        selected ? 'bg-accent-tint text-fg' : 'text-fg-2 hover:bg-hover hover:text-fg',
        className,
      )}
      {...rest}
    >
      {leading && <span className="shrink-0 inline-flex">{leading}</span>}
      <div className="flex-1 min-w-0">
        <div className="truncate text-label">{title}</div>
        {subtitle && <div className="truncate text-caption text-fg-3">{subtitle}</div>}
      </div>
      {trailing && <div className="shrink-0 flex items-center gap-1">{trailing}</div>}
    </div>
  );
}

// ── Avatar ───────────────────────────────────────────────────────────────────
export function Avatar({ src, fallback, size = 32, alt = '', className }: { src?: string | null; fallback: string; size?: number; alt?: string; className?: string }) {
  return (
    <span
      className={cn('inline-grid place-items-center rounded-full bg-surface-3 text-fg-2 font-semibold uppercase select-none overflow-hidden shrink-0', className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {src
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={src} alt={alt} className="w-full h-full object-cover" />
        : fallback.charAt(0)}
    </span>
  );
}

// ── CheckBadge (selected check) ──────────────────────────────────────────────
export function CheckBadge({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <span className={cn('grid place-items-center rounded-full bg-white text-black shadow-1', className)} style={{ width: size, height: size }} aria-hidden>
      <CheckIcon size={Math.round(size * 0.6)} />
    </span>
  );
}

// ── SelectableCard (radio-style tile) ────────────────────────────────────────
export function SelectableCard({ selected, onClick, label, description, children, className }: {
  selected?: boolean; onClick?: () => void; label?: string; description?: string; children?: ReactNode; className?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        'group relative flex flex-col items-stretch text-left rounded-xl overflow-hidden focus-ring transition-[transform,border-color] duration-[var(--dur-fast)]',
        'border-2 active:scale-[0.99]',
        selected ? 'border-white' : 'border-line hover:border-line-strong',
        className,
      )}
    >
      {children}
      {selected && <span className="absolute top-2.5 right-2.5"><CheckBadge size={20} /></span>}
      {(label || description) && (
        <span className="px-3 py-2">
          {label && <span className="block text-label text-fg">{label}</span>}
          {description && <span className="block text-caption text-fg-3 mt-0.5">{description}</span>}
        </span>
      )}
    </button>
  );
}

// ── WizardSteps ──────────────────────────────────────────────────────────────
export function WizardSteps({ steps, current, className }: { steps: string[]; current: number; className?: string }) {
  return (
    <ol className={cn('flex items-center gap-2', className)} aria-label="Progress">
      {steps.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo';
        return (
          <li key={label} className="flex items-center gap-2" aria-current={state === 'current' ? 'step' : undefined}>
            <span className={cn('grid place-items-center size-5 rounded-full text-caption font-semibold border',
              state === 'current' ? 'bg-accent text-black border-accent'
                : state === 'done' ? 'bg-surface-3 text-fg border-line-strong'
                : 'bg-transparent text-fg-3 border-line')}>
              {state === 'done' ? <CheckIcon size={11} /> : i + 1}
            </span>
            <span className={cn('text-label', state === 'current' ? 'text-fg' : 'text-fg-3')}>{label}</span>
            {i < steps.length - 1 && <span className="w-5 h-px bg-line mx-1" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
