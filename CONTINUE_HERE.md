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

### Next tasks (none urgent — no purge clock on GA/Shopify/Woo)
1. Meta "per-adapter floor" fix — Meta backfill shows "partial / Resume" that
   never completes because its fetch throws past the account's first data
   (cosmetic; data is complete to account start). Diagnose with a headless Meta
   run first.
2. Shopify backfill adapter (V3 pattern).
3. WooCommerce backfill adapter (V3 pattern).
4. Cleanup: delete stray repo-root scripts append_handoff_docs.py and
   patch_backfill_ui_v1.py (untracked leftovers).

## NEXT TASK (priority) — query_metrics: support arbitrary explicit date ranges
<!-- LORAMER_QUERY_METRICS_DATE_FLEX_DESIGN_2026_06_05 -->

This is priority #1, ahead of the Meta floor / Shopify / Woo items listed above.

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
