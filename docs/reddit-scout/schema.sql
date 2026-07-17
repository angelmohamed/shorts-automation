-- Reddit Content Scout — no-repeat ledger (REQUIREMENTS §5.1).
-- Run once in the NEW Supabase project: Dashboard → SQL Editor → paste → Run.
--
-- Reset deliberately with:  truncate table reddit_seen;
-- (Never dropped by the app — the ledger is the permanent memory.)

create table if not exists reddit_seen (
  post_id    text primary key,                       -- Reddit base36 id (e.g. "1abcde"), no "t3_" prefix
  status     text not null check (status in ('used', 'rejected')),
  subreddit  text not null,
  title      text not null,
  decided_at timestamptz not null default now()
);

-- The app talks to this table server-side only (API routes) with the project's SECRET key
-- (sb_secret_… on new projects; legacy service_role JWT also works), which bypasses RLS.
-- Enable RLS with no policies so the public/publishable key can't touch the ledger at all.
alter table reddit_seen enable row level security;
