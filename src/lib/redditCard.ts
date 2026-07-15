// Render a Reddit-style thread card (post + selected comments) to a canvas, returning both the
// image and the narration line map. This is the "synthetic OCR" counterpart of extractMemeLines:
// because WE lay the text out, every narratable line's text, bbox and reveal boundary are exact —
// no Tesseract pass. The result plugs into the existing image-overlay narration pipeline untouched
// (ocrLines → voice brushes → ElevenLabs beats → progressive top-anchored crop).
//
// Reveal semantics mirror the OCR pipeline's chrome handling: usernames, avatars, and the
// score/meta row are never narrated. Chrome ABOVE a block's first line (a comment's header) reveals
// together with that first line; chrome BELOW a block's last line (the post's meta row) reveals
// with that block — boundaries sit in the visual gap between blocks, so a crop never slices a row.

import { wrapText, roundRectPath } from '@/app/components/TemplateEditorCanvas/drawing/helpers';
import type { MemeLine } from './memeOcr';

export interface RedditUser {
  name: string;
  /** Data URI or same-origin URL. Absent → colored initial disc (Reddit-style fallback). */
  avatar?: string;
}

export interface RedditComment {
  user: RedditUser;
  body: string;
  timeAgo?: string;
}

export interface RedditCardData {
  user: RedditUser;          // post author (u/…) or subreddit (r/…) shown in the header
  timeAgo?: string;
  title: string;
  body?: string;
  /** Meta row under the post text — both optional; row is drawn if either is present. */
  score?: string;            // e.g. "12.4K"
  commentCount?: string;     // e.g. "3.1K"
  comments: RedditComment[];
  /** Draw the blue Join pill in the header (default true — it sells the look). */
  showJoin?: boolean;
}

export interface RedditCardResult {
  blob: Blob;
  width: number;
  height: number;
  /** Narratable lines (title/body/comment text only — never usernames or meta chrome). */
  lines: MemeLine[];
}

// ── Design constants (new-Reddit dark mode, drawn at 2x-ish for crispness) ──────────────────────
const W = 1024;
const PAD = 48;
const RADIUS = 36;
const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

const C = {
  cardBg: '#14181b',
  border: 'rgba(255,255,255,0.07)',
  text: '#f2f4f5',
  textSoft: '#d7dadc',
  meta: '#8ba2ad',
  join: '#0a67c2',
  joinText: '#ffffff',
  divider: 'rgba(255,255,255,0.08)',
  upvote: '#ff4500',
};

// Reddit snoo-avatar background palette for users without an avatar image.
const AVATAR_COLORS = ['#ff4500', '#0079d3', '#ea0027', '#ff8717', '#46d160', '#25b79f', '#7193ff', '#ff66ac'];
const avatarColor = (name: string) =>
  AVATAR_COLORS[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR_COLORS.length];

const POST = { avatar: 76, name: 32, time: 28, title: 46, titleLH: 58, body: 36, bodyLH: 52, meta: 30 };
const COMMENT = { avatar: 60, name: 30, time: 26, body: 36, bodyLH: 52 };
const GAP = {
  headerToTitle: 30, titleToBody: 18, bodyToMeta: 30, metaH: 56,
  blockGap: 44, commentHeaderToBody: 18, commentGap: 40,
};

interface TextRow { text: string; x: number; y: number; w: number; h: number; blockIdx: number }
interface BlockSpan { blockIdx: number; topPx: number; bottomPx: number }

function font(weight: number, size: number): string {
  return `${weight} ${size}px ${FONT}`;
}

async function loadAvatar(src?: string): Promise<HTMLImageElement | null> {
  if (!src) return null;
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawAvatar(ctx: CanvasRenderingContext2D, user: RedditUser, img: HTMLImageElement | null, x: number, y: number, d: number) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
  ctx.clip();
  if (img) {
    // cover-fit
    const s = Math.max(d / img.naturalWidth, d / img.naturalHeight);
    const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    ctx.drawImage(img, x + (d - dw) / 2, y + (d - dh) / 2, dw, dh);
  } else {
    ctx.fillStyle = avatarColor(user.name);
    ctx.fillRect(x, y, d, d);
    ctx.fillStyle = '#ffffff';
    ctx.font = font(600, d * 0.5);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(user.name.replace(/^[ur]\//, '').charAt(0).toUpperCase(), x + d / 2, y + d / 2 + d * 0.03);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
}

function drawNameRow(ctx: CanvasRenderingContext2D, user: RedditUser, timeAgo: string | undefined, x: number, cy: number, nameSize: number, timeSize: number) {
  ctx.textBaseline = 'middle';
  ctx.font = font(600, nameSize);
  ctx.fillStyle = C.text;
  ctx.fillText(user.name, x, cy);
  if (timeAgo) {
    const nameW = ctx.measureText(user.name).width;
    ctx.font = font(400, timeSize);
    ctx.fillStyle = C.meta;
    ctx.fillText(`· ${timeAgo}`, x + nameW + 14, cy);
  }
  ctx.textBaseline = 'alphabetic';
}

/** Up/downvote arrows + score + comment bubble + count. Returns nothing narratable. */
function drawMetaRow(ctx: CanvasRenderingContext2D, x: number, cy: number, score?: string, comments?: string) {
  ctx.strokeStyle = C.meta;
  ctx.fillStyle = C.meta;
  ctx.lineWidth = 3.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const arrow = (cx: number, up: boolean) => {
    const s = 11, dir = up ? -1 : 1;
    ctx.beginPath();
    ctx.moveTo(cx - s, cy + (s * 0.45) * -dir);
    ctx.lineTo(cx, cy + s * 0.75 * dir);
    ctx.lineTo(cx + s, cy + (s * 0.45) * -dir);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy + s * 0.7 * dir);
    ctx.lineTo(cx, cy - s * 0.75 * dir);
    ctx.stroke();
  };
  let cx = x + 12;
  ctx.strokeStyle = C.upvote;
  arrow(cx, true);
  cx += 34;
  ctx.font = font(600, POST.meta);
  ctx.textBaseline = 'middle';
  if (score) { ctx.fillStyle = C.text; ctx.fillText(score, cx, cy); cx += ctx.measureText(score).width + 30; }
  ctx.strokeStyle = C.meta;
  arrow(cx, false);
  cx += 44;
  if (comments) {
    // comment bubble
    ctx.beginPath();
    const bs = 13;
    ctx.arc(cx, cy, bs, Math.PI * 0.55, Math.PI * 2.45);
    ctx.lineTo(cx - bs * 0.5, cy + bs * 1.15);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = C.text;
    ctx.fillText(comments, cx + 24, cy);
  }
  ctx.textBaseline = 'alphabetic';
}

export async function renderRedditCard(data: RedditCardData): Promise<RedditCardResult> {
  // Measuring pass uses a throwaway context; layout is computed in px rows, then drawn at exact height.
  const measure = document.createElement('canvas').getContext('2d')!;
  const textW = W - PAD * 2;

  measure.font = font(700, POST.title);
  const titleLines = wrapText(measure, data.title, textW);
  measure.font = font(400, POST.body);
  const bodyLines = data.body ? wrapText(measure, data.body, textW) : [];
  const hasMeta = !!(data.score || data.commentCount);

  const commentBodyX = PAD + COMMENT.avatar + 22;
  const commentLines = data.comments.map(c => {
    measure.font = font(400, COMMENT.body);
    return wrapText(measure, c.body, W - commentBodyX - PAD);
  });

  // ── Vertical layout ────────────────────────────────────────────────────────────────────────────
  const rows: TextRow[] = [];
  const blocks: BlockSpan[] = [];
  let y = PAD;

  const postBlockTop = y;
  y += POST.avatar;                                    // header (avatar row)
  y += GAP.headerToTitle;
  let blockIdx = 0;
  for (const line of titleLines) {
    rows.push({ text: line, x: PAD, y, w: measureWidth(measure, font(700, POST.title), line), h: POST.titleLH, blockIdx });
    y += POST.titleLH;
  }
  if (bodyLines.length) {
    y += GAP.titleToBody;
    blockIdx = 1;
    for (const line of bodyLines) {
      rows.push({ text: line, x: PAD, y, w: measureWidth(measure, font(400, POST.body), line), h: POST.bodyLH, blockIdx });
      y += POST.bodyLH;
    }
  }
  if (hasMeta) { y += GAP.bodyToMeta + GAP.metaH; }
  blocks.push({ blockIdx: 0, topPx: postBlockTop, bottomPx: y });   // whole post (title+body+meta) spans block 0..1

  const commentTops: number[] = [];
  data.comments.forEach((c, i) => {
    y += i === 0 ? GAP.blockGap : GAP.commentGap;
    const top = y;
    commentTops.push(top);
    const cBlock = 2 + i;
    y += COMMENT.avatar + GAP.commentHeaderToBody;
    for (const line of commentLines[i]) {
      rows.push({ text: line, x: commentBodyX, y, w: measureWidth(measure, font(400, COMMENT.body), line), h: COMMENT.bodyLH, blockIdx: cBlock });
      y += COMMENT.bodyLH;
    }
    blocks.push({ blockIdx: cBlock, topPx: top, bottomPx: y });
  });

  const H = Math.round(y + PAD);

  // ── Draw pass ─────────────────────────────────────────────────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = C.cardBg;
  roundRectPath(ctx, 0, 0, W, H, RADIUS);
  ctx.fill();
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 2;
  roundRectPath(ctx, 1, 1, W - 2, H - 2, RADIUS);
  ctx.stroke();

  // post header
  const postAvatar = await loadAvatar(data.user.avatar);
  drawAvatar(ctx, data.user, postAvatar, PAD, PAD, POST.avatar);
  drawNameRow(ctx, data.user, data.timeAgo, PAD + POST.avatar + 22, PAD + POST.avatar / 2, POST.name, POST.time);
  if (data.showJoin !== false) {
    const jw = 118, jh = 58;
    ctx.fillStyle = C.join;
    roundRectPath(ctx, W - PAD - jw, PAD + (POST.avatar - jh) / 2, jw, jh, jh / 2);
    ctx.fill();
    ctx.fillStyle = C.joinText;
    ctx.font = font(600, 28);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Join', W - PAD - jw / 2, PAD + POST.avatar / 2 + 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // narratable text rows
  ctx.textBaseline = 'middle';
  for (const row of rows) {
    const isTitle = row.blockIdx === 0;
    const isComment = row.blockIdx >= 2;
    ctx.font = isTitle ? font(700, POST.title) : font(400, isComment ? COMMENT.body : POST.body);
    ctx.fillStyle = isTitle ? C.text : C.textSoft;
    ctx.fillText(row.text, row.x, row.y + row.h / 2);
  }
  ctx.textBaseline = 'alphabetic';

  // post meta row
  if (hasMeta) {
    const postTextBottom = rows.filter(r => r.blockIdx <= 1).reduce((m, r) => Math.max(m, r.y + r.h), 0);
    drawMetaRow(ctx, PAD - 12, postTextBottom + GAP.bodyToMeta + GAP.metaH / 2, data.score, data.commentCount);
  }

  // comment headers + thread accent
  for (let i = 0; i < data.comments.length; i++) {
    const c = data.comments[i];
    const top = commentTops[i];
    ctx.strokeStyle = C.divider;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PAD, top - (i === 0 ? GAP.blockGap : GAP.commentGap) / 2);
    ctx.lineTo(W - PAD, top - (i === 0 ? GAP.blockGap : GAP.commentGap) / 2);
    ctx.stroke();
    const img = await loadAvatar(c.user.avatar);
    drawAvatar(ctx, c.user, img, PAD, top, COMMENT.avatar);
    drawNameRow(ctx, c.user, c.timeAgo, PAD + COMMENT.avatar + 20, top + COMMENT.avatar / 2, COMMENT.name, COMMENT.time);
  }

  // ── Narration line map ────────────────────────────────────────────────────────────────────────
  // bottomFrac: intra-block → midpoint of the gap to the next line; block end → midpoint of the
  // visual gap before the next block (so headers/meta reveal with their neighbours); last line → 1.
  const lines: MemeLine[] = rows.map((row, i) => {
    const next = rows[i + 1];
    const sameBlock = next && next.blockIdx === row.blockIdx;
    // post title and body narrate as separate blocks but share one visual span (block 0's card
    // section), so a title→body boundary is still just the inter-line midpoint.
    const samePostSpan = next && row.blockIdx <= 1 && next.blockIdx <= 1;
    let boundaryPx: number;
    if (!next) {
      boundaryPx = H;
    } else if (sameBlock || samePostSpan) {
      boundaryPx = (row.y + row.h + next.y) / 2;
    } else {
      const thisSpan = blocks.find(b => row.blockIdx <= 1 ? b.blockIdx === 0 : b.blockIdx === row.blockIdx)!;
      const nextSpan = blocks.find(b => next.blockIdx <= 1 ? b.blockIdx === 0 : b.blockIdx === next.blockIdx)!;
      boundaryPx = (thisSpan.bottomPx + nextSpan.topPx) / 2;
    }
    return {
      text: row.text,
      bottomFrac: Math.min(1, boundaryPx / H),
      endsBlock: !next || next.blockIdx !== row.blockIdx,
      blockIdx: row.blockIdx,
      x0: row.x / W,
      y0: row.y / H,
      x1: (row.x + row.w) / W,
      y1: (row.y + row.h) / H,
    };
  });

  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
  return { blob, width: W, height: H, lines };
}

function measureWidth(ctx: CanvasRenderingContext2D, f: string, text: string): number {
  ctx.font = f;
  return ctx.measureText(text).width;
}
