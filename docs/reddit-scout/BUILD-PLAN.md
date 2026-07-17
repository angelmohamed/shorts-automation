# Reddit Content Scout — Build Plan (v1)

Incremental phases, each independently **typecheck + test + verify**-able. Pure logic (config, parsers, ranking,
ledger-filter) is unit-tested with vitest; the whole feature gets an adversarial review at the end. Per the
project rule, **web-verify any external assumption before asserting it** (Reddit response shapes, Supabase client
API, etc.) — the anonymous-`.json` 403 and the OAuth approval gate were already verified during design.

New code lives under `src/lib/redditScout/` (pure/server logic) + `src/app/api/reddit-scout/` (routes) +
`src/app/components/` (the panel). No existing behavior changes except: adding `'scout'` to `PipelineView`'s
`ORDER`, and one shared-ledger hook on the reel-build path.

---

## Phase 0 — Supabase project + ledger client
**Goal:** a durable no-repeat store you can read/write locally.
1. Create the **new Supabase project** (your new account). Create the `reddit_seen` table (see REQUIREMENTS §5.1).
2. `npm i @supabase/supabase-js`. Add to `.env.local`: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (server-only — the
   Scout runs server-side in an API route, so a service key kept out of the client is simplest and avoids RLS
   fuss for a single-user local tool). Add both to `.gitignore` coverage (already ignored via `.env*`).
3. `src/lib/redditScout/ledger.ts`: a lazily-created Supabase client + `getSeenIds(): Promise<Set<string>>`,
   `markDecision(post: {id,subreddit,title}, status): Promise<void>` (upsert on `post_id`).
**Verify:** a throwaway script (or a `*.test.ts` gated behind an env flag) inserts + reads a row; confirm a second
insert of the same `post_id` upserts (no dup). Do **not** put live-DB calls in the default `npm test` run.

## Phase 1 — Config file
**Goal:** all knobs in one typed, hot-reloadable place.
- `src/lib/redditScout/config.ts`: `SUBREDDITS: { name, category: 'A'|'B'|'C'|'D', minScore }[]`, `TIMEFRAME`,
  `POSTS_PER_SUB`, `COMMENTS_PER_POST`, `INCLUDE_NSFW`, `SESSION_SIZE`, `LONG_STORY_SECONDS`. Seed with the §3 list
  (image subs present but flagged `image:true` so they're filtered in v1).
**Verify (test):** `config.test.ts` — unique sub names, every sub has a valid category + positive minScore,
sane defaults. (Pure; catches typos in the list.)

## Phase 2 — Fetch adapter (puppeteer) + parsers
**Goal:** turn subreddit listings + comment trees into candidate objects, reusing the working transport.
- `src/lib/redditScout/source.ts` (server-only):
  - `interface RedditScoutSource { fetchTop(sub, t, limit): Promise<RawPost[]>; fetchComments(id, n): Promise<ImportedRedditComment[]> }`
  - `browserSource`: `fetchTop` → `redditBrowserJson('/r/'+sub+'/top.json?t='+t+'&limit='+limit+'&raw_json=1')`;
    `fetchComments` → `redditBrowserJson('/comments/'+id+'.json?raw_json=1&limit='+n)` and read **listing [1]**.
- `src/lib/redditScout/parse.ts` (PURE, no I/O — the testable core):
  - `parseListing(json): Candidate[]` → map `data.children[].data` to `{ id, subreddit, title, body, score,
    numComments, createdUtc, over18, stickied, isImage, permalink, author }`.
  - `topComments(commentsJson, n): ImportedRedditComment[]` → from listing [1], drop deleted/removed
    (`[deleted]`/`[removed]`), stickied, and bots (`AutoModerator` + a small botlist); take top N by score with
    `depth===0`. Mirror `flattenComments` in `src/app/api/reddit/route.ts` for parity.
  - `toImportedPost(candidate): ImportedRedditPost` (shape the build needs).
**Verify (tests):** `parse.test.ts` with **captured real JSON fixtures** (save one listing + one comment tree to
`__fixtures__/`): asserts field mapping, deleted/bot/sticky exclusion, top-N-by-score, image/nsfw/sticky flags,
empty-`replies` (`""`) handling, and a `kind:"more"` tail is ignored. Web-verify the two-listing + `depth`/`replies`
shape (already confirmed in design) so expectations are grounded, not copied.

## Phase 3 — No-repeat filter + shared-ledger hook
**Goal:** never surface a seen post; mark every built post used (both paths).
- `src/lib/redditScout/filter.ts` (PURE): `filterUnseen(candidates, seenIds): Candidate[]`;
  `applyThresholds(candidates, config): Candidate[]` (per-sub minScore, NSFW switch, drop sticky/image).
- **Shared-ledger hook:** in `CanvasGrid.tsx`, where a reel is built with a `redditThread.url` (bulk builder AND
  the future Scout build), extract the post id from the url and `markDecision(..., 'used')`. Centralize as
  `markRedditUsed(url, title, subreddit)`.
**Verify (tests):** `filter.test.ts` — seen removal, per-sub threshold (small sub kept vs starved by a global),
NSFW switch, sticky/image drop, empty result. A url→id extractor test (permalink + short + `t3_` forms).

## Phase 4 — Ranking / session assembly
**Goal:** the interesting logic — best-first, interleaved, capped.
- `src/lib/redditScout/rank.ts` (PURE): `assembleSession(candidates, config): Candidate[]` → group by category,
  sort each by score desc, **round-robin interleave** across categories, cap at `SESSION_SIZE`.
**Verify (tests):** `rank.test.ts` — interleave order (no category dominates), stable tie-breaking, cap respected,
fewer-than-cap and empty inputs, a single hot category not crowding others. **These assert first-principles
expectations (a failing test = a real bug), never the impl's output.**

## Phase 5 — Scout API route
**Goal:** one server endpoint the panel calls.
- `src/app/api/reddit-scout/route.ts`:
  - `GET` (or POST `{action:'scan'}`): for each sub → `fetchTop` (≈1s spacing, per-sub try/catch skip-on-fail) →
    `parseListing` → `applyThresholds` → `filterUnseen(getSeenIds())` → `fetchComments` for the survivors →
    `assembleSession`. Returns `{ candidates, failedSubs }`.
  - `POST {action:'decide', id, status, subreddit, title}` → `markDecision`.
**Verify:** hit the route locally (`curl`/browser) → returns a real session; a decide call persists to Supabase and
the id drops out of the next scan. Confirm a killed subreddit yields `failedSubs` not a 500.

## Phase 6 — Scout node + review panel (UI)
**Goal:** the approval surface.
- Add `'scout'` to `PipelineView` `ORDER` + `META` (Source, "Scout", "Discover Reddit posts"); status
  `"N new · M buffered"`; clicking it opens a **wide panel/modal** (reuse the bulk-builder modal frame), NOT the
  drawer.
- Panel: **"Scout now"** button → calls the route; a scrollable feed of candidate cards (sub · title · ▲score ·
  💬count · age · flags); per-card **Use / Reject / Skip / Open**; a **buffer tray** with count + **"Build N
  reels"**; **undo last decision** (before the next scan). Use → `decide('used')` + push to buffer; Reject →
  `decide('rejected')`; Skip → local dismiss only; Open → `window.open(permalink)`.
- **Build N reels** → map buffer → `buildReelsFromThreads(threads[])` (each: `toImportedPost`, its `comments`,
  empty `selectedComments/Paras` so the user picks in the bulk builder), then clear the buffer.
**Verify:** tsc + eslint clean; `npm run dev` → flip to Pipeline → Scout node → panel opens, cards render, decisions
round-trip, Build stages reels that flow into Pick→Export. Clean up any test Chrome after.

## Phase 7 — Flags, empty-states, polish
- Long-story flag: reuse `estimateNarrationSeconds` (`src/lib/reelDuration.ts`) on the body; flag `> LONG_STORY_SECONDS`.
- Empty session → panel hint: "No new candidates — widen the timeframe or lower thresholds in config."
- Loading / per-sub-failure surfacing; disable Build while a scan runs.
**Verify (test):** long-story flag boundary in `rank.test.ts`/`flag.test.ts`.

## Phase 8 — Full tests + adversarial review
- Ensure `npm test` covers: `config`, `parse` (fixtures), `filter`, `rank`, url→id, long-story flag — all
  first-principles, bug-hunting (not pass-engineered). Report any bug the tests catch.
- Run an **adversarial review workflow** (find → verify → synthesize) over the feature: no-repeat guarantee holds
  across restarts + the manual path; skip-not-recorded; graceful sub-failure; buffer/build correctness; the shared
  ledger id-extraction; no regression to the existing pipeline/canvas. Fix confirmed findings.
**Verify:** all green; review verdict "safe to ship"; then commit + push.

---

### Dependency / order notes
- Phases **1, 2 (parsers), 3 (filter), 4** are pure/server and fully unit-testable **before any UI** — do these
  first and lock them with tests.
- Phase **0** (Supabase) is independent — do it whenever the table's needed (before Phase 3's live filter / Phase
  5's route).
- Phase **6** (UI) depends on 4 + 5. Phase **8** last.
- **Swap-in later (not v1):** if the OAuth request is ever approved, add an `oauthSource` implementing the same
  `RedditScoutSource` interface and switch a config flag — no other code changes.
