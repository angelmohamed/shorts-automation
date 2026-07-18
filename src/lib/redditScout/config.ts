// Reddit Content Scout — configuration (REQUIREMENTS §6). Every knob lives here so behaviour is
// editable without touching core logic. Edit freely; the dev server hot-reloads it.

/** Which parts of a post are the "content" (drives surfacing/flags, never what gets captured —
    v1 captures everything and the human picks in the bulk builder):
    A = question + top replies · B = story body (word-count flagged) · C = quick one-liner · D = engagement bait */
export type ScoutCategory = 'A' | 'B' | 'C' | 'D';

export interface ScoutSubreddit {
  name: string;            // without the r/ prefix
  category: ScoutCategory;
  /** Per-sub floor because sizes differ enormously — a mediocre r/AskReddit post outscores an excellent
      r/TwoSentenceHorror post, so one global threshold would starve the smaller subs. Defaults are tiered
      roughly by subscriber count (AskReddit 45M+ … wouldyourather ~1M); tune to taste. */
  minScore: number;
  /** Image-first subs are excluded in v1 (the format renders a text card); kept in the list so enabling
      them later is a one-flag change. */
  image?: boolean;
}

export const SCOUT_SUBREDDITS: ScoutSubreddit[] = [
  // Category A — question + replies
  { name: 'AskReddit',           category: 'A', minScore: 5000 },
  { name: 'TooAfraidToAsk',      category: 'A', minScore: 1000 },
  { name: 'NoStupidQuestions',   category: 'A', minScore: 1500 },   // ~7.3M members
  { name: 'explainlikeimfive',   category: 'A', minScore: 2000 },
  // Category B — story / drama (body word-count flagged for part-splitting)
  { name: 'AmItheAsshole',       category: 'B', minScore: 2000 },
  { name: 'tifu',                category: 'B', minScore: 2000 },
  { name: 'pettyrevenge',        category: 'B', minScore: 800 },
  { name: 'MaliciousCompliance', category: 'B', minScore: 800 },
  // Category C — quick-hit one-liners
  { name: 'Showerthoughts',      category: 'C', minScore: 2000 },
  { name: 'TwoSentenceHorror',   category: 'C', minScore: 800 },
  { name: 'rareinsults',         category: 'C', minScore: 1500, image: true },   // excluded in v1
  { name: 'BrandNewSentence',    category: 'C', minScore: 1000, image: true },   // excluded in v1
  // Category D — engagement bait
  { name: 'unpopularopinion',    category: 'D', minScore: 1000 },
  { name: 'wouldyourather',      category: 'D', minScore: 300 },
];

/** Listing timeframe (`top?t=…`). */
export const SCOUT_TIMEFRAME: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all' = 'week';

/** Posts fetched per subreddit before filtering. */
export const SCOUT_POSTS_PER_SUB = 40;

/** Include NSFW-flagged posts (off by default). */
export const SCOUT_INCLUDE_NSFW = false;

/** Candidates surfaced per session (interleaved across categories, best-first within each). */
export const SCOUT_SESSION_SIZE = 25;

/** Category-B bodies whose estimated narration exceeds this get a "long" flag (trim / part 1+2 candidate).
    180s = the YouTube Shorts ceiling; the estimate model lives in src/lib/reelDuration.ts. */
export const SCOUT_LONG_STORY_SECONDS = 180;

/** Pause between Reddit requests (politeness — the transport is a real browser session, still be gentle). */
export const SCOUT_REQUEST_GAP_MS = 1000;
