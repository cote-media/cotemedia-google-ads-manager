-- LORAMER_ORDER_LEVEL_STORAGE_V1 (migration 045) — THE ORDER GRAIN, platform-agnostic.
--
-- ✅ APPLIED TO PRODUCTION (verified live 2026-07-31 by object existence, not by memory).
-- ⛔ THIS HEADER USED TO SAY "NOT APPLIED" AND IT WAS WRONG. A migration file asserting its own applied-state is a
-- doc restating a fact the DATABASE owns (LORAMER_DOCS_NEVER_RESTATE_LIVE_STATE_V1), and six of these were stale at
-- once — read by the next session deciding whether to run them. The applied-state is now checked mechanically in
-- `npm run check:data` (doc-ownership guard), in BOTH directions. Do not restate it here again; if you must note
-- something, note the DATE it was applied, which is tense-locked history and cannot drift.
-- (Historical: authored 2026-07-25 for Russ's approval; APPLIED 2026-07-25.) There is no staging DB (banked law), so this runs
-- against PRODUCTION or not at all. Blast radius: ADDITIVE ONLY — three NEW tables, no ALTER, no DROP, no
-- backfill, no change to metrics_daily or any existing table. Nothing reads these tables until the writer
-- ships, so applying this migration alone changes ZERO behavior. REVERT = DROP (bottom of this file).
--
-- WHY: an ORDER is the grain for a store — it is the thing that gets refunded, edited, or cancelled. Today
-- orders are fetched, summed IN MEMORY, and DISCARDED; only daily aggregates survive in metrics_daily
-- (★ORDER-LEVEL-STORAGE, ★GRAIN-RETENTION-AUDIT). That is a standing capture-law violation on BOTH stores, and
-- for WooCommerce it is the ONLY route to change-based restatement: wc/v3 has no native modified-date filter
-- (★WOO-TIER2-BLOCKED-BY-PLATFORM), so a periodic re-fetch BY ORDER ID is the only mechanism that detects a
-- change at all. Storing the grain is what makes that possible.
--
-- PLATFORM-AGNOSTIC BY THE UNIVERSAL KEY (CLAUDE.md): (client_id, platform, account_id) + the vendor order id.
-- Shopify and WooCommerce share these tables. They do NOT share a fetch adapter — Shopify arrives via the Bulk
-- Operations API (JSONL), Woo via paged REST + re-fetch by id. Per-platform behavior lives in the adapter, never
-- in the schema. A third store (BigCommerce, Squarespace) adds an adapter, not a migration.
--
-- ⛔ THE DAY KEY IS NOT DERIVED IN SQL, AND THAT IS DELIBERATE.
-- created_date is written by the ADAPTER, not by a generated column. Shopify returns createdAt as ISO-8601 with
-- the SHOP's UTC offset (e.g. 2026-07-24T21:40:11-04:00), and the live capture buckets a day with
-- String(o.createdAt).slice(0,10) — shopify-intelligence.ts:938 — i.e. the SHOP-LOCAL date. A
-- `generated always as ((created_at at time zone 'UTC')::date)` column would silently disagree by one day for
-- every late-evening order, and every recompute-from-local would then contradict the rows forward capture
-- already wrote. Byte-identical rows to forward capture is banked law. The adapter MUST write created_date with
-- the same expression the live path uses; created_at_raw preserves the vendor string so any disagreement is
-- provable after the fact rather than assumed away.

-- ── 1. ORDERS ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.store_orders (
  client_id           uuid        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  platform            text        NOT NULL,   -- 'shopify' | 'woocommerce' | future adapters
  account_id          text        NOT NULL,   -- shop domain / site URL — third leg of the universal key
  order_id            text        NOT NULL,   -- vendor id VERBATIM (gid://shopify/Order/123, or Woo's numeric id as text)

  order_number        text,                   -- human-facing name (#1001) — for reconciliation with the merchant
  created_at          timestamptz NOT NULL,   -- vendor createdAt, parsed
  created_at_raw      text        NOT NULL,   -- vendor createdAt VERBATIM — proves the offset the day key came from
  created_date        date        NOT NULL,   -- THE bucket key. Written by the adapter (see the block above).
  updated_at_remote   timestamptz,            -- vendor updated_at — the Tier-2 change cursor. Shopify only; NULL on Woo.
  processed_at        timestamptz,
  cancelled_at        timestamptz,

  currency            text,
  financial_status    text,
  fulfillment_status  text,

  -- MONEY. All shop-currency. subtotal_current is the NET basis and the ONLY revenue number that may be summed
  -- into an aggregate — currentSubtotalPriceSet, refund-adjusted, EXCLUDES shipping and tax (banked Shopify law:
  -- revenue = NET via currentSubtotalPriceSet, never gross totalPriceSet). The rest decompose the total.
  subtotal_current    numeric(14,2),
  total_current       numeric(14,2),
  total_tax           numeric(14,2),
  total_discounts     numeric(14,2),
  total_shipping      numeric(14,2),
  total_refunded      numeric(14,2),
  total_tip           numeric(14,2),

  customer_ref        text,                   -- vendor customer id — backs new-vs-returning cohort
  channel_handle      text,
  channel_name        text,
  discount_codes      text[],
  ship_country        text,
  ship_province       text,
  ship_city           text,

  raw                 jsonb,                  -- the vendor node as returned. Replay/repair without re-fetching.

  -- ── DISAPPEARANCE DETECTION. A hard-deleted order never appears in any sweep, so absence is only visible by
  -- comparing what a sweep RETURNED against what we HOLD. last_seen_at is stamped on every sweep that covered
  -- this order's window; deleted_upstream_at is set when a sweep that SHOULD have returned it did not. Rows are
  -- never hard-deleted: a tombstone is evidence, a missing row is silence.
  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  deleted_upstream_at timestamptz,

  PRIMARY KEY (client_id, platform, account_id, order_id)
);

-- Recompute a day's aggregate from LOCAL rows. Partial: tombstoned orders must never re-enter a sum.
CREATE INDEX IF NOT EXISTS idx_store_orders_day
  ON public.store_orders (client_id, platform, account_id, created_date)
  WHERE deleted_upstream_at IS NULL;

-- Tier-2 change sweep: "what has this store changed since my cursor" + the cursor's own high-water read.
CREATE INDEX IF NOT EXISTS idx_store_orders_changed
  ON public.store_orders (client_id, platform, updated_at_remote DESC NULLS LAST);

-- Staleness sweep: which orders a re-fetch has not confirmed lately (drives Woo's re-fetch-by-id batches).
CREATE INDEX IF NOT EXISTS idx_store_orders_last_seen
  ON public.store_orders (client_id, platform, last_seen_at);

-- ── 2. LINE ITEMS ───────────────────────────────────────────────────────────────────────────────────────────
-- created_date is DENORMALIZED from the parent so a day recompute never needs the join. It is written by the
-- adapter from the parent order's created_date — the same value, never re-derived.
--
-- ⛔ LINE ITEMS ARE REPLACED PER ORDER, NOT UPSERTED. An order edit can REMOVE a line, and an upsert only
-- overwrites keys that recur — the removed line would survive forever and inflate every product aggregate built
-- from it. The writer MUST delete this order's lines and insert the current set inside ONE transaction. This is
-- the same stale-key trap already live in the metrics_daily day-REPLACE (cron/sync:319 is upsert-only, no
-- delete); do not reproduce it at the new grain.
CREATE TABLE IF NOT EXISTS public.store_order_line_items (
  client_id      uuid    NOT NULL,
  platform       text    NOT NULL,
  account_id     text    NOT NULL,
  order_id       text    NOT NULL,
  line_item_id   text    NOT NULL,

  created_date   date    NOT NULL,            -- denormalized from the parent order; adapter-written
  product_ref    text,
  variant_ref    text,
  title          text,
  variant_title  text,
  product_type   text,
  vendor         text,
  tags           text[],
  quantity       integer NOT NULL DEFAULT 0,
  unit_price     numeric(14,2),
  line_discount  numeric(14,2),
  line_total     numeric(14,2),

  raw            jsonb,

  PRIMARY KEY (client_id, platform, account_id, order_id, line_item_id),
  FOREIGN KEY (client_id, platform, account_id, order_id)
    REFERENCES public.store_orders (client_id, platform, account_id, order_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_store_line_items_day
  ON public.store_order_line_items (client_id, platform, account_id, created_date);

CREATE INDEX IF NOT EXISTS idx_store_line_items_product
  ON public.store_order_line_items (client_id, platform, product_ref);

-- ── 3. BULK OPERATION LIFECYCLE ─────────────────────────────────────────────────────────────────────────────
-- ⚠ RUSS MAY STRIKE THIS TABLE — it is the one piece beyond "orders + line items" that was asked for, and it is
-- included because the Shopify Bulk Operations API is ASYNCHRONOUS and we run on Vercel serverless. A bulk op is
-- started in one invocation and completes minutes-to-hours later, in another. sync_state has no column that can
-- hold "op gid X is RUNNING for this shop", and Shopify enforces ONE bulk QUERY operation per shop per app at a
-- time on our API version — so starting a second one while the first runs is a hard userError, not a queue.
-- Without this table the writer cannot know an op is already in flight and cannot find the JSONL URL when the
-- op finishes. If this is struck, the writer needs an equivalent home before it can ship.
CREATE TABLE IF NOT EXISTS public.store_bulk_operations (
  id             bigserial   PRIMARY KEY,
  client_id      uuid        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  platform       text        NOT NULL,
  account_id     text        NOT NULL,
  operation_gid  text,                        -- gid://shopify/BulkOperation/123 — NULL until the mutation returns
  purpose        text        NOT NULL,        -- 'orders_backfill' | 'orders_change_sweep'
  status         text        NOT NULL,        -- CREATED|RUNNING|COMPLETED|FAILED|CANCELED|CANCELING|EXPIRED
  error_code     text,                        -- ACCESS_DENIED | INTERNAL_SERVER_ERROR | TIMEOUT
  query_text     text,                        -- the exact bulk query submitted — replayable
  window_start   date,
  window_end     date,
  object_count   bigint,
  result_url     text,                        -- signed JSONL URL; Shopify expires it after ONE WEEK
  partial_url    text,                        -- partialDataUrl — salvage path on FAILED
  rows_ingested  bigint      NOT NULL DEFAULT 0,
  started_at     timestamptz NOT NULL DEFAULT now(),
  polled_at      timestamptz,
  finished_at    timestamptz,
  ingested_at    timestamptz
);

-- "Is an op already in flight for this shop?" — the question asked before every start.
CREATE INDEX IF NOT EXISTS idx_store_bulk_ops_inflight
  ON public.store_bulk_operations (client_id, platform, account_id, status);

-- Match the fleet's posture: RLS ENABLED (service-role bypasses; anon/authenticated default-deny — no policy
-- needed). Every reader and writer of these tables is server-side under supabaseAdmin.
ALTER TABLE public.store_orders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_order_line_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_bulk_operations   ENABLE ROW LEVEL SECURITY;

-- ── REVERT PATH (no staging DB — banked law; this is the whole rollback) ─────────────────────────────────────
-- These are NEW tables that nothing reads until the writer ships, so revert is a clean DROP with no data loss
-- outside the new grain and no effect on metrics_daily. Run in this order (line items FK the orders table):
--
--   DROP TABLE IF EXISTS public.store_order_line_items;
--   DROP TABLE IF EXISTS public.store_bulk_operations;
--   DROP TABLE IF EXISTS public.store_orders;
--
-- If the writer has already shipped, the revert must ALSO revert the writer — dropping these tables under a live
-- writer turns every capture run into a hard error. Migration first, writer second, revert in the reverse order.
