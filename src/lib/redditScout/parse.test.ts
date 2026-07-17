import { describe, it, expect } from 'vitest';
import { parseListing, topComments, toImportedPost, isImagePost, isBadComment } from './parse';

// Fixtures mirror Reddit's VERIFIED real shape (web-checked during design): a listing is
// {kind:'Listing',data:{children:[{kind:'t3',data}]}}; comments are a TWO-element array
// [postListing, commentListing] with {kind:'t1',data:{…,depth,replies}} children and a trailing
// {kind:'more'}. Expectations are derived from the spec (§4.8: exclude deleted/removed/sticky/bot,
// top N by score) — NOT copied from output.

const t3 = (data: Record<string, unknown>) => ({ kind: 't3', data });
const listing = (children: unknown[]) => ({ kind: 'Listing', data: { children } });
const t1 = (data: Record<string, unknown>) => ({ kind: 't1', data });

describe('parseListing', () => {
  const raw = listing([
    t3({
      id: '1abc', subreddit: 'AskReddit', title: 'What is the scariest thing?', selftext: '',
      score: 12000, num_comments: 3400, created_utc: 1_700_000_000, over_18: false, stickied: false,
      permalink: '/r/AskReddit/comments/1abc/what_is_the_scariest_thing/', author: 'curious_cat',
    }),
    { kind: 't1', data: { id: 'nope' } },                         // wrong kind → skipped
    t3({ /* no id */ subreddit: 'x', title: 'bad', permalink: '/x' }),   // no id → skipped
    t3({
      id: '2def', subreddit: 'tifu', title: 'TIFU by testing', selftext: 'Long story body...',
      score: 800, num_comments: 40, created_utc: 1_700_100_000, over_18: true, pinned: true,
      /* no permalink */ author: 'oops_guy',
    }),
  ]);

  it('maps every field of a normal text post', () => {
    const [p] = parseListing(raw);
    expect(p).toMatchObject({
      id: '1abc', subreddit: 'AskReddit', title: 'What is the scariest thing?', body: '',
      score: 12000, numComments: 3400, createdUtc: 1_700_000_000, over18: false, stickied: false, author: 'curious_cat',
    });
    expect(p.permalink).toBe('https://www.reddit.com/r/AskReddit/comments/1abc/what_is_the_scariest_thing/');
  });

  it('skips non-t3 children and entries with no id (never a garbage/empty-id candidate)', () => {
    const out = parseListing(raw);
    expect(out.map(c => c.id)).toEqual(['1abc', '2def']);   // the t1 and the id-less t3 are gone
  });

  it('treats pinned as stickied, carries over_18, and falls back to redd.it when permalink is missing', () => {
    const p = parseListing(raw)[1];
    expect(p.stickied).toBe(true);
    expect(p.over18).toBe(true);
    expect(p.permalink).toBe('https://redd.it/2def');
  });

  it('maps non-finite numerics (JSON 1e999 → Infinity) to 0 — Infinity would NaN-poison the rank comparator', () => {
    // Real-JSON reachable: JSON.parse turns an out-of-range literal into Infinity, not an error.
    const raw = JSON.parse('{"data":{"children":[{"kind":"t3","data":{"id":"abc","subreddit":"x","title":"t","permalink":"/p","score":1e999,"created_utc":1e999,"num_comments":-1e999}}]}}');
    const [p] = parseListing(raw);
    expect(p.score).toBe(0);
    expect(p.createdUtc).toBe(0);
    expect(p.numComments).toBe(0);
  });

  it('normalises the id to lowercase (must equal postIdFromUrl’s lowercased ledger key)', () => {
    const out = parseListing(listing([t3({ id: '1ABC2D', subreddit: 'x', title: 't', permalink: '/p' })]));
    expect(out[0].id).toBe('1abc2d');
  });

  it('returns [] for malformed / empty input rather than throwing', () => {
    expect(parseListing(null)).toEqual([]);
    expect(parseListing({})).toEqual([]);
    expect(parseListing({ data: { children: 'nope' } })).toEqual([]);
    expect(parseListing({ data: {} })).toEqual([]);
  });
});

describe('isImagePost (excluded in v1)', () => {
  it('flags gallery, post_hint=image, and direct image urls', () => {
    expect(isImagePost({ is_gallery: true })).toBe(true);
    expect(isImagePost({ post_hint: 'image' })).toBe(true);
    expect(isImagePost({ url: 'https://i.redd.it/abc.jpg' })).toBe(true);
    expect(isImagePost({ url: 'https://i.redd.it/abc.png?width=1' })).toBe(true);
  });
  it('does NOT flag a text/self post or an external link', () => {
    expect(isImagePost({ selftext: 'a story', url: 'https://reddit.com/r/x/comments/1/' })).toBe(false);
    expect(isImagePost({ url: 'https://example.com/article' })).toBe(false);
    expect(isImagePost({})).toBe(false);
  });
});

describe('topComments', () => {
  // A comments response: [postListing, commentListing]. The comment listing has a mix of good + bad + a
  // 'more' tail; scores are deliberately out of order to prove sorting.
  const comments = [
    listing([t3({ id: '1abc' })]),   // [0] = the post (ignored)
    listing([
      t1({ author: 'AutoModerator', body: 'Please read the rules.', score: 999, depth: 0 }),   // bot → excluded despite top score
      t1({ author: 'good_two', body: 'Second best take.', score: 50, depth: 0, is_submitter: false }),
      t1({ author: 'good_one', body: 'Best take by score.', score: 300, depth: 0 }),
      t1({ author: '[deleted]', body: '[deleted]', score: 200, depth: 0 }),                    // deleted → excluded
      t1({ author: 'remover', body: '[removed]', score: 150, depth: 0 }),                       // removed → excluded
      t1({ author: 'modpin', body: 'Pinned announcement', score: 500, depth: 0, stickied: true }),// sticky → excluded
      t1({ author: 'nested', body: 'a reply', score: 999, depth: 1 }),                           // depth 1 → excluded
      t1({ author: 'empty', body: '', score: 80, depth: 0 }),                                    // empty body → excluded
      t1({ author: 'op_guy', body: 'OP chimes in.', score: 20, depth: 0, is_submitter: true }),
      { kind: 'more', data: { children: ['x', 'y'] } },                                          // 'more' tail → ignored
    ]),
  ];

  it('returns only usable top-level comments, top-N by score, best first', () => {
    const top = topComments(comments, 2);
    expect(top.map(c => c.body)).toEqual(['Best take by score.', 'Second best take.']);
  });

  it('excludes bot, deleted, removed, empty, stickied, and nested comments', () => {
    const bodies = topComments(comments, 20).map(c => c.body);
    expect(bodies).toEqual(['Best take by score.', 'Second best take.', 'OP chimes in.']);   // exactly the 3 good ones
    expect(bodies).not.toContain('Please read the rules.');   // AutoModerator, even at score 999
    expect(bodies).not.toContain('a reply');                  // depth 1
  });

  it('formats author as u/name, score as string, and marks isOP from is_submitter', () => {
    const op = topComments(comments, 20).find(c => c.body === 'OP chimes in.')!;
    expect(op).toMatchObject({ user: { name: 'u/op_guy' }, score: '20', depth: 0, isOP: true });
    const notOp = topComments(comments, 20).find(c => c.body === 'Best take by score.')!;
    expect(notOp.isOP).toBe(false);
  });

  it('caps at N and handles N larger than available', () => {
    expect(topComments(comments, 1)).toHaveLength(1);
    expect(topComments(comments, 100)).toHaveLength(3);
    expect(topComments(comments, 0)).toHaveLength(0);
  });

  it('handles empty replies / missing 2nd listing / malformed input without throwing', () => {
    expect(topComments([listing([t3({ id: '1' })])], 3)).toEqual([]);   // only the post listing present
    expect(topComments(null, 3)).toEqual([]);
    expect(topComments([{}, { data: {} }], 3)).toEqual([]);
    expect(topComments('nope', 3)).toEqual([]);
  });
});

describe('isBadComment', () => {
  it('rejects the exact §4.8 exclusion set', () => {
    expect(isBadComment({ author: 'AutoModerator', body: 'hi', score: 1 })).toBe(true);
    expect(isBadComment({ author: 'x', body: '[removed]' })).toBe(true);
    expect(isBadComment({ author: '[deleted]', body: 'text' })).toBe(true);
    expect(isBadComment({ author: 'x', body: '   ' })).toBe(true);        // whitespace-only
    expect(isBadComment({ author: 'mod', body: 'pinned', stickied: true })).toBe(true);
  });
  it('keeps a real human comment', () => {
    expect(isBadComment({ author: 'real_person', body: 'a genuine take', score: 10 })).toBe(false);
  });
});

describe('toImportedPost', () => {
  const base = {
    id: '1abc', subreddit: 'tifu', title: 'T', body: '', score: 900, numComments: 42,
    createdUtc: 1, over18: false, stickied: false, isImage: false, permalink: 'https://x', author: 'me',
  };
  it('maps to the ImportedRedditPost shape and drops an empty body to undefined', () => {
    expect(toImportedPost(base)).toEqual({
      user: { name: 'u/me' }, title: 'T', body: undefined, score: '900', commentCount: '42',
    });
    expect(toImportedPost({ ...base, body: 'a story' }).body).toBe('a story');
  });
});
