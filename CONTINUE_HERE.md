# CONTINUE_HERE — Resume point after June 3, 2026 (evening)

Read AFTER completing the MANDATORY READING GATE at the top of LORAMER_HANDOFF.md. Not before.

## Session start — machine-switch ritual (FIRST, every session)
Repo is the single source of truth; uncommitted work doesn't travel.
- iMac (russellcote), macOS Terminal: cd /Users/russellcote/Downloads/cotemedia-ads-manager && git pull origin main
- Air (russcote2), macOS Terminal: cd /Users/russcote2/Downloads/cotemedia-google-ads-manager && git pull origin main
Then, before any code work, run in the Cursor Agents window: "INVESTIGATE ONLY — do not edit. Read the files my next task touches plus recent git log; report structure, signatures, and anything conflicting with the plan."

## Where we are
- Phase 0a COMPLETE: nightly cron /api/cron/sync forward-captures daily metrics for Shopify, Meta, Google, WooCommerce, GA into metrics_daily, all verified reconciling.
- Phase 0b backfill DONE + verified on one client: /api/backfill/google (V2, d14429b) backfilled My Vacation Network's full Google history — 658 account-level daily rows, 2024-05-17→2026-06-02, $76.5k — in one run. Account-level only, 36-month cap, resumable via sync_state backfill cursor columns.
- Google Ads dev token AND CRON_SECRET both rotated this session.

## Next task — finish Phase 0b: the query_metrics tool
Per HISTORICAL_DATA_ENGINE_DESIGN.md §4d/§6: build a basic query layer over metrics_daily supporting multi-period comparison, exposed to Claude as a tool. Prove the marquee example on My Vacation Network: spend in the last 7 days vs the same window 6 / 12 / 18 months ago, answered from the store (not a live fetch). Then Phase 1: generalize backfill + query to the other platforms/clients, and replace the secret-pasting backfill trigger with an in-app button.

## Backfill driver (interim, until the in-app button)
macOS Terminal, one client at a time (one invocation does the full 36-mo window):
echo "→ Paste CRON_SECRET, then Enter:"; read -r -s CRON; echo "→ Running..."; curl -s -H "Authorization: Bearer $CRON" "https://cotemedia-google-ads-manager.vercel.app/api/backfill/google?clientId=<CLIENT_ID>" | python3 -m json.tool; unset CRON
Replace <CLIENT_ID>. Re-run only if interrupted; it resumes from the cursor.

## Open / pending
- Pre-launch gate: Google Ads API permissible use is "MYSELF_OR_MY_COMPANY_ONLY/internal" — switch to external + apply for Standard Access before public launch (Basic = 15k ops/day cap; review days–weeks; needs demo sign-in). Pairs with the Google OAuth verification gate.
- Still open from prior sessions: GA Phase 6 disconnect, Google date-path tech debt, ConnectionPill extract (see ROADMAP).
