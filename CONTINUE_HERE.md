# CONTINUE_HERE — LoraMer

## REMOTE CONTROL (work from phone)
- In a running Claude Code session, type `/rc` to mirror it to the Claude mobile app (preserves history). One-time set-all: `/config` -> "Enable Remote Control for all sessions" = true.
- On phone: open Claude app -> CODE tab (NOT chat list) -> find the session (computer icon + green dot when online).
- Laptop terminal must stay open and machine online. Run `claude update` if `/rc` is unknown (needs v2.1.52+; push notifications need v2.1.110+).

## Session log (2026-06-07, MacBook Air) — Meta Tech Provider + footer + Meta compliance Phase 1

### Shipped / verified
- Meta: clicked "Yes, I'm a Tech Provider" (irreversible; correct for LoraMer's multi-tenant model). Business verification ALREADY DONE (Cote Media verified, business_id 778546245572025). ACCESS VERIFICATION SUBMITTED → IN REVIEW (~5-day; "avoid restrictions" deadline 8/6/2026, after July 14 soft launch so not binding). Submitted answers: type=SaaS Platform; Platform Data use=reporting/analytics for agencies (read ad performance → dashboards, per-client consent); manages multiple portfolios=Yes (representative set of active Cote Media client portfolio IDs); website=loramer.com.
- App Settings→Basic: added Website platform, Site URL=https://app.loramer.com/. Testing instructions deferred to App Review prep.
- Facebook Login for Business OAuth verified OK: Client/Web OAuth Yes, Enforce HTTPS Yes, Strict Mode Yes, JS SDK + Login-from-devices No; redirect URIs app.loramer.com/api/meta/callback (+vercel.app rollback). Deauthorize + Data Deletion URLs still EMPTY → fill after Phase 2 endpoints exist.
- loramer.com FOOTER shipped (loramer-landing repo, LORAMER_LANDING_FOOTER_SIGNUP_EMBED_V1, a58e637 on main): WaitlistForm embedded inline in footer (reuses /api/waitlist→Mailchimp, unchanged); floating StickyCTA bar removed (component + .sticky-cta CSS deleted); attribution now "LoraMer is a product of Cote Media · since 2011"; ©2026 Cote Media LLC kept. /privacy + /terms footers already named Cote Media → left untouched (wording differs slightly; optional future match). Satisfies Meta access-verification website requirement.
- META COMPLIANCE PHASE 1 COMPLETE (LORAMER_META_FBUSERID_FOUNDATION_V1, dd66f28 on main): migration 006 applied (meta_tokens.fb_user_id col + index + meta_compliance_log table); callback now GET /v18/me?fields=id → stores fb_user_id in meta_tokens upsert (stores token w/ null on /me failure → connect never breaks); one-off CRON_SECRET-gated /api/meta/backfill-fb-user-id RAN (1 candidate, 1 updated, 0 failed) → ALL meta_tokens rows now have fb_user_id. Reconnect test: connect still works. meta-compliance-foundation branch kept for rollback.
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

## NEXT STEP — PHASE 2 (Meta compliance endpoints), scoped + ready
- NEW src/lib/meta-signed-request.ts (HMAC-SHA256 verify, timingSafeEqual)
- NEW /api/meta/deauthorize (verify → map fb_user_id→user_email → delete token + platform_connections meta rows → log → always 200)
- NEW /api/meta/data-deletion (verify → idempotency via meta_compliance_log → delete meta-sourced data → return {url, confirmation_code})
- NEW public /meta/deletion-status?code= page
- REMOVE /api/meta/backfill-fb-user-id route (cleanup)
- THEN register Deauthorize + Data Deletion URLs in Meta dashboard (after endpoints live; separate from access-verification review)

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
