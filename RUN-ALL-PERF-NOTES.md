# Run all — performance pass (uncommitted, for your review)

Researched + implemented the **safe tier** of Run-all optimizations. Everything is **uncommitted** — two files
touched: `src/app/components/CanvasGrid.tsx` and `src/app/components/TikTokCanvas/hooks/useRecording.ts`.
Typechecks clean, lint clean (no new warnings). Adversarial review ran over the diff (results below).

## What "Run all" does today
Three phases, strictly sequential: **narrate-all** → **copy-all** → **download-all (export)**. They use three
*different* resources — ElevenLabs (network), OpenRouter+Reddit (network), and the CPU (WebCodecs encode). Today
they never overlap, and each phase is mostly serial internally. Export is the dominant cost (CPU-bound, ~30–90 s/reel).

## Shipped in this pass (safe, output-preserving)

| # | Change | Stage | Win | Risk |
|---|--------|-------|-----|------|
| **N1** | Fire all per-voice `/api/tts` calls concurrently (bounded pool of 3), decode+stitch strictly in group order | narrate | A multi-voice card generates ~N× faster; **byte-identical** WAV | low |
| **N2** | One shared `AudioContext` per card instead of one per voice group | narrate | fewer contexts, less churn | low |
| **C1** | Cache `{post, comments}` at bulk-build; copy feeds `/api/description` directly instead of re-importing via `/api/reddit` | copy | removes the ~650 ms serialized-puppeteer re-import per reel (the copy-concurrency bottleneck) | low |
| **E1** | Bound the WebCodecs decode to `[keyframe≤clipStart, clipEnd+0.5s]` instead of decoding the whole file | export | a narration-truncated / trimmed reel skips decoding frames it never draws (up to ~2× on short clips) | low* |
| **E2** | `hardwareAcceleration: 'prefer-hardware'` on the H.264 encoder (VideoToolbox on macOS) | export | materially faster encode; transparent software fallback | low |
| **X2** | Prefetch the *same* URL the reel mounts+exports from (data-first, matching `activeVideoSrc`); export reads the prefetched blob from cache instead of re-fetching 100 MB | export | the download-while-encoding pipeline actually hits, saving one 100 MB fetch per reel | low |

\*E1 traced by hand: max requested source time ≈ `clipEnd − videoRate/EXPORT_FPS` (< clipEnd), decode window
covers to `clipEnd + 0.5 s`, and decode starts at the keyframe at/before clipStart — so the composited tail is
never truncated. No-op for a full, untrimmed, un-narration-bounded clip.

### Guardrails confirmed intact
- **Zero footage download during setup** — the only footage `getVideoBlob` is the export-time prefetch inside `downloadAllReels`.
- **Titles land in exports** — `framingMapRef` path untouched.
- **Narration never dropped** — parallel TTS still stitches every group in order; identical output on success.
- **Cancel semantics** — `batchCancelRef` gating untouched.

## Bigger structural wins — need your go-ahead (higher value, more risk)
These are the ones I did **not** ship without you, roughly in value-per-risk order:

1. **N3 — canvas-free parallel narration.** Narration only needs `ocrLines`/`blockAuthors` (both live in
   `framingMap`), not the mounted `<video>`. Decouple `generateNarration` from `setSelectedId` so narrate-all runs
   many reels' TTS in parallel instead of one-canvas-at-a-time. Biggest narrate-all win (8×+), medium risk (must
   preserve the reveal-timing math exactly).
2. **O1 — overlap narrate ∥ copy.** They write different `framingMap` fields (overlays vs ytTitle/description) and
   hit different APIs. Blocker is the shared `batchOp`/`batchProgress`/`batchCancelRef` single-slot state — needs
   separate progress tracks. Turns two phases into `max(narrate, copy)`.
3. **P1 — per-reel pipeline.** reel *i* exports (CPU) while reel *i+1* narrates (ElevenLabs) while reel *i+2* does
   copy (OpenRouter) — overlap all three resource classes across reels. Biggest end-to-end win; largest refactor.
4. **W1 — worker exports.** Move the WebCodecs export into a Web Worker / OffscreenCanvas so multiple reels encode
   concurrently. Export is the dominant cost, so this is huge — but it's the riskiest (untangling export from the
   on-screen canvas). Gated by whether WebCodecs+mediabunny run cleanly off the main thread here.

Best-case if all four land: the three resource classes fully overlapped + each stage internally parallel →
roughly a **5–7×** end-to-end Run-all speedup vs today, vs the ~2–2.5× the shipped safe tier gets on its own.

---
## Adversarial review results (16-agent find → verify → synthesize)

The review verified the byte-identical / output-preserving claims and found **no dead no-ops** — all six
optimizations are live on the real path. It surfaced one must-fix and one recommended hardening, **both now fixed**:

**Fixed — C1 stale thread-cache (was: wrong copy after a thread swap).** If you bulk-built a reel from thread A,
then re-pointed it to thread B via the Reddit flyout and hit Run all, copy was generated from the *cached* thread A
(mislabeling the exported MP4 + `.txt`). Fix: the cache is now **url-tagged** — copy trusts it only when the tag
matches the reel's current url, else it re-imports the current thread. `onSaveThread` also drops the entry on a
url change. (Reel ids are unique-per-session, so there's no id-reuse stale-hit path.)

**Fixed — N1 free-tier TTS safety (was: 3-wide pool could rate-limit → drop narration).** narrate-all is serial
across cards, so the pool width *is* the global ElevenLabs concurrency. Dropped 3 → **2** (free-tier ceiling, still
~2× serial), gave `fetchTts` **4 attempts with exponential backoff** (0.6→1.2→2.4 s + jitter), wrapped the fetch so
a network blip retries instead of throwing, and made `/api/tts` return a `retryable` hint so deterministic config
errors (bad key/plan/voice) **fail fast with their real message** instead of burning retries on a wrong "rate-limit"
string. On success the stitched WAV is still byte-identical.

**Reviewed and rejected (no change needed):** E1 B-frame/open-GOP reorder (the 0.5 s end-margin + start-at-earlier-
keyframe absorbs it; closed-GOP footage unaffected), E1 zero-decode on a degenerate clip (not reachable — a
non-narrated reel has `clipEnd = fullDuration`), E2 hardware-encoder stall (mechanism real but not reachable; `prefer-
hardware` falls back to software), X2b apostrophe-in-url cache miss (footage filenames have none).

**Second adversarial pass (over the fixes themselves): clean — no confirmed regressions, no must-fixes.** It
verified both original findings are resolved and `tsc` passes. It raised one low-severity nice-to-have: the
concurrent TTS pool didn't short-circuit, so a card with a deterministic config failure (e.g. a bad key) fired a
`/api/tts` call for *every* voice group instead of bailing after the first — wasted credits + slower Cancel. **Now
fixed**: the pool stops claiming new groups once any group definitively fails (with a defensive guard so the
in-order decode loop can never deref an unclaimed slot). Byte-identical success output is unchanged.

**Final verdict: correct and safe to leave uncommitted for you to ship.** No invariant broken (byte-identical
success output, no silent narration drop, no wrong-thread copy, cancel semantics intact, manual panel surfaces the
real error). Everything remains uncommitted per your ask — `git diff` shows only `CanvasGrid.tsx`,
`useRecording.ts`, `api/tts/route.ts`, plus this notes file.
