⛔ See **SESSION START GATE** in LORAMER_HANDOFF.md — the one authoritative resume protocol. Read it (and everything below) before proposing, verifying, or building anything. The git repo is the only source of truth.

**LAUNCH CONTEXT:** Soft launch target: July 14, 2026 (confirmed by Russ 2026-06-09) — invite-only founding cohort, Russ onboards manually. Full launch Q4 2026.
**AUTHORITY:** The git repo is the ONLY source of truth. The Claude project-knowledge panel, background memory, and any old handoff zip/export are NOT authoritative — they lag. Act only on the live repo read THIS session (this file + REQUIRED READING + the actual code).

## REQUIRED READING — ACTIVE WORKSTREAM
Authoritative files for the live task. `cat` and read each in full before acting. KEEP CURRENT AT EVERY HANDOFF.

Current workstream: **External review clocks for July 14 launch — (a) Google Ads API Standard Access application (now UNBLOCKED: Google OAuth adwords scope APPROVED 2026-06-10), (b) Meta App Review for ads_read → flip app to Live. Stripe: Phases 0-4 DONE & VERIFIED; Phase 5 (Gating) deferred (cohort = beta_unlimited bypasses gating); Phase 6 go-live scheduled early July (bank/legal lead time). See NEXT STEP.**
- `STRIPE_BILLING_PLAN.md` — locked plan; read the **Phase 4 (Customer Portal)** section + the entitlement matrix and locked answers.
- `src/app/billing/page.tsx` — the /billing UI (already has the "Manage billing (coming soon)" placeholder Phase 4 wires to a portal session).
- `src/app/api/billing/*` (`route.ts` = GET current plan; `checkout/route.ts` = Checkout session) and `src/app/api/stripe/webhook/route.ts` — the Stripe→Supabase sync engine (signature/dedupe/livemode/UPSERT tier-write).
- `src/lib/billing/*` (`plans.ts`, `ensure-customer.ts`, `tier-from-price.ts`) + `src/lib/stripe.ts` (Stripe singleton + `stripeLivemode`) + `src/lib/welcome-gate.ts`.
- Schema reference: `migrations/008_stripe_billing_phase2.sql` (subscriptions + stripe_events + user_profiles.stripe_customer_id, APPLIED); `plan_entitlements` price IDs populated (migration 007).

# CONTINUE_HERE — LoraMer

## REPORT FORMAT — how Claude Code delivers everything to Russ (2026-06-09, supersedes all earlier OUT.txt wording)
Every report you give Russ is printed ONCE, IN FULL, inside ONE single fenced code block (triple backticks) in your chat reply — so the Claude phone app renders it with a one-tap COPY button. Nothing of substance outside that block (a one-line lead-in is fine). Never a long version plus a condensed version. Never a file. OUT.txt stays retired. If a report must contain commands or verbatim text for Russ, they live INSIDE that same single block, delimited with `<<<START>>>`/`<<<END>>>` markers instead of nested backticks.

## REMOTE CONTROL (work from phone)
- In a running Claude Code session, type `/rc` to mirror it to the Claude mobile app (preserves history). One-time set-all: `/config` -> "Enable Remote Control for all sessions" = true.
- On phone: open Claude app -> CODE tab (NOT chat list) -> find the session (computer icon + green dot when online).
- Laptop terminal must stay open and machine online. Run `claude update` if `/rc` is unknown (needs v2.1.52+; push notifications need v2.1.110+).

=== LAUNCH RITUAL (start every session this way) ===
1. Terminal: type  loramer  (alias launches Claude Code from the repo so .mcp.json loads + stays authenticated). iMac one-time setup still pending — see iMac block below.
2. In claude.ai: say  resume loramer
3. Paste the SESSION RESUME output back into claude.ai.
4. cat every REQUIRED READING file and read it fully before acting.
5. To drive from your phone, type `/rc` in the session to mirror it to the Claude mobile app (see REMOTE CONTROL above).
=== end launch ritual ===

## Session log (2026-06-10d) — demo@loramer.com provisioned for the Google reviewer demo (LORAMER_DEMO_ACCOUNT_PROVISIONED_V1)
- Verified + set: demo@loramer.com user_profiles → tier=**beta_unlimited** (bypasses gating), welcome_seen_at SET (no welcome gate on cold sign-in), stripe_customer_id=**null** (the auto-created Stripe TEST customer cus_UgETvO7hme0HSe was DELETED — demo carries no billing). Google connection present: client "Influential Drones" (client_id 2617b163-f392-427e-9a29-f134acc51406, account_id 3699173394) via the fixed MCC picker.
- DATA: demo client has **0 metrics_daily rows** (connected today, after the last cron). I could NOT auto-trigger the sync — CRON_SECRET is not retrievable here (`vercel env pull` blanks it, same artifact as Lesson 45) and I will NOT fabricate rows. ▶ RUSS ACTION (secret-free): signed in as demo@ on /clients, open the Influential Drones card details → Connections → click **Backfill** on the Google row (runs /api/backfill/run, session-authed/ownership-gated) → full history lands in metrics_daily → the "30-Day Spend" card + metrics_daily-backed trend charts + query_metrics populate. (Alternative: trigger /api/cron/sync with the CRON_SECRET for a single day = 2026-06-09.) Without this the LIVE dashboard/Google charts/Lora still work, but the /clients 30-Day card shows $0.
- REVIEWER PATH (reasoned): cold sign-in as demo@ → welcome gate SKIPPED (welcome_seen_at set) → /clients shows Influential Drones (Google connected) and /dashboard Overview + Google tab render LIVE GAQL data (populated regardless of metrics_daily) → Ask Lora answers from live intelligence. FLAGS FOR RUSS TO EYEBALL (cold incognito browser): (1) run the Google Backfill so the 30-Day card isn't $0; (2) a fresh browser has no `advar-active-client` localStorage — confirm /dashboard lands on / lets the reviewer pick Influential Drones (not a blank/first-client default); (3) open the Google tab → real charts render; (4) ask Lora one question → real answer, no error. MCC NAME EXPOSURE (accept): demo@'s picker/mapper lists ALL MCC child client names (Cause-B listing) — fine for a Google reviewer, but it's why MCC access is revoked at teardown (below).

## DEMO TEARDOWN CHECKLIST — run AFTER the Google review (LORAMER_DEMO_ACCOUNT_PROVISIONED_V1)
- [ ] Re-enable the MANAGER (MCC) account 2-Step Verification requirement (if it was relaxed so the reviewer could sign in).
- [ ] Rotate the demo@loramer.com password.
- [ ] Downgrade demo@ MCC access Admin → read-only NOW if it was granted as Admin (read-only is all the demo needs).
- [ ] REVOKE demo@'s MCC access entirely BEFORE running pre-launch matrix test (b) — that returns demo@ to the pure business-owner shape (direct grant on Influential Drones only, NO MCC), which is exactly the identity test (b) must exercise. Rationale: with MCC access, demo@'s picker exposes all MCC client names AND it's no longer a true direct-grant fixture.
- [ ] (Optional) Decide whether to keep demo's metrics_daily backfill rows or sweep them after review.

## Session log (2026-06-10c) — /clients +Google pill fixed + empty-picker root cause (Cause B, env is FINE)
- +Google connect pill fixed (LORAMER_GOOGLE_PILL_CONNECT_V1, 911e575): was a dead <span> since the 2026-05-22 pill row (never wired) → now a button (stopPropagation + hover) opening a per-client Google Ads account picker mirroring the Meta modal. Deployed green.
- EMPTY PICKER ROOT CAUSE = Cause B only (MCC-only listing). listAccessibleAccounts lists ONLY our MCC's children (login_customer_id=GOOGLE_ADS_MANAGER_ACCOUNT_ID, customer_client level=1); no ListAccessibleCustomers path. A direct-grant business owner (demo@, admin on Influential Drones, NO MCC access) gets an empty list by design.
- ENV IS FINE (NOT changed): metrics_daily has current Google rows through 2026-06-09 (yesterday; 712 rows/17 clients/day), and the cron passes that env as login_customer_id — so it's live at runtime. The earlier `vercel env pull` 0-char read was a PULL ARTIFACT (Lesson 45). Cron is healthy, NO gap, NO backfill needed. I did NOT set the env (correct value not in hand; guessing would break the working Google path for all users + cron).
- DEMO WORKAROUND (Russ, in Google Ads): grant demo@loramer.com READ-ONLY user access on the MANAGER (MCC) account + confirm Influential Drones is linked under the MCC; then demo@ reloads /clients and the picker/mapper lists MCC children → connect → live data.
- Cause B FIX = QUEUED design workstream (ROADMAP Pre-launch): add a CustomerService.ListAccessibleCustomers path so direct-grant identities are first-class. Also queued: fail-loud required-env validation. Docs: LAUNCH_PARKING identity matrix (a/b/c; demo@ = permanent business-owner fixture), Lessons 44 (walk every identity shape) + 45 (env-pull artifact) logged.

## Session log (2026-06-10b) — Google OAuth adwords scope APPROVED (LORAMER_GOOGLE_OAUTH_APPROVED_V1)
- Google OAuth verification for the **adwords** scope = **CLEARED 2026-06-10** (GCP project savvy-palace-495920-v2). The unverified-app warning is GONE. App published in Production; branding + sensitive-scope data access both approved. This was the ~2-6 week external clock opened 2026-06-06.
- ⚠️ STANDING CAUTION (Google's approval email): ANY change to the OAuth consent screen config — app name, authorized domains, scopes, homepage/privacy/TOS URLs, logo — triggers **RE-verification** (back under review, warning can reappear). DO NOT touch the consent screen casually. This directly constrains the **homepage unification** work (loramer.com ↔ app.loramer.com): plan domain/URL changes deliberately, batch them, expect a re-review window, and never edit the consent screen mid-launch. (Also logged as Lesson 42.)
- NEW ACTIVE WORKSTREAM = the two external review clocks for July 14 (see NEXT STEP): (a) Google Ads API **Standard Access** application — now UNBLOCKED by the OAuth approval; involves switching the API Center "permissible use" internal→external + applying; (b) Meta **App Review for ads_read** → then flip the Meta app to **Live** mode. Cohort can't connect Google/Meta at scale until these clear.
- Stripe Phase 5 (Gating) DEFERRED — not launch-blocking (founding cohort = beta_unlimited bypasses gating). Phase 6 (go-live: account activation, TEST→LIVE keys, LIVE webhook, LIVE portal config) scheduled **early July** because Stripe account activation carries bank/legal lead time.

## Session log (2026-06-10) — Stripe Phase 4 (Customer Portal) COMPLETE & VERIFIED end-to-end
- Phase 4 built + shipped (LORAMER_STRIPE_PHASE4_PORTAL_V1, commit 33fca5c). New POST /api/billing/portal (auth; 500 config_missing if STRIPE_PORTAL_CONFIG_ID unset; 403 manual_tier; requires a this-livemode active/trialing/past_due sub else 409 no_subscription; customer id from user_profiles w/ subscriptions backstop else 409 no_customer; billingPortal session w/ configuration=env + return_url=/billing). /billing hasActiveSub placeholder → real "Manage billing" button. webhook/schema UNCHANGED — portal switch/cancel ride the existing customer.subscription.updated/deleted handlers (manual-tier + out-of-order guards intact).
- DASHBOARD ACTIVATION DEFERRED: Stripe Dashboard portal setup forces full business verification (held to Phase 6/LIVE). TEST portal config created via API instead (scripts/stripe-create-portal-config.mjs) → **bpc_1Tgo2JEAFDrT56pML9lyrATD** (livemode=false): subscription_update enabled (Business/Agency/Scale, both prices each, default proration), subscription_cancel at_period_end, payment_method_update enabled, no quantity updates. Pinned in Vercel **Production env STRIPE_PORTAL_CONFIG_ID** (non-secret). loramer.com/privacy + /terms both 200 (used in business_profile).
- ⚠️ PHASE 6 MUST repeat config creation in LIVE mode (configs do NOT cross modes) + set the LIVE STRIPE_PORTAL_CONFIG_ID.
- VERIFIED (LORAMER_STRIPE_PHASE4_VERIFIED_V1): Russ click-tested on prod TEST. Portal opened (config bpc_...). PLAN SWITCH Business annual→Agency annual synced: subscriptions tier=agency, price_id=price_1TgVtWEAFDrT56pMgXdAQgiy (Agency annual), interval=year, status=active; user_profiles.tier=agency (grace). CANCEL (at period end) → final drop driven via API (subscriptions.cancel) → customer.subscription.deleted synced: subscriptions.status=canceled + canceled_at set; user_profiles.tier=free. Negative: unauth POST /api/billing/portal → 401 {"error":"unauthenticated"}; free user (0 active subs) → 409 no_subscription path confirmed by state. Cleanup swept to 0 (subscriptions livemode=false=0, stripe_events=0, test profile=0; Stripe TEST customer cus_UgAc2bSO7P7tdP deleted).
- FINDING (Lesson 41): the Stripe Customer Portal "cancel at end of billing period" sets the subscription's **cancel_at (timestamp)**, NOT the cancel_at_period_end **boolean**. So the portal showed "Cancels Jun 10 2027" while both Stripe AND our mirror read cancel_at_period_end=false (mirror correctly matched Stripe; entitlement keys off status, so grace was intact — tier stayed agency until the deleted event). Our subscriptions table has no cancel_at column, so a portal-scheduled cancellation is currently INVISIBLE in the mirror as a boolean. Entitlement is unaffected (status-driven; deleted event drops to free). FOLLOW-UP (queued, not launch-blocking): if we ever surface "your plan cancels on X" or compute willCancel, capture sub.cancel_at into the mirror — don't trust cancel_at_period_end alone.

## Session log (2026-06-09d) — Stripe Phase 3 COMPLETE (Checkout) + 2 fixes, verified end-to-end
- Phase 3 shipped: /billing page (current plan, annual/monthly toggle default annual, self-serve cards, human-readable feature labels, success-poll) + "Billing & Plan" link in the dashboard account menu; POST /api/billing/checkout (validated, ensureStripeCustomer backstop, hosted Checkout, client_reference_id=user_email) + GET /api/billing. (CHECKOUT_API_V1 f81a904, BILLING_UI_V1 46d1dbf, FLAGLABELS_V1 2cd7707)
- Live click-test (cote.russell@gmail.com, Business annual, 4242 card) surfaced TWO real bugs, both fixed + verified:
  - FIX A (FIX_UPSERT_V1, 5f64108): billing writes to user_profiles were UPDATE...WHERE — a silent 0-row no-op when the user had no profile row, so tier=business resolved but was written NOWHERE (/billing showed Free over an active sub). Now UPSERT (insert if absent w/ welcome_seen_at NULL; update if present, manual tiers sticky, stripe_customer_id set only when null; affected-row count checked + logged on 0).
  - FIX B (FIX_WELCOMEGATE_V1, 605293e): the welcome/profile-creation gate lived ONLY in /clients, so a sign-in landing on /dashboard skipped row creation entirely. Extracted to src/lib/welcome-gate.ts (enforceWelcomeGate) and mounted on /dashboard + /clients + /billing. Edge cases: /welcome ungated (no loop), API routes untouched, signed-out not bounced, DB error fails open.
- Verified on prod (TEST): created->business; cancel_at_period_end->business (grace); canceled->free; welcome screen now appears on /dashboard + /billing for a profile-less user (Russ eyeballed both). GOTCHA: a plain `stripe events resend` can't prove a sync fix — the out-of-order guard skips it because a resent event keeps its ORIGINAL (older) created-timestamp; verify with a genuinely fresh event (e.g. a metadata touch) instead.
- All test data cleaned up (subscriptions/stripe_events/profile = 0; Stripe test customer deleted). Lessons 39 (affected-row count / UPSERT-when-row-may-be-absent) + 40 (no internal keys to users) added. Roadmap: Google Pay in Stripe (Project 2); loramer.com->app signup handoff (Homepage unification); first-run guidance + /welcome copy truth pass (onboarding system).
- Protocol/docs commits today: REPORT FORMAT rule = every report ONCE in ONE fenced code block in chat, no files, OUT.txt retired (LORAMER_REPORT_FORMAT_V1, 6202dad); Phase 3 DOCS — plan + log + Lessons 39/40 + roadmap (LORAMER_STRIPE_PHASE3_DOCS_V1, f0668fb); codebase map updated for the billing surface (LORAMER_CODEBASE_MAP_STRIPE_PHASE3_V1, 21768c6); roadmap path-chooser-continuity line folded into the onboarding item (LORAMER_ROADMAP_PATHCHOOSER_CONTINUITY_V1, d2320b1); this handoff hardening (LORAMER_HANDOFF_HARDEN_0609_V1).
- SECOND cleanup (end of night): Russ's welcome re-test completed a real fresh-user upgrade — which PROVED both fixes on a cold user (welcome_seen_at got set = FIX B showed /welcome; tier=business landed on a brand-new customer/profile = FIX A upsert). Swept to zero again: canceled the sub, deleted the Stripe customer, wiped subscriptions/stripe_events/profile (re-verified stable at 0, no late-webhook straggler). Stripe TEST + DB are clean.

## Session log (2026-06-09c) — Stripe Phase 2 COMPLETE (data + webhook sync, verified end-to-end)
- Migration 008 applied (subscriptions mirror + stripe_events dedupe + user_profiles.stripe_customer_id UNIQUE). Verified via MCP. (LORAMER_STRIPE_PHASE2_MIGRATION_V1, c97429f)
- src/lib/stripe.ts (lazy getStripe singleton + stripeLivemode) + src/lib/billing/tier-from-price.ts. (LORAMER_STRIPE_PHASE2_LIB_V1, cfb08ae)
- ensureStripeCustomer wired into /api/welcome (best-effort, never throws, skips @loramer.app). Idempotency proven against Stripe TEST (created->reused, 1 customer). (LORAMER_STRIPE_PHASE2_CUSTOMER_V1, eebb9e4)
- Webhook POST /api/stripe/webhook (Node runtime): constructEvent signature verify, stripe_events PK dedupe (release+500 on handler error so Stripe retries), event.livemode mode-gate, out-of-order guard, manual-tier guard (beta_unlimited/enterprise sticky), past_due=grace. period read from subscription ITEM (SDK v22 moved current_period_end off Subscription). (LORAMER_STRIPE_PHASE2_WEBHOOK_V1, b5ceccf; Phase 2 docs e35ef34)
- ENV: STRIPE_SECRET_KEY pushed to Vercel Prod from local via piped stdin (value never in chat; Vercel masks all values on `env pull`, so verified functionally not by length). STRIPE_WEBHOOK_SECRET added by Russ in Vercel after registering the TEST endpoint (we_1TgXCr...) at https://app.loramer.com/api/stripe/webhook.
- GOTCHA logged: `vercel redeploy <branch-alias>` rebuilds the SOURCE of the deployment the alias points at (was the older Step-3 commit) -> 404 on the new route. Fix: `vercel --prod` deploys the CURRENT tree. Also: Stripe CLI installed via direct x86_64 binary to ~/.local/bin (this Air is INTEL x86_64, NOT arm64; no Homebrew present); `stripe subscriptions cancel` is interactive -> needs `--confirm`; `stripe events resend` needs `--webhook-endpoint we_...`.
- VERIFIED end-to-end on prod (TEST): bad-sig->400; subscription created->user_profiles.tier business + stripe_customer_id backfilled; cancel_at_period_end->still business (grace); canceled->free; resend same event->dedup no-op (one row per event id); checkout.session.completed received/verified/acked. All test data cleaned up (subscriptions/stripe_events/test profile = 0; Stripe test customer deleted).
- NOTE: this MacBook Air .env.local has PLACEHOLDER Supabase creds (so the local Stripe key works but DB writes must go through Vercel/MCP). Production has the real creds.

## Session log (2026-06-09b) — Stripe Phase 1 COMPLETE (sync Node fix)
- sk_test_ key set in .env.local; `npm run stripe:sync` ran. Stripe side: 3 TEST products + 6 prices (Business/Agency/Scale × monthly+annual) created, now idempotently REUSED on re-run.
- BUG FIXED (LORAMER_STRIPE_SYNC_NODEFIX_V1, 04bc909): on Node 20, supabase-js 2.105 `createClient()` throws "Node.js 20 detected without native WebSocket support" — it eagerly builds a realtime client with no opt-out. Fix: dropped the @supabase/supabase-js import; write-back now does a direct authenticated PostgREST PATCH via fetch (no realtime layer, no ws dependency). Stripe logic untouched.
- This MacBook Air's .env.local has PLACEHOLDER Supabase creds (placeholder.supabase.co, 23-char key), so the script's fetch write-back can't reach the real DB here. Completed the write-back via Supabase MCP instead: UPDATE plan_entitlements set the 6 price IDs. VERIFIED — business/agency/scale populated (price IDs match sync output), free/enterprise/beta_unlimited still null.
- Phase 1 DONE: products/prices live in Stripe TEST; plan_entitlements carries price IDs; $0 moved.

## Session log (2026-06-09) — Protocol consolidation + Stripe account
- Consolidated four overlapping start-protocols into ONE "SESSION START GATE" atop LORAMER_HANDOFF.md; purged stale Cursor / patch-script / dry-run workflow; IDE refs -> Claude Code. (LORAMER_HANDOFF_CONSOLIDATE_V1)
- New standing rules in the gate + committed: READ-FIRST (act only on actual printed CONTINUE_HERE + REQUIRED READING — never a summary, memory, or panel); SINGLE-PASTE (one copy-paste block per Claude Code instruction); OUTPUT-TO-ONE-FILE (everything Claude Code shows Russ — output AND commentary — in OUT.txt only). (LORAMER_HANDOFF_READGATE_V1, LORAMER_OUTPUT_ALL_TO_FILE_V1)
- Stripe Phase 1 deliverables now tracked: migration 007 + scripts/stripe-sync-products.mjs + stripe dep. (LORAMER_STRIPE_PHASE1_TRACK_V1)
- Tree cleaned: transient artifacts gitignored; working tree clean. (LORAMER_TREE_CLEANUP_V1)
- Stripe: dedicated LoraMer Stripe account created (russ@loramer.com, TEST mode); test secret key rotated. NOT DONE: the sk_test_ value in .env.local is still EMPTY.

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

## NEXT STEP — Work the two external review clocks for July 14 (longest lead time; start now):
- **(a) Google Ads API — Tool Change Form (permissible use → external, Reporting-only).** Standard Access is DEFERRED to scale-time (Basic = 15k ops/day covers the invite-only cohort). The active item is the lighter **Tool Change Form** (support.google.com/adspolicy/contact/tool_change) to update permissible use to external/client + reporting. ANSWER PACK READY for Russ to review + submit himself: docs/GOOGLE_ADS_TOOL_CHANGE_FORM_ANSWERS.md (verbatim Q2/Q3/Q4/Q5/Q7 + Q1 reminder); attach docs/GOOGLE_ADS_API_DESIGN.pdf at Q4. ⚠️ Q2 MCC ID is NOT in our env (prod GOOGLE_ADS_MANAGER_ACCOUNT_ID is empty / local is a placeholder) — Russ supplies it (XXX-XXX-XXXX from the Ads UI). Q7 email must match the API contact email Russ sets in API Center. This is zero-risk MCC metadata (token/OAuth/account links untouched — Lesson 43). No submission by Claude.
- **(b) Meta App Review for ads_read** → then flip the Meta app from Development to **Live** mode. Tech Provider already cleared (2026-06-09); access verification DONE. Cohort can't connect Meta until ads_read is approved AND the app is Live.
- ⚠️ Do NOT touch the Google OAuth consent screen while these run (re-verification trigger — Lesson 42).

Stripe (parallel, owner = Russ's external lead times):
- **Phase 6 — Go live** scheduled **early July**: Stripe account activation (bank/legal — start early), flip TEST→LIVE keys, register LIVE webhook, RE-CREATE the portal config in LIVE mode + set LIVE STRIPE_PORTAL_CONFIG_ID (Phase 4 carryover), smoke-test.
- **Phase 5 — Gating** DEFERRED (not launch-blocking; cohort = beta_unlimited bypasses gating). Land pre-public-launch / Q4: enforce the entitlement matrix (workspace cap, monthly question counter, history-window filter, feature flags) + upgrade prompts, all DB-driven off plan_entitlements.
- Queued (roadmap): enable Google Pay in Stripe payment settings; capture sub.cancel_at into the subscriptions mirror IF we surface "cancels on X" (Lesson 41 follow-up).

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
