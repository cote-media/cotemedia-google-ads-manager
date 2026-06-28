# TOMORROW_OPENING_MESSAGE.md — Russ's opening brief for the next LoraMer chat
MAINTENANCE RULE: this file is overwritten IN FULL at every wrap — purge stale content, never append; history lives in the CONTINUE_HERE.md session log.

---

RESUME: in claude.ai say **resume loramer** → digest-first cold-gate paste; paste back; freshness gate runs. Source of truth for the resume flow = **RESUME_INSTRUCTIONS.md** (follow it, don't restate).

WHERE TONIGHT (2026-06-27) LEFT OFF — Phase 2 BREADTH well underway:

SHIPPED + PUSHED today (LIVE in prod):
- DEVICE breadth — full 4-entity-grain family (campaign / ad_group / ad / keyword × device), per-grain reconcile (campaign/ad_group/ad = FLAG-NOT-BLOCK partition; keyword = write-only subset). UPPER enum encoding.
- GEO breadth (campaign-grain) + HOUR breadth (campaign + ad_group) — shipped earlier today, live.
- (device/geo/hour forward-capture wired into cron/sync + cron/catchup; drain steps registered.)

COMMITTED, NOT PUSHED — origin/main = 2aa704c, local is **2 commits ahead** (decide push next session):
- 0ef861b — GEO entity expansion (campaign + ad_group, write-only, 20d window / 10-day chunks, 544MB-safe) + DRAIN FREE-MAX config (google drain cron 6h→*/5; maxDuration 300→800; BUDGET_MS 250→750; PER_PLATFORM_CAP[google] 4→18). Net: 36-mo backfill ~2-3mo → ~9-20hr at ~$0 added cost (work-bound, not speed-bound).
- ef7575e — self-serve backfill findings doc (investigation only).
- HELD because the self-serve design (open thread #1) may revise the drain config — don't push until that's settled, OR push as-is if you want the free-max speedup live now (geo entity expansion is safe + done regardless). Code commit → run `npm run build` before pushing.

OPEN THREAD #1 (next big piece) — SELF-SERVE BACKFILL ARCHITECTURE, not yet designed. READ **docs/LORAMER_SELFSERVE_BACKFILL_FINDINGS.md** FIRST. Spine = connect-triggered kickoff (today: none — connections just wait for the 5-min round-robin) + new-client priority tier (today: flat round-robin) + concurrency that holds per-customer speed at scale (customer #5 AND #500). Russ's own clients are the first connections through this spine — it IS how his clients get backfilled fast now. Build "as if" real scale.

OPEN THREAD #2 — clearly-free backfill speed: measure 40d-window PEAK MEMORY on a heavy ACTIVE client (extrapolated ~750MB, NOT yet measured); if ≤~800MB, apply window 40d + lease 360→300s → ~2-2.5hr backfill, clearly free. Fallback 30d if 40d spikes.

KNOWN CONSTRAINTS (from the findings doc — do not relitigate):
- Lease must stay >250s: full single-connection sweep = 187-250s; lease→200s is DEAD (mid-sweep double-claim). Current 360s safe; 300s safe.
- Vercel fluid PACKS concurrent invocations into one shared-memory instance → free concurrency needs SMALLER per-sweep window (not per-instance isolation, which isn't guaranteed). PAID lever = raise instance memory. TODO: verify the project's fluid instance memory default + observed co-location in the Vercel dashboard runtime logs (Lesson 57: confirm from source).
- Speed = laps(=1095/window, memory-bounded) × lease(>250s) ÷ concurrency(memory-bounded); all three free knobs are memory-bounded on the free 1024MB instance. Cost is work-bound (~$0.30 cohort geo). Cost cliff = VOLUME (~17-26 deep-history onboards/mo, or ~900-1500 steady clients), NOT speed.

REMAINING PROGRAM:
- Completeness-sweep TRACKER doc — still UNWRITTEN (per-platform × dimension × entity-level map). Write next session.
- Google breadth remaining: network, impression_share, video, all_conversions (all VERIFY-AT-WRITER — probe shape/entity-axis/reconcile per the established discipline before authoring). Then Meta / Shopify / GA4 / Woo breadth.
- Then: the (platform, breakdown_type) query-allowlist edit (makes device/geo/hour Lora-VISIBLE — STOP-and-confirm, live read-path) + geo-id → readable-name resolution layer (both gate when these dims become queryable by Lora).

PRODUCTION CHARTER: the bar is commercial-grade, self-serve, ~100% complete by July 14, 2026. (Charter doc was discussed but NOT yet written — write it next session too.)

EXTERNAL / RUSS-ACTION:
- Google Ads API Center "Intended Use" box still says internal-only — this CONTRADICTS the external Tool Change request and is likely why it's stuck. Russ: replace it with the reporting-only text, leave Company Type, ask Compliance.
- Meta token refresh ~July 10 (cote@ ~60d life).

MACHINES: iMac `~/Downloads/cotemedia-ads-manager` AND MacBook Air `~/Downloads/cotemedia-google-ads-manager` (folder names differ BY DESIGN). `git pull` at session start; GitHub `main` = source of truth. The Air's local env CAN run the live Google Gate-A path (prod creds present); the iMac CANNOT (its OAuth app ≠ prod → unauthorized_client) — banked parity item.

DISCIPLINE: RIGHT > FAST. Russ doesn't touch code — paste-ready commands, destination labeled, every reply ONE fenced block. Backend writers/config = freeze-safe; new UI → -next only (reviewer app frozen till the Meta decision). Every push to main auto-deploys; `npm run build` is the pre-push gate.

---
