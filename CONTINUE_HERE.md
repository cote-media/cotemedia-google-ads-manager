# CONTINUE_HERE — LoraMer

## REMOTE CONTROL (work from phone)
- In a running Claude Code session, type `/rc` to mirror it to the Claude mobile app (preserves history). One-time set-all: `/config` -> "Enable Remote Control for all sessions" = true.
- On phone: open Claude app -> CODE tab (NOT chat list) -> find the session (computer icon + green dot when online).
- Laptop terminal must stay open and machine online. Run `claude update` if `/rc` is unknown (needs v2.1.52+; push notifications need v2.1.110+).

=== LAUNCH RITUAL (start every session this way) ===
1. Terminal: type  loramer  (alias launches Claude Code from the repo so .mcp.json loads + stays authenticated). iMac one-time setup still pending — see iMac block below.
2. In claude.ai: say  resume loramer
3. Paste the SESSION RESUME output back into claude.ai.
=== end launch ritual ===

## Session log (2026-06-08, MacBook Air) — CRON_SECRET ROTATED + VERIFIED

### Shipped / verified
- Stripe billing Phase 0 complete (2026-06-08): account-model recon done (billing key = user_email; no agency table; user_profiles.tier exists but enforced nowhere; greenfield for Stripe). Entitlement matrix + 4 design decisions LOCKED. Stripe account decision: separate dedicated LoraMer account under russ@loramer.com, TEST mode first. Full spec in STRIPE_BILLING_PLAN.md.
- MCP project-scope migration (LORAMER_MCP_PROJECT_SCOPE_V1, commit 8d3016c): supabase + vercel moved from local→project scope via committed .mcp.json, so both machines share it on git pull. Supabase write-enabled (read_only=false) → migrations run via MCP, not the SQL Editor. MacBook Air verified: supabase connected (20 tools = write set), vercel connected, launched from repo. Added `loramer` zsh alias on the Air (cd into repo && claude) so it always launches from the right folder. iMac one-time setup still pending — see block below.
- CRON_SECRET ROTATED + VERIFIED. Recon confirmed ONE env var read by all bearer routes: `/api/cron/sync` + `/api/backfill/{google,meta,ga,probe,probe-ga}` + `/api/query-metrics`. They all use the same check (Authorization header, accepts `Bearer <token>` or raw, trim-tolerant, compared to `process.env.CRON_SECRET`). `/api/backfill/run` is NextAuth-session-authed (ownership-gated), NOT CRON_SECRET — unaffected by rotation.
- Vercel-NATIVE cron (`vercel.json`: `/api/cron/sync` @ `0 8 * * *`) auto-injects `Authorization: Bearer $CRON_SECRET` from project env at run time. No external callers hold the secret (the only GitHub Action, db-backup.yml, uses SUPABASE_DB_URL + R2_* only; no cron-job.org/external pinger).
- Rotation = new `openssl rand -hex 32` set in Vercel (Production + any env that had it) → redeploy (serverless binds env at deploy time) → verified on prod: NEW bearer → 200, junk bearer → 401. New value never entered chat (written to local untracked OUT.txt → pasted into Vercel → OUT.txt scrubbed). Next 08:00 UTC cron auto-uses the new secret.

## Session log (2026-06-08, MacBook Air) — Off-site DB backup SHIPPED + VERIFIED

### Shipped / verified
- Off-site DB backup SHIPPED + VERIFIED. GitHub Action `.github/workflows/db-backup.yml`: nightly `pg_dump` (custom format -Fc -Z9, --no-owner --no-privileges) of the Supabase DB via the SESSION POOLER connection (IPv4 — runners are IPv4-only), uploaded to Cloudflare R2 bucket `loramer-db-backups`, 30-day retention prune, fail-loud (`set -euo pipefail` + empty-dump/missing-secret guards).
- Schedule: 03:30 UTC daily + manual `workflow_dispatch`. Deliberately clear of the 08:00 UTC `/api/cron/sync`.
- pg_dump pinned to v17 by ABSOLUTE path `/usr/lib/postgresql/17/bin/pg_dump` (the runner's pg_wrapper resolves bare `pg_dump` to v16, which refuses the 17.6 server with "server version mismatch"). A version echo runs right before the dump as log proof. Commits: build `c95ef7b`, pgdump17 fix `63f3b40`.
- Credentials stored as GitHub Actions repo secrets: `SUPABASE_DB_URL` (session-pooler; DB password was reset 2026-06-08), `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. (No secret values recorded here.)
- Verified: fresh manual run green; first `.dump` confirmed in the R2 bucket. Combined with Supabase Pro daily automated backups (7-day retention), the "no backups before paying customers" gap is fully closed — in-platform + off-site.

## Session log (2026-06-07, MacBook Air) — Meta Tech Provider + footer + Meta compliance Phase 1

### Shipped / verified
- Meta: clicked "Yes, I'm a Tech Provider" (irreversible; correct for LoraMer's multi-tenant model). Business verification ALREADY DONE (Cote Media verified, business_id 778546245572025). ACCESS VERIFICATION SUBMITTED → IN REVIEW (~5-day; "avoid restrictions" deadline 8/6/2026, after July 14 soft launch so not binding). Submitted answers: type=SaaS Platform; Platform Data use=reporting/analytics for agencies (read ad performance → dashboards, per-client consent); manages multiple portfolios=Yes (representative set of active Cote Media client portfolio IDs); website=loramer.com.
- App Settings→Basic: added Website platform, Site URL=https://app.loramer.com/. Testing instructions deferred to App Review prep.
- Facebook Login for Business OAuth verified OK: Client/Web OAuth Yes, Enforce HTTPS Yes, Strict Mode Yes, JS SDK + Login-from-devices No; redirect URIs app.loramer.com/api/meta/callback (+vercel.app rollback). Deauthorize + Data Deletion URLs still EMPTY → fill after Phase 2 endpoints exist.
- loramer.com FOOTER shipped (loramer-landing repo, LORAMER_LANDING_FOOTER_SIGNUP_EMBED_V1, a58e637 on main): WaitlistForm embedded inline in footer (reuses /api/waitlist→Mailchimp, unchanged); floating StickyCTA bar removed (component + .sticky-cta CSS deleted); attribution now "LoraMer is a product of Cote Media · since 2011"; ©2026 Cote Media LLC kept. /privacy + /terms footers already named Cote Media → left untouched (wording differs slightly; optional future match). Satisfies Meta access-verification website requirement.
- META COMPLIANCE PHASE 1 COMPLETE (LORAMER_META_FBUSERID_FOUNDATION_V1, dd66f28 on main): migration 006 applied (meta_tokens.fb_user_id col + index + meta_compliance_log table); callback now GET /v18/me?fields=id → stores fb_user_id in meta_tokens upsert (stores token w/ null on /me failure → connect never breaks); one-off CRON_SECRET-gated /api/meta/backfill-fb-user-id RAN (1 candidate, 1 updated, 0 failed) → ALL meta_tokens rows now have fb_user_id. Reconnect test: connect still works. meta-compliance-foundation branch kept for rollback.
- META COMPLIANCE PHASE 2 COMPLETE (LORAMER_META_COMPLIANCE_ENDPOINTS_V1, a3a7b47 on main): src/lib/meta-signed-request.ts (HMAC-SHA256 verify), POST /api/meta/deauthorize, POST /api/meta/data-deletion, public /meta/deletion-status page; Phase 1 backfill route removed. Verified end-to-end: 401 on bad/missing/wrong-secret sig; valid-sig no-match test passed (fake fb_user_id 999999999999, zero deletes → data-deletion returns {url, confirmation_code}, status=no_data, status page renders). BOTH URLs REGISTERED in Meta dashboard (Facebook Login for Business): Deauthorize=https://app.loramer.com/api/meta/deauthorize, Data Deletion=https://app.loramer.com/api/meta/data-deletion. Meta data-handling requirement SATISFIED. Routes now LIVE (no longer dormant). No real-deletion test run (USER-scoped wipe; fires only on real external requests).
- ARCHITECTURE NOTE: meta_tokens is USER-scoped — ONE token per LoraMer login (user_email), reused across all that user's client ad-account connections (platform_connections). One BM OAuth grants token + account list; picker assigns accounts without re-OAuth.

### Decisions locked (Phase 2)
- Deauthorize → delete meta_tokens row + platform_connections meta rows (matches existing disconnect); KEEP metrics_daily history.
- Data deletion → delete metrics_daily(platform=meta, client_ids) + sync_state + intelligence_cache + platform_connections + meta_tokens(last); return Meta-required {url, confirmation_code}; public status page.
- client_conversations/client_memory free-text = OUT of scope (derived work product, not Meta-held data).
- Permissions: request ads_read ONLY at App Review now (read-only, demoable); add ads_management later when write feature built+demoable. WRITE/ad-management IS roadmap (Google+Meta+any platform; read-only=launch posture only). Keep Meta "Create & manage ads" use case as long-term container.

### Parallel waits (both external clocks running, passive)
- Google OAuth adwords scope: UNDER REVIEW (respond to reviewer within a day; don't touch consent screen).
- Meta access verification: IN REVIEW (respond fast if Meta asks for more portfolio IDs/detail).

### Queued / follow-ups
- Rotate CRON_SECRET in Vercel (landed in a Claude Code session during backfill; do coordinated so nightly cron keeps authenticating). Not urgent.
- Reconnect Supabase MCP on MacBook Air (russcote2) — local/user MCP scopes don't sync across machines; consider project-scope .mcp.json so migrations stop falling back to SQL Editor.
- From prior plan: Stripe billing (long pole), Supabase backups (HIGH/cheap before paying customers), quick-wins (spacing/dashboard reconcile).

### Roadmap additions
- Write/ad-management across Google+Meta+any platform (read-only = launch posture only).
- Progressive platform onboarding ("start with your strength"): platform chooser + bulk client selection from chosen platform's hierarchy.

## NEXT STEP — Supabase backups DONE (off-site R2 + in-platform Pro). CRON_SECRET rotation DONE + VERIFIED. Supabase MCP project-scope migration DONE + VERIFIED on the MacBook Air (both machines share committed .mcp.json on git pull). In-our-control queue by effort:
1. Stripe Phase 1 — BLOCKED until Russ creates the LoraMer Stripe account (russ@loramer.com, TEST mode) + grabs the test secret key (sk_test_...). Then: plan_entitlements table + solo->business tier migration, and the Stripe product/price creation script. Full spec + locked matrix + decisions in STRIPE_BILLING_PLAN.md.
2. Dashboard quick-wins (spacing/tooltip reconcile).

Passive external clocks (respond fast only if a reviewer emails): Google adwords scope UNDER REVIEW; Meta access verification IN REVIEW (then App Review for ads_read → Publish). Lower priority: optional META_APP_SECRET rotation (not public; Reset in Meta dashboard → update Vercel → redeploy, existing connections survive).

=== iMac ONE-TIME MCP SETUP (user russellcote) — do once, next time on the iMac ===
.mcp.json is already committed, so the iMac just needs to pull it, clear any old local read-only override, sign in once, and set its own alias. NOTE the iMac differs from the MacBook Air: user = russellcote, repo = /Users/russellcote/Downloads/cotemedia-ads-manager (DIFFERENT folder name).
When on the iMac, tell Claude "set up iMac MCP" and it will hand these as labeled pastes:
1. Terminal, one-time manual launch (alias not set yet): cd /Users/russellcote/Downloads/cotemedia-ads-manager && git pull origin main && claude
2. In Claude Code: approve the "trust project MCP servers" prompt; run /mcp and complete the browser sign-in for supabase + vercel.
3. In Claude Code: remove any local-scope overrides (claude mcp remove "supabase" -s local ; claude mcp remove "vercel" -s local — ignore "not found"), and add the launch alias by EDITING ~/.zshrc with the file editor, NOT echo-append (chars drop in the shell): alias loramer="cd /Users/russellcote/Downloads/cotemedia-ads-manager && claude"
4. Open a NEW terminal, type: loramer
5. Confirm /mcp shows supabase (connected, ~20 tools = write) and vercel (connected). Permanent on the iMac after this.
=== end iMac setup ===

## Session log (2026-06-06, MacBook Air) — shipped/verified
- Issue 2 empty-body fix: loadData res.ok hardening + loadSeqRef sequence guard + "Couldn't load — Retry" empty state + rail guard relaxation (LORAMER_ISSUE2_EMPTYSTATE_V1, 51264c4).
- Last-metric toggle guard on all 5 charts + GA duration tooltip "3m 24s" (LORAMER_CHART_TOGGLEGUARD_DURATION_V1, 9426565).
- Privacy Limited Use disclosure on landing /privacy (loramer-landing 2abbd48).
- Shopify allowlist: added app.loramer.com callback alongside vercel.app; application_url + webhooks left on vercel.app deliberately (LORAMER_SHOPIFY_REDIRECT_APPDOMAIN_V1, 636d4cd; shopify app deploy = loramer-6).
- Roadmap UX items: Meta picker sort/search + smart tips/glossary consolidation (16d9719).
- LoraMer Google identity: Workspace @loramer.com (russ/hello/support/lore); russ@loramer.com Owner of GCP project "Cote Media Claude Google Ads"; loramer.com verified in Search Console (DNS Domain property).
- app.loramer.com MIGRATION DONE + verified: attached to app Vercel project, Cloudflare CNAME (DNS-only), SSL issued; new redirect URIs registered on both Google OAuth clients (sign-in + GA) and Meta; NEXTAUTH_URL + GOOGLE_ANALYTICS_REDIRECT_URI flipped to app.loramer.com + redeployed. app.loramer.com now canonical; vercel.app alias still serves; old URIs still registered (rollback intact). Verified: Google sign-in + Meta connect on existing client both work.
- Google OAuth verification SUBMITTED 2026-06-06: branding VERIFIED, data access UNDER REVIEW. Clock ~2-6 weeks running. adwords is sensitive (not restricted) → no CASA. Consent screen: app LoraMer, support@loramer.com, homepage loramer.com, privacy loramer.com/privacy, authorized domain loramer.com, published to Production, unlisted demo video attached.

## Prior priorities (2026-06-06 — still standing after Phase 2; external clocks now tracked in the 06-07 section above)
1. Watch russ@loramer.com for Google reviewer follow-up; respond within a day; DO NOT touch consent screen/scopes/publish status while under review.
2. Check Meta app-review status (second external clock — cohort needs Meta app in Live mode + ads_read approved to connect).
3. Stripe billing + tier segregation (long pole; Project 2 pivoted Shopify-Managed-Pricing → Stripe; tiers, upgrade/downgrade, 20% annual, full pricing).
4. Supabase backups (HIGH, cheap, before paying customers).
5. Quick-wins: spacing/roominess pass (finishes dashboard reconcile), GA Phase 6 disconnect, audit cleanups (dead platformData, combined-path silent-zeros honesty), advar→loramer localStorage rebrand, Meta picker sort/search, GaChart/ShopifyChart dual-axis.

Launch target: soft launch ~July 14 (invite-only founding cohort, Russ onboards), full launch Q4 2026.

## Migration cleanup (minor, deferred)
- Optional Shopify dev-store install test on app.loramer.com.
- Full Shopify consolidation later (application_url + webhooks → app.loramer.com).
- Remove old vercel.app redirect URIs from Google/Meta after verification confirmed.

## Discipline
- Right > fast; no same mistake twice; one code change in flight for clean reverts.
- Verification: visual → tsc + prod + eyeball; logic/interactive → approach-first, then prod + click-test + revert-ready. Vercel PREVIEW auth is BLOCKED (NextAuth callback pinned to prod → sign-in loops on preview URLs), so prod-with-staged-revert is the working substitute.
