import type { ScoutCandidate } from './types';
import type { ScoutCategory, ScoutSubreddit } from './config';

// Session assembly (REQUIREMENTS §4.5): best-first by popularity, interleaved so no single SUB or
// category dominates a session. Standard greedy diversity re-ranking, applied hierarchically:
//   outer: categories rotate A→B→C→D (skipping exhausted ones);
//   inner: within a category, its SUBS rotate too — so AskReddit (whose top-week scores are 10–100×
//   TooAfraidToAsk's) can't monopolise category A's slots, mirroring the per-sub-threshold rationale
//   in config.ts (raw scores aren't comparable across subs of very different sizes).
// Sub queues inside a category are ordered by their best candidate, so a category's FIRST surfaced
// post is still its best overall. Pure — no I/O.

/** Deterministic candidate order: score desc → newer first → id asc. Explicit tiebreaks so the session
    never depends on the incoming listing order (sort stability alone wouldn't make cross-fetch runs
    reproducible). */
export function compareCandidates(a: ScoutCandidate, b: ScoutCandidate): number {
  return b.score - a.score || b.createdUtc - a.createdUtc || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Fixed rotation order — deterministic and covers every category. */
const CATEGORY_ORDER: ScoutCategory[] = ['A', 'B', 'C', 'D'];

/** Interleave candidates across categories AND across subs within each category (nested round-robin,
    skipping exhausted queues), best-first within each sub, capped at `sessionSize`. Candidates from
    unconfigured subs are dropped defensively (applyThresholds already removes them). */
export function assembleSession(
  candidates: ScoutCandidate[],
  subs: ScoutSubreddit[],
  sessionSize: number,
): ScoutCandidate[] {
  if (sessionSize <= 0) return [];

  // Bucket per sub (lowercased key), best-first within each sub.
  const catBySub = new Map(subs.map(s => [s.name.toLowerCase(), s.category]));
  const bySub = new Map<string, ScoutCandidate[]>();
  for (const c of candidates) {
    const key = c.subreddit.toLowerCase();
    if (!catBySub.has(key)) continue;
    const arr = bySub.get(key) ?? [];
    if (!arr.length) bySub.set(key, arr);
    arr.push(c);
  }
  for (const arr of bySub.values()) arr.sort(compareCandidates);

  // Each category holds a rotation of its subs' queues, ordered by each queue's best head. A duplicated
  // config name attaches its queue once (never duplicate candidates); a category value missing from
  // CATEGORY_ORDER simply never attaches (defensive — cannot crash or hang, see `remaining` below).
  const queuesByCat = new Map<ScoutCategory, ScoutCandidate[][]>(CATEGORY_ORDER.map(c => [c, []]));
  const attached = new Set<string>();
  for (const s of subs) {
    const key = s.name.toLowerCase();
    if (attached.has(key)) continue;
    attached.add(key);
    const q = bySub.get(key);
    if (q?.length) queuesByCat.get(s.category)?.push(q);
  }
  for (const qs of queuesByCat.values()) qs.sort((a, b) => compareCandidates(a[0], b[0]));

  // `remaining` counts only ATTACHED queues, so the loop can never spin on unreachable candidates.
  let remaining = 0;
  for (const qs of queuesByCat.values()) for (const q of qs) remaining += q.length;

  const out: ScoutCandidate[] = [];
  const cursor = new Map<ScoutCategory, number>(CATEGORY_ORDER.map(c => [c, 0]));
  for (let qi = 0; out.length < sessionSize && remaining > 0; qi++) {
    const cat = CATEGORY_ORDER[qi % CATEGORY_ORDER.length];
    const qs = queuesByCat.get(cat)!;
    const start = cursor.get(cat)!;
    for (let k = 0; k < qs.length; k++) {
      const q = qs[(start + k) % qs.length];
      if (!q.length) continue;                       // this sub exhausted → try the category's next sub
      out.push(q.shift()!);
      remaining--;
      cursor.set(cat, (start + k + 1) % qs.length);  // next turn for this category starts at the next sub
      break;
    }
    // No non-empty sub queue in this category → exhausted; the outer rotation moves on.
  }
  return out;
}
