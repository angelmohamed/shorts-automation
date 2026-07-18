import type { RedditThreadEdits } from '@/app/components/TikTokCanvas/types';
import { splitParagraphs } from '@/lib/redditThreadEdits';

// Pure parse/validate for the bulk builder's PERSISTED picking state (localStorage 'bulk:threads'). This
// exists because losing this state once wiped a user's in-progress picks — so it's load-bearing and
// unit-tested. Selections are stored/loaded as arrays (JSON has no Set); the component wraps them in Sets.

export interface StoredThread<P, C> {
  url: string;
  post: P;
  comments: C[];
  paragraphs: string[];
  selectedComments: number[];
  selectedParas: number[];
  edits: RedditThreadEdits;
}

const nonNegInts = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n) && n >= 0) : [];

/** Validate persisted threads. PER-ENTRY isolation: a malformed (or throwing) entry is dropped, never
    the whole batch. Generic over the post/comment shape (the caller supplies its concrete types). */
export function parseStoredThreads<P, C>(raw: unknown): StoredThread<P, C>[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((t): StoredThread<P, C>[] => {
    try {
      const o = t as Partial<StoredThread<P, C>> | null;
      const post = o?.post as { title?: unknown; body?: unknown } | undefined;
      if (!o || typeof o.url !== 'string' || !post || typeof post.title !== 'string') return [];
      return [{
        url: o.url,
        post: o.post as P,
        comments: Array.isArray(o.comments) ? (o.comments as C[]) : [],
        paragraphs: Array.isArray(o.paragraphs) ? o.paragraphs : splitParagraphs(typeof post.body === 'string' ? post.body : ''),
        selectedComments: nonNegInts(o.selectedComments),
        selectedParas: nonNegInts(o.selectedParas),
        edits: o.edits && typeof o.edits === 'object' && !Array.isArray(o.edits) ? (o.edits as RedditThreadEdits) : {},
      }];
    } catch { return []; }
  });
}

/** Serialize threads for storage — selections as arrays. Keeps the on-disk shape in one place with the
    parser so they can't drift. */
export function serializeThreads<P, C>(threads: Array<{
  url: string; post: P; comments: C[]; paragraphs: string[];
  selectedComments: Iterable<number>; selectedParas: Iterable<number>; edits: RedditThreadEdits;
}>): string {
  return JSON.stringify(threads.map(t => ({
    url: t.url, post: t.post, comments: t.comments, paragraphs: t.paragraphs,
    selectedComments: [...t.selectedComments], selectedParas: [...t.selectedParas], edits: t.edits,
  })));
}
