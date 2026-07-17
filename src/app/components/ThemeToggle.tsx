'use client';

import { useEffect, useState } from 'react';

// Light/dark theme toggle. Dark is the default (no data-theme); light is "Vim Light Soft" (gruvbox),
// defined in globals.css under :root[data-theme="light"]. The choice is persisted to localStorage and
// re-applied before paint by the inline script in layout.tsx (so there's no dark→light flash on reload).
export function ThemeToggle() {
  // Start matching the SSR render (dark) and correct on mount — avoids a hydration mismatch; the icon
  // just settles a frame later if the persisted theme is light.
  const [light, setLight] = useState(false);
  useEffect(() => {
    setLight(document.documentElement.getAttribute('data-theme') === 'light');
  }, []);

  const toggle = () => {
    const next = !light;
    setLight(next);
    const el = document.documentElement;
    if (next) el.setAttribute('data-theme', 'light');
    else el.removeAttribute('data-theme');
    try { localStorage.setItem('reels:theme', next ? 'light' : 'dark'); } catch { /* private mode */ }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={light ? 'Switch to dark theme' : 'Switch to light theme'}
      title={light ? 'Switch to dark theme' : 'Switch to light theme'}
      className="focus-ring flex items-center justify-center size-8 rounded-full text-fg-3 hover:text-fg hover:bg-hover transition-colors"
    >
      {light ? (
        // Moon — click to go dark
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
        </svg>
      ) : (
        // Sun — click to go light
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      )}
    </button>
  );
}
