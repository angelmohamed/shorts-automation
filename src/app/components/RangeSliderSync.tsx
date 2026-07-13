'use client';

import { useEffect } from 'react';

function syncFill(el: HTMLInputElement) {
  const min = parseFloat(el.min) || 0;
  const max = parseFloat(el.max) || 100;
  const pct = ((parseFloat(el.value) - min) / (max - min)) * 100;
  el.style.setProperty('--fill', `${pct}%`);
}

export function RangeSliderSync() {
  useEffect(() => {
    function onInput(e: Event) {
      const el = e.target as HTMLInputElement;
      if (el.type === 'range') syncFill(el);
    }

    function syncAll() {
      document.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(syncFill);
    }

    syncAll();
    document.addEventListener('input', onInput, true);

    const observer = new MutationObserver(syncAll);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.removeEventListener('input', onInput, true);
      observer.disconnect();
    };
  }, []);

  return null;
}
