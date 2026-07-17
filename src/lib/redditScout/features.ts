// Decision FEATURES — what the candidate looked like at decide time, stored alongside the label
// (used/rejected) so every decision becomes a training row for the future learned ranker (§10).
// Pure sanitization — unit-tested; the route never writes unvalidated client input.

/** Reddit's own selftext ceiling (40,000 chars) — anything longer is malformed input, clamped. */
export const MAX_BODY_CHARS = 40_000;
/** Reddit's title ceiling (300 chars). */
export const MAX_TITLE_CHARS = 300;

export interface DecisionFeatures {
  body?: string;
  score?: number;
  numComments?: number;
  createdUtc?: number;
  category?: string;
}

/** Clamp + make a string Postgres-safe: length-capped, well-formed UTF-16 (a cap that bisects a
    surrogate pair would emit a lone surrogate, which Postgres REJECTS — the whole write would 500),
    and NUL-free (U+0000 is fatal to Postgres text columns). */
export function cleanText(v: unknown, maxChars: number): string {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return v.slice(0, maxChars).toWellFormed().replace(/\u0000/g, '');
}

// STRICT number gate: no coercion — Number(null)=0 / Number(true)=1 / Number([7])=7 would FABRICATE
// feature values from JSON junk (a fake "0 upvotes" is a poisoned training row, worse than absent).
// int4 columns bound score/numComments; createdUtc must look like epoch SECONDS (not ms).
const INT4_MAX = 2_147_483_647;
const EPOCH_SECONDS_MAX = 10_000_000_000;   // ~year 2286; an epoch-ms value fails this → dropped
const intOrUndef = (v: unknown, min: number, max: number): number | undefined => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const n = Math.floor(v);
  return n >= min && n <= max ? n : undefined;
};

/** Sanitize client-sent candidate features. `category` is NOT taken from the client — the route derives
    it server-side from the subreddit via config (pass it in). Returns undefined when nothing usable
    survives, so callers can distinguish "no features" (mark-used path) from "empty features". */
export function sanitizeDecisionFeatures(
  raw: Record<string, unknown>,
  category: string | undefined,
): DecisionFeatures | undefined {
  const out: DecisionFeatures = {};
  const body = cleanText(raw.body, MAX_BODY_CHARS);
  if (body) out.body = body;
  const score = intOrUndef(raw.score, -INT4_MAX, INT4_MAX);      // negative is legal (downvoted posts)
  if (score !== undefined) out.score = score;
  const numComments = intOrUndef(raw.numComments, 0, INT4_MAX);
  if (numComments !== undefined) out.numComments = numComments;
  const createdUtc = intOrUndef(raw.createdUtc, 1, EPOCH_SECONDS_MAX);
  if (createdUtc !== undefined) out.createdUtc = createdUtc;
  if (category) out.category = category;
  return Object.keys(out).length ? out : undefined;
}
