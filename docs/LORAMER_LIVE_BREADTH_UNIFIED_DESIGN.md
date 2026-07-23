<!-- QUEUE-EXEMPT: active design-of-record for the Live+Breadth workstream; build order lives in the QUEUE. -->
# LORAMER — Unified Live + Breadth Data Model (Design)
<!-- LORAMER_LIVE_BREADTH_UNIFIED_DESIGN_V1 -->

STATUS: ACTIVE design of record for the Live + Breadth workstream (locked 2026-06-26). This doc encodes
DECISIONS, not options. It is backend/docs-only: it touches no live code and no -next UI. Build
follows the phase order in §11; every build step obeys the standing project rules (Gate A, freeze posture,
docs-with-code). Ground-truth facts this rests on are in the Appendix (all VERIFIED by repo/DB read 2026-06-26).

## 0. Why this exists
LoraMer captures EVERYTHING from EVERYWHERE and stores it FOREVER (GOVERNING LAW). Two frontiers remain after
the depth arc (Google+Meta campaign/ad_group|ad_set/ad all wired): (1) BREADTH — every breakdown dimension each
platform serves; (2) LIVE — sub-daily / realtime data the daily store cannot hold. This doc unifies both under
one model without weakening the provability that is LoraMer's moat.

## 1. DIRECTION B — LOCKED
- `metrics_daily` (the captured daily star) REMAINS the reconciled SYSTEM-OF-RECORD. It only ever holds
  settled, reconciled, daily-grained rows.
- A SEPARATE SIBLING LIVE STORE holds live / realtime / sub-daily data, keyed by `as_of` (a capture timestamp),
  NOT by calendar `date`.
- Lora RECONCILES ACROSS the two stores and ALWAYS LABELS which store a number comes from. Captured = settled
  truth; live = provisional, as-of a timestamp.
- Rationale: realtime/instantaneous data is point-in-time (e.g. GA active-users-last-30-min) and structurally
  cannot be a daily row; forcing it into metrics_daily would corrupt the settled store. Separation preserves
  provability AND adds freshness.

## 2. PROVABILITY WALL — ALREADY STRUCTURAL (keep it that way)
- VERIFIED: every writer to `metrics_daily` is a cron (`/api/cron/sync`, `/api/cron/catchup`) or a backfill
  writer; all upsert settled daily rows via `normalizeMetricsRows` on the conflict key. No live/intraday path
  writes it. The 15-min live snapshot writes to `client_context.intelligence_cache`, a DIFFERENT table.
- DECISION: the live writer MUST NEVER target the `metrics_daily` upsert. The wall stays structural (separate
  tables + separate writers), never re-conventionalized.
- ENFORCEMENT (lint/review rule, to add): any code that writes the live store is forbidden from importing/calling
  the metrics_daily upsert path; reviewer + a grep guard check this on every live-store change.

## 3. TRUTH RULE — "MERGE WITH MANDATORY PROVENANCE" — LOCKED
- Live and captured numbers MAY be combined into one figure ONLY with inline disclosure: the live portion, its
  `as_of`, and an "unreconciled / subject-to-revision" tag must appear with the figure.
- A BARE combined figure (live + captured fused with no disclosure) is FORBIDDEN.
- ENFORCEMENT = HEAVY, three layers:
  1. SELF-LABELING TOOL RESULTS — every live tool result payload carries `source:'LIVE'`, `as_of`,
     `reconciled:false` inline in the JSON the model reads; captured results carry `source:'CAPTURED'`, settled.
  2. HARD SYSTEM-PROMPT RULE — "NEVER state a figure that fuses LIVE and CAPTURED without naming each source and
     its as_of; bare blended figures are forbidden; captured is settled truth, live is provisional."
  3. STRUCTURAL POST-HOC PROVENANCE CHECK — before the answer reaches the user, a check verifies any figure
     drawing on live data carries its provenance tag; missing provenance is caught, not left to the model.
- This is the ONE place B is not structurally safe by construction (truth-labeling is prompt/model-dependent at
  layers 1–2); layer 3 is what makes it enforced rather than hoped-for.

## 4. LIVE-INTERACTION MODEL — LOCKED
- CAPTURED-BY-DEFAULT: Lora answers from the captured system-of-record unless the question is time-sensitive.
- OFFER-LIVE-ON-RELEVANCE: Lora detects "about right now / today / current / intraday" questions and OFFERS a
  live pull, routed through a dedicated tool (`query_live`, scoped to current/intraday — §5/§ tools). Trigger
  lives in TOOL-ROUTING (the tool's description scopes it to current-data questions), reinforced by a prompt
  nudge. RELIABILITY RISK acknowledged: the trigger is model-judgment (can over/under-fire); tool-routing is the
  more reliable home; not structural.
- PERSISTENT LIVE ENVIRONMENT: a continuous-live surface (always-on polling view) is a SEPARATE, later product
  surface — NOT the default answer path. Its quota implications are in §9.

## 5. TWO RECONCILE PRIMITIVES — LOCKED
- SETTLED-EQUALITY (captured store): ONE shared primitive `reconcileDay(grainMetric, anchorMetric, {abs, pct,
  posture})` → `{within, delta, action}`. Posture is a parameter; default FLAG-NOT-BLOCK (the stale-anchor lesson);
  `pct:null` = abs-only mode. Asserts EQUALITY within tolerance ($0.01 abs OR 0.1% rel). ✅ SHIPPED 2026-06-26
  (src/lib/backfill/reconcile-day.ts, LORAMER_RECONCILE_DAY_V1) for the **5 ad-grain writers** (google-campaign
  BLOCK; google-adgroup-ad/meta-campaign/meta-adset-ad/meta-placement FLAG) — proven ZERO behavior change
  (OLD-vs-NEW dry-run, finalized + flag-exercising windows, stats + flagged[] byte-identical). The primitive owns
  ONLY delta+within+advisory-action; each caller KEEPS its flag-payload, otherDeltas, anchorMissing guard, and
  control flow. shopify-dimensional (HALT, revenue, cursor-walk) stays as-is — OUTLIER, NOT folded in v1.
- LIVE (sibling store): a DIFFERENT primitive. Instantaneous metrics have no same-grain captured twin, so it
  CANNOT assert equality. It asserts only: "this is the live snapshot as of HH:MM" + OPTIONALLY "vs the trailing
  same-time-of-day baseline = normal / high / low" (anomaly band). NEVER equality-reconcile, never "settled truth."

## 6. LIVE-STORE DISPOSAL RULE — LOCKED (decided this session)
- The live store takes PLATFORM-DEFAULT granularity: GA = last-30-min realtime; Shopify = recent orders since
  last capture; Meta/Google = "today-so-far provisional" (Google is NOT realtime — inherent reporting + conversion
  lag); Woo = NONE (self-hosted, captured-only).
- Live snapshots are EPHEMERAL. Once the daily cron captures + reconciles the period a live snapshot covered, the
  captured daily row becomes the truth and the overlapping live snapshot is DISPOSED.
- CAPTURED ALWAYS WINS ON OVERLAP. The live store never accumulates a parallel history; it is a moving freshness
  edge ahead of the settled store.

## 7. UNIFIED DATA MODEL + BREADTH
- The captured shape is sound and general: the 7-column unique key (client_id, platform, entity_level, entity_id,
  date, breakdown_type, breakdown_value) carries entity × grain × breakdown × date uniformly across 5 platforms.
  Breadth rides the EXISTING (breakdown_type, breakdown_value) mechanism — NO schema change for new ad breakdowns.
- BREADTH SCOPE (per the queue PHASE-4-BREADTH): Google device/network/geo/age-gender/hour/impression-share/video/
  all_conversions/view-through/audiences/assets; Meta age-gender/geo/device/hourly/video/ranking/full
  cost_per_action; GA sessions/users/source-medium/channel/landing-pages/device/geo/demographics/events/item-
  ecommerce; Shopify shipping-tax-split/discount-codes/variant-SKU/abandoned-value/fulfillment/inventory/tags/
  channel; Woo geo/customer-mix/variants/coupons/fulfillment. These have NO 37-mo clock (indefinite retention) —
  not racing a floor.
- BREAKDOWN REGISTRY (to add): a documented per-breakdown_type registry = {attach entity_level, breakdown_value
  encoding, source field} so every dim is encoded consistently (today conventions vary: Google terms hang off
  ad_group, Meta placement off campaign, Shopify geo off account; value encoding varies raw/composite/ISO).
- entity_level should gain a CHECK/enum (it is free text today → a typo would silently fork a grain). ad_group vs
  ad_set stay as each platform's NATIVE term (NOT renamed — that is platform fidelity, not inconsistency).
- GA FOUNDATIONAL FIX (deferred to build per project rules): GA persists ONLY account totals today; all GA
  dimensions are live-only (AUDIT GA page-level gap). GA breadth needs a DECISION: first-class session/user metric
  columns vs `extra`-jsonb (which the query layer's spend/clicks columns can't aggregate). Decide at build time.

## 8. CONSOLIDATION / RETIREMENT
- CONSOLIDATE (pre-work, before breadth multiplies copies): the shared `reconcileDay` primitive (§5); shared
  fetch primitives (the duplicated RETRYABLE / fetchAllWithRetry / queryWithRetry / per-day GAQL paging across
  google-*/meta-* backfills → one low-level paged+retry helper per API).
- RETIRE (after, never before, the query layer + live store cover its use cases): the 15-min window-fetch + cache
  in `/api/intelligence` (roadmap Historical-Engine Phase 3, verbatim: "Wire Claude fully onto the query layer;
  retire the window-fetch + 15-min cache in /api/intelligence"). The dead `raw` jsonb column → repurpose for
  raw-payload provenance OR drop (decide).
- CUTOVER SAFETY (avoid two-sources-of-truth): (1) build live store/tool + truth-spine, (2) confirm query layer
  covers the captured baseline, (3) THEN retire the 15-min snapshot. NEVER retire first.

## 9. STANDARD ACCESS — PROMOTED LAUNCH-CRITICAL
- Google Ads Basic Access = 15,000 ops/day. Captured-by-default + gated/scoped live pulls stay within Basic. A
  PERSISTENT live environment (continuous polling) does NOT — it needs Standard Access OR a hard per-client
  polling cap.
- DECISION: Standard Access is promoted to LAUNCH-CRITICAL for the Live workstream (was "scale-time"). Blocked on
  the Google Ads Tool Change Form (permissible-use); the Standard-Access RMF answer pack (deferred in
  GOOGLE_ADS_TOOL_CHANGE_FORM_ANSWERS.md) + Project-21 (export/sharing) attach here.
- Other platforms: Meta/Shopify on-demand within limits; GA realtime has a SEPARATE realtime-tokens quota
  (continuous polling hits it; on-demand fine); Woo = no live path.

## 10. FREEZE POSTURE
- `/api/intelligence` reshape + 15-min cache retirement = handle with graduated care (it feeds the live shared read-path;
  Meta approved 2026-07-02 — no freeze).
- ALL new UI targets `-next` (the live app is no longer frozen — Meta approved 2026-07-02; -next stays the primary build target).
- Keep live pulls OFF the cron window (~08:45 UTC sync/catchup band; the drain crons already avoid it).
- Backend writers/primitives/new stores are freeze-safe and may proceed before unfreeze.

## 11. BUILD PHASES (ordered; each its own gated change, docs-with-code)
1. CONSOLIDATION PRE-WORK [✅ DONE 2026-06-26]: (1a) shared `reconcileDay` primitive — 5 ad writers,
   zero-change proven; shopify-dimensional OUTLIER not folded. (1b) shared fetch/paging/retry primitives —
   `gaql-with-retry.ts` gaqlWithRetry (2 google writers) + `meta-graph-paged.ts` metaFetchAllPaged (3 meta
   writers; guard param preserves adset-ad's 200 cap), zero-change proven. Two FUTURE notes carried (do NOT
   do under consolidation): (i) unify the two Google retries (backfill gaqlWithRetry vs forward
   google-retry.ts withGaqlRetry) = a BEHAVIOR-CHANGE decision (different codes/attempts/backoff/logging);
   (ii) Meta 100/subcode-1487534 "narrow-and-retry" lives at the CALLER's chunk-loop (window narrowing),
   NOT the fetch primitive = a separate behavior change. Both writers throw-on-100/1487534 today (parity).
   PHASE 1 COMPLETE. Freeze-safe.
2. BREADTH: capture every breakdown dimension fwd + backfill per §7, one drain-registry entry each; breakdown
   registry + entity_level CHECK. Freeze-safe backend.
3. LIVE SPINE: sibling live store + live reconcile primitive + `query_live` tool + the §3 truth-spine
   (self-labeling results + system-prompt rule + post-hoc provenance check). Freeze-safe backend.
4. LIVE UI on `-next` (captured-by-default + offer-live; persistent-live surface later). -next only.
5. INTELLIGENCE RESHAPE + 15-min cache retirement. FREEZE-GATED — LAST, post-Meta-decision.

## 12. OPEN NEEDS-DECISION (carry into build)
- Live store: persisted snapshots vs fetch-on-demand-only.
- GA metrics: first-class session/user columns vs extra-jsonb.
- `raw` column: repurpose-for-provenance vs drop.
- Provenance post-hoc check: how strict (block answer vs annotate).
- Live-pull frequency cap (pre-Standard-Access).
- GA Realtime + commerce-sessions sub-daily shapes: confirm fit in the live store vs a further extension.

## Appendix — GROUND TRUTH (VERIFIED 2026-06-26)
- metrics_daily: 21 cols; unique key = 7 cols above; indexes on (client,platform,date) and (client,platform,
  entity_level,date); NO breakdown index; `synced_at`=write-time (not a freshness flag); `raw` jsonb DEAD.
- Writers to metrics_daily: 7 backfill writers + cron sync + cron catchup — all settled/daily via
  normalizeMetricsRows. NO live writer. 15-min snapshot → client_context.intelligence_cache (separate table).
- entity_level written: google {account,campaign,ad_group,ad}+{ad_group×keyword, ad_group×search_term};
  meta {account,campaign,ad_set,ad}+{campaign×placement}; shopify {account,product}+{account×geo_country,
  geo_region}; ga {account ONLY}; woo {account,product}.
- GA: analytics.readonly scope, Data API v1beta runReport; Realtime = same scope/token/property, runRealtimeReport,
  last-30-min, separate realtime quota; zero realtime code today.
- Reconcile: 6 copy-paste blocks, 3 postures (BLOCK/FLAG/HALT). Fetch: fetchXIntelligence canonical (reused by
  cron+intelligence+shopify-backfill); google/meta backfills reimplement fetch.
- Google Ads Basic Access = 15k ops/day; full intel pull ~20+ ops, scoped live pull ~1–3 ops.

## Session-log pointer
Design locked 2026-06-26 after two read-only ground-truth investigations (data-model + live/breadth) this session,
following the Google+Meta depth arc completion (campaign/ad_group/ad_set/ad all wired). See CONTINUE_HERE session log.
