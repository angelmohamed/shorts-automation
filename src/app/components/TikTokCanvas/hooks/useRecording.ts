'use client';

import { useState, useRef } from 'react';
import type { MutableRefObject, RefObject } from 'react';

// @ts-expect-error -- mp4box ships no usable type declarations
import MP4Box from 'mp4box';

import {
  CANVAS_W, CANVAS_H, CAPTION_LINE_HEIGHT, HEADER_PADDING_X,
} from '../constants';
import { drawHeaderOnContext, computeSonotradeHeaderHeight } from '../drawing/drawHeader';
import { drawReelCells, drawFreeElements, reelLayout, reelVideoRect, ensureReelTextFontsLoaded, shiftFreeElementsForReelCrop } from '../drawing/drawReelCell';
import { drawMarketRow } from '../drawing/drawMarketRow';
import { trackById, trackStreamSrc, DEFAULT_MUSIC_VOLUME } from '@/lib/music';
import { drawImageOverlays } from '../drawing/drawOverlays';
import { getOverlayImage } from '@/lib/localVideoStore';
import { countCaptionLines } from '../drawing/countCaptionLines';
import type { Box, ImageOverlay, MarketData } from '../types';
import type { TwitterTemplateSettings } from '../../twitterTemplateTypes';
import type { EncodedAudioPacketSource as TEncodedAudioPacketSource, EncodedPacket as TEncodedPacket } from 'mediabunny';

// Local blobs (uploads / byte-cached downloads) are fetched directly; anything remote goes through
// /api/proxy (same-origin URLs like the proxy itself are also direct-fetchable).
function isDirectFetchable(url: string): boolean {
  if (url.startsWith('blob:')) return true;   // byte-cached local blob
  return url.startsWith('/');                 // same-origin (e.g. an /api/proxy stream URL)
}

export interface UseRecordingConfig {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  brand: string;
  rowNumber: number;
  videoId?: string;
  boxRef: MutableRefObject<Box>;
  videoOffsetRef: MutableRefObject<{ x: number; y: number }>;
  videoScaleRef: MutableRefObject<number>;
  trimStartRef: MutableRefObject<number>;
  trimEndRef: MutableRefObject<number>;
  includeEditRef: MutableRefObject<boolean>;
  logoImgRef: MutableRefObject<HTMLImageElement | null>;
  verifiedImgRef: MutableRefObject<HTMLImageElement | null>;
  overlayCaption: string;
  overlayLogoSrc: string;
  overlayDisplayName: string;
  overlayHandle: string;
  overlayVerified: boolean;
  marketData?: MarketData | null;
  /** Image overlays (topmost layer); drawn on frames whose source time is inside [start,end]. */
  overlaysRef?: MutableRefObject<ImageOverlay[]>;
  overlayImgsRef?: MutableRefObject<Map<string, HTMLImageElement>>;
  marketAvatarImgRef?: MutableRefObject<HTMLImageElement | null>;
  marketAvatarUrlRef?: MutableRefObject<string | null>;
  twitterSettings: TwitterTemplateSettings;
  /** Background-music track id (lib/music.ts) — mixed under the export audio. */
  musicIdRef?: MutableRefObject<string | null>;
  /** Music bed volume 0..1 (default DEFAULT_MUSIC_VOLUME). */
  musicVolumeRef?: MutableRefObject<number>;
}

export function useRecording(config: UseRecordingConfig) {
  const [isRecording, setIsRecording] = useState(false);
  const [recProgress, setRecProgressRaw] = useState(0);
  const [recStatus, setRecStatus] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);
  // The encode loop reports progress per frame — hundreds of awaited micro-steps in one async chain.
  // React dev treats that as a nested-update cascade ("maximum update depth"), so throttle the actual
  // setState to meaningful changes; terminal values (0 / 1) always pass so the UI can't miss the end.
  const lastProgressRef = useRef(0);
  const setRecProgress = (p: number) => {
    if (p !== 0 && p !== 1 && Math.abs(p - lastProgressRef.current) < 0.01) return;
    lastProgressRef.current = p;
    setRecProgressRaw(p);
  };

  async function startRecording(opts?: { returnBlob?: boolean }): Promise<Blob | void> {
    const {
      canvasRef, videoRef, brand, rowNumber, videoId,
      boxRef, videoOffsetRef, videoScaleRef,
      trimStartRef, trimEndRef, includeEditRef,
      logoImgRef, verifiedImgRef,
      overlaysRef, overlayImgsRef,
      overlayCaption, overlayLogoSrc, overlayDisplayName, overlayHandle, overlayVerified,
      marketData, marketAvatarImgRef, marketAvatarUrlRef,
      twitterSettings,
      musicIdRef, musicVolumeRef,
    } = config;

    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || isRecording) throw new Error('Cannot start recording');

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const signal = abortController.signal;

    setIsRecording(true);
    setRecProgress(0);
    setRecStatus('Initializing...');

    const isClean = brand === 'clean';
    const cellMode = brand !== 'clean' && !marketData;   // reel cell layout (market reels keep the legacy layout)
    // A terminal status (error, "Saved:", "Exported without audio") is set on the same synchronous
    // job as the finally below, so without this flag the finally's setRecStatus('') coalesces it away
    // and it never renders. Set it wherever a status must survive to be seen (its own timeout clears it).
    let keepStatus = false;

    try {
      const mediabunny = await import('mediabunny');
      const {
        Output, Mp4OutputFormat, BufferTarget, VideoSample, VideoSampleSource,
        EncodedAudioPacketSource, EncodedVideoPacketSource, EncodedPacketSink, EncodedPacket,
        Input, BlobSource, ALL_FORMATS, QUALITY_HIGH,
      } = mediabunny;

      const EXPORT_FPS = 30;
      const EXPORT_FRAME_DURATION = 1 / EXPORT_FPS;

      const headerDrawOpts = {
        overlayCaption, overlayLogoSrc, overlayDisplayName, overlayHandle, overlayVerified,
        logoImgRef, verifiedImgRef, s: twitterSettings,
      };

      async function mergeWithEdit(mainBuffer: ArrayBuffer, mainDuration: number): Promise<ArrayBuffer> {
        setRecStatus('Appending edit clip...');

        const editResp = await fetch('/edit.mp4');
        if (!editResp.ok) throw new Error(`Failed to fetch edit.mp4: ${editResp.status}`);
        const editArrayBuffer = await editResp.arrayBuffer();

        const mkMain = () => new Input({ source: new BlobSource(new Blob([mainBuffer], { type: 'video/mp4' })), formats: ALL_FORMATS });
        const mkEdit = () => new Input({ source: new BlobSource(new Blob([editArrayBuffer], { type: 'video/mp4' })), formats: ALL_FORMATS });

        const mainVideoTrack = await mkMain().getPrimaryVideoTrack();
        const editVideoTrack = await mkEdit().getPrimaryVideoTrack();
        if (!mainVideoTrack || !editVideoTrack) throw new Error('Missing video track for merge');

        const mainVideoConfig = await mainVideoTrack.getDecoderConfig();
        const editVideoConfig = await editVideoTrack.getDecoderConfig();

        const mainVPackets: TEncodedPacket[] = [];
        for await (const p of new EncodedPacketSink(mainVideoTrack).packets()) mainVPackets.push(p);
        let editVPackets: TEncodedPacket[] = [];
        for await (const p of new EncodedPacketSink(editVideoTrack).packets()) editVPackets.push(p);
        if (editVPackets.length > 0) {
          const firstTs = editVPackets[0].timestamp;
          editVPackets = editVPackets.map(p => p.clone({ timestamp: p.timestamp - firstTs + mainDuration }));
        }

        const MERGED_SR = 44100;
        const AFRAME = 1024;
        const allAudioPackets: TEncodedPacket[] = [];
        let sharedAudioConfig: AudioDecoderConfig | null = null;
        setRecStatus('Mixing audio...');
        try {
          if (typeof AudioEncoder === 'undefined' || typeof OfflineAudioContext === 'undefined')
            throw new Error('Web Audio API not supported');

          const tempCtx = new AudioContext({ sampleRate: MERGED_SR });
          let mainAudioBuffer: AudioBuffer;
          try { mainAudioBuffer = await tempCtx.decodeAudioData(mainBuffer.slice(0)); }
          catch { mainAudioBuffer = tempCtx.createBuffer(2, Math.ceil(mainDuration * MERGED_SR), MERGED_SR); }
          const editAudioBuffer = await tempCtx.decodeAudioData(editArrayBuffer.slice(0));
          await tempCtx.close();

          const totalSamples = Math.ceil((mainDuration + editAudioBuffer.duration) * MERGED_SR);
          const mixCh = 2;
          const offCtx = new OfflineAudioContext(mixCh, totalSamples, MERGED_SR);
          const ms = offCtx.createBufferSource(); ms.buffer = mainAudioBuffer; ms.connect(offCtx.destination); ms.start(0);
          const es = offCtx.createBufferSource(); es.buffer = editAudioBuffer; es.connect(offCtx.destination); es.start(mainDuration);
          const mixed = await offCtx.startRendering();

          const mixLen = mixed.length;
          const chunks: EncodedAudioChunk[] = [];
          let encCfg: AudioDecoderConfig | null = null;
          let encErr: Error | null = null;
          const enc = new AudioEncoder({
            output: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => {
              chunks.push(chunk);
              if (meta?.decoderConfig && !encCfg) encCfg = meta.decoderConfig;
            },
            error: (e: Error) => { encErr = e; },
          });
          enc.configure({ codec: 'mp4a.40.2', sampleRate: MERGED_SR, numberOfChannels: mixCh, bitrate: 128_000 });

          const chData = Array.from({ length: mixCh }, (_, c) => mixed.getChannelData(c));
          let tMicros = 0;
          for (let offset = 0; offset < mixLen; offset += AFRAME) {
            const fc = Math.min(AFRAME, mixLen - offset);
            const planar = new Float32Array(fc * mixCh);
            for (let c = 0; c < mixCh; c++) {
              const src = chData[c];
              for (let i = 0; i < fc; i++) planar[c * fc + i] = src[offset + i] ?? 0;
            }
            const ad = new AudioData({ format: 'f32-planar', sampleRate: MERGED_SR, numberOfFrames: fc, numberOfChannels: mixCh, timestamp: tMicros, data: planar });
            enc.encode(ad);
            ad.close();
            tMicros += Math.round((fc / MERGED_SR) * 1_000_000);
          }
          await enc.flush();
          enc.close();
          if (encErr) throw encErr;

          if (chunks.length > 0) {
            if (!encCfg) {
              const sfIdx = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350].indexOf(MERGED_SR);
              const si = sfIdx >= 0 ? sfIdx : 4;
              encCfg = { codec: 'mp4a.40.2', sampleRate: MERGED_SR, numberOfChannels: mixCh, description: new Uint8Array([(2 << 3) | (si >> 1), ((si & 1) << 7) | (mixCh << 3)]) };
            }
            sharedAudioConfig = encCfg;
            for (const chunk of chunks) allAudioPackets.push(EncodedPacket.fromEncodedChunk(chunk));
          }
        } catch (audioErr) {
          console.error('[mergeWithEdit] audio mix/encode failed:', audioErr);
        }

        const mergeOut = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
        const mergeVSrc = new EncodedVideoPacketSource('avc');
        mergeOut.addVideoTrack(mergeVSrc);
        let mergeASrc: TEncodedAudioPacketSource | null = null;
        if (allAudioPackets.length > 0) {
          mergeASrc = new EncodedAudioPacketSource('aac');
          mergeOut.addAudioTrack(mergeASrc);
        }
        await mergeOut.start();
        for (let i = 0; i < mainVPackets.length; i++) await mergeVSrc.add(mainVPackets[i], i === 0 && mainVideoConfig ? { decoderConfig: mainVideoConfig } : undefined);
        for (let i = 0; i < editVPackets.length; i++) await mergeVSrc.add(editVPackets[i], i === 0 && editVideoConfig ? { decoderConfig: editVideoConfig } : undefined);
        if (mergeASrc) {
          for (let i = 0; i < allAudioPackets.length; i++) await mergeASrc.add(allAudioPackets[i], i === 0 && sharedAudioConfig ? { decoderConfig: sharedAudioConfig } : undefined);
        }
        setRecStatus('Finalizing merged video...');
        await mergeOut.finalize();
        const merged = mergeOut.target.buffer;
        if (!merged) throw new Error('No buffer from merge output');
        return merged;
      }

      // ── Fetch + demux source video ────────────────────────────────────────────
      const videoSrcUrl = video.src || video.currentSrc;
      const videoUrl = isDirectFetchable(videoSrcUrl)     // local blob or same-origin
        ? videoSrcUrl
        : videoSrcUrl.includes('/api/proxy')
          ? videoSrcUrl
          : `/api/proxy?url=${encodeURIComponent(videoSrcUrl)}&stream=1`;

      setRecStatus('Downloading video file...');
      let arrayBuffer: ArrayBuffer;
      try {
        const response = await fetch(videoUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        arrayBuffer = await response.arrayBuffer();
      } catch (fetchError) {
        console.error('[EXPORT] ❌ Download failed:', fetchError);
        throw new Error(`Failed to download video: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}`);
      }

      setRecStatus('Parsing video file...');

      const MP4BoxFile = MP4Box.createFile();
      const videoSamples: Array<{ data: Uint8Array; timestamp: number; duration: number; isKeyframe: boolean }> = [];
      const audioSamples: Array<{ data: Uint8Array; timestamp: number; duration: number }> = [];
      let videoTrackId: number | null = null;
      let audioTrackId: number | null = null;
      let videoTimescale = 90000;
      let audioTimescale = 44100;

      MP4BoxFile.onReady = (info: { tracks?: Array<{ id: number; type: string; timescale?: number }> }) => {
        for (const track of info.tracks || []) {
          if (track.type === 'video' && !videoTrackId) { videoTrackId = track.id; videoTimescale = track.timescale || 90000; }
          if (track.type === 'audio' && !audioTrackId) { audioTrackId = track.id; audioTimescale = track.timescale || 44100; }
        }
        if (videoTrackId) MP4BoxFile.setExtractionOptions(videoTrackId, null, { nbSamples: Infinity });
        if (audioTrackId) MP4BoxFile.setExtractionOptions(audioTrackId, null, { nbSamples: Infinity });
        MP4BoxFile.start();
      };

      MP4BoxFile.onSamples = (id: number, _user: unknown, samples: Array<{ data: ArrayBuffer; cts: number; duration: number; is_sync: boolean }>) => {
        if (id === videoTrackId) {
          for (const s of samples) videoSamples.push({ data: new Uint8Array(s.data), timestamp: s.cts / videoTimescale, duration: s.duration / videoTimescale, isKeyframe: s.is_sync });
        }
        if (id === audioTrackId) {
          for (const s of samples) audioSamples.push({ data: new Uint8Array(s.data), timestamp: s.cts / audioTimescale, duration: s.duration / audioTimescale });
        }
      };

      MP4BoxFile.onError = (e: unknown) => console.error('[EXPORT] ❌ MP4Box error:', e);

      const copy = arrayBuffer.slice(0);
      // @ts-expect-error -- mp4box ships no usable type declarations
      copy.fileStart = 0;
      MP4BoxFile.appendBuffer(copy);
      MP4BoxFile.flush();

      await new Promise<void>((resolve, reject) => {
        const t = Date.now();
        const id = setInterval(() => {
          if (videoSamples.length > 0) { clearInterval(id); resolve(); }
          else if (Date.now() - t > 10000) { clearInterval(id); reject(new Error('Timeout extracting video samples')); }
        }, 100);
      });

      if (videoSamples.length === 0) throw new Error('No video samples found');

      const lastSample = videoSamples[videoSamples.length - 1];
      const fullDuration = lastSample.timestamp + lastSample.duration;
      const clipStart = trimStartRef.current;
      let clipEnd = trimEndRef.current > 0 && trimEndRef.current <= fullDuration ? trimEndRef.current : fullDuration;

      // Narrated reels: the background video runs `audioRate`× fast (baked into the overlay), and
      // the clip stops one wall-clock second after the narrator finishes — no dead air.
      const narrated = (overlaysRef?.current ?? []).filter(o => o.audioId && (o.audioDuration ?? 0) > 0);
      const videoRate = narrated.length ? Math.max(1, ...narrated.map(o => o.audioRate ?? 1)) : 1;
      const POST_NARRATION_PAD_S = 1;   // wall-clock seconds of video after the voice-over ends
      if (narrated.length > 0) {
        const narrEndSource = Math.max(...narrated.map(o => (o.audioStart ?? o.start) + (o.audioDuration ?? 0) * (o.audioRate ?? 1)));
        clipEnd = Math.max(clipStart + 0.1, Math.min(clipEnd, narrEndSource + POST_NARRATION_PAD_S * videoRate));
      }

      const clipDuration = Math.max(0.1, clipEnd - clipStart);
      const outputDuration = clipDuration / videoRate;   // sped-up video compresses the output timeline
      const totalFrames = Math.floor(outputDuration * EXPORT_FPS);

      // ── Extract AVC decoder description from MP4Box ──────────────────────────
      let description: Uint8Array | undefined;
      if (typeof MP4BoxFile.getSampleDescription === 'function') {
        const descs = MP4BoxFile.getSampleDescription(videoTrackId);
        if (descs?.[0]) description = descs[0].avcC?.config || descs[0].avcC;
      }
      if (!description) {
        try {
          const stsd = MP4BoxFile.getTrackById(videoTrackId)?.mdia?.minf?.stbl?.stsd;
          const entry = stsd?.entries?.[0];
          if (entry?.avcC?.config?.length > 0) description = new Uint8Array(entry.avcC.config);
          else if (typeof entry?.avcC?.subarray === 'function') description = entry.avcC.subarray();
          else if (typeof entry?.avcC?.start !== 'undefined' && entry?.avcC?.size) description = new Uint8Array(arrayBuffer, entry.avcC.start + 8, entry.avcC.size - 8);
        } catch (descErr) { console.warn('[EXPORT] description extraction fallback failed:', descErr); }
      }
      if (!description) {
        // No AVC config = the source isn't H.264/MP4 (e.g. an HEVC or WebM upload). The decoder is
        // AVC-only, so fail now with a message the user can act on instead of a cryptic decoder crash.
        throw new Error('This video can’t be exported — only H.264 MP4 videos are supported. Try a different file.');
      }

      // ── Set up output container + audio BEFORE decoding so we can stream ─────
      setRecStatus('Preparing audio...');

      const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
      const videoSource = new VideoSampleSource({ codec: 'avc', bitrate: QUALITY_HIGH });
      output.addVideoTrack(videoSource);

      let audioSource: TEncodedAudioPacketSource | null = null;
      let audioPackets: TEncodedPacket[] = [];
      let audioDecoderConfigForExport: AudioDecoderConfig | null = null;

      // ── Narration track ───────────────────────────────────────────────────────
      // Overlays with ElevenLabs narration replace the source audio outright (the underlying video
      // is muted — the meme voice-over IS the audio): decode the narration(s), place them on the
      // export timeline in an OfflineAudioContext, re-encode AAC. The fast AAC packet-copy path
      // below can't do that, so a narrated reel whose mix fails exports silent (source audio would
      // be desynced anyway once the video is sped up).
      const musicTrack = trackById(musicIdRef?.current);
      if ((narrated.length > 0 || musicTrack) && typeof AudioEncoder !== 'undefined' && typeof OfflineAudioContext !== 'undefined') {
        setRecStatus('Mixing narration...');
        try {
          const MIX_SR = 44100, MIX_CH = 2, AFRAME = 1024;
          const tempCtx = new AudioContext({ sampleRate: MIX_SR });
          const narrBufs: { start: number; buf: AudioBuffer }[] = [];
          for (const o of narrated) {
            const rec = await getOverlayImage(o.audioId!);
            if (!rec) continue;
            try {
              narrBufs.push({ start: (o.audioStart ?? o.start), buf: await tempCtx.decodeAudioData(await rec.blob.arrayBuffer()) });
            } catch { /* skip an undecodable narration */ }
          }
          // Background music: decoded once, looped across the whole output at a low gain.
          let musicBuf: AudioBuffer | null = null;
          if (musicTrack) {
            try {
              const res = await fetch(trackStreamSrc(musicTrack));
              if (res.ok) musicBuf = await tempCtx.decodeAudioData(await res.arrayBuffer());
            } catch { /* music is optional — export continues without it */ }
          }
          // With music but NO narration the source audio must join this mix (the packet-copy path
          // below can't blend); narration always mutes the source, so it never joins when narrated.
          let sourceBuf: AudioBuffer | null = null;
          if (narrated.length === 0 && musicBuf && audioSamples.length > 0) {
            try { sourceBuf = await tempCtx.decodeAudioData(arrayBuffer.slice(0)); }
            catch { /* keep music-only rather than dropping the mix */ }
          }
          await tempCtx.close();

          if (narrBufs.length > 0 || musicBuf) {
            const offA = new OfflineAudioContext(MIX_CH, Math.ceil(outputDuration * MIX_SR), MIX_SR);
            for (const n of narrBufs) {
              const src = offA.createBufferSource();
              src.buffer = n.buf;
              src.connect(offA.destination);
              // Narration anchor on the OUTPUT timeline: source-time offset compressed by the
              // video speed-up (the voice itself plays at 1×).
              const when = (n.start - clipStart) / videoRate;
              if (when >= 0) src.start(when);
              else src.start(0, -when);           // clip starts mid-narration → skip its head
            }
            if (musicBuf) {
              const gain = offA.createGain();
              gain.gain.value = musicVolumeRef?.current ?? DEFAULT_MUSIC_VOLUME;
              gain.connect(offA.destination);
              const src = offA.createBufferSource();
              src.buffer = musicBuf;
              src.loop = true;                     // covers any output length
              src.connect(gain);
              src.start(0);
            }
            if (sourceBuf) {
              const src = offA.createBufferSource();
              src.buffer = sourceBuf;
              src.connect(offA.destination);
              src.start(0, clipStart);             // videoRate is 1 without narration
            }
            const mixed = await offA.startRendering();

            const chunks: EncodedAudioChunk[] = [];
            let encCfg: AudioDecoderConfig | null = null;
            let encErr: Error | null = null;
            const enc = new AudioEncoder({
              output: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => {
                chunks.push(chunk);
                if (meta?.decoderConfig && !encCfg) encCfg = meta.decoderConfig;
              },
              error: (e: Error) => { encErr = e; },
            });
            enc.configure({ codec: 'mp4a.40.2', sampleRate: MIX_SR, numberOfChannels: MIX_CH, bitrate: 128_000 });
            const chData = Array.from({ length: MIX_CH }, (_, c) => mixed.getChannelData(c));
            let tMicros = 0;
            for (let offset = 0; offset < mixed.length; offset += AFRAME) {
              const fc = Math.min(AFRAME, mixed.length - offset);
              const planar = new Float32Array(fc * MIX_CH);
              for (let c = 0; c < MIX_CH; c++) {
                const chan = chData[c];
                for (let i = 0; i < fc; i++) planar[c * fc + i] = chan[offset + i] ?? 0;
              }
              const ad = new AudioData({ format: 'f32-planar', sampleRate: MIX_SR, numberOfFrames: fc, numberOfChannels: MIX_CH, timestamp: tMicros, data: planar });
              enc.encode(ad);
              ad.close();
              tMicros += Math.round((fc / MIX_SR) * 1_000_000);
            }
            await enc.flush();
            enc.close();
            if (encErr) throw encErr;

            if (chunks.length > 0) {
              if (!encCfg) {
                const sfIdx = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350].indexOf(MIX_SR);
                const si = sfIdx >= 0 ? sfIdx : 4;
                encCfg = { codec: 'mp4a.40.2', sampleRate: MIX_SR, numberOfChannels: MIX_CH, description: new Uint8Array([(2 << 3) | (si >> 1), ((si & 1) << 7) | (MIX_CH << 3)]) };
              }
              audioSource = new EncodedAudioPacketSource('aac');
              output.addAudioTrack(audioSource);
              audioPackets = chunks.map(chunk => EncodedPacket.fromEncodedChunk(chunk));
              audioDecoderConfigForExport = encCfg;
            }
          }
        } catch (e) {
          console.error('[narration mix] failed — exporting without audio:', e);
        }
      }

      if (!audioSource && narrated.length === 0 && audioSamples.length > 0) {
        try {
          const input = new Input({ source: new BlobSource(new Blob([arrayBuffer], { type: 'video/mp4' })), formats: ALL_FORMATS });
          const audioTrack = await input.getPrimaryAudioTrack();
          if (audioTrack) {
            audioDecoderConfigForExport = await audioTrack.getDecoderConfig();
            audioSource = new EncodedAudioPacketSource('aac');
            output.addAudioTrack(audioSource);
            const sink = new EncodedPacketSink(audioTrack);
            for await (const packet of sink.packets()) audioPackets.push(packet);
            const firstTs = audioPackets[0]?.timestamp || 0;
            audioPackets = audioPackets
              .map(p => p.clone({ timestamp: p.timestamp - firstTs }))
              .filter(p => p.timestamp >= clipStart && p.timestamp < clipEnd);
            if (audioPackets.length > 0) {
              const firstTrim = audioPackets[0].timestamp;
              audioPackets = audioPackets.map(p => p.clone({ timestamp: p.timestamp - firstTrim }));
            }
          }
        } catch (e) { console.error('[audio setup]', e); }
      }
      // The source had audio but it failed to extract/trim → the export will be silent. Surfaced after
      // finalize so the user knows before they discover it on Instagram.
      const audioDropped = audioSamples.length > 0 && (!audioSource || audioPackets.length === 0);

      // Ensure logo is loaded with crossOrigin=anonymous — the preview canvas may have
      // cached it without CORS, which would taint the OffscreenCanvas and fail VideoSample.
      if (overlayLogoSrc && (!logoImgRef.current?.crossOrigin)) {
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => { logoImgRef.current = img; resolve(); };
          img.onerror = () => resolve();
          img.src = overlayLogoSrc;
        });
      }

      // Pre-load market avatar with CORS so it doesn't taint the OffscreenCanvas.
      if (marketData?.photo_url && marketAvatarImgRef) {
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => { marketAvatarImgRef.current = img; resolve(); };
          img.onerror = () => resolve();
          img.src = marketData.photo_url!;
        });
      }

      // Pre-load any cell images (CORS) so they're ready for every exported frame.
      const cellImgs = new Map<string, HTMLImageElement>();
      for (const url of [
        twitterSettings.cellTop?.imageUrl, twitterSettings.cellTop2?.imageUrl, twitterSettings.cellBottom?.imageUrl, twitterSettings.cellBottom2?.imageUrl,
        twitterSettings.cellTop?.banner?.avatarUrl, twitterSettings.cellTop2?.banner?.avatarUrl, twitterSettings.cellBottom?.banner?.avatarUrl, twitterSettings.cellBottom2?.banner?.avatarUrl,
        ...(twitterSettings.freeElements ?? []).map(el => el.type === 'image' ? el.imageUrl : (el.type === 'banner' || el.type === 'bannerText') ? el.banner?.avatarUrl : undefined),
      ]) {
        if (!url || cellImgs.has(url)) continue;
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => { cellImgs.set(url, img); resolve(); };
          img.onerror = () => resolve();
          img.src = url;
        });
      }

      // Ensure text-cell fonts are loaded before drawing any frame, so exports bake in the chosen font.
      await ensureReelTextFontsLoaded(twitterSettings);

      // Ensure every image overlay is decoded before the frame loop (object URLs — no CORS taint).
      for (const o of overlaysRef?.current ?? []) {
        if (!o.src) continue;
        const existing = overlayImgsRef?.current.get(o.id);
        if (existing?.complete && existing.naturalWidth > 0) continue;
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => { overlayImgsRef?.current.set(o.id, img); resolve(); };
          img.onerror = () => resolve();
          img.src = o.src!;
        });
      }

      await output.start();

      // ── Streaming decode + render ────────────────────────────────────────────
      // The previous design queued ALL chunks then awaited flush(), which
      // deadlocks: the decoder's GPU frame pool fills up after a handful of
      // outputs, and frames never get closed until flush returns. Now we
      // consume + close frames as they arrive so the pool stays drained.
      setRecStatus('Encoding...');

      const frameQueue: Array<{ frame: VideoFrame; ts: number }> = [];
      let decoderError: Error | null = null;
      let producerDone = false;
      let consumerWaiter: (() => void) | null = null;
      let producerWaiter: (() => void) | null = null;
      const wakeConsumer = () => { const r = consumerWaiter; consumerWaiter = null; r?.(); };
      const wakeProducer = () => { const r = producerWaiter; producerWaiter = null; r?.(); };

      // Bounded wait for the next decoded frame. A silently-stalled VideoDecoder — Windows hardware decode
      // can stop emitting frames with NO `output` and NO `error` — would otherwise leave the consumer (and
      // the whole export) hanging forever. A healthy decoder emits frames in milliseconds, so 20s with zero
      // new frames is a definite stall: reject so the export fails cleanly (and retryable) instead of freezing.
      const STALL_MS = 20_000;
      const waitForFrame = () => new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Video export stalled while decoding — please try again.')), STALL_MS);
        consumerWaiter = () => { clearTimeout(t); resolve(); };
      });

      const decoder = new VideoDecoder({
        output: (frame: VideoFrame) => {
          frameQueue.push({ frame, ts: frame.timestamp / 1_000_000 });
          wakeConsumer();
        },
        error: (e: Error) => {
          decoderError = e;
          console.error('[EXPORT] ❌ VideoDecoder error:', e, 'name:', e?.name, 'message:', e?.message);
          wakeConsumer();
          wakeProducer();
        },
      });

      decoder.configure({ codec: 'avc1.64001F', codedWidth: 1080, codedHeight: 1920, description });

      // Cap how many decoded frames sit in memory before the producer waits.
      // Empirically Chromium's H.264 decoder needs ~4-8 frames in flight for
      // reorder buffer; 12 leaves headroom without blowing GPU memory.
      const MAX_BUFFERED = 12;

      const producer = (async () => {
        try {
          for (let i = 0; i < videoSamples.length; i++) {
            if (signal.aborted) throw new Error('Cancelled');
            if (decoderError) throw decoderError;
            while (frameQueue.length >= MAX_BUFFERED) {
              await new Promise<void>((r) => { producerWaiter = r; });
              if (signal.aborted) throw new Error('Cancelled');
              if (decoderError) throw decoderError;
            }
            const s = videoSamples[i];
            decoder.decode(new EncodedVideoChunk({
              type: s.isKeyframe ? 'key' : 'delta',
              timestamp: s.timestamp * 1_000_000,
              data: s.data,
            }));
            setRecProgress(0.05 + (i / videoSamples.length) * 0.1);
          }
          // Bound flush too: decoder.flush() can hang on a stalled hardware decoder, which would leave the
          // final `await producer` below hanging forever. A healthy flush is near-instant (frames stream out
          // continuously above), so a generous timeout never cuts a real one.
          let flushTimer: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([
            decoder.flush().finally(() => clearTimeout(flushTimer)),
            new Promise<never>((_, reject) => { flushTimer = setTimeout(() => reject(new Error('Video export stalled (decoder flush timed out) — please try again.')), STALL_MS + 10_000); }),
          ]);
        } finally {
          producerDone = true;
          wakeConsumer();
        }
      })();
      // Surface producer failure to the consumer loop.
      producer.catch((e) => {
        if (!decoderError) decoderError = e instanceof Error ? e : new Error(String(e));
        producerDone = true;
        wakeConsumer();
      });

      const offscreen = new OffscreenCanvas(CANVAS_W, CANVAS_H);
      const offCtx = offscreen.getContext('2d')!;
      let currentFrame: { frame: VideoFrame; ts: number } | null = null;

      // Advance `currentFrame` to the latest decoded frame with ts <= targetTs,
      // closing earlier frames as we step past them. Waits for the producer if
      // nothing's available yet.
      const advanceTo = async (targetTs: number): Promise<void> => {
        while (true) {
          if (decoderError) throw decoderError;
          if (signal.aborted) throw new Error('Cancelled');

          while (frameQueue.length > 0 && frameQueue[0].ts <= targetTs) {
            if (currentFrame) currentFrame.frame.close();
            currentFrame = frameQueue.shift()!;
            wakeProducer();
          }

          // Queue head (if any) has ts > targetTs — we're settled.
          if (frameQueue.length > 0) {
            // First-frame edge case: no current frame because the first decoded
            // frame's ts is already past targetTs. Adopt it anyway.
            if (!currentFrame) {
              currentFrame = frameQueue.shift()!;
              wakeProducer();
            }
            return;
          }

          // Queue empty + producer done → no more frames coming.
          if (producerDone) return;

          // Wait for the next decoded frame (bounded — see waitForFrame: a stalled decoder fails cleanly).
          await waitForFrame();
        }
      };

      try {
        for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
          if (signal.aborted) throw new Error('Cancelled');

          // Source position advances videoRate× per output frame — the background plays sped-up.
          const targetTs = frameIdx * EXPORT_FRAME_DURATION * videoRate + clipStart;
          await advanceTo(targetTs);
          if (!currentFrame) {
            console.warn('[EXPORT] no frame available at idx', frameIdx, '— stopping render early');
            break;
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const cf = currentFrame as any as { frame: VideoFrame; ts: number };

          if (isClean) {
            // ── Caption template: white bg, caption above, video in crop box ──
            offCtx.fillStyle = '#fff';
            offCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);

            const cropBox = boxRef.current;
            const { x: ox, y: oy } = videoOffsetRef.current;

            if (overlayCaption) {
              const captionLines = countCaptionLines(offCtx, overlayCaption);
              const CAPTION_BOTTOM_OFFSET = 18;
              const CLEAN_PAD_TOP = 44;
              const CLEAN_PAD_BOT = 40;
              const captionAreaH = CLEAN_PAD_TOP + (captionLines * CAPTION_LINE_HEIGHT) + CLEAN_PAD_BOT - CAPTION_BOTTOM_OFFSET;
              const captionAreaY = Math.max(0, cropBox.y - captionAreaH + 4);

              offCtx.font = `400 44px "Libre Franklin", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
              offCtx.fillStyle = '#000';
              const padX = HEADER_PADDING_X + 43;
              const maxWidth = CANVAS_W - padX * 2;
              let cy = captionAreaY + CLEAN_PAD_TOP + CAPTION_LINE_HEIGHT - 10;

              for (const userLine of overlayCaption.split('\n')) {
                if (!userLine) { cy += CAPTION_LINE_HEIGHT; continue; }
                let line = '';
                for (const word of userLine.split(' ')) {
                  const test = line + word + ' ';
                  if (offCtx.measureText(test).width > maxWidth && line) {
                    offCtx.fillText(line.trimEnd(), padX, cy);
                    line = word + ' '; cy += CAPTION_LINE_HEIGHT;
                  } else { line = test; }
                }
                offCtx.fillText(line.trimEnd(), padX, cy);
                cy += CAPTION_LINE_HEIGHT;
              }
            }

            const vw = video?.videoWidth || 1080;
            const vh = video?.videoHeight || 1920;
            const scale = (CANVAS_W / vw) * videoScaleRef.current;
            const dx = (CANVAS_W - vw * scale) / 2 + ox;
            const dy = (CANVAS_H - vh * scale) / 2 + oy;

            offCtx.save();
            offCtx.beginPath();
            offCtx.rect(cropBox.x, cropBox.y, cropBox.w, cropBox.h);
            offCtx.clip();
            offCtx.drawImage(cf.frame, dx, dy, vw * scale, vh * scale);
            offCtx.restore();

          } else {
            // ── Twitter template ──
            offCtx.fillStyle = twitterSettings.headerBgColor;
            offCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);

            const { x: ox, y: oy } = videoOffsetRef.current;
            const vw = video?.videoWidth || 1080;
            const vh = video?.videoHeight || 1920;

            if (cellMode) {
              // ── Reel cell layout: [top · top2] · centred video band · [bottom · bottom2] ──
              const L = reelLayout(twitterSettings);
              const getCellImg = (url?: string) => (url && cellImgs.get(url)) || null;
              // The video band is a reorderable z-layer: free elements before `videoLayer` draw BEHIND it, so
              // they must be painted before the video frame; the rest paint on top afterwards.
              const videoLayer = twitterSettings.videoLayer ?? 0;
              // When the video is cropped, the free elements follow the crop edges so spacing holds (matches
              // the live preview). No crop → same array, identical export.
              const cropTw = { ...twitterSettings, freeElements: shiftFreeElementsForReelCrop(twitterSettings.freeElements ?? [], L, boxRef.current, twitterSettings) };
              drawFreeElements({
                ctx: offCtx, s: cropTw,
                logoSrc: overlayLogoSrc, name: overlayDisplayName, handle: overlayHandle,
                logoImgRef, verifiedImgRef, placeholder: false, getCellImg, overlayCaption, to: videoLayer,
              });
              // Match the live preview: tc/bc CROP the video (clip window = boxRef y/h); the video itself
              // stays positioned by the layout band, so it never moves/rescales while cropping.
              const r = reelVideoRect(vw, vh, L, videoScaleRef.current, ox, oy);
              offCtx.save();
              offCtx.beginPath();
              offCtx.roundRect(L.bandX, boxRef.current.y, L.bandW, boxRef.current.h, twitterSettings.videoCornerRadius ?? 24);
              offCtx.clip();
              offCtx.drawImage(cf.frame, r.dx, r.dy, r.dw, r.dh);
              offCtx.restore();

              drawReelCells({
                ctx: offCtx, s: twitterSettings, L,
                logoSrc: overlayLogoSrc, name: overlayDisplayName, handle: overlayHandle,
                logoImgRef, verifiedImgRef, placeholder: false, getCellImg, overlayCaption,
              });
              drawFreeElements({
                ctx: offCtx, s: cropTw,
                logoSrc: overlayLogoSrc, name: overlayDisplayName, handle: overlayHandle,
                logoImgRef, verifiedImgRef, placeholder: false, getCellImg, overlayCaption, from: videoLayer,
              });
              // Image overlays — topmost layer; targetTs is source-time seconds, same domain as the
              // overlays' [start,end] windows and reveal-step times.
              drawImageOverlays(offCtx, overlaysRef?.current ?? [], overlayImgsRef?.current ?? new Map(), targetTs);
            } else {
              // ── Market reels: X header above the video + market row (legacy layout) ──
              const cropBox = boxRef.current;
              const videoTargetW = CANVAS_W - 2 * (twitterSettings.cellMargin ?? 60);
              const scale = Math.min(videoTargetW / vw, CANVAS_H / vh) * videoScaleRef.current;
              const dx = (CANVAS_W - vw * scale) / 2 + ox;
              const dy = (CANVAS_H - vh * scale) / 2 + oy;

              offCtx.save();
              offCtx.beginPath();
              offCtx.rect(cropBox.x, cropBox.y, cropBox.w, cropBox.h);
              offCtx.clip();
              offCtx.drawImage(cf.frame, dx, dy, vw * scale, vh * scale);
              offCtx.restore();

              const headerHeight = computeSonotradeHeaderHeight(offCtx, overlayCaption, twitterSettings);
              const headerY = Math.max(0, cropBox.y - headerHeight + 4);
              drawHeaderOnContext({ ctx: offCtx, cx: 0, cy: headerY, cw: CANVAS_W, ...headerDrawOpts });

              if (marketData && marketAvatarImgRef && marketAvatarUrlRef) {
                drawMarketRow({
                  ctx: offCtx,
                  cx: 0,
                  videoBottomY: cropBox.y + cropBox.h,
                  cw: CANVAS_W,
                  name: marketData.name,
                  subtitle: marketData.industry ?? marketData.subcategory ?? '—',
                  photo_url: marketData.photo_url,
                  priceUsd: marketData.price.usd,
                  lifetimeChangePct: marketData.price.lifetimeChangePct,
                  sparkline: marketData.sparkline,
                  avatarImgRef: marketAvatarImgRef,
                  lastPhotoUrlRef: marketAvatarUrlRef,
                });
              }
            }
          }

          // Output timestamps stay uniform at EXPORT_FPS — the speed-up lives in how far targetTs
          // stepped through the SOURCE per frame, not in the output timing.
          const sample = new VideoSample(offscreen, { timestamp: frameIdx * EXPORT_FRAME_DURATION + clipStart, duration: EXPORT_FRAME_DURATION });
          await videoSource.add(sample);
          sample.close();
          setRecProgress(0.15 + (frameIdx / totalFrames) * 0.7);
        }
      } finally {
        if (currentFrame) { currentFrame.frame.close(); currentFrame = null; }
        while (frameQueue.length > 0) frameQueue.shift()!.frame.close();
        wakeProducer(); // in case it's still waiting on backpressure
      }

      // Wait for producer (decode + flush) to complete before closing decoder.
      try { await producer; } catch { /* already surfaced via decoderError */ }
      if (decoderError) throw decoderError;
      try { decoder.close(); } catch { /* may already be closed */ }

      if (audioSource && audioPackets.length > 0) {
        setRecStatus('Adding audio...');
        for (let i = 0; i < audioPackets.length; i++) {
          await audioSource.add(audioPackets[i], i === 0 && audioDecoderConfigForExport ? { decoderConfig: audioDecoderConfigForExport } : undefined);
        }
      }

      setRecStatus('Finalizing...');
      setRecProgress(0.95);
      await output.finalize();

      let buffer = output.target.buffer;
      if (!buffer) throw new Error('No buffer received from output');
      if (includeEditRef.current) buffer = await mergeWithEdit(buffer, outputDuration);

      const blob = new Blob([buffer], { type: 'video/mp4' });

      // Pre-render mode (Post scheduler): hand the baked MP4 back to the caller instead of
      // saving/downloading it — they upload it and post it to Instagram.
      if (opts?.returnBlob) { setRecProgress(1); return blob; }

      // Filename = short, readable version of the on-card caption (word-boundary
      // truncated). Falls back to the old row/id naming when there's no caption.
      const captionBase = (overlayCaption || '').replace(/\s+/g, ' ').trim();
      let nameBase = captionBase;
      if (nameBase.length > 60) {
        const cut = nameBase.slice(0, 60);
        const lastSpace = cut.lastIndexOf(' ');
        nameBase = (lastSpace > 30 ? cut.slice(0, lastSpace) : cut).trim();
      }
      if (!nameBase) nameBase = videoId ?? 'export';
      // Prefix the reel number (its card position) so every export is numbered and sorts in order —
      // reel 1 → "01_….mp4", reel 2 → "02_….mp4", etc.
      nameBase = `${String(rowNumber + 1).padStart(2, '0')}_${nameBase}`;

      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href: url, download: `${nameBase}.mp4` }).click();
      URL.revokeObjectURL(url);
      // A silently-muted export is worse than a visible warning.
      if (audioDropped) { setRecStatus('⚠ Exported without audio'); setTimeout(() => setRecStatus(''), 6000); keepStatus = true; }
      setRecProgress(1);

    } catch (error) {
      if (error instanceof Error && error.message !== 'Cancelled') {
        console.error('[EXPORT] ❌ EXPORT FAILED:', error);
        console.error('[EXPORT] stack:', error.stack);
        keepStatus = true;
        setRecStatus(`Error: ${error.message}`);
        setTimeout(() => setRecStatus(''), 8000);
        throw error;
      }
    } finally {
      setIsRecording(false);
      setRecProgress(0);
      // Don't wipe a terminal status set just above (error / saved / audio warning): React batches
      // these synchronous updates, so clearing here would coalesce it to '' and it would never render.
      // Each terminal status carries its own timeout to clear itself after it's been seen.
      if (!keepStatus) setRecStatus('');
      const v = config.videoRef.current;
      if (v) { v.muted = true; v.pause(); v.currentTime = 0; v.loop = true; v.playbackRate = 1.0; }
      abortControllerRef.current = null;
    }
  }

  function cancelRecording() {
    abortControllerRef.current?.abort();
    setIsRecording(false);
    setRecProgress(0);
    setRecStatus('');
    const v = config.videoRef.current;
    if (v) { v.muted = true; v.pause(); v.currentTime = 0; v.playbackRate = 1.0; v.loop = true; }
  }

  return { isRecording, recProgress, recStatus, startRecording, cancelRecording };
}
