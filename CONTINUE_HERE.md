# CONTINUE_HERE — Resume point after June 2, 2026

*Written end-of-day June 2, 2026 on the MacBook Air. Reads AFTER LORAMER_HANDOFF.md and ROADMAP.md, not before.*

---

## TL;DR — Today's slate

- **14 commits shipped today**, all live on `main`, production-green
- **GA connector V1 is DONE end-to-end** — OAuth → property picker → intelligence → Claude context → Analytics tab + chart + granularity → Overview/Combined surfaces. Only Phase 6 (disconnect) remains minor cleanup.
- **Canonical date windows** — `src/lib/date-range.ts` is now the single source of truth; fixed the old "LAST_MONTH = 60 days" bug across Shopify/GA/Woo intelligence and daily routes
- **Shopify revenue is now NET SALES** — matches Shopify Analytics; phantom gross revenue from refunded orders eliminated
- **Supabase client dedupe completed** (data migration, not in git) — 16 duplicate name-pairs merged safely; no duplicate client names remain
- **SECURITY (HIGH, NOT DONE):** rotate secrets exposed in a screenshot of `.env.local` earlier today, then update Vercel env vars

## What shipped today (June 2, 2026)

### GA connector V1 — full build sequence (Phases 2–5 + dashboard)

1. **LORAMER_GA_OAUTH_V1** — `/api/ga/start` + `/api/ga/callback`; CSRF-protected state; separate GA OAuth client; `analytics.readonly` scope only
2. **LORAMER_GA_PROPERTY_PICKER_V1** — `/api/ga/properties` + `/api/ga/connect` + property picker UI on `/clients`
3. **LORAMER_GA_INTELLIGENCE_V1** — `src/lib/intelligence/ga-intelligence.ts`; 7 query buckets against GA Data API
4. **LORAMER_GA_CLAUDE_CONTEXT_V1** — Google Analytics section in `build-claude-context.ts` + GA-vs-Shopify reconciliation
5. **LORAMER_GA_DASHBOARD_TAB_V1** — Analytics tab on dashboard
6. **LORAMER_GA_CHART_V1** — sessions chart on Analytics tab
7. **LORAMER_GA_TAB_PROPERTY_NAME_V1** — property-name cleanup on GA tab
8. **LORAMER_GA_CHART_GRANULARITY_V1** — Day/Week/Month toggle on GA chart
9. **LORAMER_GA_OVERVIEW_COMBINED_V1** — compact GA metrics on Overview and Combined views

**GA V1 flow is complete:** connect → data → Claude reasoning → dedicated tab + chart + granularity → Overview/Combined cross-platform surfaces.

### Canonical date windows (LORAMER_DATE_RANGE_CANONICAL_V1)

- New **`src/lib/date-range.ts`** — single source of truth for all date math
- **LAST_MONTH** = previous calendar month (not 60 days)
- **Rolling 7/14/30/90** = complete days ending yesterday
- **THIS_MONTH** = 1st-of-month through today
- Wired into: Shopify/GA/Woo intelligence, `/api/shopify/daily`, `/api/woocommerce/daily`, `/api/intelligence`
- Meta **LAST_90_DAYS** preset fix — mapped to `last_90d`

### Revenue & platform fixes

- **LORAMER_SHOPIFY_NET_SALES_V1** — headline revenue uses `currentSubtotalPriceSet` (after refunds, excludes shipping/tax); surfaces `refundedAmount`. Old code summed gross original totals including refunded orders → phantom revenue. Verified: Escential May = $45.00, matching Shopify Analytics Net sales.
- **LORAMER_PLATFORM_NAV_FIX_V1** — clicking Google/Meta/Combined while on a non-ad tab now switches to Overview (platform buttons previously felt dead because they never changed the active tab)
- **LORAMER_GOOGLE_DAILY_90DAY_FIX_V1** — `getDailyMetrics()` in `google-ads.ts` was emitting invalid `segments.date DURING LAST_90_DAYS`; now uses `resolveDateWindow` → explicit `BETWEEN`

### Supabase client dedupe (data migration — not in git)

The clients list had **16 duplicate name-pairs** from the client-mapping flow running twice (May 14 + May 20). Resolved safely:

1. Backed up 3 tables to CSV
2. Merged unique children onto the keeper per pair
3. Verified counts
4. Deleted only the emptied twins

**Keepers worth recording:**

| Client | Keeper ID | Notes |
|--------|-----------|-------|
| The Escential Group | `c39ee088-c635-4bfe-b308-43fe9640f1ca` | May-20 copy; 181 conversations; GA connection + token moved onto it |
| My Vacation Network | `965c77ff-3ad5-44b2-8d45-ee8ab1c97966` | May-14 copy; 76 conversations |
| Veterinary mastermind | May-14 copy | Already had GA |

No duplicate client names remain.

## Current state (June 2, 2026 evening)

- **GA V1:** done except Phase 6 disconnect (`/api/ga/disconnect` + disconnect button on GA connection row)
- **Date windows:** canonical via `date-range.ts` for Shopify/GA/Woo intelligence + daily routes; Google Ads intelligence/daily partially migrated — see tech debt below
- **Shopify revenue:** net sales, verified against Shopify Analytics
- **Client data:** deduped in Supabase; keepers documented above
- **Secrets:** ⚠️ **NOT rotated yet** — Google client secret, Google Ads developer token, NextAuth secret, Supabase keys, Meta app secret were visible in a `.env.local` screenshot earlier today. Rotate all, then update Vercel env vars. **HIGH priority.**

## What's NOT done yet (pending)

### Immediate / next session

- ❌ **GA Phase 6** — `/api/ga/disconnect` route + disconnect button on GA connection row (minor)
- ❌ **SECURITY (HIGH)** — rotate exposed secrets + update Vercel env vars (see above)
- ❌ **Google date-path cleanup (Project 8 tech debt)** — route ALL Google date paths through `resolveDateWindow`; remove dead duplicated `LAST_90_DAYS` blocks in `src/lib/platforms/google.ts` and `src/app/api/google/adgroups/daily/route.ts`; migrate `platform/route.ts` and `google-intelligence.ts` `buildDateFilter` to the canonical resolver

### Carried forward from May 29

- ❌ `<ConnectionPill>`/`<ConnectionRow>` extract on `/clients` page (~200 lines JSX dedupe)
- ❌ Launch consolidation Phase 1 — `app.loramer.com` DNS
- ❌ Cloudflare Email Routing for hello@loramer.com
- ❌ Mailchimp API key rotation
- ❌ Bump Next.js past 14.2.3

### New roadmap items (filed in ROADMAP.md)

1. Site-wide info ("i") tooltips — explain metrics/terms across the app (e.g. "Net sales = product revenue after refunds, excl shipping & tax")
2. Warm-start "agency brain" — Claude pre-loaded with agency clients + uploaded docs (persistent memory + document RAG + bulk onboarding; NOT model fine-tuning). Extends Projects 9, 10, 16. To be scoped.
3. Agency client-list management — sort/filter `/clients` + drag-and-drop client cards into custom order (Projects 7 / 18)
4. Project 18 scope expansion — drag-and-drop + expandable/resizable metric cards on EVERY dashboard tab (Overview, Google, Meta, Combined, Shopify, Woo, Analytics), not just Overview

## What to work on next (priority order)

1. **Rotate exposed secrets** — do this before any other session work if not done overnight
2. **GA Phase 6 disconnect** — small, closes GA V1 cleanly
3. **Google date-path tech debt** — finish migrating all Google routes to `resolveDateWindow` (prevents next date drift bug)
4. **ConnectionPill/Row extract** — still recommended pre-more-connectors hygiene from May 29 audit
5. **Roadmap UX items** — tooltips, client-list management, Project 18 expansion (pick one to scope when ready)

## Resume checklist

On either machine, **start here:**

1. `cd ~/Downloads/cotemedia-google-ads-manager && git pull origin main` — sync before anything else (iMac path: `cotemedia-ads-manager`)
2. Read this CONTINUE_HERE.md
3. Skim LORAMER_HANDOFF.md — especially new Lessons 17–25
4. Check ROADMAP.md for GA V1 completion markers + new items
5. Confirm secrets were rotated (if not → do that first)
6. Pick next task from priority list above

## Discipline reminders

- **Lesson 16** — anchor discipline: only bytes from current-turn pastes
- **Lessons 17–25** — see LORAMER_HANDOFF.md (date resolver, net revenue, GAQL enums, platform/tab nav, dedupe pattern, investigate-first, git pull ritual)
- Right > fast
- `tsc --noEmit` is NOT `npm run build`; Vercel is the final check
- Comments NEVER on the same line as commas (Lesson 13)
- Repo is single source of truth — always `git pull` at session start on either machine

Good day.
