import { describe, it, expect } from 'vitest';
import { postIdFromUrl, subredditFromUrl } from './handoff';

// Pure URL→id extraction only — the Supabase read/write paths need live credentials and are
// deliberately NOT exercised in the default test run (see BUILD-PLAN Phase 0).
//
// The id this returns keys the PERMANENT no-repeat ledger, so a wrong extraction here is the
// worst kind of bug: a post that silently re-surfaces (or a wrong post blocked forever).

describe('postIdFromUrl', () => {
  it('extracts from a full permalink', () => {
    expect(postIdFromUrl('https://www.reddit.com/r/AskReddit/comments/1abc2d/whats_the_scariest_thing/')).toBe('1abc2d');
  });

  it('extracts from a comments url without a trailing slug or slash', () => {
    expect(postIdFromUrl('https://reddit.com/r/tifu/comments/xyz789')).toBe('xyz789');
  });

  it('extracts from a short redd.it link', () => {
    expect(postIdFromUrl('https://redd.it/1abc2d')).toBe('1abc2d');
  });

  it('extracts from a gallery url', () => {
    expect(postIdFromUrl('https://www.reddit.com/gallery/1abc2d')).toBe('1abc2d');
  });

  it('accepts a bare t3_ fullname', () => {
    expect(postIdFromUrl('t3_1abc2d')).toBe('1abc2d');
  });

  it('normalises to lowercase (Reddit ids are base36; mixed-case urls must map to ONE ledger key)', () => {
    expect(postIdFromUrl('https://www.reddit.com/r/tifu/comments/1ABC2D/title/')).toBe('1abc2d');
  });

  it('does not swallow the deep-link COMMENT id after the post id', () => {
    // …/comments/<post>/<slug>/<comment> — the first capture must be the post id, never the comment id.
    expect(postIdFromUrl('https://www.reddit.com/r/AskReddit/comments/1abc2d/title_slug/k9comm3/')).toBe('1abc2d');
  });

  it('returns null for non-reddit / unrecognisable urls (never a garbage key)', () => {
    expect(postIdFromUrl('https://example.com/comments-page')).toBeNull();
    expect(postIdFromUrl('')).toBeNull();
    expect(postIdFromUrl('https://www.reddit.com/r/AskReddit/')).toBeNull();
  });
});

describe('subredditFromUrl', () => {
  it('extracts the sub name from a full permalink', () => {
    expect(subredditFromUrl('https://www.reddit.com/r/AskReddit/comments/1abc/title/')).toBe('AskReddit');
  });
  it('preserves case and underscores', () => {
    expect(subredditFromUrl('https://reddit.com/r/Two_Sentence_Horror/comments/x/')).toBe('Two_Sentence_Horror');
  });
  it('returns null when there is no /r/ segment (redd.it short links, junk)', () => {
    expect(subredditFromUrl('https://redd.it/1abc')).toBeNull();
    expect(subredditFromUrl('t3_1abc')).toBeNull();
    expect(subredditFromUrl('')).toBeNull();
  });
});
