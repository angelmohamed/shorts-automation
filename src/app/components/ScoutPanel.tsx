'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from './ui/Button';
import type { ScoutCandidate } from '@/lib/redditScout/types';
import { SCOUT_SUBREDDITS } from '@/lib/redditScout/config';
import { fmtAge, isLongStory } from '@/lib/redditScout/present';

// The Scout review panel (REQUIREMENTS §4.5/§4.6): scan → a ranked, category-interleaved feed of unseen
// candidates → Use / Reject / Skip / Open per card, an undo for the last decision, and a buffer tray that
// "Build N reels" turns into staged reels. Decisions POST to /api/reddit-scout (server-side ledger);
// Skip is local-only (§3.4: skips are NOT recorded). The BUFFER lives in the parent (CanvasGrid) so it
// persists and feeds the node's status line + the build.

interface ScanStats { subsScanned: number; fetched: number; afterThresholds: number; afterSeen: number }
interface ScanResponse { candidates: ScoutCandidate[]; failedSubs: string[]; stats: ScanStats; error?: string }

const CATEGORY_BY_SUB = new Map(SCOUT_SUBREDDITS.map(s => [s.name.toLowerCase(), s.category]));

async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch('/api/reddit-scout', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(json.error ?? `scout request failed (${res.status})`));
  return json;
}

export function ScoutPanel({ open, onClose, bufferCount, bufferedIds, onBuffer, onUnbuffer, onBuild, building, onNewCount }: {
  open: boolean;
  onClose: () => void;
  bufferCount: number;
  bufferedIds: Set<string>;            // so a re-scan can't show something already buffered
  onBuffer: (c: ScoutCandidate) => void;
  onUnbuffer: (id: string) => void;    // undo of a Use
  onBuild: () => Promise<string | null>;   // resolves to an outcome notice (cap/failed cards) or null
  building: boolean;
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

  useEffect(() => { onNewCount(candidates.length); }, [candidates.length, onNewCount]);

  const scan = useCallback(async () => {
    setScanning(true); setNotice(null); setLastDecision(null);
    try {
      const r = (await post({ action: 'scan' })) as unknown as ScanResponse;
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
  }, [bufferedIds]);

  // Remove by ID, never by index: the index captured at click time goes stale while the POST is in
  // flight (a Skip or another decide resolving first) and would delete the WRONG candidate. The index
  // is kept only as a best-effort reinsert position for undo (clamped there).
  const removeById = (id: string) => setCandidates(prev => prev.filter(x => x.id !== id));

  const decide = useCallback(async (c: ScoutCandidate, index: number, kind: 'used' | 'rejected') => {
    setDeciding(c.id);
    try {
      await post({ action: 'decide', id: c.id, status: kind, subreddit: c.subreddit, title: c.title });
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
          <Button variant="primary" size="sm" loading={scanning} disabled={scanning} onClick={() => void scan()}>
            {scanning ? 'Scouting…' : 'Scout now'}
          </Button>
          <button type="button" onClick={onClose} aria-label="Close" className="focus-ring rounded-md p-1 text-fg-3 hover:bg-hover hover:text-fg">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
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
                  <Button variant="primary" size="sm" disabled={busy || building} onClick={() => void decide(c, i, 'used')}>Use</Button>
                  <Button variant="secondary" size="sm" disabled={busy || building} onClick={() => void decide(c, i, 'rejected')}>Reject</Button>
                  <Button variant="ghost" size="sm" disabled={busy || building} onClick={() => removeById(c.id)}>Skip</Button>
                  <Button variant="ghost" size="sm" onClick={() => window.open(c.permalink, '_blank', 'noopener')} aria-label="Open on Reddit">↗</Button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Buffer tray */}
        <div className="flex items-center gap-3 border-t border-line px-4 py-3 shrink-0">
          <span className="flex-1 text-caption text-fg-3 tabular-nums">
            {bufferCount ? `${bufferCount} approved, ready to build` : 'Approved posts land here.'}
          </span>
          <Button
            variant="primary" size="sm" disabled={!bufferCount || building} loading={building}
            onClick={() => void onBuild()
              // Always drop the undo affordance after a build attempt: an "Undo use" surviving the build
              // would delete the ledger row of a post that IS now a reel (→ re-suggestible → duplicate).
              .then(msg => { setLastDecision(null); if (msg) setNotice(msg); })
              .catch(e => setNotice(e instanceof Error ? e.message : 'Build failed — approved posts stay buffered.'))}
          >
            {building ? 'Building…' : `Build ${bufferCount || ''} reel${bufferCount === 1 ? '' : 's'}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
