-- LORAMER_UNIVERSE_WINDOW_LOG_V1 — WALK PROGRESS. Paste into the Supabase SQL Editor. Read-only.
--
-- ⛔ READ THE `running` COUNT FIRST. A row still reading `running` is a window that OPENED AND NEVER
-- CAME BACK — the process died mid-request. It is a FAILURE, not work in progress. The only rows that
-- may be read as progress are the terminal ones.
-- ⛔ `zero` IS NOT A FAILURE AND NOT A SKIP. The vendor answered and named nothing. That is a fact
-- about the account, and it is the whole reason this arc exists.
select
  outcome,
  count(*)                                as windows,
  sum(rows_written)                       as rows_written,
  sum(requests_spent)                     as requests,
  sum(refused_rows)                       as rows_carrying_a_refusal_stamp,
  min(window_start)                       as oldest_window,
  max(window_start)                       as newest_window,
  round(avg(extract(epoch from (finished_at - started_at)))::numeric, 1) as avg_secs
from public.universe_window_log
where vendor = 'google_ads'
group by outcome
order by case outcome when 'running' then 0 when 'error' then 1 when 'floor_stop' then 2 else 3 end, outcome;

-- TODAY'S SPEND — exactly what the governor reads. One row per window, so this is today's spend and
-- nothing else; it can never accumulate yesterday the way the old per-entry counter did.
select
  count(*)                as windows_today,
  sum(requests_spent)     as requests_today,
  6000 - sum(requests_spent) as backfill_allowance_remaining,   -- 15,000 cap − 4,000 forward − 5,000 drain
  pg_size_pretty(min(disk_free_bytes)) as lowest_disk_free_seen_today
from public.universe_window_log
where vendor = 'google_ads' and started_at >= date_trunc('day', now() at time zone 'utc');

-- ⛔ ANYTHING BROKEN, NEWEST FIRST. Empty is the good answer.
select resource, segment, window_start, outcome, left(error, 200) as error,
       started_at, finished_at, pg_size_pretty(disk_free_bytes) as disk_free
from public.universe_window_log
where vendor = 'google_ads' and outcome in ('running', 'error', 'floor_stop')
order by started_at desc
limit 50;

-- DISK RIGHT NOW, against the same floor the walk enforces (280 GB provisioned, 56 GB floor).
-- ⛔ THESE TWO NUMBERS ARE NOT FREE TEXT. They must equal PROVISIONED_BYTES and FLOOR_BYTES in
-- src/lib/backfill/universe-window-log.ts, and universe-window-log.guard.mjs leg (f) now FAILS if any
-- .sql or .md under scripts/ or docs/ disagrees. They were stale by 80 GB from the 2026-08-04 volume
-- raise (200 → 280) until 2026-08-05, so this block under-reported free space every time the morning
-- runbook was run — a disk figure that reads LOW is the direction that stops a walk which could
-- have continued.
select pg_size_pretty(used_bytes) as used, pg_size_pretty(free_bytes) as free,
       pg_size_pretty(free_bytes - (56::bigint * 1024^3)::bigint) as above_floor,
       floor((free_bytes - (56::bigint * 1024^3)::bigint) / (4.53 * 1024^3)) as windows_still_affordable
from public.universe_disk_headroom(300647710720);
