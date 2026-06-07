# CONTINUE_HERE — LoraMer

## Session log (2026-06-06, MacBook Air) — shipped/verified
- Issue 2 empty-body fix: loadData res.ok hardening + loadSeqRef sequence guard + "Couldn't load — Retry" empty state + rail guard relaxation (LORAMER_ISSUE2_EMPTYSTATE_V1, 51264c4).
- Last-metric toggle guard on all 5 charts + GA duration tooltip "3m 24s" (LORAMER_CHART_TOGGLEGUARD_DURATION_V1, 9426565).
- Privacy Limited Use disclosure on landing /privacy (loramer-landing 2abbd48).
- Shopify allowlist: added app.loramer.com callback alongside vercel.app; application_url + webhooks left on vercel.app deliberately (LORAMER_SHOPIFY_REDIRECT_APPDOMAIN_V1, 636d4cd; shopify app deploy = loramer-6).
- Roadmap UX items: Meta picker sort/search + smart tips/glossary consolidation (16d9719).
- LoraMer Google identity: Workspace @loramer.com (russ/hello/support/lore); russ@loramer.com Owner of GCP project "Cote Media Claude Google Ads"; loramer.com verified in Search Console (DNS Domain property).
- app.loramer.com MIGRATION DONE + verified: attached to app Vercel project, Cloudflare CNAME (DNS-only), SSL issued; new redirect URIs registered on both Google OAuth clients (sign-in + GA) and Meta; NEXTAUTH_URL + GOOGLE_ANALYTICS_REDIRECT_URI flipped to app.loramer.com + redeployed. app.loramer.com now canonical; vercel.app alias still serves; old URIs still registered (rollback intact). Verified: Google sign-in + Meta connect on existing client both work.
- Google OAuth verification SUBMITTED 2026-06-06: branding VERIFIED, data access UNDER REVIEW. Clock ~2-6 weeks running. adwords is sensitive (not restricted) → no CASA. Consent screen: app LoraMer, support@loramer.com, homepage loramer.com, privacy loramer.com/privacy, authorized domain loramer.com, published to Production, unlisted demo video attached.

## NEXT STEP — Google is the only external clock and it's now running; remaining launch work is all in-our-control. Priority order:
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
