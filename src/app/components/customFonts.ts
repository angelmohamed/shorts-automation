'use client';

// Registry for user-uploaded fonts. Kept as a module singleton (like document.fonts itself)
// so the canvas renderer and every font picker can resolve custom fonts without prop-threading.
// useBrandKit calls setCustomFonts() whenever the brand kit's fonts load or change.
//
// Uploaded files are grouped into FAMILIES: e.g. "Montreal Serial Bold Italic.ttf" and
// "Montreal Serial.ttf" both belong to family "Montreal Serial". Each file registers as a
// weight/style variant of that family, so the editor's weight buttons + italic toggle pick the
// right file via normal CSS font matching, and the picker shows the family just once.

import { useEffect, useState } from 'react';
import { CAROUSEL_FONTS } from './templateEditorTypes';

export interface CustomFontEntry {
  label:   string;    // family name — what the picker shows and what fontLabel stores
  css:     string;    // '"Family", sans-serif'
  google:  null;      // shaped like a CAROUSEL_FONTS entry so the two are interchangeable
  weights: number[];  // weights this family actually ships (sorted), for the adaptive weight picker
  weightLabels: Record<number, string>;  // weight → the font's OWN style name (e.g. 900 → "Heavy", not "Black")
}

// Recognised weight words → CSS weight. Keys are lowercased and space-stripped.
const WEIGHT_WORDS: Record<string, number> = {
  thin: 100, hairline: 100,
  extralight: 200, ultralight: 200,
  light: 300,
  regular: 400, normal: 400, book: 400, roman: 400,
  medium: 500,
  semibold: 600, demibold: 600,
  bold: 700,
  extrabold: 800, ultrabold: 800,
  black: 900, heavy: 900,
};
const STYLE_WORD = /^(italic|oblique|ital)$/i;
const COMPOUND_PREFIX = /^(extra|ultra|semi|demi)$/i;

// Parse a font filename into { family, weight, style } by peeling recognised style/weight
// tokens off the END (so weight words inside a family name aren't stripped).
export function parseFontName(nameOrFile: string): { family: string; weight: number; style: 'normal' | 'italic'; variable: boolean; weightLabel?: string } {
  let base = nameOrFile.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();

  // Variable-font markers → strip "VariableFont", bracketed axes ("[wght]"), and bare axis tags
  // (wght/opsz/slnt/wdth/grad) so the family name stays clean, e.g. "Geist-VariableFont_wght" → "Geist".
  let variable = false;
  if (/\[[^\]]*\]/.test(base))                      { variable = true; base = base.replace(/\[[^\]]*\]/g, ' '); }
  if (/\bvariable\s*font\b/i.test(base))            { variable = true; base = base.replace(/\bvariable\s*font\b/ig, ' '); }
  if (/\b(wght|opsz|slnt|wdth|grad)\b/i.test(base)) { variable = true; base = base.replace(/\b(wght|opsz|slnt|wdth|grad)\b/ig, ' '); }
  base = base.replace(/\s+/g, ' ').trim();

  const words = base.split(/\s+/).filter(Boolean);
  let style: 'normal' | 'italic' = 'normal';
  let weight = 400;
  let weightSet = false;
  let weightLabel: string | undefined;   // the font's own word for the weight, original casing (e.g. "Heavy")

  while (words.length > 1) {
    const last  = words[words.length - 1];
    const prev  = words[words.length - 2] ?? '';
    const lastL = last.toLowerCase();
    const prevL = prev.toLowerCase();

    if (STYLE_WORD.test(lastL)) { style = 'italic'; words.pop(); continue; }

    // Two-word weight, e.g. "Extra Bold" / "Semi Bold" (keep at least one family word).
    const compound = `${prevL}${lastL}`;
    if (!weightSet && words.length > 2 && COMPOUND_PREFIX.test(prevL) && compound in WEIGHT_WORDS) {
      weight = WEIGHT_WORDS[compound]; weightLabel = `${prev} ${last}`; weightSet = true; words.pop(); words.pop(); continue;
    }
    if (!weightSet && lastL in WEIGHT_WORDS) { weight = WEIGHT_WORDS[lastL]; weightLabel = last; weightSet = true; words.pop(); continue; }
    break;
  }

  const family = words.join(' ').trim() || 'Custom Font';
  return { family, weight, style, variable, weightLabel };
}

let customFonts: CustomFontEntry[] = [];   // one entry per family
const listeners = new Set<() => void>();
const registeredUrls = new Set<string>();

function notify() { listeners.forEach(l => l()); }

// Register one uploaded file as a weight/style variant of its family.
function registerFace(family: string, url: string, weight: number, style: 'normal' | 'italic', variable: boolean) {
  if (typeof document === 'undefined' || registeredUrls.has(url)) return;
  registeredUrls.add(url);
  try {
    // A variable font covers a whole weight range from one file; a static file is a single weight.
    const face = new FontFace(family, `url("${url}")`, variable ? { weight: '100 900', style } : { weight: String(weight), style });
    face.load().then(loaded => {
      document.fonts.add(loaded);
      customFonts = [...customFonts];   // new ref so subscribers (canvas, picker) redraw with the loaded glyphs
      notify();
    }).catch(() => { /* leave the fallback in place */ });
  } catch { /* ignore */ }
}

// Replace the custom font set: register every file as a family variant, expose one entry per family.
export function setCustomFonts(fonts: { id: string; label: string; url: string }[]) {
  const families = new Map<string, CustomFontEntry>();
  const weightSets = new Map<string, Set<number>>();
  for (const f of fonts) {
    const { family, weight, style, variable, weightLabel } = parseFontName(f.label);
    registerFace(family, f.url, weight, style, variable);
    if (!families.has(family)) families.set(family, { label: family, css: `"${family}", sans-serif`, google: null, weights: [], weightLabels: {} });
    if (!weightSets.has(family)) weightSets.set(family, new Set());
    // A variable font supports the whole range from one file, so expose all stops in the picker.
    if (variable) [100, 200, 300, 400, 500, 600, 700, 800, 900].forEach(w => weightSets.get(family)!.add(w));
    else weightSets.get(family)!.add(weight);
    // Keep the font's own name for this weight so pickers can show "Heavy" instead of the generic "Black".
    // Static faces only — a variable font is one file with no per-stop names.
    if (weightLabel && !variable) families.get(family)!.weightLabels[weight] = weightLabel;
  }
  for (const [family, entry] of families) entry.weights = [...(weightSets.get(family) ?? [])].sort((a, b) => a - b);
  customFonts = [...families.values()];
  notify();
}

// Built-in + custom fonts, for pickers.
export function allCarouselFonts() { return [...CAROUSEL_FONTS, ...customFonts]; }

// Resolve a font label (built-in family or custom family) to its entry; falls back to the first built-in.
export function resolveCarouselFont(label: string) {
  return CAROUSEL_FONTS.find(f => f.label === label)
    ?? customFonts.find(f => f.label === label)
    ?? CAROUSEL_FONTS[0];
}

// React hook: re-renders the caller whenever the custom-font set changes (added/loaded/removed).
export function useCustomFonts(): CustomFontEntry[] {
  const [, bump] = useState(0);
  useEffect(() => {
    const cb = () => bump(n => n + 1);
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  }, []);
  return customFonts;
}
