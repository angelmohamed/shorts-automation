import { describe, it, expect } from 'vitest';
import { canonicalThreadKey, partitionImportUrls, releaseByUrls, migrateScoutBuffer } from './handoff';
import type { ScoutCandidate } from './types';

// The NO-ORPHANS invariant, as tests: a used-marked post leaves the buffer only when a reel exists for
// it — so a failed/invalid/lost url must never be counted "present", dedup must recognise every variant
// of a thread already in the builder, and release must be an exact permalink match. Expectations derived
// from the contract, not the implementation.

const cand = (id: string, permalink: string): ScoutCandidate => ({
  id, permalink, subreddit: 's', title: 't', body: '', score: 1, numComments: 0, createdUtc: 1,
  over18: false, stickied: false, isImage: false, author: 'a',
});

describe('canonicalThreadKey', () => {
  it('keys a comments url by its base36 post id, across host/slash/query variants', () => {
    const k = canonicalThreadKey('https://www.reddit.com/r/tifu/comments/1abC2d/some_slug/');
    expect(k).toBe('1abc2d');
    expect(canonicalThreadKey('https://old.reddit.com/r/tifu/comments/1ABC2D/other_slug?utm_source=x')).toBe(k);
    expect(canonicalThreadKey('https://redd.it/1abc2d')).toBe(k);
  });
  it('falls back to host+path for non-thread urls, and to the trimmed string for junk', () => {
    expect(canonicalThreadKey('https://www.reddit.com/r/tifu/')).toBe('reddit.com/r/tifu');
    expect(canonicalThreadKey('not a url ')).toBe('not a url');
  });
});

describe('partitionImportUrls', () => {
  const existing = new Set([canonicalThreadKey('https://www.reddit.com/r/a/comments/exist1/x/')]);

  it('routes: new → toImport, already-in-builder variant → alreadyPresent, junk → invalid', () => {
    const r = partitionImportUrls(
      ['https://www.reddit.com/r/a/comments/new001/y/',
       'https://old.reddit.com/r/a/comments/EXIST1/z/',     // variant of the existing thread
       'https://example.com/nope',
      ].join('\n'),
      existing,
    );
    expect(r.toImport).toEqual(['https://www.reddit.com/r/a/comments/new001/y/']);
    expect(r.alreadyPresent).toEqual(['https://old.reddit.com/r/a/comments/EXIST1/z/']);
    expect(r.invalid).toEqual(['https://example.com/nope']);
  });

  it('collapses within-batch duplicates to the first occurrence (never imports one thread twice)', () => {
    const r = partitionImportUrls(
      'https://redd.it/1abc2d\nhttps://www.reddit.com/r/x/comments/1abc2d/slug/',
      new Set(),
    );
    expect(r.toImport).toEqual(['https://redd.it/1abc2d']);
  });

  it('an INVALID url is never counted present (it would orphan its used-marked post if it were)', () => {
    const r = partitionImportUrls('garbage-token', new Set());
    expect(r.toImport).toEqual([]);
    expect(r.alreadyPresent).toEqual([]);
    expect(r.invalid).toEqual(['garbage-token']);
  });

  it('empty text → all-empty partitions', () => {
    expect(partitionImportUrls('  \n ', new Set())).toEqual({ toImport: [], alreadyPresent: [], invalid: [] });
  });
});

describe('releaseByUrls (release-at-build)', () => {
  const buffer = [cand('a', 'https://www.reddit.com/r/x/comments/a/s/'), cand('b', 'https://www.reddit.com/r/x/comments/b/s/')];

  it('releases exactly the built permalinks; everything else stays buffered', () => {
    const out = releaseByUrls(buffer, ['https://www.reddit.com/r/x/comments/a/s/']);
    expect(out.map(c => c.id)).toEqual(['b']);
  });
  it('a near-miss url (extra slash, different case) releases NOTHING — exact match only', () => {
    const out = releaseByUrls(buffer, ['https://www.reddit.com/r/x/comments/A/s/', 'https://www.reddit.com/r/x/comments/b/s']);
    expect(out).toHaveLength(2);
  });
  it('empty built-list is a no-op; unknown urls are ignored', () => {
    expect(releaseByUrls(buffer, [])).toHaveLength(2);
    expect(releaseByUrls(buffer, ['https://redd.it/zzz'])).toHaveLength(2);
  });
});

describe('migrateScoutBuffer', () => {
  const ok = cand('a', 'https://redd.it/a');

  it('accepts current-shape entries and legacy {candidate, comments} entries, mixed', () => {
    const legacy = { candidate: cand('b', 'https://www.reddit.com/r/x/comments/b/s/'), comments: null };
    expect(migrateScoutBuffer([ok, legacy]).map(c => c.id)).toEqual(['a', 'b']);
  });

  it('drops garbage without nuking valid entries: null, {}, wrong-typed ids, non-reddit permalinks', () => {
    const badLink = { ...cand('c', 'https://example.com/елsewhere') };
    expect(migrateScoutBuffer([null, {}, { candidate: { id: 5 } }, badLink, ok]).map(c => c.id)).toEqual(['a']);
  });

  it('non-array / junk roots → empty buffer', () => {
    expect(migrateScoutBuffer('"x"')).toEqual([]);
    expect(migrateScoutBuffer({ candidate: ok })).toEqual([]);
    expect(migrateScoutBuffer(undefined)).toEqual([]);
  });
});
