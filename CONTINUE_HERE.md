# CONTINUE_HERE — LoraMer

## Session log (2026-06-06, MacBook Air) — all shipped to prod, verified live
- S1 corner client switcher (portal dropdown, search, All clients, account/sign-out) — c6f12f0 + fixes 18192e0
- S2+S3 nav regroup: Overview / "Channels" group (dynamic per source) / sub-tab row under Google+Meta / Lora; Platform section + flat tab list removed; mobile bottom nav untouched — merged from nav-regroup-v1 (5046c3c)
- Build 1: glyph cleanup (●/◆ → Google/Meta icons + "Google/Meta" tooltip labels) + drill Ad Performance fix (campaignId param, cost-key normalization, per-day CTR, empty state; Meta path intentionally left — its misnamed campaignId param was already correct) — b2ffe1f
- Build A: AdChart line view → multi-select metrics + app's FIRST dual-axis (CTR on right axis via yAxisId+hide pattern, absolute metrics left; per-metric tooltip via PERCENT_KEYS; line=multi/bar=single coupling; empty-selection guard) — daa1071

## NEXT STEP — Issue 2: empty body on client switch
Symptom: switching client via corner switcher leaves rail highlighted but body blank until manual Refresh; intermittent (just-switched-account race).
Diagnosis: fetch DOES fire (logs all 200); root = 200-with-empty/partial payload swallowed by silent catch + no empty-state UI. Nav-regroup didn't cause the missed load, but its rail no-op guard removed the re-click recovery gesture, so only Refresh recovers.
DO NOT do the effect-based loading-spine refactor — fetch already fires; it rewrites the fragile load path for no benefit.
Fix: (1) confirm root w/ evidence — read /api/platform for any 200 returned with missing totals/campaigns, and selectClient→loadData for an unresolved/stale-account race; if root differs, STOP and report. (2) root fix: API returns real non-200/{error} on upstream failure, or guard loadData against unresolved account. (3) permanent empty/error "Couldn't load — Retry" state. (4) relax rail no-op guard to refetch when platformData empty.
Verification: failure is intermittent (can't force); empty-state is the verifiable part.

## Queue (after issue 2)
- GaChart + ShopifyChart: copy AdChart's yAxisId+hide dual-axis for avgSessionDuration (seconds) and AOV (~100x scale gap). Pair GA with the queued "3m 24s" duration tooltip formatting.
- Day/Week/Month on Meta/Combined/Shopify: DELIBERATE decision — those daily endpoints don't accept a granularity param; needs API support or client-side bucketing.
- GoogleChart empty-toggle guard: allows zero lines (bug); make consistent with AdChart's guard. One-liner.
- Bigger, own-session items: S4 Overview = fused everything-picture (MER/contribution/funnel/profit, Project 18); Mer = net-new per-client deep surface; mobile IA pass (mobile/desktop IA diverged temporarily by design).

## Discipline
- Right > fast; no same mistake twice; one code change in flight for clean reverts.
- Verification: visual → tsc + prod + eyeball; logic/interactive → approach-first, then prod + click-test + revert-ready. Vercel PREVIEW auth is BLOCKED (NextAuth callback pinned to prod → sign-in loops on preview URLs), so prod-with-staged-revert is the working substitute.
