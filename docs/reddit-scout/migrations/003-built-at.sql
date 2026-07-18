-- Migration 003 — built_at: server-authoritative "a reel exists for this post".
-- Set by the mark-used hook (fired when a reel is built); NULL for approvals not yet built. The lost-
-- buffer recovery (list-used) filters `built_at IS NULL` so it can never resurrect a completed post
-- into a duplicate reel — a guarantee the per-browser workspace filter alone couldn't make.
--
-- Existing rows keep built_at NULL (restorable) — deliberately NOT backfilled: the server can't know
-- which already have reels (that's client workspace state), and the client-side filter is the second
-- layer for legacy rows. Every reel built from now on stamps built_at.

alter table reddit_seen add column if not exists built_at timestamptz;
