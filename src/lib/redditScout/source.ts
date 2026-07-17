import 'server-only';
import { redditBrowserJson } from '@/lib/redditBrowser';

// The fetch adapter. A swappable interface so the transport can change without touching parsing/ranking:
// v1 = the real-browser transport (dodges Reddit's May-2026 anonymous .json 403); if the OAuth Data API
// request is ever approved, add an `oauthSource` implementing the same interface and switch a flag.
//
// Returns RAW json (unknown) — all shaping happens in the pure parsers (parse.ts), which are unit-tested.

export interface RedditScoutSource {
  /** Raw `top` listing for a subreddit over `timeframe` (t=hour|day|week|month|year|all). */
  fetchTopRaw(subreddit: string, timeframe: string, limit: number): Promise<unknown>;
  /** Raw comments response for a post id (the two-listing array). `sort=top` so the best rise first. */
  fetchCommentsRaw(postId: string, limit: number): Promise<unknown>;
}

export const browserSource: RedditScoutSource = {
  fetchTopRaw: (subreddit, timeframe, limit) =>
    redditBrowserJson(`/r/${encodeURIComponent(subreddit)}/top.json?t=${encodeURIComponent(timeframe)}&limit=${limit}&raw_json=1`),
  // depth=1: reddit's `limit` budgets the WHOLE tree (replies included), so without it a reply-heavy
  // thread could starve the top-level pool topComments() draws from. depth=1 spends the entire budget
  // on top-level comments — which is all the parser keeps anyway.
  fetchCommentsRaw: (postId, limit) =>
    redditBrowserJson(`/comments/${encodeURIComponent(postId)}.json?raw_json=1&limit=${limit}&sort=top&depth=1`),
};
