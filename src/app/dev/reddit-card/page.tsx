'use client';

// Design harness for the Reddit card template — dev-only playground, not linked from the app.
// Renders sample data through the real renderer, then shows: the full card, a simulated
// narration-reveal sequence (the crop steps the reveal system will produce), and the narration
// line map (bboxes + reveal boundaries) for debugging.

import { useEffect, useRef, useState } from 'react';
import { renderRedditCard, type RedditCardData } from '@/lib/redditCard';
import type { MemeLine } from '@/lib/memeOcr';

const SAMPLE: RedditCardData = {
  user: { name: 'u/Raxza' },
  timeAgo: '7h',
  title: 'If you hit a $50 million jackpot on a slot machine, would the casino actually pay you, or find some excuse to wriggle out of it?',
  score: '46',
  commentCount: '108',
  comments: [
    {
      user: { name: 'larphraulen' },
      timeAgo: '6d ago',
      score: '38',
      body: 'I am going to say that if you have any desire to have kids in the future, you will absolutely resent him (for good reason) when that time comes. I almost guarantee you will split then when it\'s very costly and very inconvenient.\n\nEven if he gets *some* of his act together (because he will not 100% based on the amount of time he\'s had to establish this lifestlye), this will still be a lonely, uphill battle.',
    },
    {
      user: { name: 'CursedHunger' },
      timeAgo: '6d ago',
      score: '6',
      depth: 1,
      body: 'I agree 100%.\n\nI speak from my experience, having kids makes life so much harder. You loose all your free time and energy. If you make kids with addicted person, it will only get worse in most cases.',
    },
    {
      user: { name: 'Chocotaco4ever' },
      timeAgo: '6d ago',
      depth: 2,
      isOP: true,
      body: 'This is what I needed to hear. Thank you for being honest with me.',
    },
  ],
};

export default function RedditCardDev() {
  const [img, setImg] = useState<string>('');
  const [lines, setLines] = useState<MemeLine[]>([]);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [debug, setDebug] = useState(false);
  const [revealIdx, setRevealIdx] = useState<number | null>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let url = '';
    renderRedditCard(SAMPLE).then(r => {
      url = URL.createObjectURL(r.blob);
      setImg(url);
      setLines(r.lines);
      setDims({ w: r.width, h: r.height });
    });
    return () => { if (url) URL.revokeObjectURL(url); };
  }, []);

  // debug overlay: line bboxes (green) + reveal boundaries (red)
  useEffect(() => {
    const cv = overlayRef.current;
    if (!cv || !dims.w) return;
    cv.width = dims.w; cv.height = dims.h;
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, dims.w, dims.h);
    if (!debug) return;
    for (const l of lines) {
      ctx.strokeStyle = 'rgba(70,209,96,0.8)';
      ctx.lineWidth = 2;
      ctx.strokeRect(l.x0 * dims.w, l.y0 * dims.h, (l.x1 - l.x0) * dims.w, (l.y1 - l.y0) * dims.h);
      ctx.strokeStyle = 'rgba(255,69,0,0.9)';
      ctx.beginPath();
      ctx.moveTo(0, l.bottomFrac * dims.h);
      ctx.lineTo(dims.w, l.bottomFrac * dims.h);
      ctx.stroke();
    }
  }, [debug, lines, dims]);

  const visibleFrac = revealIdx === null ? 1 : lines[revealIdx]?.bottomFrac ?? 1;
  const display = 420;
  const scale = dims.w ? display / dims.w : 1;

  return (
    <div style={{ minHeight: '100vh', background: '#0b0d0e', color: '#d7dadc', padding: 32, fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>Reddit card template — design harness</h1>
      <p style={{ fontSize: 13, color: '#8ba2ad', marginBottom: 20 }}>
        Real renderer output. Use the reveal slider to preview the narration crop; toggle debug to see the line map.
      </p>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 24, fontSize: 13 }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={debug} onChange={e => setDebug(e.target.checked)} /> line map
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          reveal step
          <input
            type="range" min={-1} max={lines.length - 1} step={1}
            value={revealIdx === null ? lines.length - 1 : revealIdx}
            onChange={e => { const v = Number(e.target.value); setRevealIdx(v < 0 ? 0 : v); }}
            style={{ width: 260 }}
          />
          <span style={{ minWidth: 120 }}>
            {revealIdx === null ? 'full card' : `after line ${revealIdx + 1}: “${lines[revealIdx]?.text.slice(0, 24)}…”`}
          </span>
          <button onClick={() => setRevealIdx(null)} style={{ background: '#1a3a5c', color: '#fff', border: 0, borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>full</button>
        </label>
      </div>
      {img && (
        <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start' }}>
          {/* reveal-cropped view, as the reel will show it */}
          <div style={{ width: display, overflow: 'hidden', position: 'relative', borderRadius: 12 }}>
            <div style={{ height: dims.h * scale * visibleFrac, overflow: 'hidden' }}>
              <img src={img} width={display} alt="reddit card (reveal preview)" style={{ display: 'block' }} />
            </div>
          </div>
          {/* full card + debug overlay */}
          <div style={{ position: 'relative', width: display }}>
            <img src={img} width={display} alt="reddit card (full)" style={{ display: 'block', borderRadius: 12 }} />
            <canvas
              ref={overlayRef}
              style={{ position: 'absolute', inset: 0, width: display, height: dims.h * scale, pointerEvents: 'none' }}
            />
          </div>
        </div>
      )}
      <div style={{ marginTop: 24, fontSize: 12, color: '#8ba2ad' }}>
        {lines.length} narratable lines · blocks: {new Set(lines.map(l => l.blockIdx)).size} · {dims.w}×{dims.h}px
      </div>
    </div>
  );
}
