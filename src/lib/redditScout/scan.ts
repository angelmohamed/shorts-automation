import type { RedditScoutSource } from './source';   // type-only: never pulls source.ts (server-only) at runtime
import type { ScoutCandidate } from './types';
import {
  SCOUT_SUBREDDITS, SCOUT_TIMEFRAME, SCOUT_POSTS_PER_SUB, SCOUT_INCLUDE_NSFW,
  SCOUT_SESSION_SIZE, SCOUT_REQUEST_GAP_MS, type ScoutSubreddit,
} from './config';
import { parseListing } from './parse';
import { applyThresholds, filterUnseen } from './filter';
import { assembleSession } from './rank';

// The scan orchestrator (REQUIREMENTS §4.1/§4.5): fetch each configured sub's top listing (politeness
// gap between requests, skip-a-failing-sub-and-continue), then thresholds → no-repeat filter → session
// assembly. Dependency-injected (source, ledger read, sleep, knobs) so it unit-tests without network.
//
// DELIBERATE: a ledger read failure REJECTS the whole scan. Scanning "blind" would surface posts the
// user already used/rejected — silently violating §3.4, the single most important requirement. A loud
// failure ("fix Supabase / .env.local") is strictly better than a quiet repeat. The ledger is read
// twice: a preflight (fail fast, before any Reddit fetch) and a post-loop fresh read (so decisions
// recorded during the 15-25s scan window are still filtered out of the returned session).

export interface ScanDeps {
  getSeenIds(): Promise<Set<string>>;
  sleep?(ms: number): Promise<void>;
  subs?: ScoutSubreddit[];
  timeframe?: string;
  postsPerSub?: number;
  includeNsfw?: boolean;
  sessionSize?: number;
  gapMs?: number;
}

export interface ScanResult {
  candidates: ScoutCandidate[];
  failedSubs: string[];
  /** Funnel counts so the panel can hint correctly on an empty session (§5 edge case): nothing fetched
      (subs failing?) vs everything filtered (thresholds too high?) vs everything already seen. */
  stats: { subsScanned: number; fetched: number; afterThresholds: number; afterSeen: number };
}

export async function runScan(source: RedditScoutSource, deps: ScanDeps): Promise<ScanResult> {
  const subs = deps.subs ?? SCOUT_SUBREDDITS;
  const active = subs.filter(s => !s.image);                     // image subs are excluded in v1 — never fetched
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const gapMs = deps.gapMs ?? SCOUT_REQUEST_GAP_MS;

  // §3.4 twice over: a cheap PREFLIGHT read fails FAST (a broken ledger shouldn't cost a 20s scan first),
  // and the FILTERING read happens AFTER the listing loop — so a Use/Reject decided mid-scan, or the
  // shared-ledger mark-used hook firing from a concurrent reel build, is still filtered from this session.
  await deps.getSeenIds();

  const fetched: ScoutCandidate[] = [];
  const failedSubs: string[] = [];
  for (let i = 0; i < active.length; i++) {
    if (i > 0) await sleep(gapMs);                               // politeness gap BETWEEN requests (not before the first)
    const sub = active[i];
    try {
      const raw = await source.fetchTopRaw(sub.name, deps.timeframe ?? SCOUT_TIMEFRAME, deps.postsPerSub ?? SCOUT_POSTS_PER_SUB);
      fetched.push(...parseListing(raw));
    } catch (e) {
      console.error(`[scout] listing failed for r/${sub.name}:`, e instanceof Error ? e.message : e);
      failedSubs.push(sub.name);                                  // skip and continue — never crash the scan
    }
  }

  const afterThresholds = applyThresholds(fetched, subs, deps.includeNsfw ?? SCOUT_INCLUDE_NSFW);
  const seen = await deps.getSeenIds();                           // FRESH read post-loop; rejection propagates
  const afterSeen = filterUnseen(afterThresholds, seen);
  const candidates = assembleSession(afterSeen, subs, deps.sessionSize ?? SCOUT_SESSION_SIZE);

  return {
    candidates,
    failedSubs,
    stats: {
      subsScanned: active.length - failedSubs.length,
      fetched: fetched.length,
      afterThresholds: afterThresholds.length,
      afterSeen: afterSeen.length,
    },
  };
}
