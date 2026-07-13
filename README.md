# Reels Studio

A client-side reels workspace extracted from the digital-estate app — no Supabase, no auth, no accounts. Everything persists in your browser (localStorage + IndexedDB).

## What it does

- **Reels canvas** — paste a TikTok / Instagram / X link (auto-fetches) or upload a video file, framed into a 1080×1920 reel with a Twitter-style overlay template.
- **Timeline editor** — open the timeline to trim, split/cut, and delete clips; filmstrip thumbnails, zoomable ruler, undo/redo.
- **Export** — renders the composited reel to an H.264 MP4 entirely in the browser (mp4box demux → WebCodecs → mediabunny mux). Download one reel or all reels as a zip.
- **Template editor** — design the reel overlay (text cells, banner, avatar, free elements); templates persist locally.

## Run it

```
npm install
npm run dev
```

Open http://localhost:3000.

## Notes

- Pasting a link uses two small API routes (`/api/download` resolves the link via tikwm/fxtwitter/btch-downloader, `/api/proxy` streams the CDN video past CORS). No auth, no database — but the dev/host server must be running for link-based reels. Uploads are fully client-side.
- Uploaded videos are stored in IndexedDB so they survive reloads; link reels re-fetch from their link on load.
- Export supports H.264 MP4 sources. When a link's HD stream is H.265, the app automatically falls back to the H.264 variant so export always works.
