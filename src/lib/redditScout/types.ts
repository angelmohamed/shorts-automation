// Shared Scout types. The Scout*Post / Scout*Comment shapes are kept STRUCTURALLY COMPATIBLE with
// CanvasGrid's ImportedRedditPost / ImportedRedditComment so a buffered post can be handed straight to
// buildReelsFromThreads (tsc verifies the structural match when that wiring lands in Phase 6).

/** A raw candidate parsed from a subreddit listing (before seen-filter / thresholds / ranking). */
export interface ScoutCandidate {
  id: string;          // Reddit base36 id (no t3_ prefix) — the ledger key
  subreddit: string;
  title: string;
  body: string;        // selftext ('' if none / an image or link post)
  score: number;
  numComments: number;
  createdUtc: number;  // epoch seconds — the review panel derives "age" from this
  over18: boolean;
  stickied: boolean;
  isImage: boolean;    // image/gallery post → excluded in v1 (the format renders a text card)
  permalink: string;   // absolute https url
  author: string;      // without the u/ prefix
}

export interface ScoutRedditPost {
  user: { name: string; avatar?: string };
  timeAgo?: string;
  title: string;
  body?: string;
  score?: string;
  commentCount?: string;
}

export interface ScoutRedditComment {
  user: { name: string; avatar?: string };
  body: string;
  timeAgo?: string;
  score?: string;
  depth: number;
  isOP?: boolean;
}
