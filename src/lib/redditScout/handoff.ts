import type { ScoutCandidate } from './types';

// Pure pieces of the Scout → Import handoff, extracted so the NO-ORPHANS invariant is unit-tested
// (its previous suite died with the direct-build path): a Use marks the ledger 'used' immediately, so a
// buffered post may only leave the buffer when a REEL actually exists for it (release-at-build) — and
// every url-matching step on the way there must be exact and total.

/** Canonical thread key (mirrors the server's resolveThreadId): the base36 post id when present, else a
    normalised host+path — so www/old/np, trailing-slash and ?utm variants of one thread dedup together. */
export function canonicalThreadKey(u: string): string {
  try {
    const url = new URL(u);
    const host = url.hostname.replace(/^(www|old|new|np)\./, '');
    const parts = url.pathname.split('/').filter(Boolean);
    const ci = parts.indexOf('comments');
    if (ci >= 0 && parts[ci + 1]) return parts[ci + 1].toLowerCase();
    if (host === 'redd.it') return (parts[0] ?? u).toLowerCase();
    return (host + url.pathname.replace(/\/$/, '')).toLowerCase();
  } catch { return u.trim().toLowerCase(); }
}

/** Split raw link text into { toImport, alreadyPresent, invalid }:
    - non-reddit / junk tokens → invalid (never imported, never reported present)
    - canonical-duplicates of `existingKeys` → alreadyPresent (their thread is already in the builder)
    - canonical-duplicates WITHIN the batch → collapsed to the first occurrence. */
export function partitionImportUrls(
  rawText: string,
  existingKeys: Set<string>,
): { toImport: string[]; alreadyPresent: string[]; invalid: string[] } {
  const toImport: string[] = [];
  const alreadyPresent: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const token of rawText.split(/\s+/).map(t => t.trim()).filter(Boolean)) {
    if (!/reddit\.com|redd\.it/.test(token)) { invalid.push(token); continue; }
    const k = canonicalThreadKey(token);
    if (existingKeys.has(k)) { alreadyPresent.push(token); continue; }
    if (seen.has(k)) continue;
    seen.add(k);
    toImport.push(token);
  }
  return { toImport, alreadyPresent, invalid };
}

/** Release buffered candidates whose permalink is in `urls` (exact string match — BulkThread.url is the
    raw queued permalink, so equality holds end-to-end). Everything else stays buffered. */
export function releaseByUrls(buffer: ScoutCandidate[], urls: string[]): ScoutCandidate[] {
  const s = new Set(urls);
  return buffer.filter(c => !s.has(c.permalink));
}

/** Restore the persisted buffer, accepting the current shape (bare ScoutCandidate) AND the legacy
    pre-handoff shape ({candidate, comments}); entries without a usable reddit permalink are dropped —
    an unmatchable permalink could never be released and would sit "buffered" forever. */
export function migrateScoutBuffer(raw: unknown): ScoutCandidate[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(e => {
      if (e && typeof e === 'object' && typeof (e as ScoutCandidate).id === 'string') return e as ScoutCandidate;
      const legacy = (e as { candidate?: ScoutCandidate } | null)?.candidate;
      return legacy && typeof legacy.id === 'string' ? legacy : null;
    })
    .filter((c): c is ScoutCandidate =>
      !!c && typeof c.permalink === 'string' && /reddit\.com|redd\.it/.test(c.permalink));
}
