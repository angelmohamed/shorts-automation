import type { RedditThreadEdits } from '@/app/components/TikTokCanvas/types';

// Pure application of a user's Reddit-thread text edits (Pick-stage tweaks) — used by the card render
// path AND the YouTube-copy paths, so one edit propagates to the card, the narration (via the card's
// ocrLines) and the description. Unit-tested.

/** THE canonical paragraph splitter — the same function derives the pickable paragraph list and the
    edit indices, so they can never drift. (Blank-line separated, trimmed, empties dropped.) */
export const splitParagraphs = (body?: string): string[] =>
  (body ?? '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

const usable = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0;

/** Translate comment-edit keys from the FLYOUT'S universe (depth-0-filtered list — where edits are
    authored) onto positions in an arbitrary `comments` array (the copy paths hold UNFILTERED arrays:
    the raw /api/reddit response interleaves depth-1 replies; the bulk cache keeps the full tree).
    Without this, one reply ahead of an edited comment shifts every index and the override lands on the
    WRONG comment. Identity when the array is already depth-0-only. Remaps commentOrig alongside. */
export function remapCommentEdits<C extends { depth?: number }>(
  comments: C[],
  edits: RedditThreadEdits | undefined,
): RedditThreadEdits | undefined {
  if (!edits?.comments && !edits?.commentOrig) return edits;
  const d0: number[] = [];
  comments.forEach((c, i) => { if ((c.depth ?? 0) === 0) d0.push(i); });
  const remap = (rec: Record<number, string> | undefined): Record<number, string> | undefined => {
    if (!rec) return undefined;
    const out: Record<number, string> = {};
    for (const [k, v] of Object.entries(rec)) {
      const target = d0[Number(k)];
      if (target !== undefined) out[target] = v;
    }
    return out;
  };
  return { ...edits, comments: remap(edits.comments), commentOrig: remap(edits.commentOrig) };
}

/** Apply edits to an imported thread, returning edited COPIES (inputs untouched) + the labels of any
    SKIPPED overrides (drift guard — surface these, never hide them).
    - Empty/whitespace overrides are ignored (deselection deletes; an empty edit means "revert").
    - Out-of-range indices are ignored (a re-imported thread can shrink).
    - CONTENT ANCHOR: when an edit carries its original text (paraOrig/commentOrig) and the item at that
      index no longer matches, the override is SKIPPED (Reddit content drifted — rewriting whatever now
      sits at the index would corrupt the wrong item). Legacy edits without an anchor apply by index.
    - A title edit collapses newlines (titles are single-line).
    - A paragraph edit collapses internal blank lines — a blank line would SPLIT it into two paragraphs
      on the next import round-trip and shift every later index. */
export function applyThreadEdits<P extends { title: string; body?: string }, C extends { body: string }>(
  post: P,
  comments: C[],
  edits: RedditThreadEdits | undefined,
): { post: P; comments: C[]; skipped: string[] } {
  if (!edits) return { post, comments, skipped: [] };
  const skipped: string[] = [];
  const anchored = (orig: string | undefined, current: string): boolean =>
    orig === undefined || orig.trim() === current.trim();

  let p = post;
  if (usable(edits.title)) p = { ...p, title: edits.title.replace(/\s*\n+\s*/g, ' ').trim() };

  const paraEdits = edits.paras ?? {};
  if (Object.keys(paraEdits).length && p.body) {
    const paras = splitParagraphs(p.body);
    let changed = false;
    const next = paras.map((orig, i) => {
      const e = paraEdits[i];
      if (!usable(e)) return orig;
      if (!anchored(edits.paraOrig?.[i], orig)) { skipped.push(`paragraph ${i + 1}`); return orig; }
      changed = true;
      return e.replace(/\n\s*\n/g, '\n').trim();   // keep single newlines, forbid paragraph splits
    });
    if (changed) p = { ...p, body: next.join('\n\n') };
  }

  const commentEdits = edits.comments ?? {};
  const cs = Object.keys(commentEdits).length
    ? comments.map((c, i) => {
        if (!usable(commentEdits[i])) return c;
        if (!anchored(edits.commentOrig?.[i], c.body)) { skipped.push(`comment ${i + 1}`); return c; }
        return { ...c, body: commentEdits[i].trim() };
      })
    : comments;

  return { post: p, comments: cs, skipped };
}

/** True when `edits` contains at least one usable override — drives the "edited" indicators. */
export function hasThreadEdits(edits: RedditThreadEdits | undefined): boolean {
  if (!edits) return false;
  if (usable(edits.title)) return true;
  return Object.values(edits.paras ?? {}).some(usable) || Object.values(edits.comments ?? {}).some(usable);
}
