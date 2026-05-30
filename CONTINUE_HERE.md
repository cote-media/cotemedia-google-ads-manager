# CONTINUE_HERE — Resume point after May 29, 2026 (full marathon)

*Written end-of-evening May 29, 2026 (~9:45pm ET) on the MacBook Air after the iMac handoff. Reads AFTER LORAMER_HANDOFF.md and ROADMAP.md, not before.*

---

## TL;DR — Today's full slate

- ~20 commits across two repos shipped today, every one production-green
- **loramer.com is LIVE** — DNS propagated, SSL provisioned, marketing site live with working Mailchimp waitlist
- **GA Phase 1 foundation is fully done** — APIs enabled, OAuth client created, env vars in Vercel, ga_tokens table in Supabase. Zero GA code written yet.
- **Launch Consolidation design doc filed** — strategy for folding loramer.com + dashboard login + dashboard app into one product at launch, plus a Google-OAuth-as-discovery rethink
- **Five major new design docs** in the repo: intelligence audit, connector audit, GA connector design, Shopify LTV design, Launch Consolidation design

## What shipped today (May 29, 2026 — full day)

### On cotemedia-google-ads-manager (the dashboard app)

Morning + afternoon (covered in earlier session, recapped briefly):
1. LORAMER_ASKCLAUDE_SCROLL_V1 — Ask Claude tab auto-scrolls to latest on mount
2. LORAMER_INTELLIGENCE_HONESTY_V1 — fixed prompt-as-mirror class of hallucination
3. LORAMER_PROMPT_CACHING_PHASE_1_REFACTOR_V1 + PHASE_2_ENABLE_V1 — Project 22 closed out, ~25-70% token savings live
4. LORAMER_SHOPIFY_DEEPER_SIGNALS_V1 — six derived metrics (refund rate, returning rate, AOV split, revenue concentration)
5. LORAMER_SHOPIFY_ABANDONED_CHECKOUTS_V1 — Phase 2.1 from LTV design doc, count-only, fail-soft, PII-free
6. LORAMER_DOCS_CONNECTOR_AUDIT_V1 — 30KB connector architecture audit committed
7. LORAMER_DOCS_GA_DESIGN_V1 — GA4 connector V1 design doc filed
8. LORAMER_DOCS_EOD_2026_05_29_V1 — afternoon docs closeout

Evening (this session):
9. **LORAMER_DOCS_LAUNCH_CONSOLIDATION_DESIGN_V1** — strategic doc for unifying loramer.com + dashboard + app at launch + Google-OAuth-as-discovery rethink. Multi-part: consolidation options (merged repos / rewrites / subdomain), login UX options (keep Google / multi-platform / email-first / reframe Google), recommended sequencing, risk and rollback. Filed at `docs/LAUNCH_CONSOLIDATION_DESIGN_2026_05_29.md`.
10. **GA Phase 1 foundation** (Russ did the Google Cloud Console clicks manually):
    - Google Analytics Data API enabled on the `cote media claude google ads` Cloud project
    - Google Analytics Admin API enabled (needed for property picker)
    - NEW OAuth client created (`LoraMer GA Connector`), separate from the existing Google Ads OAuth (per the design doc)
    - Three env vars added to the dashboard's Vercel project: `GOOGLE_ANALYTICS_CLIENT_ID`, `GOOGLE_ANALYTICS_CLIENT_SECRET`, `GOOGLE_ANALYTICS_REDIRECT_URI`
    - `ga_tokens` table created in Supabase via migration (11 columns: id, user_email, client_id, ga_property_id, ga_account_id, ga_property_name, access_token, refresh_token, expires_at, created_at, updated_at)
    - Indexes: ga_tokens_client_idx, ga_tokens_client_unique, ga_tokens_user_idx
    - Project owner: cotebrandmarketing@gmail.com (same identity as the Google Ads MCC)

### On loramer-landing (the brand-new repo, separate Vercel project)

Afternoon + evening:
1. **Initial commit (V1)** — Next.js 14 single-page, center hero, etymology section, 3 differentiators, 3 sample Claude responses, Mailchimp /api/waitlist
2. **Bad commit + revert** — wrong page.tsx accidentally pulled in via stale `mv`. Recovered cleanly via `git revert HEAD && git push`. Lesson 17 candidate.
3. **V2 ship** — center-aligned hero, 4th differentiator ("A real human, always"), pricing section with 5 tiers across two tracks (Free / Business $79 / Agency $199 / Scale $999 / Enterprise). Solo renamed to Business.
4. **Free tier fix** — Free tier was wrongly showing "Shopify connection only". All tiers get all integrations; AI usage caps are the differentiator.
5. **V3 ship** (evening) — added .05 differentiator ("Knows what only you know" — uploads). Added /privacy and /terms pages with brand-aligned styling (Georgia + Instrument Sans, ink/paper palette). Updated footer with Privacy + Terms links.

### Infrastructure (evening)

- **Cloudflare DNS** — nameserver change completed at GoDaddy, propagation done, loramer.com on Cloudflare DNS
- **SSL/TLS mode** — confirmed Full at Cloudflare (correct for Vercel-hosted apex CNAME)
- **Vercel domain** — `loramer.com` added to the loramer-landing Vercel project as apex (no www redirect, apex-only)
- **DNS records updated** — deleted the two GoDaddy parking A records, added CNAME `@ → 97919c4efd509a60.vercel-dns-017.com.` with DNS-only (gray cloud), proxy disabled
- **SSL certificate issued** — Vercel + Let's Encrypt completed cert provisioning, https://loramer.com serves the landing page

### Mailchimp setup (afternoon)

- Audience created: "LoraMer Waitlist"
- Audience ID: 5bf7067007 (and in Vercel env vars)
- Data center: us6
- Three env vars in Vercel: MAILCHIMP_API_KEY, MAILCHIMP_AUDIENCE_ID, MAILCHIMP_DATA_CENTER
- Welcome email and double opt-in language set up using the Synthesis-3 brand copy
- ⚠️ **TODO: Russ rotates the Mailchimp API key.** Standard hygiene since the key was pasted in chat. Vercel env vars will need updating afterward.

## What's NOT done yet (pending for tomorrow+)

GA build:
- ❌ GA Phase 2 — OAuth wiring (`/api/ga/start`, `/api/ga/callback`)
- ❌ GA Phase 3 — Property picker (post-OAuth flow + `/api/ga/properties` + `/api/ga/connect`)
- ❌ GA Phase 4 — Intelligence adapter (`src/lib/intelligence/ga-intelligence.ts`, 7 query buckets)
- ❌ GA Phase 5 — Prompt builder render (Google Analytics section in build-claude-context)
- ❌ GA Phase 6 — Disconnect route + UI

Pre-GA hygiene (from connector audit):
- ❌ `<ConnectionPill>`/`<ConnectionRow>` extract on `/clients` page (~200 lines of JSX dedupe, zero risk, makes GA UI free)

Launch consolidation (from Launch Consolidation design doc):
- ❌ Phase 1: Set up app.loramer.com pointing at the dashboard Vercel project
- ❌ Phase 2: Update marketing CTAs to point at app.loramer.com
- ❌ Phase 3: Visual harmonization of the dashboard's login page (Georgia + ink/paper palette)
- ❌ Phase 4: Login UX evolution (email/password secondary path, Google OAuth as primary)
- ❌ Phase 5 (later): Google OAuth reframe as discovery tool

Infrastructure cleanup:
- ❌ **Cloudflare Email Routing** for hello@loramer.com → russ's Gmail (waiting for spare cycles)
- ❌ **Mailchimp API key rotation** (logged above)
- ❌ Optional: clean up the existing `www.loramer.com` CNAME (today it loops via Cloudflare CNAME flattening; works but not clean)
- ❌ ROADMAP correction of the Unified.to/Merge.dev mention (audit caught it; not yet fixed)
- ❌ Bump Next.js past 14.2.3 (security vulnerability noted in both repos' npm install warnings)

Documentation:
- ❌ Lesson 17 candidate (same-named files across projects + `mv` is dangerous) — not yet added to LORAMER_HANDOFF.md formally
- ❌ Lesson 18 candidate (patch scripts that hardcode `~/Downloads/cotemedia-ads-manager` silently fail on the laptop because the path is `cotemedia-google-ads-manager` there). Russ should use ONE path consistently OR scripts should detect which exists.

## What to work on next (priority order)

Tomorrow morning Russ wakes up fresh. The recommended priority order:

1. **GA Phase 2 — OAuth wiring** (the next real code ship). Two route files:
   - `src/app/api/ga/start/route.ts` — initiates OAuth with proper scopes + state + offline access + prompt=consent
   - `src/app/api/ga/callback/route.ts` — exchanges code for tokens, does NOT yet write to ga_tokens (that's Phase 3 after property picker)
   - Important: the design doc locks scopes to `analytics.readonly` only (NEVER analytics.edit or analytics.manage.users)
   - Important: include a CSRF-protected `state` parameter — server-issued, stored in a short-lived cookie, validated on callback
   - Verify by clicking a (temporary placeholder) Connect button on /clients that triggers /api/ga/start, getting redirected to Google's consent screen, signing in, getting redirected back to /api/ga/callback with a code

2. **GA Phase 3 — Property picker.** After OAuth returns with code, use the access_token to call GA Admin API (listAccountSummaries) and list the user's properties. Modal/dropdown on /clients lets them pick ONE property for that client. Then `/api/ga/connect` writes the ga_tokens row and a platform_connections row.

3. **`<ConnectionPill>`/`<ConnectionRow>` extract** — could slot before GA Phase 3 (the new GA Connect button benefits from it) or after (GA Phase 3 gets it for free if done first). Audit recommended before GA but the order is flexible.

4. **GA Phase 4 — Intelligence adapter.** This is the meatiest single ship. Seven query buckets to write against GA Data API. Real engineering. Don't rush it.

5. **GA Phase 5 — Prompt builder render.** Small once the data shape is right.

6. **GA Phase 6 — Disconnect.** Cleanup.

7. **GA V1.1 — Dashboard tab.** Separate ship after V1 verified. Adds a Google Analytics tab to the dashboard with visual cards.

8. **Launch consolidation Phase 1** — DNS for app.loramer.com. Cheap, low-risk, unblocks future work. Could happen between any GA phases.

## Resume checklist for tomorrow morning

On the Air:
1. `cd ~/Downloads/cotemedia-google-ads-manager && git pull origin main` — sync overnight changes (probably none)
2. `cd ~/Downloads/loramer-landing && git pull origin main` — same
3. Read this CONTINUE_HERE.md
4. Skim LORAMER_HANDOFF.md if anything feels foreign
5. Open `docs/GA_CONNECTOR_DESIGN_2026_05_29.md` for the GA Phase 2 spec
6. Start GA Phase 2

## Discipline reminders going into tomorrow

All from the day's hard-won lessons:
- Lesson 16 (anchor discipline) — only use bytes from current-turn pastes
- Lesson 17 candidate — same-named files + `mv` is dangerous, always rename downloads to be unique
- Lesson 18 candidate — patch scripts with hardcoded paths silently fail on different machines
- Right > fast — slow on GA Phase 2; it's a real auth flow with real CSRF risk
- `tsc --noEmit` is NOT `npm run build`; Vercel is the final check
- Comments NEVER on the same line as commas (Lesson 13)
- Surface raw API responses as diagnostic of last resort (Lesson 15)
- Claude.ai cannot read the local repo; ask for whole-file pastes; use Claude Code for whole-repo audits

Good day. Sleep well.
