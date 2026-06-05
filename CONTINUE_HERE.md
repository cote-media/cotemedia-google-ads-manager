# CONTINUE_HERE — Resume point after June 5, 2026

Read AFTER LORAMER_HANDOFF.md and ROADMAP.md, not before. Same laptop as last
session (MacBook Air, ~/Downloads/cotemedia-google-ads-manager).

## Session start (FIRST, every session — paste into the Cursor terminal)
```
cd ~/Downloads/cotemedia-google-ads-manager && git pull origin main
```
Expect "Already up to date" on the same laptop.

NOTE FOR THE NEXT CLAUDE: Russ does not touch code. Always hand him COMPLETE
copyable commands/blocks and state exactly where each is pasted (Cursor terminal /
Supabase SQL Editor / macOS Terminal / Vercel). Never tell him to scroll to a
previous message — if there's any confusion, re-paste the full command in your
newest message. Deliver code as downloadable files/zips (byte-exact), NOT as
multi-line pastes into the terminal (see Lesson 29).

## Session — June 5, 2026: GA backfill shipped (engine now platform-agnostic)

- GA4 historical backfill DONE end-to-end (probe -> daily fetch -> shared row
  builder -> engine V3 hooks -> GA adapter -> CRON wrapper -> UI). Verified on
  My Vacation Network (1266 rows back to 2022-12-14, per-day parity) and a
  second GA client.
- The shared backfill engine is now platform-agnostic (V3 hooks). Adding a
  platform = daily fetch + row builder + adapter + CRON wrapper + UI mount.
- A standing protocol directive was added: use Claude Code for deep-dive
  research/edits; err on caution whenever a next step isn't 100% certain.

## DONE — query_metrics: support arbitrary explicit date ranges
<!-- LORAMER_QUERY_METRICS_DATE_FLEX_DESIGN_2026_06_05 -->

**Close-out (June 5, 2026):** Shipped as LORAMER_QUERY_METRICS_DATE_FLEX_V1 — additive
`windows` param on queryMetrics opts + query_metrics tool schema/description rewrite +
proving route accepts explicit windows. PROVEN headless on My Vacation Network
(965c77ff-3ad5-44b2-8d45-ee8ab1c97966): Q4 2024 (2024-10-01..2024-12-31, spend
$12,097.46, 223 conv) and Q4 2025 (2025-10-01..2025-12-31, spend $19,191.57, 758
conv) returned with exact dates echoed and accurate labels. baseRange/offsets path
behavior-identical.

THE PROBLEM (verified against code, not assumed): the query_metrics tool can
only express a baseRange PRESET (LAST_7/14/30/90_DAYS, THIS_MONTH, LAST_MONTH)
plus offsetsMonths (equal-length windows ending N calendar months before the
base). It CANNOT accept explicit dates. So "Q4 2024" (Oct 1 - Dec 31, 2024) is
impossible to express: the model approximated it as a ~30-day preset + 18-month
offset, landed on Nov 5 - Dec 4, 2024, and mislabeled that slice "Q4 2024."
This cripples the moat (Claude reasoning over arbitrary history) and produces
confidently mislabeled analysis.

ROOT CAUSE is purely the tool INTERFACE, not the data/engine:
- src/lib/metrics-query.ts -> aggregateWindow ALREADY filters
  .gte('date', startDate).lte('date', endDate) for ANY dates.
- src/lib/date-range.ts -> resolveDateWindow ALREADY supports explicit dates via
  ('CUSTOM', customStart, customEnd) or when both customs are passed.
- The gap: queryMetrics opts + the query_metrics tool schema/description never
  expose explicit start/end. queryMetrics calls resolveDateWindow(baseRange)
  with one arg and derives comparison windows by month-shifting the base end
  date (equal span).

THE FIX (additive, back-compatible, ~3 files):
1. src/lib/metrics-query.ts - add optional
   windows?: Array<{ label?: string; startDate: string; endDate: string }>
   to queryMetrics opts. When present, aggregate EXACTLY those explicit windows
   (any dates, any length, any count) via the existing aggregateWindow + derive,
   carrying each provided label (fallback "start..end"). When ABSENT, keep the
   current baseRange/offsetsMonths behavior byte-identical (full back-compat).
   Validate each window: YYYY-MM-DD and startDate <= endDate; otherwise pass
   through (the store returns no rows for pre-data days, which is honest).
2. src/lib/claude-tools.ts - add `windows` to the query_metrics input_schema
   (array of {label, startDate, endDate}); forward it in runQueryMetricsTool.
   REWRITE the description: for any SPECIFIC period (a quarter, month, year, or
   arbitrary range) the model must translate it to explicit YYYY-MM-DD windows
   ITSELF and pass them in `windows` (Q4 2024 -> 2024-10-01..2024-12-31;
   "Q4 2024 vs Q4 2025" -> two windows). Use baseRange/offsetsMonths ONLY for
   rolling recent-vs-prior. Label each window accurately; never relabel a
   different window as the requested period. If `windows` is provided, ignore
   baseRange/offsets (mutually exclusive — say so in the description).
3. (recommended) src/app/api/query-metrics/route.ts - accept explicit windows
   too, so the fix is PROVEN HEADLESSLY (CRON_SECRET curl) before trusting
   in-app, exactly like the GA probe.

VERIFY headless on My Vacation Network (clientId
965c77ff-3ad5-44b2-8d45-ee8ab1c97966): query windows 2024-10-01..2024-12-31 and
2025-10-01..2025-12-31, confirm day-accurate totals from metrics_daily and that
labels echo back. Then in-app: ask LoraMer "compare Q4 2024 to Q4 2025" and
confirm it passes explicit windows, correctly labeled.

DISCIPLINE: interface-only; do NOT change aggregateWindow's math or the existing
baseRange/offsets path (keep byte-identical, like the V3 default branch). Read
the live files via Claude Code before editing; diff-review before each commit.

## NEXT TASK (priority) — Multiple ad accounts within a SINGLE client

**Problem:** `platform_connections` is ~1 account per `(client_id, platform)` and
`metrics_daily` had no account dimension, so one client can't hold two accounts on
the same platform without rows merging.

**Phase 1 DONE (June 5, 2026)** <!-- LORAMER_MULTIACCOUNT_PHASE1_DONE_V1 -->
Migration `migrations/005_metrics_daily_account_id.sql` was run in the Supabase
SQL Editor and VERIFIED live: nullable `account_id` added to `metrics_daily` and
backfilled from `platform_connections` for ALL FIVE platforms — every platform
`still_null = 0`, 19,404 rows total. Conflict key untouched; no app code changed.
Scoping brief + risk log: `docs/scoping/multi-account-phase1.md`. The backfill
UPDATE is idempotent — rows the cron writes before Phase 2 land NULL; re-paste
step 2 of the migration any time to sweep them.

**Phase 2 step (a) SHIPPED (June 5, 2026)** <!-- LORAMER_MULTIACCOUNT_PHASE2A_VERIFIED_GA_V1 -->
LORAMER_MULTIACCOUNT_PHASE2A_V1: all 7 `metrics_daily` row builders now
populate `account_id` (cron shopify/meta/google/woo + shared GA builder +
backfill google/meta inline + GA backfill via the shared builder). Conflict
key UNTOUCHED. `npm run build` verified before commit; deployed to prod.

**GA path PROVEN in prod (June 5, 2026):** GA backfill lap on Veterinary
mastermind (f5fbe7e5-7b22-4a17-9681-6fab7fbeddb2) wrote 151 fresh rows with
`account_id` populated (= `properties/518184304`, matches `entity_id`).
Table-wide `null_account = 0` across all 5 platforms (ga 3006, google 14895,
meta 1631, shopify 20, woo 3).

**PENDING GATE:** the 4 cron-only forward-capture builders
(google/meta/shopify/woo) have NOT written under the new code yet — today's
capture predated the deploy. Tonight's cron writes 2026-06-05 rows through
them.

**NEXT SESSION FIRST ACTION:** execute the runbook below
("FINISH MULTI-ACCOUNT MIGRATION"). Full plan + hazards:
`docs/scoping/multi-account-phase2.md`.

Then the rest of the ripple: connection schema/uniqueness
(`UNIQUE (client_id, platform)` → `(client_id, platform, account_id)`),
intelligence adapters, `sync_state` keying, query layer, `/clients` UI.

## FINISH MULTI-ACCOUNT MIGRATION (multi-account-phase2 steps b–d)
<!-- LORAMER_MULTIACCOUNT_PHASE2_RUNBOOK -->

Ordered runbook for Claude Code to execute end-to-end. STOP on any failure —
do not improvise past a failed step. Run c1–c3 well away from the ~08:45 UTC
cron window. Live conflict constraint name (verified 2026-06-05):
`metrics_daily_client_id_platform_entity_level_entity_id_dat_key`.

**GATE (all must pass, else STOP):**
1. Query `metrics_daily`: fresh rows exist for `date = '2026-06-05'` on EACH
   of google / meta / shopify / woocommerce (proves all 4 cron-only builders
   wrote under the new code).
2. `null_account = 0` for EVERY platform, table-wide:
   ```
   select platform, count(*) rows, count(*) filter (where account_id is null) null_account
   from metrics_daily group by platform order by platform;
   ```
3. Confirm DDL writes are possible (Supabase MCP in write mode, or hand the
   SQL to Russ for the Supabase SQL Editor).

**STEP b — guard then lock:**
```sql
DO $$ DECLARE n bigint; BEGIN SELECT count(*) INTO n FROM public.metrics_daily WHERE account_id IS NULL; IF n>0 THEN RAISE EXCEPTION 'ABORT: % null account_id', n; END IF; END $$;
ALTER TABLE public.metrics_daily ALTER COLUMN account_id SET NOT NULL;
```

**STEP c1 — add the new key (idempotent; only if a constraint named
`metrics_daily_multiaccount_unique` doesn't already exist):**
```sql
ALTER TABLE public.metrics_daily
  ADD CONSTRAINT metrics_daily_multiaccount_unique
  UNIQUE (client_id, platform, account_id, entity_level, entity_id, date, breakdown_type, breakdown_value);
```

**STEP c2 — flip both constants, byte-identical:**
In `src/app/api/cron/sync/route.ts` (~L22-23) and
`src/lib/backfill/run-backfill.ts` (~L82-83), change `METRICS_DAILY_CONFLICT`
from
`'client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value'`
to
`'client_id,platform,account_id,entity_level,entity_id,date,breakdown_type,breakdown_value'`.
Grep `account_id,entity_level` to prove BOTH flipped byte-identical; run
`npx tsc --noEmit`; commit and push ONLY if both pass.

**STEP c3 — only after the Vercel deploy is READY:**
```sql
ALTER TABLE public.metrics_daily DROP CONSTRAINT IF EXISTS metrics_daily_client_id_platform_entity_level_entity_id_dat_key;
```

**STEP d — prove it:** run one Google backfill lap for client
`f5fbe7e5-7b22-4a17-9681-6fab7fbeddb2` (Veterinary mastermind); confirm row
count unchanged, all rows non-null `account_id`, zero upsert/constraint
errors.

**Why this ordering is safe:** c1→c2→c3 is window-free by design — at every
moment a unique constraint matching the RUNNING code's onConflict column list
exists (old code matches the old constraint until c3; new code matches
`metrics_daily_multiaccount_unique` from c1). Keep that order.

### Next tasks (none urgent — no purge clock on GA/Shopify/Woo)
1. Meta "per-adapter floor" fix — Meta backfill shows "partial / Resume" that
   never completes because its fetch throws past the account's first data
   (cosmetic; data is complete to account start). Diagnose with a headless Meta
   run first.
2. Shopify backfill adapter (V3 pattern).
3. WooCommerce backfill adapter (V3 pattern).
4. Cleanup: delete stray repo-root scripts `append_handoff_docs.py` and
   `patch_backfill_ui_v1.py` (untracked leftovers).

## What shipped & was PROVEN this session

### In-app backfill button — Phase 1 COMPLETE (retired the CRON_SECRET curl)
- `src/lib/backfill/run-backfill.ts` — shared backfill engine (account-level daily,
  chunked, resumable). Auth is the caller's responsibility.
- `src/lib/backfill/adapters.ts` — per-platform adapters (google + meta) + a
  `backfillAdapters` registry. THIS is where every future platform plugs in.
- `src/app/api/backfill/google/route.ts` + `meta/route.ts` — now THIN CRON-bearer
  GET wrappers over the engine (behavior identical to the pre-refactor V1/V2).
- `src/app/api/backfill/run/route.ts` — session-authed POST, ownership-gated
  (closes the IDOR on the GET routes), {google,meta} allowlist, one platform/lap.
- `src/app/api/backfill/status/route.ts` — session-authed GET, per-platform
  progress; reports the HONEST earliest (actual min(date) in metrics_daily).
- `src/app/api/backfill/probe/route.ts` — read-only CRON-bearer diagnostic: ask a
  platform's API for any date window, see rows/earliest/latest/error. Use it to
  confirm how deep a platform actually serves BEFORE trusting depth.
- `src/app/clients/BackfillControl.tsx` — per-platform UI control on /clients
  Connections (google+meta): reads status, drives run in resumable laps, disables
  while running (double-click guard), shows honest history depth.

### Deep-history V2 — capture as far back as the platform serves
- `run-backfill.ts`: floor raised 36 → 132 months (Google's 11yr ceiling); per-chunk
  try/catch (stops gracefully on a retention/date error instead of 500-ing); target
  recomputed fresh each run.
- `status` route: earliestDate = actual earliest row held (honest), not the swept
  cursor target.
- PROVEN on "Bath Fitter | O'Gorman Bros" (Google): earliest 2020-01-27 (the
  account's true first-spend day, matched in the Google UI), 1,933 daily rows,
  total_spend $2,293,179.80 — reconciling to Google's all-time $2.29M to the penny.

### Reset + redeepen
- Cleared backfill_complete / backfill_earliest_date / backfill_target_date for ALL
  google+meta sync_state rows so every client's button reappeared. Russ then
  backfilled ALL his current google+meta clients deep. (The reset only clears the
  cursor/flags — metrics_daily data is never deleted by it.)

## Platform data-retention reality (drives backfill strategy — see ROADMAP table)
- GOOGLE ADS: rolling 37-month limit on GRANULAR (daily/hourly/weekly) data + 11yr
  for aggregates, effective June 1, 2026. As of June 4 the API STILL served full
  granular history (we pulled 51–77 months) — enforcement not yet biting. URGENT:
  backfill new google clients while the deep history is still reachable.
- META: shorter retention (~37 months typical); backfill works, sweeps empty for
  older ranges, resumable.
- GA4: the 2/14/50-month retention applies to EVENT/USER-level data (Explorations).
  The AGGREGATE metrics LoraMer pulls are kept indefinitely and served by the Data
  API WITHOUT the retention limit. So GA can likely be backfilled deep — CONFIRM via
  a wide GA Data API probe first. NOT urgent (aggregate isn't purged).
- SHOPIFY / WOOCOMMERCE: no purge clock — Shopify keeps orders; Woo is the
  merchant's own DB. Full history always available. NOT urgent. But LoraMer only
  FORWARD-captures them today — no backfill route yet.

## NEXT TASKS (priority)
1. GA backfill adapter. FIRST: read-only probe the GA Data API on a real property
   over a wide range (e.g. 2015→yesterday) to confirm aggregate depth. THEN add a
   GA daily-fetch (model it on `ga-intelligence.ts`) + register a `ga` adapter in
   `src/lib/backfill/adapters.ts` + render <BackfillControl platform="ga"> on the GA
   row in `src/app/clients/page.tsx`. No time pressure.
2. Shopify + Woo backfill adapters — same pattern. No time pressure.
3. New google/meta clients Russ adds: the button works automatically for fresh
   clients; if any were previously capped, reset their sync_state backfill_* first
   (SQL below). TIME-SENSITIVE (rolling purge).
4. Polish: "history coming soon" labels on non-backfillable platform rows;
   per-adapter floor for Meta (132mo sweeps many empty chunks but is resumable);
   backfill UX; optional "backfill all clients" bulk action.

## HOW TO ADD A NEW PLATFORM BACKFILL (the universal pattern)
The engine + run/status/probe routes are platform-agnostic. To add a platform:
1. Provide a daily-fetch returning `DailyRow[]` ({date,cost,clicks,impressions,
   conversions,conversionValue}).
2. Register an adapter in `src/lib/backfill/adapters.ts` (platform, accountIdKey,
   chunkDays, connectionMissingError, tokenMissingError, loadToken, fetchDaily) and
   add it to the `backfillAdapters` registry.
3. Render `<BackfillControl clientId={client.id} platform="<p>" onComplete={fetchClients} />`
   on that platform's row in `src/app/clients/page.tsx`.
Run/status/probe and the UI then work automatically.

## Verification / operations commands (copy/paste)
Probe a Google account's true depth (macOS Terminal; replace CLIENT_ID):
```
echo "→ Paste CRON_SECRET, then Enter (hidden):"; read -r -s CRON; curl -s -H "Authorization: Bearer $CRON" "https://cotemedia-google-ads-manager.vercel.app/api/backfill/probe?clientId=CLIENT_ID&start=2015-01-01&end=2026-06-03" | python3 -m json.tool; unset CRON
```
Confirm captured depth + spend for a client (Supabase SQL Editor; replace NAME):
```
select c.name, min(m.date) earliest, max(m.date) latest, count(*) days, round(sum(m.spend)::numeric,2) total_spend
from metrics_daily m join clients c on c.id=m.client_id
where c.name ilike '%NAME%' and m.platform='google' and m.entity_level='account'
group by c.name;
```
Reset google+meta backfill flags so buttons reappear (Supabase SQL Editor):
```
update sync_state set backfill_complete=false, backfill_earliest_date=null, backfill_target_date=null where platform in ('google','meta');
```

## Still open / carried forward
- SECURITY: the June 2 .env.local screenshot exposed 5 secrets. Confirmed rotated:
  Google Ads dev token + CRON_SECRET. STILL VERIFY/ROTATE: Google client secret,
  NextAuth secret, Supabase keys, Meta app secret — then update Vercel env vars.
- GA Phase 6 disconnect; Google date-path tech debt; ConnectionPill extract.

## Discipline reminders
- Right > fast; dry-run sacred; deliver complete files/zips (Lesson 29), not
  terminal code pastes; `tsc --noEmit` is the type gate but cannot catch mangled
  string literals in untyped calls — grep critical strings; Vercel is the real
  build gate.
- Always give Russ copyable commands with the exact paste destination; never say
  "scroll up."
- Run the Session Wrap-Up Checklist (in LORAMER_HANDOFF.md) before ending.

## SESSION 2026-06-05 (PM) — UI/UX WORKSTREAM
<!-- LORAMER_UIUX_SESSION_V1 -->

Shipped today (all pushed to main):
- b7d2027 — brand design-language CSS ported into app globals (section-label, wordmark-mer, link-quiet, section-reveal, smoothing). Additive; nothing consumes it yet.
- f41c0d3 — new GET /api/clients/metrics (per-client 30d spend/revenue/roas + lastActive; canonical filter entity_level='account' AND breakdown_type='' AND breakdown_value='').
- 6fff9e3 — metrics v2: HONEST revenue. revenue30 = store (shopify/woo) if store rows exist, else GA, never summed; ads conversion_value never folded in (returned as convValue30); adds revenueSource = store|ga|none. Cross-checked to the penny.
- 088b687 — /clients rebuilt: responsive grid (1/2/3 col), stat-tile cards (30d spend/revenue+source dot/ROAS/last-active), sort control (alphabetical default + recent/spend/revenue), and the "Claude" pill → "Mer" deep overlay (twin desktop modal / mobile sheet via shared IIFE content) replacing the inline expand. Claude→Lora/Mer renamed ON THE /clients PAGE ONLY. DEEP_LABEL const = swappable.

Naming locked: in-app analyst = "Lora"; client deep-dive pill+surface = "Mer"; "Powered by Claude" = engine credit only.

Migration status: PARKED, unchanged. The FINISH MULTI-ACCOUNT MIGRATION runbook (steps b–d) in this file self-resumes once the forward-capture cron writes 2026-06-05 rows — after midnight UTC (manual Terminal curl after 8 PM ET, else the ~08:45 UTC run), then tell Claude Code to execute that runbook.

NEXT ORDER (UI/UX), do in sequence:
1. Kill the robotic feel: restyle the Recharts chart tooltip + chart typography to warm/bigger/padded/soft-shadow/rounded (like Google Ads, NOT mono/cramped); propagate the Lora rename app-wide (dashboard sidebar still says "ASK CLAUDE"); apply the homepage type scale + spacing + serif display headings across dashboard pages.
2. Mobile IA: make /clients reachable on mobile (nav gap, not layout — grid already 1-col); declutter the mobile bottom-nav (platform views become a secondary in-client selector, not top-level); sidebar-purpose IA pass.
3. Flagship later: warm-start auto-population — always-open Additional Context box + new Industry selector; on type/industry pick, auto-prefill fresh warm-start context drafted by Claude but grounded in primary sources w/ provenance, human-reviewable, never silently injected as fact; mechanism = curated per-industry reference library (skills). Plus Mer as its own route/new tab (shared component). Deeper track to ~95% accuracy = semantic layer (query_metrics) → skills → provenance footer → evals (per the Anthropic self-serve-analytics blog).

UI philosophy: ONE responsive codebase; same content/IA on mobile & desktop, only chrome adapts; separate render blocks only when the interaction model must change (drawer↔sheet, sidebar↔bottom-nav), sharing content.

Immediate next action: surface the dashboard's Recharts chart/tooltip component + the sidebar nav source from src/app/dashboard/page.tsx, then start step 1.
