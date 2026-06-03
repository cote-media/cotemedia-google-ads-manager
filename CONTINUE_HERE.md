# CONTINUE HERE — Next session

Last session: June 3, 2026 (evening). Read the "Session — June 3, 2026 (evening)" entry in LORAMER_HANDOFF.md and docs/HISTORICAL_DATA_ENGINE_DESIGN.md for full context.

## Where we are
Historical Data Engine Phase 0a is live: nightly cron (/api/cron/sync, 0 8 UTC) forward-captures daily metrics into the metrics_daily warehouse. Shopify (0a.3a) and Meta (0a.3b) adapters are built and VERIFIED writing correct, reconciling daily rows. Schema (0a.1) and Google refresh-token capture (0a.2) done.

## Do next, in order
1. Rotate the Google Ads developer token (Google Ads API Center). Last un-rotated exposed secret AND the prerequisite for the Google adapter. Update the Vercel env var, redeploy, verify Google Ads still works in-app.
2. Build 0a.3c — Google sync adapter in /api/cron/sync, mirroring the Meta adapter. google_tokens refresh token + rotated dev token; GAQL daily pull per customer id; account → campaign → ad_group → ad/keyword rows.
3. Build 0a.3d — GA + WooCommerce adapters, same pattern.
4. Phase 0b — one-time backfill (races the ~37-month rolling purge).
5. Phase 3 — Claude query layer (tools that pull warehouse slices per question).

## Also rotate
CRON_SECRET in Vercel — value was shared in chat. New value; update the env var named exactly CRON_SECRET (case-sensitive); redeploy.

## Parked (not urgent)
Shopify token hardening + dedupe (see handoff). Cosmetic cron clientsProcessed double-count.
