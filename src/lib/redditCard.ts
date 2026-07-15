// Render a Reddit-style thread card (post + selected comments) to a canvas, returning both the
// image and the narration line map. This is the "synthetic OCR" counterpart of extractMemeLines:
// because WE lay the text out, every narratable line's text, bbox and reveal boundary are exact —
// no Tesseract pass. The result plugs into the existing image-overlay narration pipeline untouched
// (ocrLines → voice brushes → ElevenLabs beats → progressive top-anchored crop).
//
// Visual language mirrors new-Reddit dark mode: pill action buttons under the post, flat threaded
// comments connected by curved rails with ⊖ collapse dots, per-comment vote/Reply/Share rows, blue
// OP badge, multi-paragraph bodies. Chrome (headers, pills, action rows) is never narrated: it
// reveals together with the neighbouring text block, and crop boundaries always sit in visual gaps.

import { wrapText, roundRectPath } from '@/app/components/TemplateEditorCanvas/drawing/helpers';
import type { MemeLine } from './memeOcr';

export interface RedditUser {
  name: string;
  /** Data URI or same-origin URL. Absent → colored initial disc (Reddit-style fallback). */
  avatar?: string;
}

export interface RedditComment {
  user: RedditUser;
  body: string;              // \n\n separates paragraphs
  timeAgo?: string;
  score?: string;            // shown in the comment's action row
  depth?: number;            // 0 = top-level, 1 = reply, 2 = reply-to-reply…
  isOP?: boolean;            // blue OP badge next to the username
}

export interface RedditCardData {
  user: RedditUser;          // post author (u/…) or subreddit (r/…) shown in the header
  timeAgo?: string;
  title: string;
  body?: string;
  score?: string;            // post pill row (drawn if either is present)
  commentCount?: string;
  comments: RedditComment[];
  /** Draw the blue Join pill in the header (default true). */
  showJoin?: boolean;
}

export interface RedditCardResult {
  blob: Blob;
  width: number;
  height: number;
  /** Narratable lines (title/body/comment text only — never usernames, pills or action rows). */
  lines: MemeLine[];
}

// ── Design constants (new-Reddit dark mode, drawn at ~2x for crispness) ─────────────────────────
const W = 1024;
const PAD = 48;
const RADIUS = 36;
const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

const C = {
  cardBg: '#101416',
  border: 'rgba(255,255,255,0.06)',
  text: '#f2f4f5',
  textSoft: '#d7dadc',
  meta: '#94a3ab',
  action: '#aab8bf',
  pillBg: '#1e2528',
  rail: 'rgba(255,255,255,0.16)',
  join: '#0a67c2',
  joinText: '#ffffff',
  op: '#4d9df6',
};

const AVATAR_COLORS = ['#ff4500', '#0079d3', '#ea0027', '#ff8717', '#46d160', '#25b79f', '#7193ff', '#ff66ac'];
const avatarColor = (name: string) =>
  AVATAR_COLORS[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR_COLORS.length];

const POST = { avatar: 76, name: 32, time: 28, title: 46, titleLH: 58, body: 36, bodyLH: 52 };
const CMT = { avatar: 52, name: 29, time: 26, body: 34, bodyLH: 50, indent: 64, actionText: 26, actionH: 44 };
const GAP = {
  headerToTitle: 30, titleToBody: 18, textToPills: 36, pillH: 62, pillsToComments: 44,
  headerToBody: 16, para: 26, bodyToAction: 20, commentGap: 40,
};

interface TextRow { text: string; x: number; y: number; w: number; h: number; blockIdx: number }
interface CommentLayout {
  c: RedditComment; x: number; top: number; avatarCx: number; avatarCy: number;
  actionY: number; bottom: number; hasChild: boolean; parentIdx: number | null;
}

const font = (weight: number, size: number) => `${weight} ${size}px ${FONT}`;

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

function drawNameRow(
  ctx: CanvasRenderingContext2D, user: RedditUser, timeAgo: string | undefined,
  x: number, cy: number, nameSize: number, timeSize: number, isOP = false,
) {
  ctx.textBaseline = 'middle';
  ctx.font = font(600, nameSize);
  ctx.fillStyle = C.text;
  ctx.fillText(user.name, x, cy);
  let cx = x + ctx.measureText(user.name).width;
  if (isOP) {
    ctx.font = font(700, nameSize * 0.85);
    ctx.fillStyle = C.op;
    ctx.fillText('OP', cx + 12, cy);
    cx += 12 + ctx.measureText('OP').width;
  }
  if (timeAgo) {
    ctx.font = font(400, timeSize);
    ctx.fillStyle = C.meta;
    ctx.fillText(`· ${timeAgo}`, cx + 12, cy);
  }
  ctx.textBaseline = 'alphabetic';
}

// Reddit's outline vote arrow: triangular head + open stem, rounded joins.
function voteArrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, up: boolean) {
  const s = size, dir = up ? 1 : -1;
  ctx.save();
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.42, cy + s * 0.5 * dir);
  ctx.lineTo(cx - s * 0.42, cy - s * 0.05 * dir);
  ctx.lineTo(cx - s * 0.7, cy - s * 0.05 * dir);
  ctx.lineTo(cx, cy - s * 0.72 * dir);
  ctx.lineTo(cx + s * 0.7, cy - s * 0.05 * dir);
  ctx.lineTo(cx + s * 0.42, cy - s * 0.05 * dir);
  ctx.lineTo(cx + s * 0.42, cy + s * 0.5 * dir);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function bubbleIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.save();
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI * 0.52, Math.PI * 2.42);
  ctx.lineTo(cx - r * 0.45, cy + r * 1.12);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function shareIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.save();
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();                                  // arrow
  ctx.moveTo(cx - s * 0.1, cy - s * 0.15);
  ctx.quadraticCurveTo(cx - s * 0.75, cy - s * 0.05, cx - s * 0.75, cy + s * 0.6);
  ctx.quadraticCurveTo(cx - s * 0.35, cy + s * 0.05, cx + s * 0.3, cy + s * 0.12);
  ctx.moveTo(cx + s * 0.3, cy + s * 0.12);
  ctx.lineTo(cx + s * 0.3, cy + s * 0.38);
  ctx.lineTo(cx + s * 0.85, cy - s * 0.12);
  ctx.lineTo(cx + s * 0.3, cy - s * 0.62);
  ctx.lineTo(cx + s * 0.3, cy - s * 0.15);
  ctx.stroke();
  ctx.restore();
}

function dotsIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.save();
  ctx.fillStyle = C.action;
  for (const dx of [-11, 0, 11]) {
    ctx.beginPath();
    ctx.arc(cx + dx, cy, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Post action pills: [↑ score ↓] [🗨 count] [↗ Share]. Returns nothing narratable. */
function drawPostPills(ctx: CanvasRenderingContext2D, x: number, top: number, score?: string, comments?: string) {
  const h = GAP.pillH, r = h / 2;
  let cx = x;
  ctx.textBaseline = 'middle';
  const pill = (w: number) => {
    ctx.fillStyle = C.pillBg;
    roundRectPath(ctx, cx, top, w, h, r);
    ctx.fill();
  };
  ctx.font = font(600, 30);
  if (score) {
    const tw = ctx.measureText(score).width;
    const w = 44 + tw + 16 + 44;
    pill(w);
    ctx.strokeStyle = C.text;
    voteArrow(ctx, cx + 30, top + h / 2, 15, true);
    ctx.fillStyle = C.text;
    ctx.font = font(600, 30);
    ctx.fillText(score, cx + 52, top + h / 2 + 1);
    ctx.strokeStyle = C.text;
    voteArrow(ctx, cx + 52 + tw + 26, top + h / 2, 15, false);
    cx += w + 20;
  }
  if (comments) {
    ctx.font = font(600, 30);
    const tw = ctx.measureText(comments).width;
    const w = 58 + tw + 26;
    pill(w);
    ctx.strokeStyle = C.text;
    bubbleIcon(ctx, cx + 32, top + h / 2, 13);
    ctx.fillStyle = C.text;
    ctx.fillText(comments, cx + 56, top + h / 2 + 1);
    cx += w + 20;
  }
  {
    ctx.font = font(600, 30);
    const tw = ctx.measureText('Share').width;
    const w = 62 + tw + 26;
    pill(w);
    ctx.strokeStyle = C.text;
    shareIcon(ctx, cx + 34, top + h / 2, 16);
    ctx.fillStyle = C.text;
    ctx.fillText('Share', cx + 60, top + h / 2 + 1);
  }
  ctx.textBaseline = 'alphabetic';
}

/** Comment action row: ⊖ (on the rail, when threaded) ↑ score ↓  Reply  Share  ···  */
function drawCommentActions(ctx: CanvasRenderingContext2D, x: number, cy: number, score?: string) {
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = C.action;
  ctx.fillStyle = C.action;
  let cx = x;
  voteArrow(ctx, cx + 12, cy, 13, true);
  cx += 34;
  ctx.font = font(600, CMT.actionText);
  if (score) { ctx.fillText(score, cx, cy + 1); cx += ctx.measureText(score).width + 14; }
  voteArrow(ctx, cx + 12, cy, 13, false);
  cx += 46;
  bubbleIcon(ctx, cx + 10, cy, 11);
  ctx.font = font(600, CMT.actionText);
  ctx.fillText('Reply', cx + 30, cy + 1);
  cx += 30 + ctx.measureText('Reply').width + 34;
  shareIcon(ctx, cx + 12, cy, 13);
  ctx.fillText('Share', cx + 32, cy + 1);
  cx += 32 + ctx.measureText('Share').width + 34;
  dotsIcon(ctx, cx + 12, cy);
  ctx.textBaseline = 'alphabetic';
}

const paragraphs = (body: string) => body.split(/\n\s*\n/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);

export async function renderRedditCard(data: RedditCardData): Promise<RedditCardResult> {
  const measure = document.createElement('canvas').getContext('2d')!;
  const textW = W - PAD * 2;

  measure.font = font(700, POST.title);
  const titleLines = wrapText(measure, data.title, textW);
  const postParas = data.body ? paragraphs(data.body) : [];
  const hasPills = !!(data.score || data.commentCount);

  // ── Vertical layout ────────────────────────────────────────────────────────────────────────────
  const rows: TextRow[] = [];
  let y = PAD;

  y += POST.avatar + GAP.headerToTitle;                       // post header
  for (const line of titleLines) {
    measure.font = font(700, POST.title);
    rows.push({ text: line, x: PAD, y, w: measure.measureText(line).width, h: POST.titleLH, blockIdx: 0 });
    y += POST.titleLH;
  }
  if (postParas.length) {
    y += GAP.titleToBody;
    for (const [pi, para] of postParas.entries()) {
      if (pi > 0) y += GAP.para;
      measure.font = font(400, POST.body);
      for (const line of wrapText(measure, para, textW)) {
        rows.push({ text: line, x: PAD, y, w: measure.measureText(line).width, h: POST.bodyLH, blockIdx: 1 });
        y += POST.bodyLH;
      }
    }
  }
  if (hasPills) y += GAP.textToPills + GAP.pillH;
  const postBottom = y;

  const layouts: CommentLayout[] = [];
  const depthStack: number[] = [];                            // layout index of the latest comment at each depth
  data.comments.forEach((c, i) => {
    const depth = Math.max(0, c.depth ?? 0);
    const x = PAD + depth * CMT.indent;
    y += i === 0 ? GAP.pillsToComments : GAP.commentGap;
    const top = y;
    const bodyX = x + CMT.avatar + 18;
    const bodyW = W - bodyX - PAD;
    y += CMT.avatar + GAP.headerToBody;
    const cBlock = 2 + i;
    for (const [pi, para] of paragraphs(c.body).entries()) {
      if (pi > 0) y += GAP.para;
      measure.font = font(400, CMT.body);
      for (const line of wrapText(measure, para, bodyW)) {
        rows.push({ text: line, x: bodyX, y, w: measure.measureText(line).width, h: CMT.bodyLH, blockIdx: cBlock });
        y += CMT.bodyLH;
      }
    }
    y += GAP.bodyToAction;
    const actionY = y + CMT.actionH / 2;
    y += CMT.actionH;
    const parentIdx = depth > 0 ? depthStack[depth - 1] ?? null : null;
    depthStack[depth] = layouts.length;
    depthStack.length = depth + 1;
    layouts.push({
      c, x, top, avatarCx: x + CMT.avatar / 2, avatarCy: top + CMT.avatar / 2,
      actionY, bottom: y, hasChild: false, parentIdx,
    });
    if (parentIdx !== null && layouts[parentIdx]) layouts[parentIdx].hasChild = true;
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

  // thread rails first (behind avatars): parent avatar → curve into child avatar
  ctx.strokeStyle = C.rail;
  ctx.lineWidth = 3;
  for (const l of layouts) {
    if (l.parentIdx === null) continue;
    const p = layouts[l.parentIdx];
    if (!p) continue;
    const px = p.avatarCx;
    ctx.beginPath();
    ctx.moveTo(px, p.avatarCy + CMT.avatar / 2 + 6);
    ctx.lineTo(px, l.avatarCy - 18);
    ctx.quadraticCurveTo(px, l.avatarCy, px + 18, l.avatarCy);
    ctx.lineTo(l.x - 8, l.avatarCy);
    ctx.stroke();
  }

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

  // narratable text
  ctx.textBaseline = 'middle';
  for (const row of rows) {
    const isTitle = row.blockIdx === 0;
    ctx.font = isTitle ? font(700, POST.title) : font(400, row.blockIdx >= 2 ? CMT.body : POST.body);
    ctx.fillStyle = isTitle ? C.text : C.textSoft;
    ctx.fillText(row.text, row.x, row.y + row.h / 2);
  }
  ctx.textBaseline = 'alphabetic';

  // post pills
  if (hasPills) {
    const postTextBottom = rows.filter(r => r.blockIdx <= 1).reduce((m, r) => Math.max(m, r.y + r.h), 0);
    drawPostPills(ctx, PAD, postTextBottom + GAP.textToPills, data.score, data.commentCount);
  }

  // comments: avatar, name row, action row, collapse dot on the rail below threaded parents
  for (const l of layouts) {
    const img = await loadAvatar(l.c.user.avatar);
    drawAvatar(ctx, l.c.user, img, l.x, l.top, CMT.avatar);
    drawNameRow(ctx, l.c.user, l.c.timeAgo, l.x + CMT.avatar + 18, l.avatarCy, CMT.name, CMT.time, l.c.isOP);
    drawCommentActions(ctx, l.x + CMT.avatar + 18, l.actionY, l.c.score);
    if (l.hasChild) {
      // ⊖ on the comment's own column at action-row height, with the rail continuing beneath
      ctx.strokeStyle = C.rail;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(l.avatarCx, l.avatarCy + CMT.avatar / 2 + 6);
      ctx.lineTo(l.avatarCx, l.actionY - 16);
      ctx.stroke();
      ctx.strokeStyle = C.action;
      ctx.beginPath();
      ctx.arc(l.avatarCx, l.actionY, 13, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(l.avatarCx - 6, l.actionY);
      ctx.lineTo(l.avatarCx + 6, l.actionY);
      ctx.stroke();
    }
  }

  // ── Narration line map ────────────────────────────────────────────────────────────────────────
  // bottomFrac: intra-block → midpoint of the gap to the next line; block end → midpoint of the
  // visual gap before the next block (headers/pills/action rows reveal with their neighbours);
  // last line → 1.
  const blockBottom = (blockIdx: number): number =>
    blockIdx <= 1 ? postBottom : layouts[blockIdx - 2]?.bottom ?? H;
  const blockTop = (blockIdx: number): number =>
    blockIdx <= 1 ? PAD : layouts[blockIdx - 2]?.top ?? H;

  const lines: MemeLine[] = rows.map((row, i) => {
    const next = rows[i + 1];
    const sameBlock = next && next.blockIdx === row.blockIdx;
    const samePostSpan = next && row.blockIdx <= 1 && next.blockIdx <= 1;
    let boundaryPx: number;
    if (!next) boundaryPx = H;
    else if (sameBlock || samePostSpan) boundaryPx = (row.y + row.h + next.y) / 2;
    else boundaryPx = (blockBottom(row.blockIdx) + blockTop(next.blockIdx)) / 2;
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
