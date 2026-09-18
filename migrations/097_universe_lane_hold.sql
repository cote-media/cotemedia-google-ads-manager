-- 097_universe_lane_hold.sql — LORAMER_WALK_QUOTA_SCOPE_V1
--
-- ⛔ WHAT THIS IS: ONE client's own quota hold on ONE vendor lane — the record an ACCOUNT-scoped Google refusal
-- writes ("rate_scope ACCOUNT · Retry in N seconds": that customer's bucket, nobody else's). The fleet sentinel
-- (sync_state row 00000000-…/__google_quota, migration 013's breaker columns) stays the record for DEVELOPER-scoped
-- and scope-less refusals and is NOT touched by this migration or by any lane hold.
--
-- ⛔ ONE ROW PER (client_id, vendor) LANE, matching universe_fire_lease (085) and universe_run (096) exactly.
-- ⛔ VENDOR is the v2 attempt ledger's spelling ('google' — universe-v2-contract.ts VENDOR), the same key the
-- worker and the resumer address the lane by; nothing in this table knows which vendor it is holding.
-- ⛔ CLOCK-BASED, LIKE THE FLEET ROW: held_until in the past reads CLEAR; no manual unblock exists or is needed.
-- backoff_tries carries the no-delay fallback streak (10/20/40 s) so the schedule continues across fires.
--
-- READERS: universe-v2-worker.ts (consumer hold path), cron/universe-resume/route.ts (resumer hold path) — both via
-- walk-quota-store.ts readWalkLaneHold. WRITER: walk-quota-store.ts applyWalkHold (armed at universe-vendor-stream's
-- armingStream). No live or legacy path reads this table.
--
-- REVERT: DROP TABLE public.universe_lane_hold;   (additive — the hold paths treat a missing row as CLEAR and an
-- unreadable table as UNKNOWN=hold, so a drop parks the walk loudly rather than silently)
-- ⛔ THERE IS NO STAGING DATABASE. This can only be proven where it is applied.

CREATE TABLE IF NOT EXISTS public.universe_lane_hold (
  client_id      uuid        NOT NULL,
  vendor         text        NOT NULL,
  held_until     timestamptz NOT NULL,
  rate_scope     text        NOT NULL,            -- 'ACCOUNT' | 'DEVELOPER' | 'UNKNOWN' as Google named it
  rate_name      text,                            -- e.g. "Requests per service per method"
  retry_delay_s  integer,                         -- the delay Google sent, or NULL on the fallback schedule
  backoff_tries  integer     NOT NULL DEFAULT 0,  -- fallback streak (0 when Google sent a delay)
  reason         text        NOT NULL,
  armed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, vendor)
);

COMMENT ON TABLE public.universe_lane_hold IS
  'LORAMER_WALK_QUOTA_SCOPE_V1 — one client''s own quota hold on one vendor lane (ACCOUNT-scoped refusals and the no-delay fallback). Clock-based: held_until in the past reads clear. The fleet sentinel is sync_state 00000000-…/__google_quota, untouched.';

-- RPC grant posture (065): the service role reads/writes; nothing else needs it.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.universe_lane_hold TO service_role;
