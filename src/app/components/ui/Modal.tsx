'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from './cn';
import { IconButton } from './Button';
import { CloseIcon } from '@/lib/icons';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Set false to forbid backdrop-click dismissal (e.g. unsaved input). Default true. */
  dismissOnBackdrop?: boolean;
  /**
   * Visual treatment of the card. `'default'` is the standard dialog surface;
   * `'auth'` matches the login/signup card — darker `bg-page`, softer `rounded-2xl`
   * corners, a centered header, and a floating top-right close button.
   */
  variant?: 'default' | 'auth';
}

const SIZES = { sm: 'max-w-[420px]', md: 'max-w-[560px]', lg: 'max-w-[720px]', xl: 'max-w-[940px]' };

const EXIT_MS = 170;   // keep the card mounted briefly so the fade-out can play before it unmounts

export function Modal({ open, onClose, title, description, children, footer, size = 'sm', dismissOnBackdrop = true, variant = 'default' }: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);

  // Stay mounted through the exit animation: when `open` flips false we play the fade-out, then unmount.
  const [render, setRender] = useState(open);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (open) { setRender(true); setClosing(false); return; }
    if (!render) return;
    setClosing(true);
    const t = setTimeout(() => { setRender(false); setClosing(false); }, EXIT_MS);
    return () => clearTimeout(t);
  }, [open, render]);

  useEffect(() => {
    if (!open) return;
    lastFocused.current = document.activeElement as HTMLElement | null;
    // focus the first focusable inside the dialog (or the card itself)
    const card = cardRef.current;
    const focusable = card?.querySelector<HTMLElement>('input,select,textarea,button,[href],[tabindex]:not([tabindex="-1"])');
    (focusable ?? card)?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !card) return;
      const items = Array.from(card.querySelectorAll<HTMLElement>('input,select,textarea,button,[href],[tabindex]:not([tabindex="-1"])')).filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      lastFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!render) return null;

  const isAuth = variant === 'auth';

  return (
    <div
      className={cn('fixed inset-0 z-modal grid place-items-center p-4 bg-[var(--scrim)]', closing ? 'de-overlay-out' : 'de-overlay-in')}
      onMouseDown={e => { if (dismissOnBackdrop && e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'relative w-full max-h-[85vh] overflow-hidden flex flex-col border border-line shadow-3 outline-none',
          closing ? 'de-dialog-out' : 'de-dialog-in',
          'bg-page', isAuth ? 'rounded-2xl' : 'rounded-xl',
          SIZES[size],
        )}
        onMouseDown={e => e.stopPropagation()}
      >
        {isAuth ? (
          <>
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute right-3 top-3 grid size-8 place-items-center rounded-md text-fg-3 transition-colors hover:bg-hover hover:text-fg focus-ring"
            >
              <CloseIcon size={16} />
            </button>
            <header className="shrink-0 px-7 pt-7 pb-4 text-center">
              <h2 className="text-[20px] leading-tight font-bold tracking-[-0.01em] text-fg">{title}</h2>
              {description && <p className="text-body text-fg-3 mt-1">{description}</p>}
            </header>
          </>
        ) : (
          <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 shrink-0">
            <div className="min-w-0">
              <h2 className="text-title text-fg">{title}</h2>
              {description && <p className="text-caption text-fg-3 mt-0.5">{description}</p>}
            </div>
            <IconButton icon={<CloseIcon size={16} />} label="Close" onClick={onClose} className="-mr-1 -mt-0.5" />
          </header>
        )}
        <div className={cn('flex-1 min-h-0 overflow-y-auto', isAuth ? cn('px-7', !footer && 'pb-7') : 'px-5 pb-2')}>{children}</div>
        {footer && <div className={cn('flex items-center justify-end gap-2 shrink-0', isAuth ? 'px-7 pb-7 pt-3' : 'px-5 py-4')}>{footer}</div>}
      </div>
    </div>
  );
}
