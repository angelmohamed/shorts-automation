'use client';

import type { ReactNode } from 'react';
import { cn } from './cn';
import { InfoIcon, AlertCircleIcon, AlertTriangleIcon, CheckIcon } from '@/lib/icons';

// ── Spinner ──────────────────────────────────────────────────────────────────
export function Spinner({ size = 'md', label = 'Loading', className }: { size?: 'sm' | 'md'; label?: string; className?: string }) {
  return (
    <span role="status" aria-live="polite" className={cn('inline-flex', className)}>
      <span
        className={cn(
          'inline-block rounded-full border-2 border-current border-r-transparent text-fg-2',
          'animate-spin motion-reduce:animate-none motion-reduce:border-r-current',
          size === 'sm' ? 'size-3.5' : 'size-5',
        )}
        aria-hidden
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

// ── BrandLoader (full-screen / full-area loading animation) ───────────────────
// The animated FeedForce mark (public/feedforceloader.svg): the three ellipses pulse in sequence.
// The animation (and its prefers-reduced-motion fallback) lives INSIDE the SVG, so no CSS classes
// here. Use for screen- and section-level loading; keep <Spinner> for inline/button use.
// `size` is the mark's WIDTH; height follows its natural aspect (the mark isn't square).
export function BrandLoader({ size = 48, label = 'Loading', className }: { size?: number; label?: string; className?: string }) {
  return (
    <span role="status" aria-live="polite" className={cn('inline-flex', className)}>
      <img
        src="/feedforceloader.svg"
        alt=""
        aria-hidden
        draggable={false}
        width={size}
        style={{ width: size, height: 'auto' }}
        className="select-none"
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

// ── Badge / Chip ─────────────────────────────────────────────────────────────
type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';
const BADGE_TONES: Record<Tone, string> = {
  neutral: 'bg-active text-fg-2 border-line',
  info: 'bg-info-tint text-info-text border-info-border',
  success: 'bg-success-tint text-success-text border-success-border',
  warning: 'bg-warning-tint text-warning-text border-warning-border',
  danger: 'bg-danger-tint text-danger-text border-danger-border',
  accent: 'bg-accent-tint text-accent-text border-accent-border',
};
export function Badge({ tone = 'neutral', dot, icon, children, className }: { tone?: Tone; dot?: boolean; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 h-5 px-2 rounded-full text-caption font-medium border', BADGE_TONES[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {icon && <span aria-hidden className="inline-flex">{icon}</span>}
      {children}
    </span>
  );
}

// ── Alert ────────────────────────────────────────────────────────────────────
type AlertTone = 'info' | 'success' | 'warning' | 'danger';
const ALERT_TONES: Record<AlertTone, { cls: string; icon: ReactNode }> = {
  info: { cls: 'bg-info-tint border-info-border text-info-text', icon: <InfoIcon size={15} /> },
  success: { cls: 'bg-success-tint border-success-border text-success-text', icon: <CheckIcon size={15} /> },
  warning: { cls: 'bg-warning-tint border-warning-border text-warning-text', icon: <AlertTriangleIcon size={15} /> },
  danger: { cls: 'bg-danger-tint border-danger-border text-danger-text', icon: <AlertCircleIcon size={15} /> },
};
export function Alert({ tone = 'info', title, children, className }: { tone?: AlertTone; title?: string; children?: ReactNode; className?: string }) {
  const t = ALERT_TONES[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex items-start gap-2 rounded-md border px-3 py-2 text-caption', t.cls, className)}>
      <span aria-hidden className="shrink-0 mt-px">{t.icon}</span>
      <div className="min-w-0">
        {title && <p className="font-semibold text-fg">{title}</p>}
        {children && <p className="leading-relaxed">{children}</p>}
      </div>
    </div>
  );
}

// ── ProgressBar ──────────────────────────────────────────────────────────────
export function ProgressBar({ value, tone = 'accent', className, label }: { value: number; tone?: 'accent' | 'neutral'; className?: string; label?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={cn('h-1.5 w-full rounded-full bg-surface-3 overflow-hidden', className)}
      role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={cn('h-full rounded-full transition-[width] duration-[var(--dur-base)]', tone === 'accent' ? 'bg-accent' : 'bg-white')} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ── EmptyState ───────────────────────────────────────────────────────────────
export function EmptyState({ icon, title, description, action, tone = 'empty', bareIcon = false, className }: {
  icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; tone?: 'empty' | 'danger';
  /** Drop the icon tile's chrome (background/border) — for hosts that are already a framed box. */
  bareIcon?: boolean; className?: string;
}) {
  return (
    <div role={tone === 'danger' ? 'alert' : undefined} className={cn('mx-auto max-w-[20rem] py-12 flex flex-col items-center gap-3 text-center', className)}>
      {icon && (
        <span aria-hidden className={cn('grid place-items-center size-12',
          !bareIcon && 'rounded-xl border',
          tone === 'danger'
            ? cn('text-danger-text', !bareIcon && 'bg-danger-tint border-danger-border')
            : cn('text-fg-3', !bareIcon && 'bg-surface-2 border-line'))}>
          {icon}
        </span>
      )}
      <p className="text-heading text-fg">{title}</p>
      {description && <p className="text-body text-fg-2 leading-relaxed">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

// ── Tooltip (CSS-group, supplemental — never the only label) ──────────────────
export function Tooltip({ content, side = 'top', children, className }: { content: string; side?: 'top' | 'bottom'; children: ReactNode; className?: string }) {
  return (
    <span className={cn('relative inline-flex group/tooltip', className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-1/2 -translate-x-1/2 z-dropdown whitespace-nowrap max-w-[240px]',
          'rounded-md bg-surface-overlay border border-line shadow-2 px-2 py-1 text-caption text-fg',
          'opacity-0 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100',
          'transition-opacity duration-[var(--dur-base)] motion-reduce:transition-none',
          side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
        )}
      >
        {content}
      </span>
    </span>
  );
}
