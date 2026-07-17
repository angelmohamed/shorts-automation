# Reddit Content Scout — Requirements (v1, finalized)

> Supersedes the original draft. Every open decision from the design Q&A is folded in and marked **[decided]**.
> Scope is **v1**; anything under §10 is explicitly deferred.

## 1. Purpose

Discover popular Reddit posts suited to the "Reddit thread over gameplay footage" YouTube Shorts format, present
the best *unseen* candidates for approval, and **permanently remember every post used or rejected so nothing is
ever suggested twice**. It is the front door to the existing reels pipeline: an approved post becomes a staged reel
that flows through Import → Pick → Narrate → Copy → Export.

## 2. Where it lives  **[decided]**

- A new **"Scout" source node** at the front of the **Pipeline view** (`PipelineView.tsx`), i.e. `ORDER` becomes
  `['scout', 'import', 'pick', 'footage', 'music', 'narrate', 'copy', 'export']`.
- Because the candidate feed is richer than the 320px config drawer the other nodes use, **clicking the Scout node
  opens a wide review panel/modal** (bulk-builder-sized), not the side drawer.
- The node's status line reads e.g. **"12 new · 5 buffered"**.
- The existing manual **Import** (paste a URL) stays alongside it as a second source.
- **Runs locally only** — the whole reels app is run on the user's machine for scouting; the fetch relies on a
  real local browser (see §7).

## 3. Content sources and per-category extraction

The subreddit list is grouped into four categories; the category decides which parts of a post are the "content".
The list + categories live in the **config file** (§6) and can grow without code changes.

- **Category A — Question + replies** (question is the hook, top comments are the content):
  `r/AskReddit`, `r/TooAfraidToAsk` → title + top 2–3 comments · `r/explainlikeimfive` → title + single top answer.
- **Category B — Story / drama** (post body is the content): `r/AmItheAsshole`, `r/tifu`, `r/pettyrevenge`,
  `r/MaliciousCompliance` → title + full body (+ optional top comment). **Body word-count is recorded and long
  bodies are flagged** (see §4.3) so they can be trimmed/split later.
- **Category C — Quick-hit one-liners:** `r/Showerthoughts` → title (+ optional 1–2 replies) ·
  `r/TwoSentenceHorror` → **title AND body together** (sentence 1 = title, sentence 2 = body; both required) ·
  `r/rareinsults`, `r/BrandNewSentence` → **image posts, EXCLUDED in v1** (see §10).
- **Category D — Engagement bait:** `r/unpopularopinion` → title + body (+ optional top disagreeing comment) ·
  `r/wouldyourather` → title (the question itself); comments optional (the video ends on the question).

> **v1 capture policy [decided]:** the Scout **captures everything** (full body + all fetched top comments) and
> the human picks what to narrate later in the existing bulk builder. It does **not** pre-trim to the category —
> the category only drives which parts are *surfaced/flagged*, not what is discarded.

## 4. Core functional requirements

### 4.1 Fetching  **[decided: puppeteer transport, on-demand]**
- Pull top posts per subreddit over a configurable timeframe (**default: `top?t=week`**), configurable count per
  subreddit (**default ~40**).
- Fetching is **on-demand** ("Scout now"); no scheduler in v1.
- Reddit's anonymous `.json` API returns **403 as of May 2026** (policy/fingerprint block, not rate — see §7), so
  all fetches go through the app's **existing real-browser transport `redditBrowserJson(path)`**
  (`src/lib/redditBrowser.ts`), which already returns clean JSON from a real headless-Chrome session.
- Politeness: ~1s pause between requests; on a subreddit failure, **skip it and continue — never crash**.

### 4.2 Popularity filtering
- Discard posts below a **per-subreddit minimum upvote threshold** (config), because subreddit sizes differ wildly
  (a mediocre r/AskReddit post outscores a great r/TwoSentenceHorror post — a single global threshold starves the
  smaller subs).

### 4.3 Safety / quality filtering
- Exclude **NSFW**-flagged posts by default (config switch).
- Always exclude **stickied / moderator** posts.
- Exclude **image-only** posts in v1 (the format renders a text card).
- **Long-story flag [decided]:** for Category B, record the body word count and flag posts whose estimated
  narration would exceed a Short (reuse the `reelDuration` estimate model). Surface the flag; never auto-remove.
- **No profanity/demonetization flag in v1** (deferred to §10).

### 4.4 Memory / no-repeat guarantee (**the most important requirement**)  **[decided: Supabase]**
- Every post the user **decides** on is recorded in **Supabase** (a fresh project — §5) with: Reddit **post id**,
  **status** `used | rejected`, **decided_at**, **title** (readability), and **subreddit**.
- Any post id in this store is **never suggested again, in any future session, permanently.**
- **Skipped** posts are **not** recorded and may reappear later.
- **Shared ledger [decided]:** building a reel from *any* Reddit post — the Scout **or** the manual bulk
  builder/paste path — records that post id as `used`, so the Scout can never surface something already made.
- Durable across restarts; deliberately resettable (truncate the table); hard to lose accidentally (hosted DB).

### 4.5 Ranking & presentation
- New (previously unseen) candidates presented **best-first by popularity**, **interleaved across categories**
  (round-robin so no single sub dominates) — **[decided]**.
- **Default session size ~25 candidates**, configurable.
- Each card shows: subreddit, title preview, upvotes, comment count, post age, and any flags (e.g. "long", "image"
  — image hidden in v1).

### 4.6 User decisions
- Per candidate: **Use**, **Reject**, **Skip** (undecided), **Open** (the reddit permalink in a new tab).
- **Session-level undo** of the last decision (guards against misclicks) before it's committed permanently.

### 4.7 Buffer + build  **[decided]**
- **Use** → the post enters an **approved buffer** *and* its id is written `used` to Supabase immediately.
- A **"Build N reels"** action turns the buffer into staged reels by calling the existing
  `buildReelsFromThreads(threads[])` (`CanvasGrid.tsx`), where each thread supplies
  `{ url, post: ImportedRedditPost, comments: ImportedRedditComment[], selectedComments, selectedParas }`.
- Built reels arrive with footage + a rendered card and flow into Pick → Narrate → … as today.

### 4.8 Output package captured on "Use"
For each used post, capture (per the reel-build shape and for the durable record): title, full body text (if any),
top **N comments (default 3)** with author + upvote count — **excluding** deleted/removed, stickied moderator, and
bot comments (e.g. `AutoModerator`) — the permalink, and stats (score, comment count, age, subreddit). Identifiable
by `subreddit + post id`.

## 5. Data model

### 5.1 Supabase (fresh project) — the no-repeat ledger
```
table reddit_seen
  post_id      text  primary key      -- Reddit "t3_" id (or the base36 id)
  status       text  not null         -- 'used' | 'rejected'
  subreddit    text  not null
  title        text  not null
  decided_at   timestamptz not null default now()
```
- Read path: filter fetched candidates by `post_id NOT IN (select post_id from reddit_seen)`.
- Write path: `Use`/`Reject` upsert one row; the shared-ledger hook upserts `used` when a reel is built.
- Access is local-only via the Supabase JS client + project URL/anon key in `.env.local` (RLS can be permissive
  for a single-user local tool, or a service key kept server-side — decided at build time in Phase 0).

### 5.2 In-app shapes (reuse existing types)
- `ImportedRedditPost = { user:{name,avatar?}, timeAgo?, title, body?, score?, commentCount? }`
- `ImportedRedditComment = { user:{name,avatar?}, body, timeAgo?, score?, depth, isOP? }`
- `framingMap[reelId].redditThread = { url, comments?, paras? }` — how a built reel remembers its source (drives
  the shared-ledger `used` write).

## 6. Configuration  **[decided: typed config file]**

A single typed config file (e.g. `src/lib/redditScout/config.ts`) — version-controlled, hot-reloaded, editable
without touching core logic:
- subreddit list, each with its **category** and **per-sub min score**
- **timeframe** (`t=week` default), **posts fetched per sub** (~40), **N comments captured** (3)
- **NSFW inclusion** switch, **session size** (~25), **long-story threshold** (seconds)

## 7. Technical constraints & known pitfalls (verified)

- **Anonymous `.json` is dead (403, since ~May 2026)** — the block is policy + TLS-fingerprint + IP-reputation,
  *not* rate, so User-Agents/throttling don't help and cloud IPs are blocked. **→ use `redditBrowserJson` (real
  local Chrome).** OAuth was considered but rejected for v1: it now requires a **2–4 week manual approval** and its
  free tier is **non-commercial only**.
- **Comment endpoint returns two listings**: `[0]` = the submission, `[1]` = the comment tree. Comments carry a
  `depth` field (top-level = 0). `replies` is `""` when none, else a listing, and may end in a `kind:"more"` object
  — ignore "more" for v1 (we only need the top N).
- **Edge cases:** image-only posts (excluded v1), deleted/removed content (skip in extraction), empty result set
  (surface a hint: widen timeframe / lower thresholds), individual subreddits failing to load (skip + continue).
- Scraping via a real browser is **against Reddit's API terms** and is inherently more fragile than OAuth; this is
  an accepted v1 tradeoff (the app already relies on it for imports).

## 8. Integration with the reels studio

- **Fetch:** `redditBrowserJson('/r/<sub>/top.json?t=week&limit=40')` and
  `redditBrowserJson('/comments/<id>.json?raw_json=1&limit=<N>')`; parse with logic mirroring `flattenComments`
  (`src/app/api/reddit/route.ts`).
- **Build:** buffer → `buildReelsFromThreads(...)`.
- **Ledger hook:** wherever a reel gains/holds a `redditThread.url`, extract the post id and upsert `used`.
- **UI:** a `'scout'` entry in `PipelineView`'s `ORDER` + a wide review panel; reuse the app's tokens/components.

## 9. Success criteria

- Running "Scout now" returns a ranked, interleaved list of **only unseen** candidates across the configured subs,
  degrading gracefully when a sub fails.
- Use/Reject persist to Supabase and the post never reappears — across restarts and across the manual build path.
- "Build N reels" produces staged reels indistinguishable from manually-built ones.
- No global crash on any single fetch/parse failure.

## 10. Out of scope for v1 (phase-2)

AI suitability scoring · near-duplicate/rephrase detection · auto-generated titles/hooks · part-splitting
assistant · **image posts** (r/rareinsults, r/BrandNewSentence) · **profanity/demonetization flag** · **OAuth Data
API** (swap-in later if approved) · scheduled/cron fetching.
