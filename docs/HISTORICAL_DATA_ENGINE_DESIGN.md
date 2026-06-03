# LoraMer Historical Data Engine — Design
<!-- LORAMER_HISTORICAL_DATA_ENGINE_DESIGN_V1 -->

*Filed June 3, 2026. Foundational. This is the spine — the architecture that makes "every piece of everything, always available to the AI" real. It replaces the current fetch-one-selected-window model that is why period-over-period and deep history don't work today.*

---

## 1. What it delivers

Claude can answer any question across **any time period and any dimension, instantly, for any client** — and "remember" it — because the data lives in LoraMer's own database, queried per question, instead of being live-fetched one window at a time.

The capability test, in Russ's words: *"best combination of assets relative to spend for the last 7 days, compared to the same thing 6 months ago, a year ago, and 18 months ago"* — answered without blinking, then carried into the next question.

This is the moat promise made literal: deep accumulated knowledge (lore + sea), feeding force-multiplier recommendations grounded in full history — not one isolated window.

---

## 2. Core principles

1. **Store, don't re-fetch.** Platforms are pulled on a schedule into LoraMer's own database. Questions are answered from the store, not from a live per-question fetch.
2. **Capture forward, forever.** From day one of the engine, every metric at full granularity is banked permanently in LoraMer. Platform retention stops mattering for everything captured from here on.
3. **Backfill as deep as each platform still allows** — which is less than expected and shrinking (see §3).
4. **Platform-agnostic by construction.** One normalized store + thin per-platform sync adapters + one query layer. Every current and future platform plugs into the same spine; a new connector is a new adapter, not a rebuild.
5. **Query slices, never the firehose.** Claude pulls exactly the slices a question needs via tools. The context window is never the bottleneck, and per-question Anthropic cost goes *down* vs. stuffing whole windows.

---

## 3. The hard reality on "as far back as possible" (verified June 3, 2026)

This is the constraint that shapes everything, and it is time-sensitive.

| Platform | Granular (daily / asset-level) | Coarse (monthly+) | Notes |
|---|---|---|---|
| **Google Ads** | **37 months** (rolling) | 11 years (monthly/quarterly/annual) | Enforced **June 1, 2026**. Granular queries past 37 months return `DateRangeError`. Reach/frequency: 3 years. |
| **Meta Ads** | aggregate ~**37 months**; breakdowns ~6–13 months | — | Placement/device breakdowns ~13 mo; frequency ~6 mo; unique counts ~13 mo (Jan 2026). |
| **GA4** | ~**36 months** via Data API (silent truncation) | — | Plus a per-property data-retention setting (can be as low as 2/14 mo for event-level) — verify per property. |
| **Shopify** | effectively full history | — | Commerce data via Admin API back to store creation. Verify per adapter. |
| **WooCommerce** | full history | — | Merchant's own database; no platform purge. |

**What this means:** "everything as far back as possible" = roughly **37 months of full-granularity history** backfilled now (plus Google's 11-year monthly aggregates and full commerce history), and then **everything, forever, from today**.

**The urgency, in the platforms' own words:** Both Google and Meta now tell advertisers to *"hold your own data."* The granular window is **rolling** — every day without forward-capture running, Google and Meta permanently drop the oldest day of granular history off a 3-year edge. Backfill gets ~3 years today; the store is the only way to ever exceed 3 years of granular depth. **Forward-capture is a countdown, not a preference.**

---

## 4. Architecture

### 4a. The store (normalized, platform-agnostic)

- **Metrics fact table** — base grain is **daily**, the finest grain reliably comparable across time and platforms. Rows keyed by `(client_id, platform, entity_level, entity_id, date [, breakdown dims])` → normalized metrics (`spend, impressions, clicks, conversions, conversion_value, revenue, …`) + a `raw` JSON column for platform-specific extras that don't map cleanly.
- **Entity dimension tables** — campaigns / ad sets / ads / assets (and each platform's analogs: GA properties, Shopify products/orders, Woo equivalents) with names, status, metadata.
- **Breakdown dimensions** — placement, device, geo, asset/combination — as additional dimension columns/tables, populated only where the platform retains them.
- A new platform = new rows tagged with the platform + an adapter mapping. **No schema rework per platform.**

### 4b. Sync adapters (one thin adapter per platform)

- Each adapter pulls yesterday's data and **upserts** into the store. Reuses the API knowledge already in the existing per-platform intelligence adapters (`google-intelligence.ts`, `meta-intelligence.ts`, `shopify-intelligence.ts`, `ga-intelligence.ts`).
- Runs **nightly**, scheduled. Upserts are **idempotent** (re-running a day overwrites cleanly).
- Includes a **rolling lookback** (re-pull the last N days each night) because Google and Meta restate recently-attributed conversions after the fact.

### 4c. Backfill (one-time, per client per platform)

- On connect — and once now for every existing client — pull the full available history (capped at the platform's retention from §3) into the store.
- **Chunked by date** to respect rate limits; **resumable** so a failure doesn't restart from zero.

### 4d. Query layer — the agent layer, made concrete

- Claude gets tools, e.g. `query_metrics(client, platform(s), level, dateRange(s), dimensions, filters)` → returns aggregated and/or multi-period comparison results from the store.
- Supports **arbitrary periods and multi-period comparison** in one ask (this period vs. any number of prior periods).
- Claude composes the marquee example as a few tool calls + reasoning; only the **result slices** enter context.

### 4e. How it feeds Claude (replaces today's live-fetch)

- The nightly sync keeps the store fresh; per question, Claude **queries the store via tools** instead of being handed one pre-fetched window.
- The stale/empty-cache failure class (today's Meta bug) **largely dissolves**, because data lives in our DB and is queried fresh per question rather than fetched-once-and-cached.

---

## 5. Volume & cost (sanity check)

- A client with hundreds of ads over 37 months at daily grain with a few breakdowns lands on the order of 10^5–10^6 rows. Postgres/Supabase handles this comfortably with indexing + **partitioning by date (and/or client)**.
- **Sync cost:** nightly incremental is cheap (yesterday + rolling lookback). The one-time **backfill** is the heavy, rate-limit-bounded job.
- **Anthropic cost goes down** per question — Claude pulls only the needed slices instead of a window firehose.

---

## 6. Phased build (value fast, no boiling the ocean)

- **URGENT — Phase 0a: Forward-capture first.** Stand up the store schema + nightly sync for the platforms we have, so we **stop losing the rolling granular window today** — even before backfill and the query layer are polished. This is the countdown item.
- **Phase 0b:** Backfill + a basic query tool for **one** platform end-to-end (likely Google or Meta), proving the multi-period comparison works on one real client.
- **Phase 1:** Roll adapters out to the rest of the current platforms (Meta/Google/Shopify/GA/Woo).
- **Phase 2:** Asset/combination-level depth + breakdowns where retained.
- **Phase 3:** Wire Claude fully onto the query layer; retire the window-fetch + 15-min cache in `/api/intelligence`.
- **Phase 4:** New-platform adapter template — Triple Whale, LinkedIn, TikTok, etc. inherit history + comparison for free.

---

## 7. Relationship to existing projects

- **Replaces** the live-fetch model inside the intelligence layer (Project 3).
- **Complements Project 9 (Memory & Learning):** this is the raw historical *numbers*; memory is the learned *model of the operator*. Both feed Claude.
- **Distinct from Project 10 (Uploads):** uploads are for non-API operator data (LTV, margins, CRM). Uploads are **not** the mechanism for platform history — this engine is. Don't conflate them.
- **Enables the agent layer** (moat item #5).

---

## 8. Open decisions / to verify during build

1. Finalize exact per-platform retention (GA4 property settings; confirm Shopify/Woo full history).
2. Rolling-lookback window per platform for late-attributed conversions.
3. Asset/combination depth: forward-capture is total; **backfill is partial** (Google PMax combinations / Meta breakdowns are the most retention-limited layer).
4. Store partitioning strategy at scale.
5. Sync orchestration: Vercel cron vs. a dedicated worker — Vercel function timeouts will likely force chunking/queueing for the backfill.
6. Anthropic cost model for query-tool calls per question.

---

## 9. The one line that matters

Every day without forward-capture running, the platforms permanently drop the oldest day of granular history off a rolling 3-year edge. **Build the capture now; everything else can follow.**
