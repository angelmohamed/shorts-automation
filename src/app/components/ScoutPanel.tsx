'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './ui/Button';
import type { ScoutCandidate } from '@/lib/redditScout/types';
import type { UsedRow } from '@/lib/redditScout/ledger';   // type-only — erased at build, pulls no supabase
import { SCOUT_SUBREDDITS } from '@/lib/redditScout/config';
import { fmtAge, isLongStory } from '@/lib/redditScout/present';

// The Scout review panel (REQUIREMENTS §4.5–4.7): scan → a ranked, category-interleaved feed of unseen
// candidates → Use / Reject / Skip / Open per card, an undo for the last decision, and a buffer tray whose
// "Send N to Import" hands the approved posts to the bulk builder (auto-import → pick/tweak → build there).
// Decisions POST to /api/reddit-scout (server-side ledger); Skip is local-only (§3.4: skips are NOT
// recorded). The BUFFER lives in the parent (CanvasGrid), persists, and releases entries only when a reel
// is actually built from them (release-at-build — never orphan a used-marked post).

interface ScanStats { subsScanned: number; fetched: number; afterThresholds: number; afterSeen: number }
interface ScanResponse { candidates: ScoutCandidate[]; failedSubs: string[]; stats: ScanStats; error?: string }

const CATEGORY_BY_SUB = new Map(SCOUT_SUBREDDITS.map(s => [s.name.toLowerCase(), s.category]));

// The subreddits a scan CAN include — image subs are excluded in v1 (the format renders a text card).
const SELECTABLE_SUBS = SCOUT_SUBREDDITS.filter(s => !s.image);
const ALL_SUB_NAMES = SELECTABLE_SUBS.map(s => s.name);
const SUB_CATEGORIES = ['A', 'B', 'C', 'D'] as const;

/** Restore the enabled-subreddit selection. An explicit stored selection (incl. empty) is honoured;
    only a first run / corrupt value defaults to all. Unknown names (config changed) are dropped. */
function loadSelectedSubs(): Set<string> {
  try {
    const stored = localStorage.getItem('scout:subs');
    if (stored != null) {
      const raw: unknown = JSON.parse(stored);
      if (Array.isArray(raw)) {
        const known = raw.filter((n): n is string => typeof n === 'string' && ALL_SUB_NAMES.includes(n));
        // Honour an explicit None (stored []); but a non-empty selection whose every name was removed/
        // renamed in config drifted to empty — fall back to all rather than stranding the user at 0.
        if (known.length === 0 && raw.length > 0) return new Set(ALL_SUB_NAMES);
        return new Set(known);
      }
    }
  } catch { /* corrupt/private → default all */ }
  return new Set(ALL_SUB_NAMES);
}

async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch('/api/reddit-scout', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(json.error ?? `scout request failed (${res.status})`));
  return json;
}

export function ScoutPanel({ open, onClose, bufferCount, bufferedIds, onBuffer, onUnbuffer, onSendToImport, builtPostIds, onNewCount }: {
  open: boolean;
  onClose: () => void;
  bufferCount: number;
  bufferedIds: Set<string>;            // so a re-scan can't show something already buffered
  onBuffer: (c: ScoutCandidate) => void;
  onUnbuffer: (id: string) => void;    // undo of a Use
  /** Hand the approved buffer to the Import stage (bulk builder auto-imports the threads; picking +
      building happen THERE). The buffer releases entries only once a reel is built from them. */
  onSendToImport: () => void;
  /** Post ids that already have a reel in the workspace — excluded from a ledger restore. */
  builtPostIds: Set<string>;
  onNewCount: (n: number) => void;
}) {
  const [candidates, setCandidates] = useState<ScoutCandidate[]>([]);
  const [stats, setStats] = useState<ScanStats | null>(null);
  const [failedSubs, setFailedSubs] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scannedAtUtc, setScannedAtUtc] = useState(0);   // age anchor, snapped per scan (no render-time Date.now)
  const [notice, setNotice] = useState<string | null>(null);
  // Last committed decision, for the §4.6 undo (one step, cleared by the next scan).
  const [lastDecision, setLastDecision] = useState<{ kind: 'used' | 'rejected'; candidate: ScoutCandidate; index: number } | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);   // candidate id with an in-flight decide
  // Which subreddits a scan includes — persisted, defaults to all. The scan sends the names; the server
  // filters its config to them (so only configured subs can ever be fetched).
  const [selectedSubs, setSelectedSubs] = useState<Set<string>>(loadSelectedSubs);
  const [subsOpen, setSubsOpen] = useState(false);
  // Skip the mount echo: an UNTOUCHED default stays unpersisted, so loadSelectedSubs keeps returning "all"
  // dynamically — a subreddit later added to config is auto-included instead of frozen out. A real toggle/
  // All/None still writes (incl. an explicit empty None).
  const didMountSubs = useRef(false);
  useEffect(() => {
    if (!didMountSubs.current) { didMountSubs.current = true; return; }
    try { localStorage.setItem('scout:subs', JSON.stringify([...selectedSubs])); } catch { /* quota/private */ }
  }, [selectedSubs]);
  const toggleSub = (name: string) => setSelectedSubs(prev => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  useEffect(() => { onNewCount(candidates.length); }, [candidates.length, onNewCount]);

  const scan = useCallback(async () => {
    setScanning(true); setNotice(null); setLastDecision(null);
    try {
      const r = (await post({ action: 'scan', subs: [...selectedSubs] })) as unknown as ScanResponse;
      setScannedAtUtc(Date.now() / 1000);
      const fresh = r.candidates.filter(c => !bufferedIds.has(c.id));
      setCandidates(fresh);
      setStats(r.stats);
      setFailedSubs(r.failedSubs);
      if (!fresh.length) {
        setNotice(r.stats.fetched === 0
          ? 'Nothing fetched — are the subreddits failing? Check the dev console.'
          : r.stats.afterThresholds === 0
            ? 'Everything was filtered out — consider lowering per-sub thresholds or widening the timeframe in the scout config.'
            : 'No new candidates — everything popular has already been used or rejected. Try a longer timeframe.');
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Scan failed.');
    } finally {
      setScanning(false);
    }
  }, [bufferedIds, selectedSubs]);

  // Remove by ID, never by index: the index captured at click time goes stale while the POST is in
  // flight (a Skip or another decide resolving first) and would delete the WRONG candidate. The index
  // is kept only as a best-effort reinsert position for undo (clamped there).
  const removeById = (id: string) => setCandidates(prev => prev.filter(x => x.id !== id));

  const decide = useCallback(async (c: ScoutCandidate, index: number, kind: 'used' | 'rejected') => {
    setDeciding(c.id);
    try {
      // body/score/comments/age ride along as training features for the future learned ranker.
      await post({
        action: 'decide', id: c.id, status: kind, subreddit: c.subreddit, title: c.title,
        body: c.body, score: c.score, numComments: c.numComments, createdUtc: c.createdUtc,
      });
      removeById(c.id);
      setLastDecision({ kind, candidate: c, index });
      if (kind === 'used') onBuffer(c);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Decision failed.');
    } finally {
      setDeciding(null);
    }
  }, [onBuffer]);

  // Stale-undo guard: if the last decision was a Use whose post has LEFT the buffer (it was built, or
  // unbuffered by an earlier undo), offering "Undo use" would delete the ledger row of an existing reel
  // → the post becomes re-suggestible → duplicate reel. Drop the stale affordance.
  useEffect(() => {
    if (lastDecision?.kind === 'used' && !bufferedIds.has(lastDecision.candidate.id) && deciding !== lastDecision.candidate.id) {
      setLastDecision(null);
    }
  }, [bufferedIds, lastDecision, deciding]);

  // ── Lost-buffer recovery: rebuild the approved buffer from the LEDGER (every Use wrote a used-row with
  // features first, so approvals are never truly lost). Rows whose post already has a workspace reel are
  // excluded; the rest re-enter the buffer as reconstructed candidates (redd.it permalinks resolve fine
  // at Import). ──
  const [restoring, setRestoring] = useState(false);
  const restoreFromLedger = useCallback(async () => {
    setRestoring(true); setNotice(null);
    const LIMIT = 50;
    try {
      const r = await post({ action: 'list-used', limit: LIMIT });
      const rows = (r.used ?? []) as UsedRow[];
      const fresh = rows.filter(row => !builtPostIds.has(row.post_id) && !bufferedIds.has(row.post_id));
      for (const row of fresh) {
        onBuffer({
          id: row.post_id,
          subreddit: row.subreddit,
          title: row.title,
          body: row.body ?? '',
          score: row.score ?? 0,
          numComments: row.num_comments ?? 0,
          createdUtc: row.created_utc ?? (Math.floor(Date.parse(row.decided_at) / 1000) || 1),
          over18: false, stickied: false, isImage: false,
          permalink: `https://redd.it/${row.post_id}`,
          author: '',
        });
      }
      const truncated = rows.length >= LIMIT ? ` (showing the ${LIMIT} most recent — older approvals not listed)` : '';
      setNotice(fresh.length
        ? `Restored ${fresh.length} approved post${fresh.length === 1 ? '' : 's'} from the ledger.${truncated}`
        : `Nothing to restore — every recent used post already has a reel or is buffered.${truncated}`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Restore failed.');
    } finally {
      setRestoring(false);
    }
  }, [builtPostIds, bufferedIds, onBuffer]);

  const undo = useCallback(async () => {
    if (!lastDecision) return;
    const { kind, candidate, index } = lastDecision;
    try {
      await post({ action: 'undecide', id: candidate.id });
      if (kind === 'used') onUnbuffer(candidate.id);
      setCandidates(prev => {
        const next = prev.slice();
        next.splice(Math.min(index, next.length), 0, candidate);   // back where it was (clamped)
        return next;
      });
      setLastDecision(null);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Undo failed.');
    }
  }, [lastDecision, onUnbuffer]);

  if (!open) return null;
  const nowUtc = scannedAtUtc;

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-scrim p-4" onPointerDown={onClose}>
      <div
        className="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-surface-1 shadow-3"
        onPointerDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-line px-4 py-3 shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="text-subheading font-semibold text-fg">Reddit Scout</h2>
            <p className="truncate text-caption text-fg-3">
              {stats
                ? `${stats.fetched} fetched · ${stats.afterThresholds} past thresholds · ${stats.afterSeen} unseen${failedSubs.length ? ` · failed: ${failedSubs.map(s => 'r/' + s).join(', ')}` : ''}`
                : 'Top posts from your subreddits — approve the ones worth a reel. Nothing repeats.'}
            </p>
          </div>
          {lastDecision && (
            <button type="button" onClick={() => void undo()} className="text-caption text-fg-3 underline underline-offset-2 hover:text-fg">
              Undo {lastDecision.kind === 'used' ? 'use' : 'reject'}
            </button>
          )}
          <Button variant="primary" size="sm" loading={scanning} disabled={scanning || selectedSubs.size === 0} onClick={() => void scan()}>
            {scanning ? 'Scouting…' : 'Scout now'}
          </Button>
          <button type="button" onClick={onClose} aria-label="Close" className="focus-ring rounded-md p-1 text-fg-3 hover:bg-hover hover:text-fg">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Subreddit selector — choose which subs this scan includes (persisted). */}
        <div className="border-b border-line px-4 py-2 shrink-0">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setSubsOpen(o => !o)} className="flex items-center gap-1 text-caption text-fg-2 hover:text-fg">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden
                style={{ transform: subsOpen ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}><path d="m9 18 6-6-6-6" /></svg>
              <span className="font-medium">Subreddits</span>
              <span className="tabular-nums text-fg-3">{selectedSubs.size} of {ALL_SUB_NAMES.length}</span>
            </button>
            {selectedSubs.size === 0 && <span className="text-caption text-warning-text">pick at least one to scan</span>}
            {subsOpen && (
              <div className="ml-auto flex items-center gap-2 text-caption">
                <button type="button" onClick={() => setSelectedSubs(new Set(ALL_SUB_NAMES))} className="text-fg-3 underline underline-offset-2 hover:text-fg">All</button>
                <button type="button" onClick={() => setSelectedSubs(new Set())} className="text-fg-3 underline underline-offset-2 hover:text-fg">None</button>
              </div>
            )}
          </div>
          {subsOpen && (
            <div className="mt-2 flex flex-col gap-1.5">
              {SUB_CATEGORIES.map(cat => {
                const subs = SELECTABLE_SUBS.filter(s => s.category === cat);
                if (!subs.length) return null;
                return (
                  <div key={cat} className="flex flex-wrap items-center gap-1.5">
                    <span className="w-3 shrink-0 text-[10px] font-semibold text-fg-4">{cat}</span>
                    {subs.map(s => {
                      const on = selectedSubs.has(s.name);
                      return (
                        <button key={s.name} type="button" onClick={() => toggleSub(s.name)}
                          className={`rounded-full border px-2 py-0.5 text-caption transition-colors ${on ? 'bg-action border-action text-action-fg' : 'border-line-strong text-fg-3 hover:bg-hover'}`}>
                          r/{s.name}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Candidate feed */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {notice && <p className="px-1.5 py-2 text-caption text-fg-3">{notice}</p>}
          {!notice && candidates.length === 0 && !scanning && (
            <p className="px-1.5 py-2 text-caption text-fg-3">Hit “Scout now” to pull this week’s top posts.</p>
          )}
          {candidates.map((c, i) => {
            const cat = CATEGORY_BY_SUB.get(c.subreddit.toLowerCase());
            const busy = deciding === c.id;
            return (
              <div key={c.id} className="flex items-start gap-3 rounded-lg px-1.5 py-2 hover:bg-hover">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-caption text-fg-3">
                    {cat && <span className="rounded-sm border border-line px-1 text-[10px] font-semibold text-fg-4">{cat}</span>}
                    <span className="font-medium text-fg-2">r/{c.subreddit}</span>
                    <span className="tabular-nums">▲{c.score.toLocaleString()}</span>
                    <span className="tabular-nums">💬{c.numComments.toLocaleString()}</span>
                    <span className="tabular-nums">{fmtAge(c.createdUtc, nowUtc)}</span>
                    {isLongStory(c) && <span className="rounded-sm bg-warning-tint px-1 text-[10px] font-semibold text-warning-text" title="Estimated over the 3:00 Shorts ceiling — trim or split">long</span>}
                    {c.over18 && <span className="rounded-sm bg-danger-tint px-1 text-[10px] font-semibold text-danger-text">nsfw</span>}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-body text-fg">{c.title}</p>
                  {c.body && <p className="mt-0.5 line-clamp-1 text-caption text-fg-3">{c.body}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1 pt-0.5">
                  <Button variant="primary" size="sm" disabled={busy} onClick={() => void decide(c, i, 'used')}>Use</Button>
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => void decide(c, i, 'rejected')}>Reject</Button>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => removeById(c.id)}>Skip</Button>
                  <Button variant="ghost" size="sm" onClick={() => window.open(c.permalink, '_blank', 'noopener')} aria-label="Open on Reddit">↗</Button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Buffer tray — approved posts hand off to the Import stage (picking + building happen there). */}
        <div className="flex items-center gap-3 border-t border-line px-4 py-3 shrink-0">
          <span className="flex-1 text-caption text-fg-3 tabular-nums">
            {bufferCount ? `${bufferCount} approved, ready for Import` : 'Approved posts land here.'}
            {' · '}
            <button type="button" onClick={() => void restoreFromLedger()} disabled={restoring}
              className="underline underline-offset-2 hover:text-fg disabled:opacity-40"
              title="Rebuild the approved buffer from the ledger — recovers approvals lost to a cleared buffer (posts that already have reels are skipped)">
              {restoring ? 'Restoring…' : 'Restore from ledger'}
            </button>
          </span>
          <Button
            variant="primary" size="sm" disabled={!bufferCount}
            onClick={() => {
              // Drop the undo affordance at handoff: undoing a Use whose thread is now in the builder
              // would delete its ledger row while the reel still gets built (→ re-suggestible → duplicate).
              setLastDecision(null);
              onSendToImport();
            }}
          >
            {`Send ${bufferCount || ''} to Import`}
          </Button>
        </div>
      </div>
    </div>
  );
}
