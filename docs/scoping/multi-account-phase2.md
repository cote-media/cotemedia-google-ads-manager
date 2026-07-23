# Multi-Account Phase 2 — widen the `metrics_daily` conflict key to include `account_id`

<!-- LORAMER_MULTIACCOUNT_PHASE2_SCOPING -->
<!-- QUEUE-KEY: metrics_daily conflict key, platform_connections uniqueness, sync_state keying, query-layer account filter -->
Status: **SCOPING ONLY** (2026-06-05). No code changed, nothing executed.
Prereq: Phase 1 DONE (`migrations/005_metrics_daily_account_id.sql` run + verified;
see `docs/scoping/multi-account-phase1.md`).

## 1. Every metrics_daily write site (verified against current main)

There are **6 upsert sites** and **0 DELETE/UPDATE** sites. All 6 resolve their
`onConflict` from one of **two identical constants** — the string exists in
exactly TWO places in the codebase:

| # | Constant / site | File:line | onConflict (verbatim) |
|---|---|---|---|
| — | `METRICS_DAILY_CONFLICT` (cron) | `src/app/api/cron/sync/route.ts:22-23` | `'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'` |
| — | `METRICS_DAILY_CONFLICT` (backfill) | `src/lib/backfill/run-backfill.ts:82-83` | `'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'` |
| 1 | Shopify forward capture | `cron/sync/route.ts:426` | references cron constant |
| 2 | Meta forward capture | `cron/sync/route.ts:511` | references cron constant |
| 3 | Google forward capture | `cron/sync/route.ts:598` | references cron constant |
| 4 | WooCommerce forward capture | `cron/sync/route.ts:681` | references cron constant |
| 5 | GA forward capture | `cron/sync/route.ts:759` | references cron constant |
| 6 | Backfill engine (google/meta/ga) | `run-backfill.ts:233` | references backfill constant |

(`onConflict: 'client_id,platform'` at cron 443/528/615/698/776 and
run-backfill 259 are `sync_state` upserts — Phase 3, NOT this change.)

Row builders feeding those upserts (where `account_id` must be added to the row):

| Builder | File:line | Account variable in scope |
|---|---|---|
| `buildShopifyMetricsRows` | `cron/sync/route.ts:60-103` | `shopDomain` (from `conn.account_id`, :397) |
| `buildMetaMetricsRows` | `cron/sync/route.ts:131-211` | `accountId` (from `conn.account_id`, :476) |
| `buildGoogleMetricsRows` | `cron/sync/route.ts:224-280` | `customerId` (from `conn.account_id`, :561) |
| `buildWooMetricsRows` | `cron/sync/route.ts:282-325` | `tok.store_url` (:675) |
| `buildGaMetricsRows` (shared fwd+backfill) | `src/lib/intelligence/ga-metrics-row.ts:38-62` | `propertyId` param |
| Backfill default inline rows (google/meta) | `run-backfill.ts:212-229` | `accountId` (resolved :122-157) |
| GA backfill `buildRows` hook | `src/lib/backfill/adapters.ts:101-111` | `ctx.accountId` |

## 2. Current unique index (live DB, read 2026-06-05)

```
CREATE UNIQUE INDEX metrics_daily_client_id_platform_entity_level_entity_id_dat_key
  ON public.metrics_daily USING btree
  (client_id, platform, entity_level, entity_id, date, breakdown_type, breakdown_value)
```
(plus `metrics_daily_pkey` on `id` — untouched.)

## 3. Do writers populate account_id today? **NO — verified.**

All 7 row builders omit `account_id`; the account identifier rides only in
`entity_id` (account level) / nowhere (sub-account levels). Live DB confirms
`null_account = 0` on all platforms ONLY because the Phase 1 backfill ran after
the last cron (08:48 UTC). **Every cron run from tonight on writes NULL
`account_id` rows until step (a) ships.**

## 4. The safe sequence

### (a) Teach every writer to populate `account_id` — SAFE, ship first, alone
Add `account_id` to the row object in all 7 builders above (the variable is
already in scope in every one). The conflict key is UNCHANGED in this step, so
behavior is byte-identical on the key; the extra column simply lands in
inserts and refreshes on updates. Deploy, let one nightly cron run, verify:
new rows have `account_id` populated.

### (b) Sweep any NULLs written since Phase 1 — Supabase SQL Editor
Re-run step 2 of `migrations/005_metrics_daily_account_id.sql` (idempotent).
Then verify zero NULLs, and lock it:
```sql
ALTER TABLE metrics_daily ALTER COLUMN account_id SET NOT NULL;
```
NOT NULL is the structural defense against the hazard in §5 — do not skip it.

### (c) Widen the index + conflict constants — THE simultaneous step
SQL (one transaction, Supabase SQL Editor — migration 006):
```sql
BEGIN;
ALTER TABLE metrics_daily
  DROP CONSTRAINT metrics_daily_client_id_platform_entity_level_entity_id_dat_key;
ALTER TABLE metrics_daily
  ADD CONSTRAINT metrics_daily_conflict_key
  UNIQUE (client_id, platform, account_id, entity_level, entity_id, date, breakdown_type, breakdown_value);
COMMIT;
```
Code (one commit, deployed immediately after the SQL):
- `src/app/api/cron/sync/route.ts:22-23` — constant becomes
  `'client_id,platform,account_id,entity_level,entity_id,date,breakdown_type,breakdown_value'`
- `src/lib/backfill/run-backfill.ts:82-83` — the SAME string, byte-identical.

**Those two lines are the entire code surface of (c)** — all 6 upsert sites
inherit via the constants. Grep both files for the literal string after
editing (tsc cannot catch a mangled string literal — Lesson 29/handoff).

**Deploy/SQL race window:** PostgREST requires a unique constraint matching
the ON CONFLICT column list EXACTLY. Old code + new index → loud upsert error;
new code + old index → loud upsert error. Either ordering fails LOUDLY (no
corruption, no silent dupes) during the gap, so: run the SQL and push the
commit back-to-back, far from the nightly cron (~08:45 UTC), then prove with
a headless backfill lap or the proving route before walking away.

### (d) After (c) is verified
Trigger one backfill lap + one cron cycle; confirm row counts unchanged
(pure key-widening must not create rows: today's data is strictly 1 account
per (client, platform), so no pre-existing pair collides under the new key).

## 5. Hazards — read before running anything

1. **NULL-in-unique-index (THE hazard):** Postgres treats NULLs as DISTINCT in
   unique indexes. If the index includes `account_id` while any writer can
   still send NULL, ON CONFLICT will NEVER match those rows → **silent
   duplicate rows every sync, doubling metrics**. This is why the order is
   immovable: writers populate (a) → sweep (b) → `SET NOT NULL` (b) → only
   then widen (c). The NOT NULL constraint makes the failure mode loud
   (insert rejected) instead of silent (data corrupted). Do not reorder.
2. **The race window in (c)** is unavoidable but loud (see above). Schedule
   away from the cron; verify immediately.
3. **Byte-identical constants:** the two `METRICS_DAILY_CONFLICT` strings must
   match each other and the SQL column list exactly — a one-character drift
   makes one writer error on every upsert. Grep, don't trust eyes.
4. **`SET NOT NULL` rejects future writers that forget the column** — any NEW
   platform adapter must include `account_id` in its row builder from day one.
   Add that to the "how to add a platform" checklist when (a) ships.
5. **Forward/backfill parity invariant:** (a) must change the cron builders
   and the backfill builders in the SAME commit — `buildGaMetricsRows` is
   shared (good), but google/meta have separate cron + backfill row builders
   that must stay byte-identical per the engine's contract.
6. **Old rows are immutable history:** no DELETE/UPDATE sites exist, and (c)
   creates no rows. If post-(c) verification shows row-count growth without a
   new account being connected, stop — that is the §5.1 failure signature.

## 6. Explicitly out of scope for Phase 2

`platform_connections` uniqueness, `sync_state` keying (`'client_id,platform'`
upserts listed in §1), intelligence-layer fan-out, query-layer account
filter/grouping, `/clients` UI — all Phase 3+, sequenced AFTER the storage
layer is proven under the widened key.
