import { describe, it, expect } from 'vitest';
import { applyThreadEdits, remapCommentEdits, depth0IndexOf, writeCommentEdit, readCommentEdit, splitParagraphs, hasThreadEdits } from './redditThreadEdits';

// Expectations from the design contract: edits are keyed by the SAME indices the pickable lists use;
// empty/garbage overrides never destroy content; a para edit must never change the paragraph COUNT
// on a round-trip (that would shift every later index and silently mis-target selections + edits).

const post = { title: 'Original title', body: 'Para one.\n\nPara two.\n\nPara three.' };
const comments = [{ body: 'first comment' }, { body: 'second comment' }];

describe('applyThreadEdits', () => {
  it('no edits → identical content, same references (cheap identity path)', () => {
    const r = applyThreadEdits(post, comments, undefined);
    expect(r.post).toBe(post);
    expect(r.comments).toBe(comments);
  });

  it('overrides the title (and collapses newlines — titles are single-line)', () => {
    const r = applyThreadEdits(post, comments, { title: 'Punchier\ntitle ' });
    expect(r.post.title).toBe('Punchier title');
    expect(post.title).toBe('Original title');   // input untouched
  });

  it('overrides a paragraph by index and rejoins the body', () => {
    const r = applyThreadEdits(post, comments, { paras: { 1: 'Edited second para.' } });
    expect(splitParagraphs(r.post.body)).toEqual(['Para one.', 'Edited second para.', 'Para three.']);
  });

  it('INDEX-STABILITY: a paragraph edit containing a blank line cannot split into two paragraphs', () => {
    const r = applyThreadEdits(post, comments, { paras: { 0: 'part a\n\npart b' } });
    const paras = splitParagraphs(r.post.body);
    expect(paras).toHaveLength(3);               // still 3 — indices 1 and 2 unshifted
    expect(paras[0]).toBe('part a\npart b');     // blank line collapsed to a single newline
    expect(paras[1]).toBe('Para two.');
  });

  it('overrides a comment body by index, leaving the others alone', () => {
    const r = applyThreadEdits(post, comments, { comments: { 1: 'reworded' } });
    expect(r.comments[0].body).toBe('first comment');
    expect(r.comments[1].body).toBe('reworded');
    expect(comments[1].body).toBe('second comment');   // input untouched
  });

  it('empty / whitespace overrides are ignored (revert semantics, never deletion)', () => {
    const r = applyThreadEdits(post, comments, { title: '   ', paras: { 0: '' }, comments: { 0: '\n ' } });
    expect(r.post.title).toBe('Original title');
    expect(r.post.body).toBe(post.body);
    expect(r.comments[0].body).toBe('first comment');
  });

  it('out-of-range indices are ignored (a re-imported thread can shrink)', () => {
    const r = applyThreadEdits(post, comments, { paras: { 99: 'ghost' }, comments: { 99: 'ghost' } });
    expect(splitParagraphs(r.post.body)).toHaveLength(3);
    expect(r.comments).toHaveLength(2);
  });

  it('a body-less post with paragraph edits stays body-less (no fabricated body)', () => {
    const r = applyThreadEdits({ title: 't' } as { title: string; body?: string }, comments, { paras: { 0: 'ghost' } });
    expect(r.post.body).toBeUndefined();
  });

  it('extra fields on post/comments pass through untouched (generic shapes)', () => {
    const rich = { title: 't', body: 'a', user: { name: 'u/x' }, score: '5' };
    const r = applyThreadEdits(rich, [{ body: 'c', user: { name: 'u/y' }, depth: 0 }], { title: 'T2' });
    expect(r.post.user).toEqual({ name: 'u/x' });
    expect(r.comments[0].depth).toBe(0);
  });

  it('a paragraph edit never mutates the INPUT post.body (direct non-mutation assert)', () => {
    const original = post.body;
    applyThreadEdits(post, comments, { paras: { 0: 'replaced' } });
    expect(post.body).toBe(original);
  });

  it('DRIFT ANCHOR: an override whose recorded original no longer matches is SKIPPED and reported', () => {
    const r = applyThreadEdits(post, comments, {
      comments: { 0: 'reworded' }, commentOrig: { 0: 'a DIFFERENT original than what is here now' },
      paras: { 1: 'edited' }, paraOrig: { 1: 'not what para two says' },
    });
    expect(r.comments[0].body).toBe('first comment');      // NOT rewritten
    expect(splitParagraphs(r.post.body)[1]).toBe('Para two.');
    expect(r.skipped.sort()).toEqual(['comment 1', 'paragraph 2']);
  });

  it('DRIFT ANCHOR: applies normally when the recorded original still matches (whitespace-insensitive)', () => {
    const r = applyThreadEdits(post, comments, {
      comments: { 0: 'reworded' }, commentOrig: { 0: '  first comment ' },
    });
    expect(r.comments[0].body).toBe('reworded');
    expect(r.skipped).toEqual([]);
  });

  it('LEGACY edits without anchors still apply by index (backward compatible)', () => {
    const r = applyThreadEdits(post, comments, { comments: { 1: 'reworded' } });
    expect(r.comments[1].body).toBe('reworded');
    expect(r.skipped).toEqual([]);
  });
});

describe('remapCommentEdits (flyout depth-0 universe → raw unfiltered array)', () => {
  const raw = [
    { body: 'top A', depth: 0 },
    { body: 'reply to A', depth: 1 },     // interleaved reply — shifts raw indices
    { body: 'top B', depth: 0 },
  ];

  it('THE H1 case: filtered index 1 must land on the SECOND top-level comment (raw index 2)', () => {
    const remapped = remapCommentEdits(raw, { comments: { 1: 'edited B' } })!;
    expect(remapped.comments).toEqual({ 2: 'edited B' });
    const r = applyThreadEdits({ title: 't' }, raw, remapped);
    expect(r.comments[2].body).toBe('edited B');           // top B edited
    expect(r.comments[1].body).toBe('reply to A');         // the reply untouched
  });

  it('remaps the commentOrig anchors alongside the overrides', () => {
    const remapped = remapCommentEdits(raw, { comments: { 1: 'x' }, commentOrig: { 1: 'top B' } })!;
    expect(remapped.commentOrig).toEqual({ 2: 'top B' });
  });

  it('is the identity for a depth-0-only array (the flyout’s own list)', () => {
    const flat = [{ body: 'a', depth: 0 }, { body: 'b', depth: 0 }];
    expect(remapCommentEdits(flat, { comments: { 1: 'x' } })!.comments).toEqual({ 1: 'x' });
  });

  it('drops overrides whose filtered index exceeds the top-level count; passes non-comment fields through', () => {
    const remapped = remapCommentEdits(raw, { title: 'T', comments: { 9: 'ghost' } })!;
    expect(remapped.title).toBe('T');
    expect(remapped.comments).toEqual({});
  });

  it('undefined / comment-less edits pass through unchanged', () => {
    expect(remapCommentEdits(raw, undefined)).toBeUndefined();
    const e = { title: 'T' };
    expect(remapCommentEdits(raw, e)).toBe(e);
  });
});

describe('depth0IndexOf (bulk full-tree index → shared depth-0 key)', () => {
  const raw = [
    { body: 'top A', depth: 0 },     // full 0 → depth-0 rank 0
    { body: 'reply', depth: 1 },     // full 1 → null (not top-level)
    { body: 'top B', depth: 0 },     // full 2 → depth-0 rank 1
    { body: 'top C', depth: 0 },     // full 3 → depth-0 rank 2
  ];
  it('maps each top-level comment to its depth-0 rank', () => {
    expect(depth0IndexOf(raw, 0)).toBe(0);
    expect(depth0IndexOf(raw, 2)).toBe(1);
    expect(depth0IndexOf(raw, 3)).toBe(2);
  });
  it('returns null for a reply (not editable / not in depth-0 space)', () => {
    expect(depth0IndexOf(raw, 1)).toBeNull();
  });
  it('is the round-trip inverse of remapCommentEdits for top-level comments', () => {
    // edit keyed at depth-0 rank 1 → remap to full → full index 2 → depth0IndexOf back to 1.
    const full = remapCommentEdits(raw, { comments: { 1: 'x' } })!.comments!;
    const fullIdx = Number(Object.keys(full)[0]);
    expect(fullIdx).toBe(2);
    expect(depth0IndexOf(raw, fullIdx)).toBe(1);
  });
  it('is identity on a reply-free tree (the common case)', () => {
    const flat = [{ depth: 0 }, { depth: 0 }, { depth: 0 }];
    expect([0, 1, 2].map(i => depth0IndexOf(flat, i))).toEqual([0, 1, 2]);
  });
});

describe('writeCommentEdit / readCommentEdit (bulk keying round-trip)', () => {
  // reply-heavy tree: full idx 0 = C0(d0), 1 = R1(d1 reply), 2 = C2(d0).
  const comments = [{ body: 'C0', depth: 0 }, { body: 'R1', depth: 1 }, { body: 'C2', depth: 0 }];

  it('THE mutant-killer: editing full idx 2 keys DEPTH-0 rank 1, not full idx 2', () => {
    const e = writeCommentEdit(comments, 2, 'C2 edited', {});
    expect(e.comments).toEqual({ 1: 'C2 edited' });     // rank 1 — a full-index mutant would write {2:…}
    expect(e.commentOrig).toEqual({ 1: 'C2' });          // drift anchor recorded
  });

  it('read reflects the edit on full idx 2 and NOT on the reply at full idx 1', () => {
    const e = writeCommentEdit(comments, 2, 'C2 edited', {});
    expect(readCommentEdit(comments, 2, e)).toEqual({ text: 'C2 edited', edited: true });
    expect(readCommentEdit(comments, 1, e)).toEqual({ text: 'R1', edited: false });   // reply: never an edit
    expect(readCommentEdit(comments, 0, e)).toEqual({ text: 'C0', edited: false });
  });

  it('round-trips through remapCommentEdits → applyThreadEdits onto the RIGHT full comment', () => {
    const e = writeCommentEdit(comments, 2, 'C2 edited', {});
    const applied = applyThreadEdits({ title: 't' }, comments, remapCommentEdits(comments, e));
    expect(applied.comments[2].body).toBe('C2 edited');   // C2 rewritten
    expect(applied.comments[1].body).toBe('R1');           // reply untouched
    expect(applied.comments[0].body).toBe('C0');
  });

  it('a reply (depth>0) is never editable — write is a no-op', () => {
    expect(writeCommentEdit(comments, 1, 'hacked reply', {})).toEqual({});
  });

  it('blank or original-matching value clears the override + its anchor', () => {
    const e = writeCommentEdit(comments, 2, 'C2 edited', {});
    expect(writeCommentEdit(comments, 2, '   ', e)).toEqual({});    // blank clears
    expect(writeCommentEdit(comments, 2, 'C2', e)).toEqual({});     // back to original clears
  });

  it('preserves unrelated edits (title, paras, other comments) untouched', () => {
    const prev = { title: 'T', paras: { 0: 'p' }, comments: { 0: 'c0 edit' }, commentOrig: { 0: 'C0' } };
    const e = writeCommentEdit(comments, 2, 'C2 edited', prev);
    expect(e.title).toBe('T');
    expect(e.paras).toEqual({ 0: 'p' });
    expect(e.comments).toEqual({ 0: 'c0 edit', 1: 'C2 edited' });
  });
});

describe('splitParagraphs (the canonical splitter both pick-lists and edits key off)', () => {
  it('splits on blank lines, trims, drops empties', () => {
    expect(splitParagraphs('a\n\n  b  \n\n\n\nc')).toEqual(['a', 'b', 'c']);
    expect(splitParagraphs('')).toEqual([]);
    expect(splitParagraphs(undefined)).toEqual([]);
  });
  it('keeps single newlines inside one paragraph', () => {
    expect(splitParagraphs('line1\nline2\n\nnext')).toEqual(['line1\nline2', 'next']);
  });
});

describe('hasThreadEdits', () => {
  it('false for absent/empty/whitespace-only edit sets', () => {
    expect(hasThreadEdits(undefined)).toBe(false);
    expect(hasThreadEdits({})).toBe(false);
    expect(hasThreadEdits({ title: ' ', paras: { 0: '' } })).toBe(false);
  });
  it('true when any usable override exists — each kind independently', () => {
    expect(hasThreadEdits({ comments: { 3: 'x' } })).toBe(true);
    expect(hasThreadEdits({ title: 'T' })).toBe(true);
    expect(hasThreadEdits({ paras: { 0: 'p' } })).toBe(true);
  });
});
