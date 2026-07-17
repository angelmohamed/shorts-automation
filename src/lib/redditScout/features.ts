// Decision FEATURES — what the candidate looked like at decide time, stored alongside the label
// (used/rejected) so every decision becomes a training row for the future learned ranker (§10).
// Pure sanitization — unit-tested; the route never writes unvalidated client input.

/** Reddit's own selftext ceiling (40,000 chars) — anything longer is malformed input, clamped. */
export const MAX_BODY_CHARS = 40_000;

export interface DecisionFeatures {
  body?: string;
  score?: number;
  numComments?: number;
  createdUtc?: number;
  category?: string;
}

const intOrUndef = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.floor(n) : undefined;   // floats floored; NaN/±Infinity/junk dropped
};

/** Sanitize client-sent candidate features. `category` is NOT taken from the client — the route derives
    it server-side from the subreddit via config (pass it in). Returns undefined when nothing usable
    survives, so callers can distinguish "no features" (mark-used path) from "empty features". */
export function sanitizeDecisionFeatures(
  raw: Record<string, unknown>,
  category: string | undefined,
): DecisionFeatures | undefined {
  const out: DecisionFeatures = {};
  if (typeof raw.body === 'string' && raw.body.length > 0) out.body = raw.body.slice(0, MAX_BODY_CHARS);
  const score = intOrUndef(raw.score);
  if (score !== undefined) out.score = score;              // negative is legal (downvoted posts)
  const numComments = intOrUndef(raw.numComments);
  if (numComments !== undefined && numComments >= 0) out.numComments = numComments;
  const createdUtc = intOrUndef(raw.createdUtc);
  if (createdUtc !== undefined && createdUtc > 0) out.createdUtc = createdUtc;
  if (category) out.category = category;
  return Object.keys(out).length ? out : undefined;
}
