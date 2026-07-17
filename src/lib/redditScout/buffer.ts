// Pure buffer↔build reconciliation for the Scout (unit-tested — this logic guards against the two
// worst buffer bugs: orphaning approved posts, and duplicate reels on a retry).

/** After a build that consumed the FIRST `built` entries of `snapshotIds` (addReels consumes the thread
    prefix in order and truncates at the reel cap), return the buffer entries that remain: everything
    except the consumed prefix. Works on the CURRENT buffer (`prev`), not the snapshot — entries added
    mid-build survive untouched. A reel whose card render failed still counts as consumed (its grid reel
    EXISTS; rebuilding it would duplicate the reel). */
export function remainingBufferAfterBuild<T>(
  prev: T[],
  snapshotIds: string[],
  built: number,
  idOf: (entry: T) => string,
): T[] {
  const consumed = new Set(snapshotIds.slice(0, Math.max(0, built)));
  return prev.filter(e => !consumed.has(idOf(e)));
}

/** The user-facing outcome line for a scout build, or null when everything built cleanly. */
export function buildOutcomeNotice(attempted: number, built: number, failed: number, reelCap: number): string | null {
  const parts: string[] = [];
  const unbuilt = attempted - built;
  if (unbuilt > 0) parts.push(`${unbuilt} approved post${unbuilt === 1 ? '' : 's'} didn't fit the ${reelCap}-reel cap — still buffered`);
  if (failed > 0) parts.push(`${failed} card${failed === 1 ? '' : 's'} failed to render (reel created — re-import via its Reddit panel)`);
  return parts.length ? parts.join(' · ') : null;
}
