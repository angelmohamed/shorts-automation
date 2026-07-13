'use client';

import { useState, useId } from 'react';
import type { ReactNode } from 'react';
import { cn } from './cn';
import { ChevronRightIcon } from '@/lib/icons';

// ── Card ─────────────────────────────────────────────────────────────────────
export function Card({ as: As = 'div', surface = 2, padding = 'md', className, children, ...rest }: {
  as?: 'div' | 'section' | 'article'; surface?: 1 | 2 | 3; padding?: 'none' | 'sm' | 'md'; className?: string; children: ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  const surf = surface === 1 ? 'bg-surface-1' : surface === 3 ? 'bg-surface-3' : 'bg-surface-2';
  const pad = padding === 'none' ? '' : padding === 'sm' ? 'p-3' : 'p-4';
  return (
    <As className={cn('rounded-lg border border-line-faint', surf, pad, className)} {...rest}>
      {children}
    </As>
  );
}

// ── Divider ──────────────────────────────────────────────────────────────────
export function Divider({ orientation = 'horizontal', className }: { orientation?: 'horizontal' | 'vertical'; className?: string }) {
  return <div role="separator" aria-orientation={orientation}
    className={cn(orientation === 'vertical' ? 'w-px self-stretch' : 'h-px w-full', 'bg-line', className)} />;
}

// ── SectionHeader ────────────────────────────────────────────────────────────
export function SectionHeader({ title, description, actions, variant = 'eyebrow', className }: {
  title: string; description?: string; actions?: ReactNode; variant?: 'eyebrow' | 'heading'; className?: string;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <div className="min-w-0">
        {variant === 'eyebrow'
          ? <p className="text-caption uppercase tracking-wide text-fg-3 font-semibold">{title}</p>
          : <h2 className="text-heading text-fg">{title}</h2>}
        {description && <p className="text-caption text-fg-3 mt-0.5">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
    </div>
  );
}

// ── SettingRow (label ↔ control) ─────────────────────────────────────────────
export function SettingRow({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 min-h-8', className)}>
      <div className="min-w-0">
        <span className="text-label text-fg-2">{label}</span>
        {hint && <p className="text-caption text-fg-3">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ── Panel (dock) ─────────────────────────────────────────────────────────────
export function Panel({ title, children, footer, className, headerActions }: {
  title?: string; children: ReactNode; footer?: ReactNode; className?: string; headerActions?: ReactNode;
}) {
  return (
    <aside className={cn('flex flex-col bg-surface-1 border-line', className)} aria-label={title}>
      {title && (
        <header className="flex items-center justify-between gap-2 h-12 px-4 border-b border-line shrink-0">
          <h2 className="text-heading text-fg truncate">{title}</h2>
          <div className="flex items-center gap-1">{headerActions}</div>
        </header>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
      {footer && <div className="border-t border-line p-3 shrink-0">{footer}</div>}
    </aside>
  );
}

// ── CollapsibleSection (dual controlled/uncontrolled) ────────────────────────
export function CollapsibleSection({ title, defaultOpen = true, open: controlledOpen, onOpenChange, right, children, className }: {
  title: ReactNode; defaultOpen?: boolean; open?: boolean; onOpenChange?: (v: boolean) => void; right?: ReactNode; children: ReactNode; className?: string;
}) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolled;
  const regionId = useId();
  const toggle = () => {
    if (!isControlled) setUncontrolled(o => !o);
    onOpenChange?.(!open);
  };
  return (
    <div className={cn('flex flex-col', className)}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={toggle}
          className="flex flex-1 items-center gap-2 h-9 px-1 rounded-md text-label text-fg-2 hover:text-fg hover:bg-hover focus-ring"
        >
          <ChevronRightIcon size={13} className={cn('shrink-0 transition-transform duration-[var(--dur-base)] motion-reduce:transition-none', open && 'rotate-90')} aria-hidden />
          <span className="truncate">{title}</span>
        </button>
        {right && <div className="shrink-0">{right}</div>}
      </div>
      <div
        id={regionId}
        className="grid transition-[grid-template-rows] duration-[var(--dur-base)] ease-[var(--ease-standard)] motion-reduce:transition-none"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="pl-2 pt-1 pb-2 flex flex-col gap-2">{children}</div>
        </div>
      </div>
    </div>
  );
}
