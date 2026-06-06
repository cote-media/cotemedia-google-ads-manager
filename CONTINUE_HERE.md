# CONTINUE_HERE — LoraMer

## Session log (2026-06-06, MacBook Air) — all shipped to prod, verified live
- S1 corner client switcher (portal dropdown, search, All clients, account/sign-out) — c6f12f0 + fixes 18192e0
- S2+S3 nav regroup: Overview / "Channels" group (dynamic per source) / sub-tab row under Google+Meta / Lora; Platform section + flat tab list removed; mobile bottom nav untouched — merged from nav-regroup-v1 (5046c3c)
- Build 1: glyph cleanup (●/◆ → Google/Meta icons + "Google/Meta" tooltip labels) + drill Ad Performance fix (campaignId param, cost-key normalization, per-day CTR, empty state; Meta path intentionally left — its misnamed campaignId param was already correct) — b2ffe1f
- Build A: AdChart line view → multi-select metrics + app's FIRST dual-axis (CTR on right axis via yAxisId+hide pattern, absolute metrics left; per-metric tooltip via PERCENT_KEYS; line=multi/bar=single coupling; empty-selection guard) — daa1071
- Issue 2 empty-body fix shipped + verified on prod — LORAMER_ISSUE2_EMPTYSTATE_V1 (51264c4): loadData hardening + res.ok throw, loadSeqRef sequence guard (kills latent stale-data race), "Couldn't load — Retry" empty/error state, rail no-op guard relaxation on 3 guards (store-only guard 3745 left intentional). All 4 click-tests passed mobile. (Investigation note: root was client-side silent catch, NOT a 200-with-missing-totals — /api/platform 200s always carry full shape; combined path silently swallows upstream failures into zeros, queued as a separate honesty fix.)

## NEXT STEP — two low-risk mobile-friendly fills
1. GoogleChart empty-toggle guard: its metric toggle allows deselecting ALL metrics (zero lines — bug). Make it consistent with AdChart's last-metric guard. One-liner; a NOTE comment already marks the spot on GoogleChart's toggle.
2. GA duration formatting: averageSessionDuration renders as a plain number (seconds) in the GaChart tooltip — format as "3m 24s". Extend ChartTooltip's per-dataKey formatting (PERCENT_KEYS pattern → a DURATION_KEYS set fed from GA_CHART_METRICS).

## Queue (after the two fills)
- GaChart + ShopifyChart: copy AdChart's yAxisId+hide dual-axis for avgSessionDuration (seconds) and AOV (~100x scale gap).
- Day/Week/Month on Meta/Combined/Shopify: DELIBERATE decision — those daily endpoints don't accept a granularity param; needs API support or client-side bucketing.
- /api/platform combined path: silently swallows per-platform upstream failures into a zeros payload (honesty fix — return partial-failure signal).
- Bigger, own-session items: S4 Overview = fused everything-picture (MER/contribution/funnel/profit, Project 18); Mer = net-new per-client deep surface; mobile IA pass (mobile/desktop IA diverged temporarily by design).

## Discipline
- Right > fast; no same mistake twice; one code change in flight for clean reverts.
- Verification: visual → tsc + prod + eyeball; logic/interactive → approach-first, then prod + click-test + revert-ready. Vercel PREVIEW auth is BLOCKED (NextAuth callback pinned to prod → sign-in loops on preview URLs), so prod-with-staged-revert is the working substitute.
