# CONTINUE_HERE - Resume point after June 4, 2026

Read AFTER LORAMER_HANDOFF.md and ROADMAP.md, not before. Same laptop as last session
(MacBook Air, ~/Downloads/cotemedia-google-ads-manager).

## Session start
```
cd ~/Downloads/cotemedia-google-ads-manager && git pull origin main
```
Expect "Already up to date" - same laptop, last session's work was pushed.

## Where we are
- Phase 0b COMPLETE: historical query layer (src/lib/metrics-query.ts) + read-only proving
  route /api/query-metrics, and query_metrics wired as a Claude tool on ALL surfaces via
  src/lib/claude-tools.ts. Proven on My Vacation Network.
- Meta backfill DONE (Phase 1 start): /api/backfill/meta + src/lib/meta-ads.ts. MyVN
  backfilled (565 rows to 2023-06-04). Meta conversion caveat surfaced to Claude.
- Backfill routes today: google + meta only (ACCOUNT-LEVEL, CRON_SECRET-bearer GET,
  resumable via sync_state, 36-month cap). Shopify/GA/Woo have forward-capture only.

## Next task - in-app backfill button (retire the curl)
Goal: a session-authed, in-app way to run backfills so Russ never pastes CRON_SECRET into a
terminal again. Investigate-only assessment is already done; refined design with corrections:

DESIGN
- ONE platform per "lap." A backfill is chunked + resumable (60s route cap, NO background
  queue exists). The button kicks off a lap, the UI reads progress and re-triggers to resume
  until complete. Do NOT try to run all platforms in one request - it will time out.
- Session POST endpoint (e.g. /api/backfill/run): verify getServerSession AND enforce client
  ownership (.eq('user_email', session.user.email) on clients). The existing backfill GET
  routes do NOT check ownership (latent IDOR, CRON_SECRET-only) - the browser path MUST. Use
  POST, not GET, for a browser-triggered mutation.
- Auth approach = extract the google + meta backfill loop bodies into shared lib functions
  (e.g. src/lib/backfill/*), make the existing CRON GET routes thin wrappers over them, and
  have the session route call the lib directly. No CRON_SECRET in the browser path, no nested
  60s timeouts. This is also the "register a backfill function" foundation so Shopify/GA/Woo
  plug in later.
- Progress: sync_state has backfill_earliest_date / backfill_target_date / backfill_complete /
  updated_at. No API exposes sync_state to the browser yet - add a small read (extend
  /api/clients or a GET status route). Percent is indicative (real depth is account-specific,
  not always 36mo).
- UI: the Connections block on /clients (src/app/clients/page.tsx ~L997-1091). Per backfillable
  platform (google/meta now) show a Backfill button + progress; non-backfillable platforms show
  "history coming soon." DISABLE the button while a lap runs (no locking exists - prevents the
  double-click / parallel-invocation cursor race).

SUGGESTED BUILD ORDER
1. Extract shared backfill lib (src/lib/backfill/*); refactor /api/backfill/google +
   /api/backfill/meta into thin GET wrappers; re-verify BOTH still backfill via curl (no
   behavior change) before moving on.
2. Session POST /api/backfill/run with ownership check, one platform per lap, {google,meta}
   allowlist + graceful skip for platforms with no route yet.
3. Small sync_state status read for the UI.
4. UI button + progress + lap-driver on /clients Connections, with a double-click guard.

GOTCHAS (from the investigate sweep)
- No background queue anywhere; per-route maxDuration=60; resumable by design.
- Concurrency: no locking on sync_state. Cron vs backfill use different columns (low risk),
  but two concurrent backfills on the same client+platform can stomp the cursor (data is
  idempotent, but wasted work / premature complete) - disable button during a run.
- Multi-account clients: backfill uses .find() = FIRST connection per platform; cron loops
  all. Multi-account backfill is a known gap.
- Reviewer/Shopify-install sessions may not own clients.user_email rows - the ownership check
  could 404 for them (acceptable).

## After the button
Remaining Phase 1: Shopify / GA / Woo backfill routes (same template as Meta), run them
THROUGH the new button. Then Phase 2 (asset/breakdown depth), Phase 3 (cutover: wire Claude
fully onto the query layer, retire the 15-min live-fetch cache in /api/intelligence).

## Discipline reminders
- Right > fast; dry-run sacred; per-edit content-based idempotency; comments NEVER after a
  comma/closing token (L13); `tsc --noEmit` is NOT a full build, Vercel is the gate (L14);
  anchors only from current-turn pastes (L16); investigate-only first on big files (L24);
  page.tsx has desktop/mobile twin blocks - audit both (L26).
- Run the Session Wrap-Up Checklist (in LORAMER_HANDOFF.md) before ending the next session.
