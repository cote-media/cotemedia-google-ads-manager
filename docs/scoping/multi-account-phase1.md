# Multi-Account Phase 1 — `metrics_daily.account_id` (column + backfill)

<!-- LORAMER_MULTIACCOUNT_PHASE1_V1 -->
Status: **WRITTEN, NOT RUN** (2026-06-05). Russ executes in the Supabase SQL
Editor after review. No app code changed. Conflict key untouched.

Migration file: `migrations/005_metrics_daily_account_id.sql`

## What it does

1. `ALTER TABLE metrics_daily ADD COLUMN IF NOT EXISTS account_id TEXT` —
   nullable, no default. The unique/conflict index is NOT altered.
2. One idempotent `UPDATE … FROM platform_connections` populates `account_id`
   for ALL existing rows on ALL FIVE platforms.
3. Verification queries (totals, NULLs by platform, one-account-per-pair
   invariant, account-level `entity_id` cross-check).

## Why one uniform source (not per-platform)

The task allowed scoping to google/meta and leaving the rest NULL.
**Recommendation: populate all five platforms from `platform_connections` —
it is both cleaner AND complete.** Verified read-only against live data
(2026-06-05):

- Every one of the 19,404 `metrics_daily` rows joins to exactly one
  `platform_connections` row on `(client_id, platform)` — zero orphans.
- At `entity_level='account'`, `entity_id` equals the connection's
  `account_id` for **all five platforms** (google 12,810/12,810,
  meta 1,586/1,586, ga 2,855/2,855, shopify 15/15, woo 3/3 — zero
  mismatches). So `platform_connections.account_id` already IS the GA
  property id, the Shopify shop domain, and the Woo store identifier —
  no need to source from `ga_tokens` / `shopify_tokens`.
- `UNIQUE (client_id, platform)` on `platform_connections` guarantees the
  UPDATE join cannot fan out — each row gets exactly one value.

## Exact SQL

See `migrations/005_metrics_daily_account_id.sql` (single source of truth —
paste the whole file into the Supabase SQL Editor). Summary of the operative
statements:

```sql
ALTER TABLE metrics_daily ADD COLUMN IF NOT EXISTS account_id TEXT;

UPDATE metrics_daily m
SET account_id = pc.account_id
FROM platform_connections pc
WHERE pc.client_id = m.client_id
  AND pc.platform  = m.platform
  AND m.account_id IS NULL;
```

Expected verification results immediately after running:
- 3b: `still_null = 0` on every platform.
- 3c: zero rows (no client/platform pair with >1 account).
- 3d: zero rows (account-level `account_id` = `entity_id`).

## Risks / caveats flagged before running

1. **New rows go in NULL until Phase 2.** Cron forward-capture and the
   backfill engine don't know the column exists, so every row written after
   this migration has `account_id = NULL`. Harmless (nothing reads it), and
   the UPDATE is idempotent — re-paste step 2 any time to sweep them. Phase 2
   (writers populate `account_id`) closes this gap permanently.
2. **Run it BEFORE adding any second account.** The unambiguous 1:1 mapping
   is the entire safety basis. Once a client holds two accounts on one
   platform, the join would still not fan out for OLD rows only if the old
   connection row is intact — don't rely on that; run now.
3. **Reconnect-to-a-different-account window.** If a client disconnects and
   reconnects a DIFFERENT account before this runs, its historical rows
   would be stamped with the new account id. For account-level rows
   verification 3d catches it (`account_id <> entity_id`). Current data has
   zero such cases.
4. **Shopify shares stores across clients** (6 connection rows, 4 distinct
   shop domains). Not a problem — the mapping is per `(client_id, platform)`
   — just don't be surprised by duplicate account_ids across clients.
5. **Conflict key intentionally untouched.** Widening it to include
   `account_id` is a later phase and must land simultaneously with writer
   changes in cron sync + backfill engine (byte-identical-rows rule).
   This migration does not change any write behavior.
6. **No index added on account_id.** Deliberate — query-layer support comes
   later; index when there's a reader.

## What Phase 2+ looks like (not in this migration)

- Writers (cron `/api/cron/sync`, `src/lib/backfill/`) populate `account_id`
  on every new row.
- Drop `UNIQUE (client_id, platform)` on `platform_connections` →
  `UNIQUE (client_id, platform, account_id)`.
- `sync_state` gains an account dimension; query layer / `query_metrics`
  gains optional account filter/grouping; `/clients` UI lists N connections
  per platform.
- Only after writers are proven: consider widening the metrics_daily
  conflict key.
