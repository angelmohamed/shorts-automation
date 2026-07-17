-- Migration 002 — decision FEATURES for the future learned ranker (phase-2 §10).
-- Captures, at decide time, what the candidate looked like — so every Use/Reject from now on is a
-- labeled training row (status = the label; these columns = the features). Nullable: rows written by
-- the shared-ledger mark-used hook (manual reel builds) have no candidate context and stay null;
-- training simply filters to rows with features.
--
-- Run in Supabase → SQL Editor (or the Management API). Idempotent.

alter table reddit_seen add column if not exists body         text;      -- selftext at decide time (≤40k chars, Reddit's own cap)
alter table reddit_seen add column if not exists score        integer;   -- upvotes at decide time
alter table reddit_seen add column if not exists num_comments integer;
alter table reddit_seen add column if not exists created_utc  bigint;    -- post age derivable vs decided_at
alter table reddit_seen add column if not exists category     text;      -- scout category A-D (from config at decide time)
