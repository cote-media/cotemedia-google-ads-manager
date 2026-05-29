# CONTINUE_HERE — Resume point after May 29, 2026 marathon

*Written end-of-day May 29, 2026 (~5pm ET) before Russ switches from iMac to MacBook Air.*

The next Claude reads this AFTER LORAMER_HANDOFF.md and ROADMAP.md, not before.

---

## TL;DR — where we are right now

- 14 commits shipped to production today on `cotemedia-ads-manager`, all green
- 4 commits shipped on the brand-new `loramer-landing` repo, live on a Vercel preview URL
- The landing page collects waitlist emails to a real Mailchimp audience (verified working)
- Cloudflare DNS for loramer.com is propagating but not yet pointed at the landing page
- GA4 connector design doc is filed and locked, but ZERO GA code has been written yet
- A connector architecture audit (Claude Code-driven, 30KB) recommends shipping GA in the current pattern, NOT refactoring first

## What shipped today (May 29, 2026)

Order matters — the audit reshaped the second half of the day.

### On cotemedia-ads-manager (the dashboard app)

1. **LORAMER_ASKCLAUDE_SCROLL_V1** — Ask Claude tab now auto-scrolls to the latest message on mount. ChatTab was missing the useLayoutEffect that RightPanel already had. Verified production-green.

2. **LORAMER_INTELLIGENCE_HONESTY_V1** — fixed the silent prompt-as-mirror class of hallucination. Connected-but-empty platforms now emit an honest empty-state header. The completeness header is dynamically generated per turn. Found via Claude Code audit (`docs/INTELLIGENCE_ARCHITECTURE_AUDIT_2026_05_29.md`). Also cleaned up leftover RAW_DEBUG instrumentation per Lesson 15.

3. **LORAMER_PROMPT_CACHING_PHASE_1_REFACTOR_V1** — pure restructure of `buildClaudeContext` into `{prefix, suffix}`. Zero behavior change, verified via three production read-back tests.

4. **LORAMER_PROMPT_CACHING_PHASE_2_ENABLE_V1** — wired `/api/chat` and `/api/insight` to use Anthropic's `cache_control: ephemeral` on the prefix block. Verified live: cache write at 13:17 UTC, cache read 42 seconds later. Saves roughly 25% on second-turn, 70% on multi-turn chats. Project 22 closed out.

5. **LORAMER_SHOPIFY_DEEPER_SIGNALS_V1** — six derived metrics from the existing Shopify GraphQL response (no new API calls): refundedOrderCount, refundRate, returningRate, newCustomerAov, returningCustomerAov, revenueConcentration. Claude correctly quoted all of them verbatim on a tested client.

6. **LORAMER_SHOPIFY_ABANDONED_CHECKOUTS_V1** — Phase 2.1 from the LTV design doc. Added `abandonedCheckoutCount?: number` via a separate fail-soft GraphQL query helper. PII-free (only `id` field requested). Fail-soft on missing `manage_abandoned_checkouts` permission. Decision change from design doc: shipped COUNT only, not rate, since full funnel data isn't API-available. Verified: Claude quoted "16 abandoned checkouts vs 49 completed orders" verbatim.

7. **LORAMER_DOCS_CONNECTOR_AUDIT_V1** — committed the 30KB connector architecture audit from Claude Code. Three-part finding: (a) the four existing connectors are LESS uniform than expected (Google piggybacks on NextAuth, Meta has no refresh helper, WooCommerce isn't OAuth) so the "refactor before GA" idea is wrong; (b) ship GA in the current pattern, but do a small `<ConnectionPill>`/`<ConnectionRow>` extract on `/clients` first (~200 lines of JSX dedupe, zero token-layer risk); (c) the ROADMAP's mention of Unified.to/Merge.dev was wrong — those are B2B SaaS aggregators (CRM/HRIS), not ad networks. Native integrations are right for the top 6-8 ad platforms; marketing-ETL aggregators (Supermetrics, Improvado) are wrong shape for LoraMer's live 15-min intelligence and don't fit the data-depth moat.

8. **LORAMER_DOCS_GA_DESIGN_V1** — filed `docs/GA_CONNECTOR_DESIGN_2026_05_29.md`. V1 scope locked: 7 query buckets (account totals, top sources, top campaigns, top landing pages, top conversion events, geo+device, e-commerce). One GA property per LoraMer client (matches existing pattern). New OAuth client (cleaner than reusing the Google Ads one). Six-phase build sequence laid out.

9. **Docs closeouts** — three commits flipping ROADMAP/HANDOFF checkboxes for each major ship per the docs-with-code discipline rule.

### On loramer-landing (brand new repo, separate Vercel project)

This is a NEW repo: `cote-media/loramer-landing` on GitHub. Separate Vercel project. Lives at a Vercel preview URL until loramer.com DNS points at it.

1. **Initial commit** — clean Next.js 14 single-page site. Tailwind config matches the dashboard's tokens (ink/paper/accent). Georgia (display) + Instrument Sans (body). Logo SVGs copied from dashboard. Three components: LogoMark (with breath animation), WaitlistForm, StickyCTA. One API route: `/api/waitlist` POSTs to Mailchimp via `PUT /lists/{audience_id}/members/{md5(email)}` (idempotent upsert).

2. **Bad commit + revert** — a `mv` command pulled the wrong page.tsx (it grabbed the dashboard's 3000-line page.tsx that had ended up in Downloads). Vercel build failed loudly. Reverted via `git revert HEAD`. Lesson: when copying files into a project that has a same-named file in another project, give the source a unique filename (we used `landing-page-v2.tsx` afterward). NEW lesson candidate, see Lesson 17 below.

3. **v2 ship** — center-aligned hero (was left), added "A real human, always" as the 4th differentiator, added Section 04 (Pricing with all 5 tiers split into "For business owners" and "For agencies" tracks). Solo renamed to **Business** at **$79/mo**. Updated section numbering throughout.

4. **Free tier fix** — Free tier was wrongly showing "Shopify connection only". All tiers get all integrations; AI usage caps (questions/month, workspaces, retention) are the actual price differentiator.

### Mailchimp setup
- Audience created: "LoraMer Waitlist" (ID: see Vercel env vars)
- API key: stored in Vercel as env var, NOT in repo
- Data center: us6
- Three env vars: MAILCHIMP_API_KEY, MAILCHIMP_AUDIENCE_ID, MAILCHIMP_DATA_CENTER
- ⚠️ TODO: Russ should rotate the Mailchimp API key soon (standard hygiene since the key was pasted in chat). Vercel env vars will need to be updated afterward.

### Cloudflare DNS
- loramer.com nameservers have been changed at GoDaddy to point at Cloudflare
- DNS propagation in flight as of ~3:30pm ET
- Cloudflare Email Routing not yet configured (waiting for nameserver propagation)
- Vercel DNS records not yet added to Cloudflare (waiting for same)

## What's NOT done yet

These were on the day's plan but didn't happen because the connector audit took priority + the landing page work consumed real time:

- ❌ GA Phase 1 — Google Cloud Console setup (Russ does this manually): enable Analytics Data API on existing project, create NEW OAuth client (NOT reusing Google Ads OAuth), get client_id/secret, add to Vercel env vars
- ❌ GA Phase 2-6 — none of the GA code has been written
- ❌ `<ConnectionPill>`/`<ConnectionRow>` extract — the small pre-GA UI dedupe from the audit
- ❌ loramer.com DNS pointed at Vercel — waiting for Cloudflare nameserver propagation
- ❌ Cloudflare Email Routing — hello@loramer.com → russ's Gmail
- ❌ ROADMAP fix for Unified.to/Merge.dev mention — audit caught this, hasn't been corrected yet
- ❌ Mailchimp API key rotation — flagged but not done

## NEW Lesson candidate from today

**Lesson 17 — Same-named files across projects + `mv` is a disaster waiting to happen.** When copying a file from chat downloads into a project, never download with the same filename as an existing file in another project that might be in Downloads from an earlier session. Always give downloads unique names (e.g. `landing-page-v2.tsx`) and `mv` them into final location with the rename. Today we shipped a broken Vercel deploy because `~/Downloads/page.tsx` already existed (from an earlier dashboard session) and `mv ~/Downloads/page.tsx ~/Downloads/loramer-landing/src/app/page.tsx` moved the WRONG one. Spotted by Vercel error log mentioning `recharts` and `next-auth/react` — modules that don't belong in a landing page. Recovery: `git revert HEAD && git push`, then re-export with a unique name.

This lesson should be added to LORAMER_HANDOFF.md when Russ has time tomorrow. Not in this docs ship.

## What Russ does between machines

**On iMac before walking away:**
- Confirm `git status` is clean on BOTH repos: `cotemedia-ads-manager` AND `loramer-landing`
- Confirm both are pushed (no "branch ahead of origin")
- Note: Mailchimp credentials are NOT in any local file. They're in Vercel env vars only.

**On Air after arriving:**
1. Open Cursor on the Air
2. Pull latest on the dashboard repo: `cd ~/Downloads/cotemedia-google-ads-manager && git pull origin main`
   - Note the path difference: iMac has `cotemedia-ads-manager`, laptop has `cotemedia-google-ads-manager`. Same repo, different folder name. Documented in HANDOFF.
3. Clone the landing page repo onto the laptop if it isn't there yet:
   ```
   cd ~/Downloads
   git clone https://github.com/cote-media/loramer-landing.git
   cd loramer-landing
   npm install
   ```
4. Same Vercel project for landing page, no setup needed, env vars already in Vercel
5. Read updated LORAMER_HANDOFF.md and this CONTINUE_HERE.md
6. Pick up the resume options below

## What to work on next (priority order)

The audit recommended this sequence, and that's still the right answer:

1. Cloudflare DNS finalization (~5 min, when propagation is done) — confirm nameservers active, add Vercel DNS records to point loramer.com at the loramer-landing Vercel project, configure Cloudflare Email Routing: hello@loramer.com → russ's Gmail, verify the landing page is live at loramer.com.
2. `<ConnectionPill>`/`<ConnectionRow>` extract on `/clients` page (~30 min). Per the audit: highest-value/lowest-risk pre-GA dedupe. Touches NO OAuth or tokens, deletes ~200 lines of JSX. Makes GA's Connect button essentially free when we ship Phase 3. Marker: `LORAMER_CONNECTION_COMPONENTS_V1`.
3. GA Phase 1 (Russ does Cloud Console manually first). Enable Analytics Data API on existing Cloud project. Create new OAuth client (NOT reusing Google Ads one — see GA design doc). Add three env vars to Vercel: GOOGLE_ANALYTICS_CLIENT_ID, GOOGLE_ANALYTICS_CLIENT_SECRET, GOOGLE_ANALYTICS_REDIRECT_URI. Run `ga_tokens` migration in Supabase (SQL in the design doc).
4. GA Phases 2-6 — sequential commits per the design doc.
5. ROADMAP correction — fix the Unified.to/Merge.dev mention in Project 6 architecture note; cite the audit's finding.

## Discipline reminders going into the Air session

- Lesson 16 (anchor discipline) — only use bytes from the user's CURRENT-turn paste
- Lesson 17 (proposed, this session) — unique filenames when moving downloads
- Right > fast — slow on the GA build, it's a real foundation
- `tsc --noEmit` is NOT `npm run build`; Vercel is the final check
- Comments NEVER on the same line as commas or closing tokens (Lesson 13)
- Surface raw API responses into Claude's prompt as diagnostic of last resort (Lesson 15)
- For Claude.ai (this chat): cannot read local repo. Ask for whole-file pastes. Use Claude Code for whole-repo audits.

Good day. Keep going.
