# TOMORROW_OPENING_MESSAGE.md — Russ's opening brief for the next LoraMer chat
MAINTENANCE RULE: this file is overwritten IN FULL at every wrap — purge stale content, never append; history lives in the CONTINUE_HERE.md session log.

---

RESUME: in claude.ai say **resume loramer** → I output the digest-first cold-gate paste; paste it back; the freshness gate runs (FRESH → one paste, done). The resume flow's source of truth is **RESUME_INSTRUCTIONS.md** — do not restate the steps here, follow it.

WHERE TODAY (2026-06-26) LEFT OFF:
- DEPTH ARC COMPLETE — Google ad_group/ad + Meta campaign + Meta ad_set/ad backfill writers all shipped, wired into the auto-drain, and drained live this session. With the earlier Google campaign work, every Google + Meta spend grain (account → campaign → ad_group|ad_set → ad) now has a writer + an automatic drain step (sync_state keys: google_campaign, google_adgroup_ad, meta_campaign, meta_placement, meta_adset_ad). They keep draining to the 36-mo floor on the 6h cron — no manual action.
- UNIFIED LIVE + BREADTH design LOCKED & committed: **docs/LORAMER_LIVE_BREADTH_UNIFIED_DESIGN.md** (LORAMER_LIVE_BREADTH_UNIFIED_DESIGN_V1). Direction B = captured `metrics_daily` stays the reconciled SYSTEM-OF-RECORD; a SEPARATE sibling live store (keyed by `as_of`) holds live/realtime/sub-daily; Lora reconciles across + ALWAYS labels which store. Read it before proposing Live/Breadth work.
- PHASE 1 CONSOLIDATION COMPLETE — shared `reconcileDay` primitive + shared fetch primitives (`gaqlWithRetry` / `metaFetchAllPaged`); the 5 ad-grain writers now share them (zero behavior change, proven OLD-vs-NEW).

NEXT STEP — **Phase 2 BREADTH** (design §7). Open it with the GA FOUNDATIONAL decision FIRST: GA persists ONLY account totals today (every GA dimension is live-only, never captured), so GA breadth needs a session/user **metric-columns-vs-extra-jsonb** decision. Then the breakdown registry + an `entity_level` CHECK, then the dimension writers (Google device/network/geo/age-gender/hour/impression-share/video/all_conversions; Meta age-gender/geo/device/hourly/video/ranking; GA/Shopify/Woo breadth) — each reconciling via the shared primitives. Breadth has NO 37-mo clock (indefinite retention) → no rush; lead with a read-first investigation on the GA fork.

ACTIVE QUEUE + FUTURE NOTES: all live in **LORAMER_QUEUE_OF_RECORD.md** (do not duplicate). Includes the banked items (Standard Access promoted launch-critical; iMac⇄Air parity + prod-Google-secrets fork; 18-connection hygiene audit; demo-twin 2617b163 campaign re-drain; Influential Drones connection health; standing rules: read-first existence check + verify-external-UI-before-instructing) + Phase-1b future notes (unify-the-two-Google-retries; Meta 100/1487534 narrow-and-retry).

MACHINES: works on the iMac (`~/Downloads/cotemedia-ads-manager`) AND the MacBook Air (`~/Downloads/cotemedia-google-ads-manager` — folder name differs BY DESIGN, never "fix" it). `git pull` at session start; GitHub `main` is the source of truth. Local-env PARITY is a queued job: the iMac local env can't run the live Google path (its OAuth app ≠ prod's that minted the refresh tokens → `unauthorized_client`), so Google Gate-A runs as a PROD dry-run (zero writes); Meta runs locally fine.

DISCIPLINE: RIGHT > FAST. Russ doesn't touch code — every command paste-ready with the destination labeled; every report in ONE fenced code block. Freeze posture: the live reviewer app is FROZEN until the Meta decision (new UI → `-next` only); backend writers/primitives/new stores are freeze-safe. Every push to `main` auto-deploys to Vercel — `npm run build` is the pre-push gate.

---
