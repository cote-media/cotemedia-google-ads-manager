# TOMORROW_OPENING_MESSAGE.md — Russ's opening brief for the next LoraMer chat
MAINTENANCE RULE: this file is overwritten IN FULL at every wrap — purge stale content, never append; history lives in the CONTINUE_HERE.md session log.

---

RESUME: in claude.ai say **resume loramer** → digest-first cold-gate paste; paste back; freshness gate runs. Source of truth for the resume flow = **RESUME_INSTRUCTIONS.md** (follow it, don't restate).

WHERE TONIGHT (2026-06-27 → early 06-28 UTC) LEFT OFF — the SELF-SERVE BACKFILL SPINE is BUILT, SHIPPED, and VERIFIED LIVE.

LIVE + PUSHED (origin/main = 30cb347, all auto-deployed + verified READY in prod):
- GEO entity expansion (campaign + ad_group level, write-only, 20d→40d window).
- FREE-MAX drain config (google drain cron */5, maxDuration 800s, cap 18).
- FULL SELF-SERVE SPINE (LORAMER_SELFSERVE_SPINE_V1, all 4 steps): (1) priority lane — new-client backfill_priority=10, ordering-only, decays on onboard-complete; (2) connect-kickoff — every connection-insert site (clients/connections [google/meta], woo, ga, shopify×2) sets priority=10 + waitUntil() → immediate /api/cron/drain?clientId=; (3) bounded-concurrency runner — N-dial (BACKFILL_CONCURRENCY default 2, env-overridable) + hard memory cap (clampConcurrency: N×peak(window) ≤ 2GB−256) + runPool; (4) free dial — window 40d / N=2 / lease 360→480.
- BUDGET_MS 750→680 (the 504 fix — headroom under the 800s ceiling so a late-starting ~86s geo step can't overrun).
- DB: migrations 020 (backfill_priority column) + 021 (lease 480, CAS byte-identical) APPLIED + verified live. @vercel/functions ^3.7.4 in the lockfile, resolving in prod.

VERIFIED IN PROD (real ticks, not just deployed): `concurrency:2` confirmed in the live drain JSON (bounded runner is the active path, not the old serial loop); a real scoped tick = HTTP 200, ERRORS:NONE, 5 breadth steps lapped (adgroup_ad floored + marked — exercising the backfill_priority write path); cohort auto-cron fires 200×5; NO missing-column / lease / OOM errors. 40d×N=2 measured 970MB peak (≤2GB). Spine proven on real data: a new connection → priority=10 + immediate kickoff → ~3.7hr concurrent backfill to the 36-mo floor, holding the per-customer promise at customer #5 AND #500. SPINE STATUS = COMPLETE + LIVE (supersedes any earlier "not yet designed/built" note — it is built, shipped, and verified).

DISK FINDING (banked tonight — NOT a bug): Supabase disk auto-expanded 2→8→12GB. Root cause = transient WAL spikes during heavy geo write bursts (a single heavy geo lap = ~589-923k rows in ~10 min → GBs of WAL transiently; Supabase auto-expands at ~90% full and never shrinks), NOT data — only ~1.9GB actually used (db 1.05GB + WAL 0.9GB; temp 0; no replication slots). metrics_daily = ~1.5M rows, verified REAL geo data (5:1 insert:update, ~4% dead tuples, n_tup_del 0 → genuine new rows, no over-write/runaway). COST TRAJECTORY (real): the geo backfill is EARLY (geo drain steps not floored); as it floors across heavy clients, metrics_daily grows toward ~5-30GB and the disk keeps auto-expanding — Supabase BILLS per GB → **add STORAGE to the cost-per-customer model**. TODO (quiet window): verify $/GB + the current bill; rerun the geo date-coverage projection query (it timed out under active write load tonight).

504 RECHECK PENDING: the BUDGET_MS 680 deploy (30cb347) had 1 clean fire (200) when checked; confirm ALL-200 across ~6 fires (the deploy went live ~06:0X UTC; recheck ~25-30 min after).

ROADMAP / PARKED (banked, unwritten unless noted):
- completeness-sweep TRACKER doc (per-platform × dimension × entity-level map) — UNWRITTEN, write next.
- PRODUCTION CHARTER doc (commercial-grade/self-serve/~100% by July 14 bar) — discussed, UNWRITTEN.
- whale-probe: pre-backfill size estimate + tiered handling for very large accounts.
- Woo/Shopify plugin-app data access — verify capabilities vs the platforms' docs.
- de-identified methodology artifact (named-stack, function-framed).
- general-vs-actual deep-dive (owed).
- Supabase disk cost (above).

REMAINING PROGRAM (capture breadth, then make visible):
- Google breadth remaining: network, impression_share, video, all_conversions — all VERIFY-AT-WRITER (probe shape/entity-axis/reconcile before authoring).
- Then Meta / Shopify / GA4 / Woo breadth.
- Then: the (platform, breakdown_type) query-allowlist edit (makes device/geo/hour Lora-VISIBLE — STOP-and-confirm, live read-path) + geo-id → readable-name resolution.
- BAR: commercial-grade, self-serve, ~100% complete by July 14, 2026.

EXTERNAL / RUSS-ACTION:
- Google Ads API Center "Intended Use" box still says internal-only — CONTRADICTS the external Tool Change request, likely why it's stuck. Replace with the reporting-only text, leave Company Type, ask Compliance.
- Meta token refresh ~July 10 (cote@ ~60d life).

MACHINES: iMac `~/Downloads/cotemedia-ads-manager` AND MacBook Air (russcote2) `~/Downloads/cotemedia-google-ads-manager` (folder names differ BY DESIGN). `git pull` at session start; GitHub `main` = source of truth. For the authoritative machine/env story (who has `.env.local`, who runs the full build vs live Google Gate-A) → see the HANDOFF MACHINES & ENV STATE block.

DISCIPLINE: RIGHT > FAST. Russ doesn't touch code — paste-ready commands, destination labeled, every reply ONE fenced block. Backend writers/config = freeze-safe; new UI → -next only. Every push to main auto-deploys; `npm run build` is the pre-push gate; migrations are applied in the Supabase SQL Editor (or via MCP) before/with the deploy.

---
