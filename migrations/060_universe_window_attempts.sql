-- 060_universe_window_attempts.sql
-- LORAMER_UNIVERSE_FAILURE_IS_DURABLE_V1 — FLIGHT 1, STEP 1 + STEP 2 (the DB half only; NO code deploys with
-- this migration, by instruction).
--
-- ⛔ WHY THIS EXISTS. The audit (docs/LORAMER_BACKFILL_COMPLETE_AUDIT.md §3b) counted 15 of 22 defects that
-- wrote durable state ONLY on the success path or on neither. The walk's open path is the keystone: a killed
-- invocation reaches no catch, so `closeWindow` — the ONLY writer of `requests_spent` and `outcome` — never
-- runs, and the attempt leaves no trace at all. Three separate 300-second poison loops have now formed on
-- `campaign_search_term_view` (ids 2871, 17959, and a third live at the time of writing), each invisible to
-- the rate governor because `requests_spent` stayed 0.
--
-- ⛔ THE UPSERT THIS REPLACES CANNOT BE FIXED IN PLACE. universe-window-log.ts:127-135 passes a LITERAL
-- object to PostgREST `.upsert()`. PostgREST can only set a column to the value supplied, never to an
-- expression over the existing row, so `attempts = attempts + 1` is not expressible — and the same payload
-- already writes `rows_written: 0, requests_spent: 0, refused_rows: 0, error: null, finished_at: null` on
-- every open, so an `attempts` field written that way would RESET to 1 on every redelivery and count
-- BACKWARDS. That is why this is an RPC and not a payload change.
--
-- ⛔ AMENDMENT 1 (RUSS) — THE COUNTER MUST NOT COUNT LAWFUL EARLY RETURNS. `quota_stop`
-- (queues/google-ads-universe/route.ts:116) and `floor_stop` (:158) are the governor and the disk floor
-- doing their job, not failures. Three quota pauses on one window — routine under the 15,000/day cap — must
-- never abandon a window that never failed. THE DISTINCTION IS MADE FROM THE PREVIOUS ROW'S OUTCOME, inside
-- the ON CONFLICT DO UPDATE clause, where the pre-update row is addressable as `universe_window_log.outcome`:
--     attempts = universe_window_log.attempts
--              + case when universe_window_log.outcome = 'running' then 1 else 0 end
-- `running` is the ONLY outcome that means "an invocation opened this window and died without closing it"
-- (054's own header: "A crash leaves this. It is a FAILURE, not a pending state."). Every other value means a
-- close happened, lawful or not, so the attempt is not charged.
--
-- ⛔ AMENDMENT 2 (RUSS) — THE CHECK MUST NOT VALIDATE UNDER LIVE WRITES. universe_window_log is written every
-- 2-4 minutes and the LIVE PostgREST statement_timeout is 8 SECONDS (DECISIONS: role GUCs do not re-apply on
-- SET ROLE, so 8s persists through service_role; the 120s cluster default is visible only to MCP/superuser
-- sessions). The four statements below run SEPARATELY, in this order, with their locks stated:
--   (1) row count reported BEFORE anything          — read-only
--   (2) ADD CONSTRAINT ... NOT VALID                — ACCESS EXCLUSIVE, CATALOG ONLY, no scan
--   (3) VALIDATE CONSTRAINT                         — SHARE UPDATE EXCLUSIVE; does NOT block INSERT/UPDATE
--   (4) DROP CONSTRAINT (the old one)               — ACCESS EXCLUSIVE, catalog only
-- MEASURED BEFORE APPLYING: 17,835 rows / 9,576 kB. The validation scan is milliseconds at that size, and
-- (3) does not block the walk's writes at all. If the table were large enough that (3) could not finish
-- inside the live timeout, the instruction is to STOP rather than run it.
--
-- ⛔ AMENDMENT 3 (RUSS) — INTERNAL ORDER. The CHECK must accept 'abandoned_owed' BEFORE the 2871/17959
-- update runs, and the update asserts EXACTLY 2 rows or the migration fails.
--
-- ⛔ AMENDMENT 4 (RUSS) — THE DONE SIGNAL MUST NOT SILENTLY MEAN 346 OF 559. Verified this session:
-- queues/google-ads-universe/route.ts:231 computes its denominator as
--   doc.entries.filter(e => e.delivers === true && (e.segment === null || e.dateCombinable === true)).length
-- = 559, while the starter publishes `selectableEntries(doc)` (google-ads-universe-writer.ts:212-216), which
-- adds two more exclusions (derived-time segments, DEFERRED_ENTRIES) = 346 — matching the 346 rows in
-- universe_run_state. 346 < 559, so isClientComplete (universe-run-state.ts:85-87) is UNSATISFIABLE BY
-- CONSTRUCTION, independently of the unsealed-floor defect. Fixing the denominator alone would make
-- 'complete' mean 346 of 559 with 213 catalog entries silently excluded — A GREEN FLAG OVER A HOLE, which the
-- governing law forbids. So the notice carries BOTH numbers and the exclusions stay enumerable.
-- ⛔ VENDOR_CATALOG_IS_THE_DENOMINATOR STANDS. This is the VISIBLE-DEBT form; the catalog is not narrowed.
--
-- REVERT PATH (there is NO staging database; an RPC/migration can only be proven where it is applied):
--   ⛔ ORDER MATTERS — function → CHECK → columns, the reverse of apply, and rows must be moved OFF
--   'abandoned_owed' FIRST or the CHECK revert fails halfway:
--     update public.universe_window_log set outcome='error' where outcome='abandoned_owed';
--     drop function if exists public.universe_window_open(uuid,text,text,text,date,date,bigint,integer);
--     alter table public.universe_window_log drop constraint universe_window_log_outcome_check;
--     alter table public.universe_window_log add constraint universe_window_log_outcome_check
--       check (outcome in ('running','ok','zero','skipped','error','floor_stop','quota_stop'));
--     alter table public.universe_window_log drop column if exists attempts;
--     alter table public.universe_run_notice drop column if exists entries_catalog_total;
--     alter table public.universe_run_notice drop column if exists entries_excluded;
--   Dropping the function is safe on its own: the old literal-payload openWindow path still compiles, so a
--   revert of the function without a code revert degrades to today's behaviour rather than breaking.


-- ── (1) COUNT FIRST. Reported before anything is altered. ────────────────────────────────────────────────
-- select count(*) from public.universe_window_log;   →  17,835 rows / 9,576 kB, measured 2026-08-08 17:37Z


-- ── ATTEMPTS COLUMN. PG11+ makes a non-volatile default metadata-only: no table rewrite, no scan. ────────
alter table public.universe_window_log
  add column if not exists attempts integer not null default 0;

comment on column public.universe_window_log.attempts is
  'LORAMER_UNIVERSE_FAILURE_IS_DURABLE_V1 — how many invocations DIED on this window without closing it. Incremented by universe_window_open ONLY when the previous outcome was ''running''. A lawful early return (quota_stop, floor_stop) does NOT charge an attempt.';


-- ── (2) NEW CHECK, NOT VALID. ACCESS EXCLUSIVE but CATALOG-ONLY — no row scan, sub-millisecond. ─────────
-- ⛔ NOT VALID means "enforce for new writes immediately, do not scan existing rows now". New writes are
-- constrained from this statement onward, which is what makes step (4)'s drop safe.
alter table public.universe_window_log
  add constraint universe_window_log_outcome_check_v2
  check (outcome in ('running','ok','zero','skipped','error','floor_stop','quota_stop','abandoned_owed'))
  not valid;


-- ── (3) VALIDATE. SHARE UPDATE EXCLUSIVE — does NOT block INSERT/UPDATE/DELETE, so the walk keeps writing. ─
alter table public.universe_window_log
  validate constraint universe_window_log_outcome_check_v2;


-- ── (4) DROP THE OLD CHECK. ACCESS EXCLUSIVE, catalog-only. ──────────────────────────────────────────────
alter table public.universe_window_log
  drop constraint universe_window_log_outcome_check;


-- ── AMENDMENT 4 — THE NOTICE CARRIES BOTH DENOMINATORS. ────────────────────────────────────────────────
-- ⛔ NULLABLE ON PURPOSE. A notice written WITHOUT them must be detectably incomplete, not silently 0 —
-- 0 is a claim, NULL is an absence, and the guard leg asserts a notice may never carry one number without
-- the other. universe_run_notice holds ZERO rows today, so this is additive with nothing to backfill.
alter table public.universe_run_notice
  add column if not exists entries_catalog_total integer,
  add column if not exists entries_excluded integer;

comment on column public.universe_run_notice.entries_catalog_total is
  'AMENDMENT 4 — the FULL vendor-catalog denominator (delivers && date-combinable), the number entries_total is a SUBSET of. entries_total is what the walk actually published (selectableEntries); this is what the vendor serves. A notice carrying one without the other is a green flag over a hole.';
comment on column public.universe_run_notice.entries_excluded is
  'AMENDMENT 4 — entries_catalog_total − entries_total. The per-entry exclusions and their reasons (derived-time segment vs DEFERRED_ENTRIES) ride in `detail` so one query enumerates them.';


-- ── THE OPEN RPC. Replaces the literal-payload upsert at universe-window-log.ts:127-135. ────────────────
-- ⛔ clock_timestamp(), NEVER now(). universe-window-log.ts:146-148 records the 2026-08-04 bug where a
-- 158-second job logged finished_at == started_at because now() means TRANSACTION START.
-- ⛔ requests_spent IS SET AT DISPATCH, NOT AT CLOSE (S2). closeWindow reconciles it DOWN to 0 only when the
-- vendor was demonstrably never called. Pessimistic by design: an optimistic counter fails toward spending
-- the fleet's quota against a pause nobody can see, which this repo has already paid for once (audit §3 #10).
-- ⛔ THE MEANING OF universe_window_log.requests_spent CHANGES: "requests the vendor ANSWERED" becomes
-- "requests DISPATCHED". Every reader over-counts rather than under-counts, which is the safe direction:
--   readLaneSpendToday → migrations/057:39 · google-op-budget.ts:86,335 ·
--   scripts/universe-walk-progress.sql:12,26,27 · tests/guards/google-op-budget.guard.mjs:406,418 ·
--   tests/guards/universe-window-log.guard.mjs:16
-- ⛔ NOT universe_run_state.requests_spent — a DIFFERENT column, cumulative per entry, and summing it
-- "billed day 2 for day 1" (migrations/057:14). This migration does not touch it.
create or replace function public.universe_window_open(
  p_client_id        uuid,
  p_vendor           text,
  p_resource         text,
  p_segment          text,
  p_window_start     date,
  p_window_end       date,
  p_disk_free_bytes  bigint,
  p_requests_spent   integer
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_attempts integer;
begin
  insert into public.universe_window_log (
    client_id, vendor, resource, segment, window_start, window_end,
    outcome, disk_free_bytes, rows_written, requests_spent, refused_rows, error,
    started_at, finished_at, attempts
  ) values (
    p_client_id, p_vendor, p_resource, coalesce(p_segment, ''), p_window_start, p_window_end,
    'running', p_disk_free_bytes, 0, coalesce(p_requests_spent, 0), 0, null,
    clock_timestamp(), null, 1
  )
  on conflict (client_id, vendor, resource, segment, window_start) do update set
    outcome          = 'running',
    disk_free_bytes  = excluded.disk_free_bytes,
    rows_written     = 0,
    requests_spent   = excluded.requests_spent,
    refused_rows     = 0,
    error            = null,
    started_at       = clock_timestamp(),
    finished_at      = null,
    -- ⛔ AMENDMENT 1. Charge an attempt ONLY when the previous invocation died mid-flight.
    attempts         = universe_window_log.attempts
                     + case when universe_window_log.outcome = 'running' then 1 else 0 end
  returning attempts into v_attempts;
  return v_attempts;
end;
$function$;

comment on function public.universe_window_open(uuid,text,text,text,date,date,bigint,integer) is
  'LORAMER_UNIVERSE_FAILURE_IS_DURABLE_V1 — the ONLY open path for universe_window_log. Returns the attempt count so the caller can bound retries. Charges an attempt ONLY when the prior outcome was ''running'' (an invocation that died without closing); quota_stop and floor_stop are lawful early returns and are never charged. Sets requests_spent AT DISPATCH so a killed invocation is visible to the rate governor.';

revoke all on function public.universe_window_open(uuid,text,text,text,date,date,bigint,integer) from public;


-- ── AMENDMENT 3 — THE TWO ORPHANS MOVE TO THE OWED STATE. Runs only after the CHECK accepts the value. ──
-- ⛔ WHY THEY MUST MOVE. Both were set to 'error' by operator halt on 2026-08-08 (audit §3 #17). 'error' is
-- terminal to windowAlreadyFinished (universe-window-log.ts:253 — `outcome !== 'running'`), which is what
-- broke the loop and is correct. But 'error' says "asked and failed", not "we stopped asking and this window
-- is still owed" — so the first two orphans the system ever created would be the only two its own owed-list
-- could not see. EXACTLY 2 ROWS OR THE MIGRATION FAILS.
do $$
declare
  v_updated integer;
begin
  update public.universe_window_log
     set outcome = 'abandoned_owed'
   where id in (2871, 17959)
     and outcome = 'error';
  get diagnostics v_updated = row_count;
  if v_updated <> 2 then
    raise exception 'LORAMER_UNIVERSE_FAILURE_IS_DURABLE_V1 ABORTED — expected to move EXACTLY 2 rows (ids 2871, 17959) from error to abandoned_owed, moved %. The migration asserts this rather than assuming it: a different count means the rows were changed by something else since the audit read them, and continuing would bank a false record.', v_updated;
  end if;
end $$;
