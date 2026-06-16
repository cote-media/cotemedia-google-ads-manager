# LoraMer — Product Roadmap
<!-- LORAMER_ROADMAP_REFRESH_V1 -->

*Last updated: June 5, 2026*

LoraMer is a business intelligence platform for marketing agencies and business owners. It pulls every signal a business produces (Shopify, Google Ads, Meta Ads, and more) into a unified intelligence layer, then lets Claude reason across all of it.

This roadmap is organized by **active project**. Items marked `[?]` are uncertain status — please confirm. Items in **Completed Archive** at the bottom are done.

---

## 🚀 PROJECT 1 — Production Launch (Shopify App Store) ✅ APPROVED & LIVE

**Status (May 26, 2026):** ✅ APPROVED & LIVE on the Shopify App Store (approved May 26, 2026).

### Submission readiness
- [x] Rebrand from Advar to LoraMer everywhere
- [x] Shopify expiring offline tokens migration
- [x] Shopify mandatory compliance webhooks (`customers/data_request`, `customers/redact`, `shop/redact`)
- [x] HMAC verification on webhooks
- [x] Custom Distribution disabled — using Public app track
- [x] `shopify app deploy` run (loramer-5 released May 25 with new application_url)
- [x] Shopify-initiated install flow (LORAMER_SHOPIFY_INSTALL_V1) — satisfies 2.3.1 + 2.3.2 + 2.3.3
- [x] REST → GraphQL Admin API migration (LORAMER_GRAPHQL_MIGRATION_V1) — satisfies 2.2.4

### App Store listing content
- [x] All listing copy submitted (intro, details, 3-5 features, subtitle, search terms, title, meta)
- [x] Integrations list submitted
- [x] Support email confirmed (`support@cotemedia.com`)
- [x] Privacy policy URL live (`/privacy`)
- [x] Feature media submitted (1600×900)
- [x] Desktop + mobile screenshots submitted with alt text
- [x] Screencast (Loom walkthrough) submitted
- [x] Test account credentials for reviewers (reviewer-token bypass via `/reviewer-login`)
- [x] Testing instructions submitted (explains in-app `+ Shopify` modal is post-install management, NOT an install path)

### v1 = Free-only
- [x] Listed Free plan only for initial approval
- [x] No billing code in v1 — Managed Pricing comes in v1.1 (Project 2)

### Review-requirements outcome (AI Toolkit re-run May 25)
- 27 ✅ passing
- 1 ❌ flagged but addressable in submission notes (2.3.1 false positive on the in-app modal — explained to reviewer)
- 3 ⚠️ needs review (1.1.1, 1.2.1, 2.2.3) — all N/A for non-embedded free-only app, addressed in submission notes
- 10 ⏭️ skipped (app extensions not used)

### LAUNCH BLOCKER → resolved: Zero-spend date range renders empty
- [x] Dashboard now renders with $0 / 0 across all tiles when Google account has zero spend
- [x] Fixed at UI layer: zeroed-shell render when intelligence returns empty platform data

### Post-submission watch items
- [ ] Confirm "Deprecated offline token" warning clears (rolling 30-day window)
- [ ] Address any Shopify reviewer feedback when it arrives
- [ ] Resubmit if revisions requested

---

## 💰 PROJECT 2 — Pricing & Billing (v1.1, after App Store approval)

Once approved, ship the paid tiers within 30 days.

### Final pricing structure (decided May 21, 2026)
| Tier | Price | Workspaces | AI Questions | Retention | Notes |
|------|-------|------------|--------------|-----------|-------|
| Free | $0 | 1 | 5/mo | 30 days | Shopify only — no Google/Meta |
| Solo | $49/mo | 1 | 100/mo | 12 months | All integrations |
| Agency | $199/mo | 10 | 500/mo | Unlimited | + WYWS digest, priority support |
| Scale | $999/mo | 50 | 2,500/mo | Unlimited | + agent automations, white-label, bulk export, SLA |
| Enterprise | Custom | 50+ | Custom | Custom | Contract billing outside Shopify |

### Implementation
> **Superseded by Stripe — see STRIPE_BILLING_PLAN.md.** Phases 0–3 DONE in TEST mode (entitlements table, customer + webhook sync, `/billing` Checkout for free→paid). Phase 4 = Stripe Customer Portal (plan switch/downgrade/cancel) is NEXT.
- [ ] **Enable Google Pay in Stripe payment-method settings** (Stripe Dashboard → Settings → Payments) so hosted Checkout offers it. (Stripe Phase 3 follow-up, 2026-06-09.)
- [ ] Implement Shopify Managed Pricing for Solo, Agency, Scale tiers
- [ ] Plan-change UX (upgrade/downgrade flow)
- [ ] Enforce workspace limit per tier (soft enforcement — alert at limit, hard block at limit + 2)
- [ ] Enforce AI question cap per tier with monthly reset
- [ ] Enforce data retention policy per tier (background job to delete old data)
- [ ] "Bring 3 clients, get Agency for $99 first 3 months" intro offer
- [ ] Annual prepay 20% discount toggle
- [ ] Founding-50 / Founding-25 discount codes (off-public, outreach only)

### Track usage before locking caps
- [ ] Add Anthropic API spend tracking per user (cost per AI question logged)
- [ ] After 2 weeks of real usage, tune AI question caps to actual usage patterns
- [ ] Add cost-per-customer dashboard for Russ to monitor margin

### Conversation export (ships before Scale tier — feature gate by tier)
- [ ] "Download as PDF" button on every conversation (Solo/Agency/Scale)
- [ ] "Download as Markdown" button on every conversation
- [ ] "Email me this conversation" button (Solo/Agency/Scale)
- [ ] Bulk export — all conversations as zip (Scale only)
- [ ] Scheduled weekly email digest of new conversations (Scale only)

---

## 🧠 PROJECT 3 — Intelligence Layer Depth

**Status (May 26, 2026):** Design doc filed at `docs/PROJECT_3_DESIGN.md`. Execution started.

**North star:** answer "what combination of campaign × ad group × keyword × audience × asset × geo × demo drove this conversion?" — the question every operator asks that no platform answers cleanly.

**Tier-aware caching (locked decision):**
- Free: 4-hour cache minimum (Shopify-only tier; users upgrade for fresher data)
- Solo: 1-hour cache
- Agency: 15-min hot data, 1-hour cold data
- Scale: 5-min hot data, 15-min cold data
- Enterprise: tunable per contract

Architecture passes tier into cache layer; same code path, different TTL values. While Project 2 (tiered pricing) hasn't shipped, the architecture defaults to current "15 min hot, 1 hour cold" — when Project 2 ships, dynamic tier lookup slots in cleanly.

**Cross-link:** future user-customizable UI tables (pick what's always-visible vs. ask-Claude-for-it at higher tiers) tracked in **Project 18 — Customizable Dashboards**. Not in scope for Project 3 itself.

---

The actual moat. Everything that makes Claude's answers better and harder to copy.

### Project 3 Step 2 status (shipped May 26, 2026)

Steps 2a–2f shipped end-to-end: search terms (2a), conversion attribution (2b), audience segments (2c), demographics (2d), RSA asset-level (2e), PMax asset groups (2f). Note: 2c and 2d never had granular checkboxes in the list below — they shipped as part of the broader intelligence work. **Step 2g shipped (May 28, 2026):** PMax top asset combinations now surface via `asset_group_top_combination_view` (Google's Combinations report), joined to readable asset text. Validator-confirmed that per-asset BEST/GOOD/LOW labels are NOT API-selectable in v23 (UI-only) — so combinations, not labels, are the asset-level performance signal. Dead `performance_label` read and the prompt scaffolding that implied labels existed were removed. (LORAMER_ROADMAP_STEP2G_V1)

### Already shipping
- [x] **Shopify abandoned checkouts (May 29, 2026 — LORAMER_SHOPIFY_ABANDONED_CHECKOUTS_V1):** Phase 2.1 from the LTV design doc. Adds `abandonedCheckoutCount` (count only, no rate) to IntelligenceShopify via a separate fail-soft helper with its own try/catch. PII-free: query requests `id` only. Fail-soft on missing `manage_abandoned_checkouts` permission — undefined skips the prompt line entirely so Claude isn't shown a misleading zero. Verified live: 16 abandoned in the test client's window correctly surfaced.
- [x] **Shopify deeper signals (May 29, 2026 — LORAMER_SHOPIFY_DEEPER_SIGNALS_V1):** Six new derived metrics surfaced to Claude, all computable from the existing GraphQL response — no new API calls. Fields: refundedOrderCount, refundRate, returningRate, newCustomerAov, returningCustomerAov, revenueConcentration (% of revenue from top 10% of orders by value). Verified in production: Claude correctly quoted refund rate (0% on a tested client), returning customer AOV ($9,745.94), and revenue concentration (61.5%) verbatim from context. Phase 2 (true LTV, abandoned cart, cohort retention) requires additional API calls — design doc filed at `docs/SHOPIFY_LTV_DESIGN_2026_05_29.md`.
- [x] **Shopify net sales revenue (June 2, 2026 — LORAMER_SHOPIFY_NET_SALES_V1):** Headline Shopify revenue switched from gross order totals to **net sales** — uses `currentSubtotalPriceSet` (after refunds, excludes shipping/tax) and surfaces `refundedAmount`. Old code summed gross original totals including refunded/cancelled orders, producing phantom revenue. Verified: Escential May = $45.00, matching Shopify Analytics Net sales.
- [x] **Canonical date windows (June 2, 2026 — LORAMER_DATE_RANGE_CANONICAL_V1):** New `src/lib/date-range.ts` is the single source of truth. LAST_MONTH = previous calendar month; rolling 7/14/30/90 = complete days ending yesterday; THIS_MONTH = 1st-of-month through today. Wired into Shopify/GA/Woo intelligence + `/api/shopify/daily` + `/api/woocommerce/daily` + `/api/intelligence`. Fixed the old "LAST_MONTH = 60 days" bug. Meta LAST_90_DAYS preset mapped to `last_90d`.
- [x] **GA4 connector V1 (June 2, 2026 — LORAMER_GA_OAUTH_V1 through LORAMER_GA_OVERVIEW_COMBINED_V1):** Full end-to-end GA connector shipped. OAuth (`/api/ga/start`, `/api/ga/callback`), property picker (`/api/ga/properties`, `/api/ga/connect`), intelligence adapter (`ga-intelligence.ts`, 7 query buckets), Claude context render + GA-vs-Shopify reconciliation, Analytics dashboard tab, sessions chart, property-name cleanup, Day/Week/Month chart granularity, compact GA on Overview + Combined. **Phase 6 disconnect still pending** (`/api/ga/disconnect` + UI button).
- [x] **Intelligence honesty (May 29, 2026 — LORAMER_INTELLIGENCE_HONESTY_V1):** Connected-but-empty platforms now emit an honest empty-state line ("Meta is connected but had no spend in this date range") instead of vanishing. Completeness header replaced with a dynamic per-turn line listing each platform as populated / connected-but-empty / not-connected. Removes the prompt-as-mirror hallucination class (Lesson 11). Diagnosed via the May 29 architecture audit (`docs/INTELLIGENCE_ARCHITECTURE_AUDIT_2026_05_29.md`). Also removed leftover RAW_DEBUG instrumentation from meta-intelligence.ts (Lesson 15 cleanup).
- [x] Universal Intelligence Layer architecture (`build-claude-context.ts`)
- [x] `/api/intelligence` master endpoint
- [x] 15-min cache per client+dateRange
- [x] Claude insight banner (50-word max, cached 1hr)
- [x] Persistent Claude sidebar / RightPanel
- [x] Floating Claude Assistant
- [x] Panel clears on client switch (each client has isolated brain)
- [x] HARD CONSTRAINTS block at top of prompt — directives override default analysis
- [x] Cross-panel conversation memory (no more per-panel silos)
- [x] Heuristic directive extraction from chat history
- [x] Active alerts injected into Claude's context so Reply works with alert references

### Deeper data for Claude context
- [x] Google search term report — what queries are triggering ads (shipped — Step 2a)
- [ ] Google auction insights — impression share, overlap rate, outranking share
- [x] Google asset-level performance — individual RSA headlines/descriptions (shipped — Step 2e)
- [ ] Google bid strategy — fetch `bidding_strategy_type`
- [x] Google conversion action breakdown — `/api/google/conversions` route (shipped — Step 2b)
- [ ] Meta placement breakdown — `publisher_platform` via Insights API breakdown
- [ ] Meta audience targeting — lookalike/interest/retargeting from ad set targeting spec
- [ ] Meta bid strategy — fetch `bid_strategy` field
- [ ] Meta conversion event names/types
- [ ] Ad creative details — type (image/video/carousel), headline, description per ad
- [ ] Device breakdown — mobile vs desktop vs tablet
- [ ] Geographic performance — top locations by spend/conversions
- [ ] Historical trend — week-over-week / month-over-month deltas
- [ ] All of above injected into AskClaudeButton rowContext

### Web search for Claude
- [ ] Enable Claude web search during analysis (competitor pricing, industry benchmarks)
- [ ] Phase 1: on-demand (user explicitly asks for market context)
- [ ] Phase 2: Claude auto-triggers when it detects a gap in its analysis
- [ ] Use cases: competitor CPC benchmarks, industry ROAS by vertical, seasonal trends

### Pre-built prompt library & digest
- [ ] Curated prompts grouped by role (business owner / agency) and platform
- [ ] "While You Were Sleeping" digest — scheduled job (Agency+ tier)
- [ ] Anomaly detection with plain English alerts (rebuilt as part of Project 12)

### Multi-KPI selection
- [ ] Allow multiple KPIs per client (e.g. Purchases AND Leads)
- [ ] Change `client_context.primary_kpi` to JSONB array
- [ ] Update insight prompts to reference all selected KPIs
- [ ] UI: checkbox group instead of single select

### LORA INTELLIGENCE — Growth Blueprint + Daily Alerts (two scopes of ONE engine)
Two reads of the same complete-context engine: one on-demand deep document (R1) and one recurring lightweight pulse (R2). Both fan specialized analysis across every data grain + user context, and both live or die by the same disciplines: split "grounded in your data" vs "needs inputs you haven't supplied," and carry provenance per item. (The Lora brain is `src/lib/intelligence/`; per-client memory + `query_metrics`/`query_breakdown` give the historical reach — see LORAMER_CODEBASE_MAP.md.)

- [ ] **[R1] "BOMB" / GROWTH BLUEPRINT** — codename "bomb"; **NEEDS A REAL PRODUCT NAME.** On-demand, full-throttle growth document: one command → Lora ingests the COMPLETE data garden (every platform grain + historical trends) + user context/industry → a structured, exportable strategy doc. Likely a **Mer** artifact (the client deep-dive surface).
  - Sections: exec summary · revenue levers · pricing · website/CRO · retention · remarketing · cost & margin · prioritized action list (each item with expected impact + provenance).
  - **Make-or-break dependency:** the cost/margin/pricing/offline sections need business context Lora can't see (COGS, margins, goals). The doc MUST split "grounded in your data" vs "needs inputs you haven't supplied," and prompt for the missing pieces to unlock those sections. NEVER invent a margin (extends the prompt-honesty doctrine, Lesson 11).
  - **Mechanism (NOT fine-tuning):** one large structured prompt over the complete context at high/max effort; a natural fit for SUBAGENTS fanned per domain (ad data · sales · product/pricing · website/CRO · retention · logistics/margin) composed by a lead agent. Positioning = "a team of specialized analysts, not one chatbot." Use "specialized," NOT "tuned," unless/until a per-industry/per-domain skills/knowledge library backs a real knowledge-tuning claim.
  - **Pricing:** tier-gated — 1/month on a low tier → unlimited on high; "unlimited" needs a quiet fair-use cap; caps config-driven per tier via entitlement gating (Stripe Phase 5, deferred — founding cohort = beta_unlimited bypasses).
- [ ] **[R2] DAILY ALERT LAYER** — scope + quality + cadence (IMPROVE the existing layer, not greenfield).
  - **Step 0 = read-only audit** of what exists today (the InsightChat "Lora Analysis" banner + `anomaly-filter.ts` + the "While You Were Sleeping"/digest items above) before deciding build-vs-improve.
  - Timing: overnight events fire AFTER the nightly cron completes — the **cron_runs completion sentinel** (WS1b-1, shipped 2026-06-16) signals a clean run; a failed connection (the **connection-health** engine) is itself alert-worthy.
  - Quality bar: prioritized (no alert fatigue) · actionable · anomaly-aware · provenance per item.
  - Toggles: short-version switch + cadence (daily / weekly / 2-week / monthly), with content ADAPTING per cadence (a monthly pulse ≠ 30 dailies stacked).
  - Open: delivery channel (in-app / email / push). Shares infra with R1 (same engine, lighter read).

---

## ⚡ PROJECT 4 — Execution Layer

The eventual product wedge: Claude doesn't just recommend, it acts. Big project, ship piece by piece.

### Keyword actions
- [ ] Pause/enable keywords (one-click toggle on keyword table)
- [ ] Adjust keyword bids
- [ ] Add negative keywords
- [ ] Delete keywords

### Campaign actions
- [ ] Pause/enable campaigns
- [ ] Adjust daily budgets
- [ ] Change bidding strategy

### "Claude Recommends" workflow
- [ ] Claude surfaces specific action list after analysis
- [ ] User reviews with checkboxes (approve/skip each)
- [ ] Single "Execute Selected" button pushes all approved changes
- [ ] Confirmation summary of what changed

**Philosophy:** every Claude recommendation should eventually be executable from inside LoraMer. "Here's what's wrong" → "Want me to fix it?" is a fundamentally different product.

---

## 🎨 PROJECT 5 — UX & Polish

### Just finished
- [x] Font fix — Instrument Sans across all form elements and `font-mono` utilities
- [x] Left sidebar navigation (Meta/Google style)
- [x] Client selector in sidebar
- [x] Column picker per table (Core/E-commerce/Meta Only/Google Only categories)
- [x] Mobile responsive base layout
- [x] Dashboard error boundary catches client-side crashes
- [x] Unified attention surface (alerts + Claude analysis in one card — Project 11 v1)
- [x] Paused-with-spend threshold raised to $500 (was $0, too noisy)

### Open items
- [ ] **Meta Ad Accounts connect modal — search + default sort (LORAMER_ROADMAP_META_PICKER_SORT_V1):** The 'Connect Meta Ad Accounts' selection modal lists every ad account the user can access with no ordering — unusable at 100+ accounts (agency case). Add (1) default alphabetical sort by account name, (2) a search/filter input at top matching name or act_ id. Contained front-end change in the account-selection modal; reuse the same pattern for Google/GA pickers if they share the issue. Pre-launch UX win — agency founding-cohort users hit this immediately.
- [ ] **Smart coachmark/tip system + in-dashboard glossary/knowledge base (LORAMER_ROADMAP_TIPS_GLOSSARY_V1):** Quick Tip popups are live but must become a managed system — SMART (context/frequency-aware; never re-show a dismissed tip; right tip per surface), REMOVABLE (dismiss/Got it — exists), RETRIEVABLE (a persistent '?'/Help or Tips affordance to bring tips back after dismissal). PLUS a glossary/knowledge-base surface inside the dashboard explaining metrics & terms (net sales, ROAS vs CPA, impression share, etc.). Consolidates and supersedes the scattered items it cross-references. One coherent help/onboarding system. **Stripe Phase 3 follow-ups (2026-06-09):** (a) first-run guidance for a brand-new user landing on an EMPTY dashboard (no platforms connected yet) — they currently hit a bare dashboard with no direction; (b) welcome-copy truth pass — the /welcome screen claims "Your Google Ads accounts are connecting now" / "Google Ads connected via your MCC" for fresh users who have connected nothing; make the copy honest about actual connection state. Fold both into this onboarding system. (c) Path-chooser continuity (2026-06-09): the Agency/Business chooser at sign-in works, but the chosen path DIES after /welcome — "Let's go" dumps the user on the bare "Add Client Manually" page with no continuation. Post-welcome must land on a guided connect-your-first-platform step that matches the chosen path (Business → connect store / ad accounts; Agency → connect MCC + bulk-select clients). This is the entry point of the "start with your strength" flow. **(d) PRIORITY BUMP — first-login progressive onboarding (2026-06-10, surfaced by demo onboarding):** on first sign-in, DETECT the ad accounts accessible to the signed-in Google identity (and other connected platforms) and offer a bulk-import / "select your accounts" step INSTEAD of dumping the user on the empty "Add Client Manually" state. The bones exist (the /clients "Set Up Clients" Google mapper) but it's buried below the grid and Google-only; promote it to a first-class first-run step and extend to bulk selection from the chosen platform's hierarchy. **(e) "Set Up Clients" mapper needs PER-ROW selection (2026-06-10):** today it's one all-or-nothing "Save Clients" button — agencies must be able to EXCLUDE specific accounts (a per-row checkbox / deselect), not import every accessible account. INTERIM WORKAROUND (works today, for onboarding calls): blanking a row's Client Name field SKIPS that row (`if (clientName.trim())` guard in saveAllMappings) — no client/connection is created for it, and it does NOT fail. Folds into this progressive-onboarding workstream.
- [ ] **Site-wide info tooltips (LORAMER_ROADMAP_INFO_TOOLTIPS_V1):** Cross-cutting UX — add ("i") explainers across the app wherever metrics or terms may confuse users. Examples: "Net sales = product revenue after refunds, excl shipping & tax"; ROAS vs CPA; impression share decomposition. Not one screen — many surfaces, one consistent tooltip pattern. → Consolidated into LORAMER_ROADMAP_TIPS_GLOSSARY_V1 (above).
- [ ] Better loading states (skeletons instead of "Loading...")
- [x] **Coming-soon landing page at loramer.com LIVE (May 29, 2026 — LORAMER_LANDING_V1+V2+V3):** Separate repo `cote-media/loramer-landing`, separate Vercel project. Live at https://loramer.com (apex, no www redirect). DNS via Cloudflare (propagated, nameservers active), SSL provisioned by Vercel + Let's Encrypt, Cloudflare SSL mode Full. Next.js 14 single-page: center hero with phrase-by-phrase reveal, 5 differentiators (including "A real human, always" and "Knows what only you know" — uploads), pricing section with 5 tiers across two tracks (Free / Business $79 / Agency $199 / Scale $999 / Enterprise), brand-aligned /privacy and /terms pages covering waitlist + Mailchimp + app data + Shopify merchant data + GDPR/CCPA/CAN-SPAM. Mailchimp waitlist end-to-end working with double opt-in. REMAINING: Cloudflare Email Routing for hello@loramer.com; rotate Mailchimp API key; eventual launch consolidation (see docs/LAUNCH_CONSOLIDATION_DESIGN_2026_05_29.md).
- [x] **Ask Claude scroll-on-refresh (LORAMER_ROADMAP_ASKCLAUDE_SCROLL_V1) — SHIPPED May 29, 2026:** ChatTab was missing the scroll ref + effect that RightPanel already had. Added `chatScrollRef` + `useLayoutEffect` that instant-scrolls to bottom on mount (refresh case) and smooth-scrolls on new messages. Verified in production.
- [ ] **Client-switch data refresh (LORAMER_ROADMAP_CLIENT_SWITCH_REFRESH_V1):** When switching clients via the left sidebar nav, full client data doesn't appear to refresh consistently. Some panels/sections may show stale data from the previous client or partial data. Audit the client-switch flow — dashboard state, intelligence cache lookup, Claude context — to ensure full refresh on every client change.
- [ ] **User-defined dashboard cards for Tier 2 signals (LORAMER_ROADMAP_DASHBOARD_CARDS_ONDEMAND_V1):** Step 3 Tier 2 intelligence (Geographic, Device, Hour-of-day, Impression Share, Recommendations, Meta Placements) is currently Claude-context only — no UI surfaces. Users should be able to optionally display any of these metrics as dashboard cards on-demand, configured per their preferences. Aligns with the user-defined dashboard concept (similar to how Shopify panels work). Each Tier 2 signal already has a clean typed shape in PlatformIntelligence — straightforward to surface.
- [ ] Better empty states
- [ ] Metric cards redesign on Overview tab
- [ ] Visual refresh of dashboard interior
- [ ] **Explicit "Open client profile" affordance** (LORAMER_ROADMAP_OPEN_PROFILE_V1) — currently the Claude pill on a client card is the only way to expand the profile section (which now also contains the memory editor). Not discoverable for new users, especially Shopify-install users landing cold. Need a clear button or "Edit profile / Memory" link adjacent to each client. Maybe also a tour or coachmark on first visit that points to it.
- [x] **Platform-nav fix (June 2, 2026 — LORAMER_PLATFORM_NAV_FIX_V1):** Clicking Google/Meta/Combined while on a non-ad tab (e.g. Shopify, Analytics) now switches to Overview. Previously platform buttons felt dead because platform selector and tab nav were separate controls — changing platform never changed the active tab.

### State persistence
- [x] Active platform persists
- [x] Active tab persists
- [x] Date range persists
- [x] Drill state persists per client
- [ ] Chart metric selection (Spend/Clicks/Impressions/Conversions) persists
- [ ] Chart granularity (Day/Week/Month) persists
- [ ] Ad group chart visible lines persist
- [ ] Ad bar chart metric selection persists
- [ ] Sort column and direction persists per table per platform
- [ ] All state restored from localStorage on mount, cleared only on explicit user action

### Chart-table column sync
- [ ] Column added in table → metric automatically available as chart line
- [ ] Platform-aware (Meta-only columns only on Meta view)
- [ ] Applies to all levels: campaigns, ad groups, ads

### Known bugs
- [ ] Combined mode drill-down — clicking campaign rows does nothing; should drill using campaign's own platform
- [ ] Window focus auto-refresh — refetches every tab return; disable Next.js focus revalidation

### Demo mode
- [ ] `/demo` route with realistic fake client data — no login required
- [ ] Static JSON demo data file with fictional but realistic campaigns
- [ ] Shareable URL for sales/demos
- [ ] "Sign up" banner at top

### Explainer page
- [ ] Replace "← Cote Media Ads Manager" back nav with cleaner "← Back" or logo
- [ ] Testimonial section (populate post-beta)
- [ ] Pricing teaser

---

## 🔌 PROJECT 6 — Platform Expansion

Order of priority for additional integrations beyond Google/Meta/Shopify.

### Ad platforms
1. Microsoft/Bing Ads
2. TikTok Ads
3. Amazon Ads
4. LinkedIn Ads
5. X/Twitter Ads
6. Pinterest Ads
7. Snapchat Ads
8. Reddit Ads

**Architecture note:** Strongly consider Unified Advertising API (Unified.to or similar) to scale to 8+ platforms without rebuilding each one. Each platform's OAuth + data normalization is 1-2 weeks; aggregator route gets all 8 in 1-2 weeks total.

### E-commerce / store platforms
- [x] Shopify (v1 shipped)
- [ ] WooCommerce
- [ ] Data points to pull (when adding): revenue by product, AOV, abandoned cart rate, checkout rate, return rate, inventory

### Other systems
- [ ] Klaviyo (email marketing)
- [x] **Google Analytics 4 (June 2, 2026 — GA connector V1):** OAuth, property picker, intelligence adapter, Claude context, Analytics tab + chart + granularity, Overview/Combined surfaces. See Project 3 "Already shipping" for commit markers. **Remaining:** Phase 6 disconnect route + UI button.
- [ ] Stripe (payment data for non-Shopify clients)

---

## 🏢 PROJECT 7 — Agency-Specific Features

Features that justify the Agency tier and above.

- [ ] **Agency client-list management (LORAMER_ROADMAP_CLIENT_LIST_MGMT_V1):** Sort and filter the `/clients` list; drag-and-drop client cards into a custom order the operator prefers. Fits Project 18 customizable-dashboard philosophy applied to the client roster. Agency-tier UX that compounds with warm-start onboarding (see Project 9 / warm-start brain item below).
- [ ] Cross-client insights — "3 of your clients have low Quality Scores"
- [ ] Agency benchmark view — compare client performance against each other
- [ ] Best practice sharing — "Client A's audience strategy is working well, apply to Client B?"
- [ ] White label option (Scale tier)
- [ ] Team member access (Scale tier)
- [ ] Custom domain support (Scale/Enterprise)
- [ ] Client portal — read-only view for end clients (Scale tier)
- [ ] Agent automations — scheduled recurring analysis (Scale tier)

---

## 🏗 PROJECT 8 — Tech Debt & Operational

- [x] **Supabase backups (logged May 22) — DONE 2026-06-08, option (c) both.** (a) Supabase Pro tier: daily automated backups with 7-day retention. (b) Off-site: nightly GitHub Action (`.github/workflows/db-backup.yml`) `pg_dump` of the DB via the session pooler → Cloudflare R2 bucket `loramer-db-backups`, 30-day prune, fail-loud. The "no backups before paying customers" gap is fully closed (in-platform + off-site).
- [ ] **Finish advar → loramer localStorage prefix rebrand (logged May 22)** — codebase has 51 references to keys like `advar-active-tab`, `advar-active-client`, `advar-drill-state`, etc. These work fine but are inconsistent with the LoraMer brand and confused at least one fix session tonight (a WooCommerce pill fix wrote to `loramer-active-tab` and nothing happened because the app reads `advar-active-tab`). Proper fix: rename all 51 keys to `loramer-` in code, AND add a one-time migration on first load that copies any existing `advar-` value to its `loramer-` counterpart so existing users don't lose state. Single contained sprint, ~1 hour of careful work. Roadmap before any other major refactor touches storage.
- [ ] **Admin page for user management (logged May 22)** — currently the only way to add a beta tester, change a user's tier, or see who is in the system is via Supabase SQL. Build a simple `/admin` route (gated to Russ's email or a super_admin tier) that lists every user, their tier, signup date, last login, and spend-to-date. Allow tier changes, beta_unlimited toggle, and a one-click "invite new tester" flow that adds their email. Foundation for everything from manual support to the eventual "talk to a human" workflow.
- [ ] **Refresh connection UX (found May 22):** one-click "Refresh connection" buttoatform for when tokens expire, OAuth scopes change, MCC permissions are revoked, or Meta Business Manager access changes. Today the only path is disconnect + reconnect. Surface in client profile expansion. Should re-trigger OAuth without losing client_context or analysis history.
- [ ] Upgrade Next.js 14.2.3 (security vulnerability)
- [ ] Fix npm deprecation warnings
- [ ] Add error boundaries with user-friendly error messages
- [ ] Rate limiting on API routes
- [ ] Apply for Google Ads Standard API access (currently on Basic)
- [ ] Anthropic API spend monitoring dashboard
- [ ] Webhook retry queue for compliance webhooks (if Supabase write fails)
- [ ] Revisit `forceRefresh=true` on insight intelligence fetch — currently disables server-side cache, ups Anthropic cost
- [ ] Unify the three caches (localStorage insight 1hr, drill-state, server intelligence 15min) under one invalidation strategy
- [ ] Request deduplication on `/api/intelligence` — fast tab switching fires multiple parallel calls
- [ ] Tier-gate or batch the `extractProfileContext` Claude call (currently runs per chat exchange, expensive at scale)
- [ ] **Google date-path consolidation (June 2, 2026 — LORAMER_ROADMAP_GOOGLE_DATE_CANONICAL_V1):** Route ALL Google date paths through `resolveDateWindow` from `src/lib/date-range.ts`. Remove dead duplicated `LAST_90_DAYS` blocks in `src/lib/platforms/google.ts` and `src/app/api/google/adgroups/daily/route.ts`. Migrate `platform/route.ts` and `google-intelligence.ts` `buildDateFilter` to the canonical resolver so every Google path shares one date source. Partial fix shipped today (`getDailyMetrics` in `google-ads.ts` — LORAMER_GOOGLE_DAILY_90DAY_FIX_V1); remainder is cleanup to prevent the next date drift bug.
- [ ] **AUDIT FIND (May 29, 2026 — intelligence audit):** Stale intelligence cache can serve empty Meta payload (LORAMER_ROADMAP_STALE_INTEL_CACHE_V1). After LORAMER_INTELLIGENCE_HONESTY_V1 shipped, an Ask Claude test on Vet Mastermind / last 7 days returned "Meta: connected but no spend in this date range" on the first answer despite Meta having real spend in that window. Subsequent answers correctly said "Meta: populated." Self-healing implies either (a) the 15-min `client_context.intelligence_cache` row served a prior empty-Meta payload, or (b) the Meta fetch silently returned campaigns:[] from a transient failure. The new honest-empty branch is correctly reflecting whatever is in the cache — the bug is upstream. Fix path depends on which: H1 → invalidate cache on dateRange change OR include cache hash in response so the surface can detect stale-empty; H2 → instrument the Meta `.catch` blocks so transient failures don't poison the cache. Need to capture state at the moment it happens to know which.
- [ ] **AUDIT FIND (May 29, 2026 — intelligence audit):** Dead `platformData` payload in /api/chat (LORAMER_ROADMAP_DEAD_PLATFORMDATA_V1). dashboard `sendChat()` sends `platformData` in the request body (page.tsx ~line 2848) but `/api/chat` ignores it and re-fetches intelligence server-side. Wasted bandwidth on every chat call. Trivial cleanup: drop the field from the client-side body.
- [ ] **AUDIT FIND (May 29, 2026 — intelligence audit):** Meta spend>0 filter is invisible and surprising (LORAMER_ROADMAP_META_SPEND_FILTER_V1). meta-intelligence.ts filters campaigns / ad sets / ads on `spend > 0` (lines 94, 125, 168). Meaning: ad-set structure (targeting, names, optimization goals) vanishes whenever an account is quiet in the chosen date window, even though that data is static and doesn't depend on spend. For "what's my targeting?" questions this is actively wrong. Consider fetching ad-set STRUCTURE (no spend filter, no insights) alongside the insights query, so targeting questions work even in a quiet window. Performance metrics still come from the spend>0 filtered insights — they're separate concerns now conflated into one fetch.
- [ ] **AUDIT FIND:** `layout.tsx` has hardcoded `fontFamily: Georgia` inline style on `<body>` that overrides globals.css — this is the root cause of every font fight. Fix: remove inline style entirely.
- [ ] **AUDIT FIND:** `dashboard/page.tsx` line ~1212 — insight useEffect deps don't include `userNotes`, causing race where directive may not be respected on first load
- [ ] **AUDIT FIND:** Landing page (`app/page.tsx`) copy still says "ads, reimagined" / "Google Ads management" — outdated vs BI repositioning
- [ ] **AUDIT FIND:** Landing page nav had duplicate "LoraMer" text (now fixed but worth a styling pass)
- [ ] Architectural audit pass: re-read all `/api/*` routes for similar copy-paste/inheritance issues

---

## 🧠 PROJECT 9 — Persistent Memory & Learning

The biggest single moat. The reason Scale-tier customers don't churn after month 6.

**Core insight:** any competitor can copy the dashboard in a quarter. They can copy persistent memory in 2 weeks. They cannot copy 6 months of accumulated learning per customer. By the time competitors are feature-matched, Scale customers have a Claude that understands their specific accounts better than any AI on the market.

**Memory vs. Learning — the distinction matters.**

- **Memory** is lookup: "the user said X 3 weeks ago, recall it now." Phase 1/1.5 already built this.
- **Learning** is something different. Claude forms hypotheses from observation, updates them over time, notices recurring patterns, distinguishes signal from noise, builds a model of *the user* — not just the data.

The "model of the user" piece is what nobody else is doing. Triple Whale shows data. Northbeam shows attribution. LoraMer's Scale tier can be the first BI tool that learns *how the operator thinks about their business*.

### Architecture (full Scale-tier vision)

**1. `client_memory` table — Supabase.**
- Facts the user told us (explicit): "Ignore ROAS," "Target CPL is $35," "Brand is our hero"
- Patterns Claude observed: "User asks about Brand 3x more than other questions"
- Hypotheses with confidence scores: "Brand drives lower CPL than Generic (confidence: 0.85, observed 6 weeks)"
- Dismissed insights: "Don't surface 'high CPM' as an issue for this client"

**2. Nightly learning loop — background agent.**
Per client, runs once daily. Reviews the day's data + user interactions. Updates `client_memory`. Outputs a "Daily Learning Log."

**3. Memory injection — prompt layer.**
Every Claude call reads from `client_memory`. Replaces the heuristic directive extraction with structured, scored facts.

**4. Memory editing UI — `/dashboard/[client]/memory`.**
User can edit facts, delete things Claude got wrong, promote to "always cite," see hypotheses + confidence scores. Critical for trust.

**5. `user_preferences` table — operator-level personalization.**
Separate from per-client memory.

### Tier mechanics

| Tier | Memory model |
|------|--------------|
| **Free** | Session-only |
| **Solo** | Persistent per-client memory, 50 facts max, no learning loop |
| **Agency** | Persistent memory + dismissed-insights tracking. 500 facts/client. No nightly learning loop |
| **Scale** | Full system: unlimited memory, nightly learning loop, hypotheses, daily learning logs, memory editing UI |

**Memory Credits:** Solo/Agency users who hit caps can buy credit packs. Anthropic-style metering.

### Warm-start "agency brain" (LORAMER_ROADMAP_WARM_START_BRAIN_V1 — to be scoped)

A Claude experience pre-loaded with the agency's clients + uploaded docs so new users hit the ground running, not cold. Mechanism = **persistent memory + document RAG + bulk onboarding** — NOT literal model fine-tuning. Extends Project 9 (Memory/Learning), Project 10 (Data Ingestion), and Project 16 (operator knowledge). Scope TBD; file here so it doesn't get lost between sessions.

- [ ] **"Website" field on the Mer client profile (2026-06-10):** add a Website URL to the client profile; LoraMer scans/ingests the site so Lora learns the business — offerings, pricing, positioning, seasonality, voice. Feeds the warm-start context system and PAIRS with the Industry selector + Additional Context box (the three together seed Lora's understanding of a new client). Like the rest of warm-start, ingested website content must carry PROVENANCE and be HUMAN-REVIEWABLE — surfaced as reviewable context, never silently injected as fact (same discipline as Lesson 11 prompt-as-mirror + the per-industry reference libraries item). Extends Project 9 / Project 10.

### Phased rollout

- **Phase 1** ✅ Per-conversation directive extraction (shipped May 21)
- **Phase 1.5** ✅ HARD CONSTRAINTS block at top of prompt (shipped May 21)
- **Phase 2** ✅ SHIPPED (May 26, 2026) — structured `client_memory` table with explicit facts. User can write/edit in UI. NO learning loop yet — manually curated memory. Shipped with App Store launch.
- **Phase 3 — post-launch (~6 weeks out):** dismissed-insights tracking + basic pattern observation
- **Phase 4 — after first paying Scale customer:** full nightly learning loop with daily learning logs

### Phase 2.1 — Memory editor UX evolution (LORAMER_ROADMAP_MEMORY_UX_V1)

As fact count grows, the inline list will get unwieldy. Real concern flagged after Phase 2 shipped (May 26) — at 5 facts the editor is fine, at 50 it's a wall of text, at 200 unusable.

Incremental fixes:
- [ ] Collapsible category groups (collapsed by default with count badge — user expands what they need)
- [ ] Search/filter input at the top of the memory section
- [ ] Sort options: pinned first → most recently referenced → most recent → oldest
- [ ] Quick "pin all" / "archive all" bulk actions on category headers
- [ ] Visual indicator when a fact was last referenced by Claude (so users see what's active vs. dormant)
- [x] Inline blurb under each group header explaining what the category means (LORAMER_MEMORY_CATEGORY_BLURB_V1 — shipped May 26)
- [ ] **Glossary/help popover** for memory categories (LORAMER_ROADMAP_MEMORY_GLOSSARY_V1) — "?" icon next to section title opens a popover with full definitions and examples for Directive / Fact / Context / Preference / Observation. Goes beyond the one-line blurbs to give new users a real reference. Connects to onboarding/tour system when one exists. → Consolidated into LORAMER_ROADMAP_TIPS_GLOSSARY_V1 (Project 5).

Bigger evolution (likely Phase 2.5+):
- [ ] **Merge similar facts** — when user adds "Ignore ROAS" and Claude observes "Don't focus on ROAS", offer to consolidate
- [ ] **Decay / auto-archive stale facts** — if Claude hasn't referenced a fact in N months, suggest archiving with one click
- [ ] **Sub-grouping within categories** — facts about budget vs. targeting vs. creative auto-cluster
- [ ] **Dedicated `/memory` route per client** for power users with 100+ facts (alternative to inline UI; profile keeps the most pinned/recent)

Tier-gating opportunity: bulk operations + sub-grouping might be Agency-tier features (since they only matter at scale).

### Phase 2.3 — Environmental Change Detection (LORAMER_ROADMAP_PHASE_2_3_V1)

**The data-driven sibling of Phase 2.2.** Phase 2.2 handles "user changed their mind about a directive." Phase 2.3 handles "the data evolved against a standing directive."

**Scenario:** User sets directive "Ignore ROAS — we're not measuring it." Six weeks later, e-commerce launches, purchase pixel starts firing, and ROAS climbs 0 → 2.3 → 4.1 over 14 days. A real analyst would say: "Side note — ROAS is meaningful now. Want to revisit that directive?" Claude should do the same.

**The brand commitment:** Claude doesn't lie by omission. A directive doesn't blind Claude to reality — it tells Claude how to *interpret* reality. When reality changes meaningfully, the directive deserves a check-in.

### Behavior

When Claude generates an analysis response for a client where:
- A directive bans a specific metric (e.g. "ignore ROAS")
- That metric has crossed a meaningfulness threshold (e.g. ROAS > 1.5x sustained)
- AND a trend is visible (e.g. growth from prior period)

Claude adds a brief, non-intrusive note in its response: "Side note: ROAS has climbed from 0 to 2.3x over the last 14 days. I know you've asked me to ignore it, but worth a heads-up." User can then:
- Reaffirm directive ("still ignore") → Claude suppresses the flag for some window (e.g. 14 days unless threshold jumps again)
- Update directive ("track it now") → triggers Phase 2.2 supersession flow

### Trajectory tracking

Single data point = noise. Trend across days = signal. Use existing date-range comparison logic to compute meaningful deltas. Thresholds tuned per metric:
- ROAS: > 1.5x sustained, OR jumped 50%+ in last week
- Conversions: count crossed a meaningful absolute threshold (10+ in a week)
- CPM/CTR: jumped to new range outside historical baseline

Heuristics first; refine over time based on real signal/noise ratio.

### Re-trigger logic (so it's not annoying)

After user dismisses ("still ignore"), Claude shuts up about that metric for a window. BUT if the metric crosses a *new* threshold during that window (e.g. ROAS jumped from 2.3 to 4.1 — significantly stronger signal), Claude flags it again with the updated number. User can dismiss again or update directive.

Pattern: Claude becomes more confident each time the data reasserts itself. By the third dismissal of an ever-growing signal, Claude might switch from "side note" to "I want to flag this more directly — ROAS is now 6.2x sustained over 30 days."

### Architecture

1. **Banned-metrics tracker.** When prompt is built, compute the list of metrics the user has directives against (use existing anomaly-filter's `extractBannedMetrics`).
2. **Signal detector.** For each banned metric, compute current value + trend. If above threshold, add to a `environmentalFlags` array on intelligence object.
3. **Prompt builder injection.** When `environmentalFlags` has entries, inject a section: "BANNED-METRIC SIGNAL: ROAS is currently 2.3x (was 0 last period). Briefly mention in your response that this metric is now showing meaningful signal, and ask if the user wants to revisit the directive."
4. **Dismissal tracking.** New table `client_environmental_dismissals` or new field on `client_memory` — when user says "still ignore," record threshold value + timestamp. Detector re-fires only when value exceeds prior dismissal threshold by a meaningful delta.

### Marketing implication

This is one of the headline features for the LoraMer pitch. **"LoraMer's Claude doesn't just follow your rules — it tells you when your rules might be outdated."** That's a real differentiator vs. dashboards that just show numbers, and vs. AI tools that just execute the latest instruction.

### Phased build (when we get to it)

1. Banned-metric tracker + threshold logic (1 hr)
2. `client_environmental_dismissals` table + dismissal API (30 min)
3. Prompt builder injection (30 min)
4. End-to-end test on a real client with a Shopify connection + a "ignore ROAS" directive (manual)
5. Tune thresholds based on real signal/noise observations (ongoing)

Estimated: 2-3 hours initial build, then weeks of tuning.

### Connected projects

- **Phase 2.2** — user-driven changes. Phase 2.3 surfaces lead naturally into Phase 2.2 (user says "actually track it now").
- **Project 11 (Unified Attention Surface)** — environmental flags could surface in the alerts box AS WELL AS in Claude's analysis prose. Probably both, since some users won't read the long-form Claude response.
- **Project 9 Phase 4 (Nightly Learning Loop)** — at Scale tier, this whole thing runs nightly and surfaces a digest: "Three of your clients have banned metrics that crossed thresholds this week. Review?"

---

## 📂 PROJECT 10 — Data Ingestion (User-Uploaded Business Data)
<!-- LORAMER_ROADMAP_UPLOAD_LAUNCH_V1 -->

**Design hardened + launch-scoped June 2, 2026 — see `docs/UPLOAD_FEATURE_DESIGN.md` (LORAMER_DOCS_UPLOAD_DESIGN_V1). Launch-critical. Four decisions locked: 25MB/file; ~20-25K words/client + ~5-10K curated agency-level (technical caps, not tiers at launch); managed scan API now / ClamAV later; text-only storage; agency+client hierarchy at launch with bulk import flagged launch-adjacent.**

Lets owners and agencies feed Claude business signals that no API provides — sales pipelines, customer LTV, brand guidelines, persona docs, profit margins, return rates. This is where LoraMer becomes irreplaceable.

**The big idea:** Triple Whale can show ad spend and Shopify revenue. They cannot tell you "your Meta CAC is $42 but your average LTV for Meta-acquired customers is $85 vs $140 from Google." That requires data living in the operator's head, in their CRM, in a Google Sheet.

### Version 1 — Static reference docs ✅ SHIPPED

V1 is live. PDF, DOCX, TXT, CSV upload works on the client profile page. Text extracts on upload via pdf-parse and mammoth, then appends to `client_context.user_notes`. 8,000 char limit per file.

**Known gap (fix locked June 2, 2026):** uploaded doc content currently lives in the same `user_notes` field as user-typed directives. If a brand doc mentions ROAS in passing, the directive extraction regex could falsely match it as a user instruction. **Fix locked:** separate `uploaded_docs` storage (field/table), kept distinct from `user_notes` — see `docs/UPLOAD_FEATURE_DESIGN.md`.

### Launch scope (must-have)
<!-- LORAMER_ROADMAP_UPLOAD_LAUNCH_V1 -->

- [ ] Multi-format upload (PDF/DOCX/TXT/MD/CSV/XLSX) with validation + malware scan + size limits
- [ ] Separate `uploaded_docs` storage (not `user_notes`)
- [ ] Budgeted doc injection into Claude, prompt-injection-safe (delimited untrusted data)
- [ ] Agency + client knowledge hierarchy
- [ ] Encryption at rest, access scoping, delete, audit log, privacy/no-training language
- [ ] Client-shell knowledge panel + agency-level knowledge area
- [ ] Onboarding upload prompt + contextual empty-states

#### Tasks remaining for V1
- [ ] Migrate to separate `uploaded_docs` field (Supabase schema + upload route + context builder)
- [ ] Update build-claude-context.ts to include uploaded_docs as its own section, separate from user_notes
- [ ] Tier-based word/page limits enforced (Free 500 / Solo 5K / Agency 25K / Scale unlimited)
- [ ] Show currently-uploaded docs in client profile with delete capability
- [ ] Replace-vs-append UX when uploading new file

### Version 1 original spec (preserved for reference)

- PDF, DOCX, TXT, MD upload per client
- Extract text on upload (mammoth for docx, pdf-parse for pdf)
- Store in `client_context.uploaded_docs` as text blob
- Inject into Claude system prompt with token budget
- Tier limits: Free 500 words, Solo 5K, Agency 25K, Scale unlimited

**Use cases:** brand guidelines, brand voice, positioning, persona decks, last quarter's strategy memo.

### Version 2 — Structured operational data (30 days post-launch)

- CSV / XLSX upload per client
- Parse structurally (columns, types)
- User maps columns to meaning
- Store as queryable structured data with schema
- Claude reasons across uploaded data + API data

**Use cases:** sales pipeline, lead source attribution, LTV by segment, return rates by product, profit margins by SKU.

**Build for two early customers as design partners first. See what columns they actually have and what queries they actually want. Then generalize.**

### Version 3 — Live-updating data feeds (Scale tier, post-launch on demand)

- Google Sheets connector — Claude reads sheet daily
- Notion database connector
- Custom webhook receiver for CRMs (HubSpot, Pipedrive)
- Scheduled fetcher per customer

**Build trigger:** only after a paying Scale customer asks for it.

### Critical foundations (build once, before any of the above ships)

- Encryption at rest for uploaded docs
- Per-user access controls
- Data deletion mechanism (offboarded clients → docs gone in 30 days)
- Privacy policy update
- No-training assertion to customers
- Audit log for uploads, edits, deletions

### Onboarding integration

The upload feature is *also* a fundamental piece of activation. Rewrite the post-OAuth flow to make doc upload step 2.

---

## 🚨 PROJECT 11 — Unified Attention Surface (Alerts + Insights)

**v1 shipped May 21.** Standalone yellow box gone. Alerts now appear inside the same blue card as Claude's analysis. Reply button covers both.

### v1 (shipped)
- [x] Combined `anomalies` array and Claude `insight` into a single component
- [x] Removed standalone yellow box early-return
- [x] Active alerts injected into Claude's context so Reply works with alert references
- [x] Anomaly filter respects `user_notes` directives

### v2 (next)
- [ ] Make alerts dismissible (user clicks × on an alert → it doesn't show again for this client)
- [ ] Track dismissed alerts in `client_memory` (feeds Project 9 learning loop)
- [ ] Severity tiers (info/warning/critical) with different styling
- [ ] Apply consistent across all panels (Overview, Campaigns, Keywords, drill-down)

---

## 🎚 PROJECT 12 — User-Defined Alert Rules

The current hardcoded rules (low ROAS, paused with spend) are decent defaults but can never serve every operator. High-tier users define their own.

**Architecturally connected to Project 9.** Alert rules ARE the operator model. Same data that says "alert me when X" should weight X higher in Claude's analysis. Alert rules, memory directives, and learned patterns are three angles on the same operator model.

### Core mechanic

A rule has three parts:
1. **Trigger** — metric + operator + threshold + window
2. **Severity** — info, warning, critical
3. **Action** — show alert, email digest, inject into Claude context, trigger agent automation

Examples:
- "ALERT critical when any campaign's CPL increases >20% week-over-week"
- "ALERT warning when frequency exceeds 3x for any active campaign"
- "ALERT info when a new ad spent >$50 and got zero conversions"

### Schema

`alert_rules` table — id, client_id, user_email, name, metric, operator, threshold, window, severity, actions (JSONB), scope, enabled.

`alert_events` table — id, rule_id, client_id, triggered_at, payload (JSONB), dismissed_by_user, dismissed_at.

### UI

`/dashboard/[client]/alerts` — alert center per client. List of rules. Triggered today panel. Rule builder (dropdowns, no SQL). Suggested rules from Claude (Scale tier).

### Tier mechanics

| Tier | Alert capabilities |
|------|-------|
| **Free** | Default hardcoded alerts only |
| **Solo** | Default + 3 custom rules |
| **Agency** | Default + 25 custom rules per client + email digest delivery |
| **Scale** | Unlimited custom rules + AI-suggested rules + agent automations + Slack/SMS |

### Phased build

- **Phase 1 (post-launch, ~2 weeks):** schema + simple rule builder UI for Solo/Agency. Rules fire dashboard alerts only.
- **Phase 2 (~30 days later):** email digest delivery + daily/weekly summary.
- **Phase 3 (Scale-tier launch):** Claude proposes rules based on observed patterns.
- **Phase 4:** rules trigger agent automations.

---

## 📱 PROJECT 13 — Mobile QA Cadence & Pre-Launch Checklist

Mobile rendering is not a one-time task. Treat it as a recurring discipline with three different intensities.

### The three cadences

**1. Smoke check (after any UI deploy).** ~30 seconds on phone. Catch obvious breakage.

**2. Feature-complete pass (every 2 weeks or after a feature ships).** ~30 minutes. Every screen the feature touches.

**3. Full systematic pass (before App Store submission).** ~2 hours. iPhone portrait, iPhone landscape, iPad viewport, slow 3G, PWA mode.

### Pre-Launch Mobile Checklist

Run in order, on real iPhone Safari, not desktop responsive mode.

**Auth flow**
- [ ] Sign-in page renders, button tappable
- [ ] Google OAuth completes from phone
- [ ] Redirects land correctly

**Clients page**
- [ ] Client list scrolls smoothly
- [ ] Long client names don't break layout
- [ ] "Open →" button tappable (44×44px minimum)
- [ ] Add client modal opens, closes, submits
- [ ] Connect platform buttons work

**Dashboard — Overview**
- [ ] Sidebar collapses or hides appropriately
- [ ] Platform selector accessible
- [ ] Date range picker opens, doesn't overflow
- [ ] Unified attention card renders cleanly
- [ ] Reply button tappable, expands chat
- [ ] Chat input not covered by keyboard
- [ ] Can read previous messages while typing
- [ ] Metric tiles wrap properly
- [ ] Charts render, tooltips don't go off-screen
- [ ] Campaign Performance card scrolls
- [ ] Budget Utilization card readable

**Dashboard — Campaigns**
- [ ] Table horizontal scrolls with clear indicator, OR shows as cards, OR hides columns
- [ ] Column picker opens, doesn't get cut off
- [ ] Column picker scrolls if long
- [ ] Drill-down works
- [ ] Breadcrumbs visible after drilling
- [ ] Status badges legible
- [ ] AskClaudeButton accessible

**Dashboard — Keywords (Google only)**
- [ ] Table renders / scrolls
- [ ] Match type legible
- [ ] QS color-coding visible

**Dashboard — Shopify**
- [ ] Revenue/orders/AOV tiles legible
- [ ] Customer split renders
- [ ] Top products list scrolls
- [ ] ShopifyChart renders

**Floating Claude Assistant**
- [ ] Bottom-right bubble visible, not blocking content
- [ ] Tapping opens compact popup
- [ ] Popup fits on screen (not 400×500 hardcoded)
- [ ] Can close popup
- [ ] Conversation persists between tabs

**Client profile / context**
- [ ] Edit fields don't overflow
- [ ] Save button reachable above keyboard
- [ ] User notes textarea expands appropriately

**Error states**
- [ ] Dashboard error boundary renders cleanly
- [ ] "Refresh page" / "Reset and reload" buttons tappable

### Known issues to verify

- [ ] Long client names wrap or truncate cleanly
- [ ] Modals positioned absolutely don't get cut off
- [ ] Column picker opens upward when too close to bottom
- [ ] Chart tooltips constrained to viewport
- [ ] Pull-to-refresh doesn't fire during chat scroll
- [ ] Safe area insets respected

### Right panel sizing on mobile (logged May 22)

- [ ] **Mobile right-panel takes full screen (logged May 22)** — when a diamond is tapped on mobile, the RightPanel now opens full-width (`w-full md:w-96`). This was a quick mobile fix during the popover-to-panel migration. The full-screen takeover loses the dashboard context behind it and feels heavy. Likely better: panel takes maybe 85-90% of the viewport height as a bottom sheet, OR a slightly inset side panel (e.g. `w-[90vw] max-w-md`) so a sliver of the dashboard stays visible. Decide visual treatment, then implement as a single component (no `md:` position-mode toggles — same lesson from Project 17).

### Triggers for unscheduled mobile passes

- After every Shopify reviewer rejection citing UI
- After any change to layout primitives
- After adding a new modal or overlay
- After any change to dashboard tabs

---

## 📣 Cross-cutting — In-app message / nudge layer *(deserves its own project — scope TBD)*

Onboarding coachmarks, token-expired prompts, tier nudges, upload prompts. Broader than uploads; multiple features need it. Launch minimum: contextual empty-states + dismissible banner. Full notification system is a fast-follow. Surfaced from upload/knowledge design (June 2, 2026 — `docs/UPLOAD_FEATURE_DESIGN.md`). → Coachmark/tips + glossary slice consolidated into LORAMER_ROADMAP_TIPS_GLOSSARY_V1 (Project 5).

---

## 💡 Strategy Notes

- **Two buyers, one product:** business owner track and agency track. Onboarding affects Claude tone, not platform access.
- **The moat is the intelligence layer**, not the dashboard. Any dev can rebuild the dashboard in a quarter. The encoded judgment about what matters in ad performance (Meta CTR is already a percentage, `effective_status` not `status`, paused campaigns with spend = red flag) is what makes the AI insights land.
- **"AI that works for you, not for the platform"** — potential tagline. Differentiator vs Google Ads Advisor / Meta's recommendations.
- **Amazon + Google + Meta + Shopify in one tool with AI reasoning across all of it = genuinely rare.** Triple Whale does aggregation; LoraMer does aggregation + diagnosis.
- **Sequencing rationale:** Free-only to App Store first → approved → add paid tiers via Managed Pricing. Shortens time to "live on App Store" by ~2 weeks vs building billing into v1.

---

## 🏷 Naming (Done)

LoraMer is the final name. Trademark research clear (May 2026).

Other candidates evaluated and rejected: Merali, Loravi, Lorami, Advar (working title).

---

## 💬 PROJECT 14 — Unified Conversation Surface

Right now Claude lives in three places: tiny diamond bubbles on rows, the right-side expanded panel, and the standalone Ask Claude tab. Each currently behaves like a separate Claude with no memory of what the user said in another surface. From the user's perspective, that's confusing and wasteful.

**Conceptual model:** there is ONE Claude per client. The surfaces are doorways into the same ongoing relationship, not separate Claudes. Users don't say "I told the diamond on row X" — they say "I told Claude." Product behavior must match how users talk about it.

**Connected to Project 9 (Memory & Learning).** Storage unification is the precondition for memory working correctly. Without it, the memory layer ends up with weird seams.

### Architecture

**Layer 1 — Storage (one table, scoped by client).**
All Claude conversations live in a single `client_conversations` table. Each message records:
- `surface` (diamond, right panel, ask-claude tab)
- `scope` (specific row, campaign, client-wide)
- `timestamp`
- `role` + `content`

Replaces the current `client_context.conversations` JSONB blob that silos by panel key.

**Layer 2 — Context selection (smart, not dump-everything).**
When any surface opens, Claude pulls the conversation log and selects relevant slices:
- **Diamond on a row** → that row's exchanges first, plus summary of broader context
- **Right panel** → whatever was just discussed plus expanded context
- **Ask Claude tab** → full recent conversation sorted by recency

Selection logic is the smart part. NOT "everything in every prompt" — "the right slice for the surface."

**Layer 3 — Continuity hooks (user-controlled).**
- Right panel auto-loads diamond's prior exchanges (already works — preserve)
- Ask Claude tab shows subtle banner when recent conversations exist: *"Continue from your last conversation about Performance Max?"* with one-tap options [Continue] / [Start fresh] / [See all recent]
- Default is fresh; continuity is opt-in but one tap away
- Diamond on row X shows "we discussed this row 2 days ago" if applicable

### Tradeoffs to manage

- **Context bloat over time.** A 200-exchange history can't all fit in a prompt. Mitigate with last-N selection + summarization of older exchanges.
- **Spatial mnemonic loss.** "I asked on the campaigns table" was a useful memory anchor. Keep surface metadata visible so users can navigate by where they were.
- **Scope confusion.** Row-level question vs. account-level question have different default scopes. Claude needs to know which mode it's in.
- **Performance.** Every surface load fetches conversation history → more Supabase roundtrips. Solvable with caching.

### Phased build

**Phase 1 — Storage unification ✅ SHIPPED (May 25, 2026)**
- [x] `client_conversations` table created (migration 002)
- [x] One-time data migration: 102 messages flattened from JSONB blob into the new table
- [x] Three surfaces switched to new API (`/api/conversations`):
  - [x] 4a: RightPanel (slide-out from ✦) — LORAMER_CONV_API_V1_RIGHTPANEL
  - [x] 4b: InsightChat (blue analysis banner) — LORAMER_CONV_API_V1_INSIGHTCHAT
  - [x] 4c: Intelligence route reads all conversations for Claude memory — LORAMER_CONV_API_V1_INTELLIGENCE
  - [x] 4d: ChatTab (left-sidebar ASK CLAUDE tab) — LORAMER_CONV_API_V1_CHATTAB
  - [x] 4e: openPanel re-fetches history on client switch — LORAMER_CONV_API_V1_OPENPANEL
- [x] **Soft delete semantics** (LORAMER_CONV_SOFT_DELETE_V1, migration 003) — Clear button hides UI but Claude memory is preserved. Matches "deep knowledge accumulates" brand promise.
- [x] End-to-end verified: write on one surface → Claude reads it on another surface for the same client
- [ ] Drop legacy `client_context.conversations` JSONB column (defer ~1 week after soak)
- [ ] Update `extractProfileContext` to query new table directly (currently still works via shaped JSONB)

**Phase 2 — Cross-context references (next; mostly already enabled by Phase 1 4c)**
- [ ] Claude naturally references earlier exchanges across surfaces in its prose
- [ ] "Earlier you mentioned Brand campaigns are your heroes — still consistent here"
- [ ] No new UI; just tighter context selection in prompts (improve buildConversationContext)

**Phase 3 — Ask Claude tab continuity prompt**
- [ ] Detect recent conversations (last 24h) for current client when Ask Claude tab opens
- [ ] Show subtle banner: "Continue from [surface] [time ago]?"
- [ ] One tap to load, one tap to dismiss, or type to start fresh
- [ ] Banner doesn't block input — non-modal

### Why this is important pre-launch

Phase 1 is small enough to ship before App Store submission. Doing it now means:
- Memory & Learning (Project 9) can build on top of clean storage instead of a messy migration later
- Users on day one experience continuity, not silos — better first impression
- Cleaner data model for usage analytics and Anthropic spend tracking

---

## 🎨 BRAND NOTES (parking spot for design decisions)

### Logo
- **Final v1 logo:** "LM" in Georgia, white-on-navy (#0f172a) rounded square
- **Wordmark:** "LoraMer" plain Georgia, no italics
- **Backup variant:** "LoraMer" with blue (#2563eb) "Mer" — held for potential use later; user noted blue is the Cote Media signature color (used since 2011)
- Icon used at 1024×1024 for Shopify App Store, 32×32 favicon, 16×16 (deferred — SVG scales)
- Logo files live at `public/icon-1024.svg` and `public/favicon.svg`

### Name & Story — IMPORTANT

**LoraMer is a coined word for "deep knowledge" or "deep understanding."**

- *Lora* — from "lore" — the body of accumulated knowledge about something built up over time
- *Mer* — sea / depth (French/Latin root)
- Together: knowledge that goes deep, accumulates, compounds — exactly what the product is

There is also a personal layer (combination of Russ's daughters' names) but that is private — not customer-facing. The story we tell the world is the etymology / product mission alignment.

**Why this matters strategically:**
- The name and the product mission are the same thing. The Claude that "actually knows your business" — that goes deeper than surface metrics, accumulates context across months, builds real understanding — IS LoraMer.
- This differentiates against generic BI tools that report numbers. LoraMer's promise is depth and accumulated understanding, not faster dashboards.
- Project 9 (Memory & Learning) is the literal product expression of the name. Anything that compounds depth over time ladders directly to brand. Anything that's surface-level — prettier charts, more KPIs at a glance — is hygiene, not brand-aligned moat work.

**Implications for copy and marketing:**
- Lean into "deep," "knowledge," "understanding," "compounds over time," "accumulates," "actually knows," "goes deeper."
- Avoid generic BI language: "insights," "analytics," "data-driven" — these are commodity.
- The Always-On Analyst feature card is the voice template — "Persistent memory means Claude remembers your goals, your KPIs, and what you told it last week."
- Hero copy could evolve toward this: "Deep knowledge for your business" / "The AI that actually knows your business" / "Lore + sea — AI that goes deeper." (Defer to post-launch, but file as direction.)
- Pitch decks, investor conversations, customer onboarding should all reference the etymology — gives the name a real story instead of "we coined it."

**Implications for future design work:**
- The blue accent on "Mer" emphasizes the depth half of the name — visually meaningful, not just decorative. Worth reconsidering whether v1 mono wordmark is correct.
- Future logo evolutions could play with depth visually — M extending below baseline, layered marks, etc. Not v1, but a creative direction filed.

**For any future Claude handoff:**
The etymology and the "deep knowledge" positioning is not a fun-fact about the name — it is the brand. Any new instance of Claude working on this project needs to know: LoraMer = depth + accumulated knowledge, and product decisions should be evaluated against that promise.


### Non-Negotiable Brand Commitments

Two things are NOT product features. They are foundational brand commitments that all product and marketing decisions must respect. Any future Claude working on this project must treat these as binding:

1. **Deep knowledge.** LoraMer means "deep knowledge" — the product accumulates understanding of each customer's business over time. Every feature is evaluated against whether it makes Claude know the customer better. See "Name & Story" section above.

2. **A real human, always.** Every customer can reach a real person, on every plan, every time they need one. This is operational, not just marketing. See Project 15 for the full commitment, SLAs, and tier mechanics.

If these two commitments ever conflict with a product decision, the commitments win. Product changes to either of these require explicit user (Russ) approval.

### Open question: Cote Media ↔ LoraMer relationship
- LoraMer was developed by Cote Media but is positioned as a standalone product
- Blue accent is shared visual heritage from Cote Media (since 2011)
- **Decisions needed (defer):**
  - Should LoraMer credit "By Cote Media" anywhere on the homepage / footer?
  - Should the Cote Media legal entity own LoraMer, or should LoraMer be a separate entity?
  - Does mixing brands complicate eventual sale, fundraise, or licensing of LoraMer?
  - What's the right "from the agency that built this" story for credibility vs. "this is its own thing" story for product positioning?
- Revisit after App Store launch and first customer feedback

---

## 🤝 PROJECT 15 — Human Support Commitment

**Non-negotiable brand promise:** every LoraMer customer can reach a real person, on every plan, every time they need one. No bot-only support. No phone trees. Ever.

This is both a product requirement (visible in the app) and an operational commitment (we actually staff it).

### Why this is a moat

AI companies dropping users into bot-only support has become a market failure. Customers know they're being held hostage by chatbots designed to deflect, not solve. The backlash is real and growing. Any company willing to publicly commit to "humans always available" gets a defensible customer-experience moat.

**This connects to the brand story.** The "deep knowledge" promise is fundamentally about LoraMer being a real partner, not a vending machine. A real partner is reachable. A vending machine isn't. The human-always-available commitment is brand consistency with everything else.

### What we commit to publicly

> "Every LoraMer customer can reach a human, on every plan, every time they need one. No phone tree. No 'sorry, I'm just a bot.'"

### What that means operationally

- AI bot tries first for known issues (password resets, billing, common how-tos) — this is OK
- A permanent, visible "Talk to a human" button on every support surface — one click, no friction
- Human channel = email + live chat during defined hours, with response-time SLAs per tier
- After-hours = email queue with first-response by morning

### Tier-based SLAs (update Project 2 pricing to reflect these)

| Tier | Human support |
|------|---------------|
| Free | Email, 24-48hr first response |
| Solo ($49) | Email + in-app chat, 8hr first response |
| Agency ($199) | Email + in-app chat, 4hr first response, priority queue |
| Scale ($999) | Email + in-app chat + Slack channel + phone, 1hr first response, named contact |
| Enterprise | Dedicated support, SLAs in contract |

### Product surfaces to build

- [ ] "Talk to a human" link visible in app (Settings → Support → Talk to a human)
- [ ] In any AI support chat, permanent "Get a human" button always visible in UI
- [ ] Response-time promise shown next to the button, tier-appropriate
- [ ] App Store listing and pricing page explicitly call out the human commitment
- [ ] Footer link from every page leads to support, support page leads to a human path within 1 click

### Marketing surfaces

- [x] Homepage feature strip: "A Real Human, Always" (one of three columns)
- [ ] Agency page: callout about reaching humans when campaigns break
- [ ] Business page: callout about never getting stuck with a bot
- [ ] Pricing page: human-support SLAs visible per tier
- [ ] App Store listing copy: include in the differentiation section

### Operational planning

- **Today (10 customers):** Russ handles support directly. Fine.
- **At 50 customers:** Russ part-time on support. Set up help desk software (Intercom, Plain, etc.). Defined response hours.
- **At 200 customers:** First support hire. Russ off the front line, on escalations only.
- **At 1000+ customers:** Support team. Tier-1 handles common issues, Tier-2 handles complex, Russ on strategic only.

Pricing must fund this from the start. The Solo/Agency/Scale tiers are designed with human-support cost baked into margin assumptions.

### Risk to manage

The promise is operational, not just marketing. If we ever break it — let a customer get genuinely stuck with bots, ignore a "talk to a human" request, fail to respond within the SLA — the brand damage is severe because we made the commitment loudly. **Don't promise it on the homepage until support tooling and process are in place.** Currently: Russ as a human is enough for the next 30-50 customers, then we revisit.

---

## 🌐 PROJECT 16 — Global Preferences vs Per-Client Directives

**Problem:** Directives (e.g. "ignore ROAS," "target CPL is $35," "this is a brand awareness account") are currently per-client. If an agency runs the same operating philosophy across 30 clients, they have to set the same directive 30 times. That's friction *and* an opportunity to make the product feel like it has deeper knowledge of the operator.

**Direct connection to brand:** This is the "deep knowledge" promise made concrete. A real partner understands not just each client, but YOU — how you think, what you care about, what you ignore across all your work. LoraMer learning the operator (not just the data) is the moat.

### Architecture: three layers of preferences

1. **User-level defaults** — preferences that apply to ALL of a user's clients unless overridden. Stored in a new `user_preferences` table keyed on user_email.
   - Examples: "I'm a brand-focused agency, ignore ROAS by default" / "I prioritize CPL over CPA across all accounts" / "Default funnel framing: ToF / MoF / BoF"
   
2. **Client-level directives** — existing per-client `user_notes`. Overrides user defaults when present.
   - Examples: "This client cares ONLY about ROAS, override my default" / "This is the one exception — focus on conversion volume not CPA"
   
3. **Conversation-derived directives** — extracted from chat history via `extractProfileContext`. Currently writes to client-level. In Phase 3+ should be smart enough to ask "save to this client, or to all clients?"

### Phased build

**Phase 1 — User preferences table & UI (pre-launch if time, otherwise post)**
- [ ] `user_preferences` table: user_email, business_context, default_directives (text), default_kpi
- [ ] Profile/settings page where user enters their global preferences once
- [ ] `build-claude-context.ts` reads user_prefs FIRST, then layers client directives on top
- [ ] User preferences shown as "Default from your settings" tag in client profile, dimmed unless overridden

**Phase 2 — Cross-client directive propagation (post-launch)**
- [ ] When user saves a directive to one client, offer: "Apply this to all your other [X] clients too?"
- [ ] One-click cross-propagation OR per-client cherry-pick
- [ ] Track which directives are user-level vs client-level to prevent silent override

**Phase 3 — Operator model (Scale tier, connected to Project 9 Memory & Learning)**
- [ ] Claude observes patterns in operator behavior across clients
- [ ] Suggests new user-level preferences: "You've ignored ROAS in 5 of your 6 clients. Make this a default?"
- [ ] Daily learning log includes operator-level observations alongside per-client learning

### Tier mechanics

| Tier | Preference model |
|------|------------------|
| Free | Per-client only |
| Solo | User-level defaults + per-client overrides |
| Agency | + cross-client propagation prompts |
| Scale | + operator model (Phase 3 / Project 9 integration) |

### Connected projects

- **Project 9 (Memory & Learning):** the operator model in Phase 3 IS the Project 9 nightly learning loop applied at the user level, not just per client
- **Project 14 (Unified Conversation Surface):** when a user makes a statement in any chat, the directive can be saved at the right level (user vs client)
- **Project 2 (Pricing):** Scale tier's operator model is one of the things that justifies the $999 price point

### UX consideration

Don't surface this complexity to Free/Solo users — they have one or two clients and don't need three layers. The "user-level defaults" feature only becomes valuable at 5+ clients. Show it conditionally based on client count, or surface it as an onboarding step for Agency-tier users only.

---

## 🐛 PROJECT 17 — Popover Positioning ✅ RESOLVED (May 25, 2026)

**Resolution:** The popover no longer exists. The ✦ diamond click now opens the RightPanel (existing slide-out from the right) on desktop and a bottom sheet on mobile. Both are anchored, neither floats.

### How it was resolved

- **Desktop:** Diamond click opens the existing RightPanel — slide-out anchored to the right edge of the viewport. Same component used for the row-level diamond, the card-level diamond, and the InsightChat Reply button. No floating popover.
- **Mobile (LORAMER_MOBILE_BOTTOM_SHEET_V1, May 25):** Same RightPanel component, but rendered as a bottom sheet on screens below `md:` breakpoint. Covers bottom ~75% of viewport with `top-[25%]`, so the user can still see what they tapped on. Rounded top corners. Two separately-rendered divs with `hidden md:flex` and `flex md:hidden` — never `md:` overrides on `position` (the rule that broke things in the original popover attempt).

### Lessons captured for future Claude

- When fixing a positioning bug, identify the ROOT issue (overflow container clipping) before changing positioning fundamentals.
- Don't replace working CSS anchoring with JS calculations unless absolutely necessary.
- For mobile/desktop differences in popover/panel behavior, use TWO components with `hidden md:block` / `block md:hidden`, not one component with `md:` overrides on `position` properties.
- `md:` Tailwind overrides work reliably for `width`, `padding`, `display` — but NOT reliably for `position` mode changes (`fixed` ↔ `absolute`).
- The cheapest fix is sometimes to remove the problematic component entirely and use one that already works.

---


---

## 🎨 PROJECT 18 — Customizable Dashboards (Drag-Drop Cards)

**The vision:** users build their own analytics views from a palette of cards, instead of consuming whatever fixed layout LoraMer happens to ship. Two distinct layers, both needed.

**Inspiration:** Shopify's customizable home dashboard, where merchants drag analytics blocks to compose their own overview. That model proves the pattern works and users get it.

### Why this matters

A fixed dashboard always serves SOMEONE poorly. The ecomm operator and the lead-gen operator care about different things. The agency owner reviewing 30 clients wants a different shape than the business owner who lives in one account. Letting the user decide what they see is both a UX win AND a moat — every saved layout is one more piece of accumulated knowledge about how that operator thinks, h feeds Project 9 (Memory & Learning).

### Two layers

**Scope expansion (June 2, 2026):** Drag-and-drop + expandable/resizable metric cards should apply to **EVERY dashboard tab** — Overview, Google, Meta, Combined, Shopify, WooCommerce, AND the new Analytics tab — not just Overview. The original Phase 1 proving ground (Shopify tab) still makes sense as the first implementation, but the vision is all tabs.

**Layer 1 — Per-platform customizable views.**
Inside each platform tab (Shopify, Google, Meta, WooCommerce, Analytics) — the user chooses which cards appear, where they sit, and how big they are. Some cards are larger (full-width chart), some smaller (single metric tile), some medium (top-N list).

**Layer 2 — Cross-platform unified dashboard.**
A new "My Overview" type surface where the user drags cards from ANY connected platform onto one canvas. Shopify revenue card + Google CPL card + Meta ROAS card + Klaviyo subscriber count card — all on one screen, composed by the operator. This is the version that becomes the daily-driver screen for power users.

### Card library (initial set)

**Shopify / WooCommerce:** Revenue tile · Revenue trend chart · Orders tile · AOV tile · Top products list · Customer split · Conversion funnel · Inventory alerts

**Google Ads:** Spend tile · ROAS tile · CPL tile · Top campaigns · Top keywords · Quality score distribution · Search terms list · Auction insights

**Meta Ads:** Spend tile · ROAS tile · CPA tile · Top campaigns · Top ads · Frequency distribution · Audience overlap · Creative performance

**Google Analytics:** Sessions tile · Sessions trend chart · Users · Page views · Top pages · Traffic sources · GA-vs-Shopify reconciliation card

**Cross-platform:** Combined spend · Combined ROAS · Channel mix · Revenue attribution · Claude insight card (live AI analysis as a draggable widget)

### Technical considerations

- **Persistence model:** layouts saved per-user-per-client in Supabase. New table `dashboard_layouts` keyed on (user_email, client_id, layout_name) with JSONB column for grid state.
- **Grid library:** evaluate react-grid-layout or DnD-Kit. React-grid-layout is the standard Shopify-style pattern.
- **Templates:** ship 3–4 starter templates (Ecomm Operator / Agency Overview / Performance Marketer / Brand Manager) so first-time users don't face a blank canvas.
- **AI suggestions (Scale tier):** Claude proposes cards based on observed user behavior — "You ask about CPL a lot, want to pin a CPL tile here?"

### Tier mechanics

| Tier | Customization |
|------|---------------|
| Free | Fixed default layout |
| Solo | 3 saved layouts per client |
| Agency | Unlimited per-client layouts, share layouts across clients |
| Scale | + cross-platform unified dashboard, AI-suggested layouts, template publishing |

### Phased build

**Phase 1 — Architecture & per-platform Shopify view (~4 weeks):**
- [ ] `dashboard_layouts` table
- [ ] Card component abstraction (every existing tile/chart becomes a draggable Card)
- [ ] React-grid-layout integration on the Shopify tab as the proving ground
- [ ] Save / load / reset to default

**Phase 2 — Roll out to all platform tabs (~2 weeks):**
- [ ] Same pattern on Google, Meta, WooCommerce, Analytics tabs
- [ ] Overview and Combined tabs included (not just platform-specific tabs)
- [ ] Starter templates per platform

**Phase 3 — Cross-platform unified dashboard (~3 weeks):**
- [ ] New "My Overview" route at top of sidebar
- [ ] Drag from any platform's card library
- [ ] Combined data fetching with the existing intelligence layer

**Phase 4 — Claude integration (Scale tier):**
- [ ] AI-suggested layouts
- [ ] "Claude built this dashboard for you" onboarding flow
- [ ] Layout patterns fed into Project 9 learning loop

### Connected projects

- **Project 9 (Memory & Learning):** saved layouts are accumulated operator-level knowledge. Layouts inform what Claude thinks the operator cares about.
- **Project 14 (Unified Conversation Surface):** Claude insight cards embedded in custom layouts reference the same conversation history.
- **Project 16 (Global Preferences):** layout templates can be user-level defaults applied across all clients.

### Why this is a moat

Triple Whale ships one dashboard. Northbeam ships one dashboard. Generic BI tools require analyst-level effort to compose custom views. LoraMer's pitch becomes: "build the dashboard YOU want, and Claude reads across whatever you put on it." Combined with persistent memory, every saved layout is one more way the product knows the customer specifically that no competitor can copy.

## 👥 PROJECT 20 — Multi-User Workspaces & Permissions

**The need:** Higher-tier customers (Agency, Scale, Enterprise) aren't single operators — they're teams. Account managers, owners, virtual assistants, executives. Right now LoraMer is one user → many clients. We need many users → one workspace → many clients, with role-based permissions.

**Connected to brand:** Real human commitment (Project 15) — for an agency to deliver service to their clients, multiple humans on their side need access. Single-seat ownership doesn't fit.

### Architecture

**`workspaces` table** — top-level container. Replaces the implicit "user_email is the workspace" model. Old `user_email` columns get backfilled to a `workspace_id` foreign key.

**`workspace_members` table** — `(workspace_id, user_email, role, invited_by, joined_at)`. A user can belong to multiple workspaces (e.g. a freelancer working with two agencies).

**Roles** — start with two, expand later:
- **Owner** — full admin including billing, can invite/remove members, can delete workspace. Can do everything.
- **Member** — can do everything inside the workspace EXCEPT manage other members, change billing, or delete workspace.

Future roles to consider: **Viewer** (read-only — useful for clients to see their own dashboards), **Billing-only** (CFO seat).

**Migration path:** every existing `user_email` becomes the Owner of a new workspace named after their email. All their `clients` and `client_context` rows get a `workspace_id` set.

### Mechanics

- Invitation flow: Owner enters email → invitation email sent → recipient signs in with Google or accepts via magic link → joins as Member
- Member sees the same dashboard as Owner (clients sidebar, all data) — invisible UI difference
- Member CAN'T see Settings → Team, Settings → Billing, or the "Delete workspace" button
- Audit log per workspace: who invited whom, who removed whom, who connected what platform

### Tier mechanics

| Tier | Seats |
|------|-------|
| Free | 1 (single user, no team features) |
| Solo | 1 |
| Agency | Up to 5 seats |
| Scale | Up to 25 seats |
| Enterprise | Custom |

Additional seats per tier purchasable as add-ons.

### Phased build

- **Phase 1 (post-launch, ~2 weeks):** Schema migration. `workspaces` + `workspace_members` tables. Backfill. UI invisible — every existing user becomes the sole Owner of their own workspace.
- **Phase 2 (~30 days):** Invite UI in Settings. Two roles (Owner / Member). Tier-gated.
- **Phase 3:** Audit log + member activity feed.
- **Phase 4:** Additional roles (Viewer, Billing-only). Granular permissions.

### Connected projects

- **Project 2 (Pricing):** Seat counts become a real lever for tier upgrade
- **Project 9 (Memory & Learning):** Memory should be workspace-scoped, not user-scoped, so the team learns together
- **Project 14 (Unified Conversation Surface):** Conversations may need attribution (who asked Claude what) for audit purposes
- **Project 16 (Global Preferences):** User-level preferences stay personal; workspace-level preferences are shared

### Open questions

- How does the Shopify-install auto-created user (`shopify+<handle>@loramer.app`) fit? It's already a workspace of one — does it stay that way forever, or can a Shopify-install merchant later "claim" the workspace via Google login and invite team members?
- Billing implications: per-seat billing or flat-tier-includes-N-seats?
- Single Sign-On (SSO) for Enterprise tier — separate sub-project later

---

## 📤 PROJECT 21 — Export & Sharing
*(LORAMER_ROADMAP_PROJECT_21_EXPORT_V1)*

**The need:** Users finish a LoraMer analysis and immediately want to share it. Today the only path is copy/paste into a doc or email. That's friction in the moment that matters most — when the work product is leaving LoraMer and entering someone's actual workflow.

**Connected to brand:** "Deep knowledge that accumulates" only earns its keep if that knowledge can be carried out of LoraMer and into the rest of the operator's work. Export isn't a feature, it's the closing motion of every session.

### Origin
Russ generated a full year-long media briefing for My Vacation Network on May 27, 2026 — the first real-world output of the product. The analysis itself was excellent (across-platform, asset-level, demographic-aware). But the next step was manual: copy the entire response, paste into Google Docs, format, add a header, share. Several minutes of friction that the product should have absorbed in one click.

### Formats to support

| Format | Primary use | Tier |
|--------|-------------|------|
| Markdown (.md) | Power users, devs, GitHub | Free |
| Plain text (.txt) | Lowest-common-denominator share | Free |
| PDF | Client deliverables, archived briefs | Solo+ |
| Word (.docx) | Editing before client share, agency workflows | Solo+ |
| XLSX | Data tables only (campaigns, search terms, audiences) | Solo+ |
| HTML email | "Email me this conversation" → inbox-ready brief | Agency+ |
| Scheduled email digest | Weekly auto-export of new conversations | Scale |
| JSON | API consumers, programmatic workflows | Scale |
| Bulk zip | All conversations for a client, or all clients | Scale |

### UX surfaces
- **Conversation-level:** Every Claude response surface (Ask Claude tab, right panel, insight banner expand) gets a per-conversation export button. Three-dot menu → Export → format picker.
- **Client-level:** Client profile page → "Export all" button. Bulk download all conversations + data snapshot in chosen format.
- **Scheduled:** Agency+ tier — schedule weekly/monthly digest auto-emailed to a configured address.

### Architecture
- Server-side rendering for PDF and DOCX (libraries: `pdf-lib` or `puppeteer` for PDF, `docx` package for Word)
- Markdown is trivial — already what Claude generates natively
- HTML email needs templated rendering with LoraMer branding
- XLSX from the structured platform data (not the prose) — uses the same data layer already feeding the dashboard tables
- All exports respect the current date range and platform filters

### Tier mechanics
| Tier | Export capabilities |
|------|---------------------|
| Free | Markdown + plain text, single conversation |
| Solo | + PDF, Word, XLSX, single conversation |
| Agency | + HTML email delivery, bulk per-client export |
| Scale | + Scheduled digest, JSON API, bulk all-clients export, branding/white-label option |

### Phased build
- **Phase 1 (this week — minimum viable):** Markdown + plain text export from any conversation surface. One button, two format options. No tier gating yet — just ship it for current users.
- **Phase 2 (~2 weeks):** PDF + Word via server-side rendering. Tier-aware (Free/Solo+ check). Tests with real briefings to validate formatting holds.
- **Phase 3 (~30 days):** XLSX for data tables. Bulk client-level export. "Email me this" delivery.
- **Phase 4 (Scale-tier launch):** Scheduled digests, JSON API, white-label branding option.

### Connection to recent work
- Project 14 Phase 1 (conversation unification) makes per-conversation export possible — there's now a single canonical record of every exchange
- Project 9 (Memory) means exports can include "context Claude knows about this client" for fuller deliverables
- Project 3 (Intelligence depth) means exports surface specific data points (asset names, search terms, demographic IDs) that justify the deliverable

### Connected projects
- **Project 2 (Pricing):** Export tiers are a real upgrade lever
- **Project 7 (Agency-specific):** White-label exports = Scale tier brand promise
- **Project 19 (Canva closed-loop):** Long-term, "export to Canva for creative build" is one possible format/destination

### Open questions
- HTML email export — do we send from a LoraMer domain, or use the user's own email auth (Gmail/Outlook integration)?
- PDF templating — start with a clean default, or offer customizable templates from the start?
- Should Scale-tier white-label include removing "Generated by LoraMer" footer, or just custom logo/colors?

---

## ⚡ PROJECT 22 — Prompt Caching
*(LORAMER_ROADMAP_PROJECT_22_PROMPT_CACHE_V1)*

**The cost lever Project 3 should have shipped alongside focus-aware slicing.** Per the May 29 intelligence architecture audit, the current Claude calls run ~18-20k input tokens at full context (Sonnet 4.6, ~$0.054-0.06 per message). Focus-aware slicing trims that by ~20-25% at most (~$0.012-0.015 saved). Anthropic prompt caching cuts cached input by ~90% (cached tokens at $0.30/M vs $3/M). For a multi-turn conversation — which is the dominant pattern in Ask Claude / right panel — caching saves dramatically more than slicing ever could.

The system prompt is large and stable across turns: hard constraints, identity, client profile, memory, intelligence data — all largely unchanged between consecutive messages in the same chat. Marking the cacheable prefix with `cache_control: { type: 'ephemeral' }` would mean: first turn pays full price, subsequent turns within the cache TTL (5 min default) pay ~10% of input.

### Why this matters strategically

The intelligence audit recommended Option C (full context by default, narrow slice only for explicit single-row scope). The cost calculus only works at scale if prompt caching is in place — otherwise "always send everything" gets expensive fast. **Prompt caching unblocks the architectural shift toward honest, complete context.** It also is the right cost answer regardless of which architecture wins.

### Tasks
- [x] **SHIPPED May 29, 2026** (LORAMER_PROMPT_CACHING_PHASE_1_REFACTOR_V1 + LORAMER_PROMPT_CACHING_PHASE_2_ENABLE_V1) — Two-phase rollout. Phase 1 refactored `buildClaudeContext` to expose `buildClaudeContextCacheable()` returning `{ prefix, suffix }` while keeping the string export byte-identical for backwards compatibility. Phase 2 wired `/api/chat` and `/api/insight` to send `system` as a typed array with `cache_control: { type: 'ephemeral' }` on the prefix block. Production cache hit verified at 13:17 UTC: write call logged `cache_create: 11525, cache_read: 0` followed 42 seconds later by a read call with `cache_create: 0, cache_read: 11525`. ~25% input-cost savings on the second turn alone; ~70% on multi-turn chats.
- [x] Add `cache_control` markers to the system prompt in `/api/chat/route.ts`
- [x] Same for `/api/insight/route.ts`
- [x] Decide cache boundary: cache prefix = hard constraints + identity + profile + platform data + memory. Suffix = conversation history + analysis rules + (alerts in insight). Active alerts moved into suffix so the cached prefix stays stable across calls.
- [x] Instrument cache hit rate so we can see real savings — `[chat] cache:` and `[insight] cache:` console logs surface `cache_creation_input_tokens` and `cache_read_input_tokens` on every call.
- [x] Verify against Anthropic docs that ephemeral 5-min TTL is sufficient for typical chat session length (it should be — chats are bursty). Verified: works as expected; cache hit observed 42s after write.
- [ ] **Phase 3 (not shipped today):** longer TTL (1 hr) for more stable parts (client profile, memory) using two-tier caching. Defer until cache-hit data shows it would help — current 5-min TTL is already covering the dominant usage pattern.
- [ ] **Phase 3 (not shipped today):** include conversation history in a SECOND cache breakpoint that invalidates on new messages but caches the conversation prefix across turns within the same chat. Squeezes more out of the 4-breakpoint budget.

### Connected projects
- **Project 3 (Intelligence Layer Depth):** Caching makes "Claude sees everything" affordable.
- **Project 2 (Pricing):** Lowers cost-per-customer enough to revisit AI question caps per tier.

### Acceptance
- Cache hit rate > 50% on multi-turn chats
- Input cost per message in a 5-message chat drops by 60%+ vs. pre-caching

---

## ✅ Completed Archive

### Core platform
- [x] Google Ads API connected (OAuth, campaigns, keywords, search terms, ad groups, ads)
- [x] Google Analytics 4 connector V1 (June 2, 2026 — OAuth, property picker, intelligence, Claude context, Analytics tab + chart, Overview/Combined; Phase 6 disconnect pending)
- [x] Canonical date windows via `src/lib/date-range.ts` (June 2, 2026 — LORAMER_DATE_RANGE_CANONICAL_V1)
- [x] Meta Ads integration (OAuth via Business Manager, campaigns, ad sets, ads, e-commerce actions)
- [x] Shopify integration v1 (OAuth, orders, products, customers via Admin API)
- [x] Shopify net sales revenue (June 2, 2026 — LORAMER_SHOPIFY_NET_SALES_V1)
- [x] Universal Intelligence Layer (`build-claude-context.ts`, `/api/intelligence`)
- [x] Combined cross-platform view
- [x] Drill-down: campaigns → ad groups/ad sets → ads
- [x] Multi-line color-coded charts
- [x] Column picker with category grouping
- [x] Totals row in all tables
- [x] Meta e-commerce action columns

### AI / Claude features
- [x] Claude chat with full account context
- [x] Markdown rendering in chat
- [x] Claude insight banner (Haiku 4.5, 50-word max, 1hr cache)
- [x] Persistent Claude sidebar (RightPanel)
- [x] Floating Claude Assistant
- [x] Per-client conversation isolation
- [x] localStorage chat history persistence
- [x] HARD CONSTRAINTS block — user directives override default analysis
- [x] Cross-panel conversation memory
- [x] Heuristic directive extraction (regex on user messages)
- [x] Anomaly filter respects user_notes directives
- [x] Active alerts passed to Claude so Reply button understands them

### UX
- [x] Left sidebar navigation
- [x] Platform selector (Google/Meta/Combined)
- [x] Date range picker with custom ranges
- [x] Mobile responsive base layout
- [x] Tab and account sticky on refresh
- [x] Drill state persistence per client
- [x] Instrument Sans / Georgia font system
- [x] Form element font fix
- [x] Dashboard error boundary catches client-side crashes
- [x] Unified attention surface v1 (Project 11)

### Data ingestion
- [x] Doc upload V1 — PDF/DOCX/TXT/CSV extract to text, append to client context
- [x] Upload UI on client profile page
- [x] 8,000 char per-file limit

### Shopify (App Store readiness)
- [x] Rebrand to LoraMer everywhere
- [x] Expiring offline tokens migration
- [x] Token auto-refresh helper
- [x] Mandatory compliance webhooks endpoint
- [x] HMAC verification on webhooks
- [x] `shopify_compliance_log` table

### Data
- [x] Match type label fix (4=Broad, 3=Phrase, 2=Exact)
- [x] Quality Score color coding
- [x] CTR fix for Meta (already a percentage, don't multiply)
- [x] `effective_status` used instead of `status` for Meta
- [x] Paused-with-spend anomaly threshold raised to $500

### Misc
- [x] Vercel auto-deploy from GitHub pushes
- [x] Claude using client name (not "Cote Media") in chat

## Historical Data Engine (foundational) — added June 3, 2026
System of record for period-over-period and arbitrary historical analysis. Platform-agnostic daily-grain warehouse (metrics_daily) + nightly forward-capture cron + backfill + Claude query layer. Design: docs/HISTORICAL_DATA_ENGINE_DESIGN.md.

- [ ] **Multiple ad accounts per client (NEXT SESSION PRIORITY — June 5, 2026):** `platform_connections` is ~1 account per `(client_id, platform)` and `metrics_daily` has no account dimension, so one client can't hold two accounts on the same platform without rows merging. **First decision (before code):** rollup-only vs per-account breakout vs both — determines whether `metrics_daily` needs an `account_id` column. Then map ripple: connection schema/uniqueness, intelligence adapters, backfill engine/adapters, query layer, `/clients` UI. Scope only next session — do not design yet.
- [x] **Phase 0a COMPLETE** — all 5 forward adapters LIVE/VERIFIED (Shopify, Meta, Google, WooCommerce, GA); nightly cron `/api/cron/sync` forward-captures into `metrics_daily`.
- [x] **Phase 0b backfill DONE + verified** on My Vacation Network — `/api/backfill/google` V2 (d14429b): 658 account-level daily rows, 2024-05-17→2026-06-02, $76.5k spend, one clean run.
- [x] **Phase 0b remaining:** `query_metrics` tool — multi-period comparison from store (marquee: last 7 days vs 6/12/18 months ago). DONE: built + wired into chat/insight (June 4) + ownership-hardened (2026-06-11, LORAMER_QUERY_METRICS_OWNERSHIP_V1).
- **Phase 1 next:** generalize backfill + query to other platforms/clients; replace secret-pasting backfill trigger with in-app button.

## Pre-launch requirements — added June 3, 2026
- [x] **Google OAuth app verification (sensitive adwords scope; no CASA) — CLEARED 2026-06-10** (GCP project savvy-palace-495920-v2; unverified-app warning gone, app published in Production). ⚠️ Any consent-screen change (name/domains/scopes/URLs/logo) re-triggers verification — freeze it during launch; constrains Homepage unification (Lesson 42).
- [ ] **Google Ads API Standard Access application — now UNBLOCKED by the OAuth approval.** Apply in the Ads MCC API Center (tied to the developer token, NOT the GCP project); declare **External + Reporting-Only** permissible use (code is 100% read-only — only `customer.query`/`googleAds:search`, zero mutates). RMF does NOT require write features for a reporting-only tool — only required default columns + a clearly-labeled export per displayed hierarchy level. **Basic (15k ops/day) is almost certainly enough for the invite-only July 14 cohort — Standard is a scale-time item, NOT a launch blocker** (and Google has a known 2026 review backlog). Approach drafted 2026-06-10 (see CONTINUE_HERE / session report); no submission yet.
- Meta App Review — ACTIVE (added 2026-06-10; Tech Provider verification CLEARED 2026-06-09, app still unpublished / Development mode): prepare + submit App Review for `ads_read` (screencast of the connect flow, reviewer test instructions, read-only justification), then switch the app to Live mode. The founding cohort CANNOT connect Meta until BOTH are done — pre-launch gate, running alongside the Google OAuth review.
- [ ] **Direct-grant business-owner Google onboarding (Cause B fix, added 2026-06-10 — LORAMER_GOOGLE_PICKER_ROOTCAUSE_V1):** the Google account picker/mapper lists ONLY children of our MCC (`listAccessibleAccounts` logs in as `GOOGLE_ADS_MANAGER_ACCOUNT_ID` and queries `customer_client level=1`). A business owner with DIRECT admin on a single Ads account and NO MCC access gets an empty list (confirmed with demo@loramer.com on 2026-06-10; NOT an env problem — the nightly cron proves the MCC env is live). Fix = add a `CustomerService.ListAccessibleCustomers` path so a signed-in identity's directly-accessible accounts are enumerated too (then query each WITHOUT forcing `login_customer_id`=MCC, or with the right login context), and merge with the MCC-children list. Makes the business-owner onboarding shape first-class (see LAUNCH_PARKING.md identity matrix row b). Queued design workstream — verify against the matrix before the cohort. NOT a launch blocker only if the July cohort is MCC-agency-only; REQUIRED before onboarding any direct-grant business owner.
- [ ] **Fail-loud validation of required env vars (added 2026-06-10):** a missing/empty required env (e.g. `GOOGLE_ADS_MANAGER_ACCOUNT_ID`, dev token) currently fails SILENTLY — surfaces as an empty picker or a mis-scoped fetch, not an error. Add startup/route-level validation that throws a clear, logged error when a required env is absent, so misconfiguration is loud at deploy time instead of a confusing empty UI. (Tech-debt/reliability; pairs with Lesson 45.)
- Homepage unification: regularize loramer.com marketing homepage with the Vercel app landing; Sign-in-with-Google stays only on the Vercel app. On the critical path for Google verification. **Stripe Phase 3 follow-up (2026-06-09):** there is no productized signup today — a new user lands straight on /dashboard with nothing connected. The real signup flow must START at loramer.com and hand off to the app; fold that loramer.com → app signup handoff into this homepage-unification work.
- [ ] **Additional login & account-creation methods (added 2026-06-11 — post-soft-launch / pre-Q4-public):** today sign-in is Google only. Add **email/password first** (highest value for B2B; requires password-reset + email-verification flows), then optionally **Meta/Apple OAuth**. Supabase Auth supports all of these as providers — the REAL work is **account linking**: the same email arriving via a second provider must resolve to the EXISTING account, never create a duplicate. DEFER past the July 14 soft launch (manual cohort onboarding makes Google-only costless); target before the Q4 public launch.
- [ ] **Re-request Meta `ads_management` scope when write/ad-management features ship (added 2026-06-11):** the write scope was DROPPED 2026-06-11 (LORAMER_META_SCOPE_READONLY_V1) because launch posture is read-only and an unused write scope risks Meta App Review rejection. When write/ad-management features are built: (1) re-add `ads_management` to the OAuth scope string, AND (2) submit a NEW Meta App Review with a write-use justification. NOTE: existing read-only connections will need RE-AUTHORIZATION to pick up the new grant. Pairs with the Project 4 execution layer.
- [ ] Legal housekeeping (added 2026-06-11, pre-Q4 public launch): file DBA / trade-name registrations for "Cote Media" and "LoraMer" under Cote, LLC — neither has been formally filed; matters for banking, contracts, and state compliance (requirements vary by state; typically a cheap, fast filing). Pair with a legal review of privacy posture: privacy policy, Terms of Service, and the data-handling representations made in the Meta App Review and Google verification submissions.
- [ ] Aggregate anonymous industry benchmarking (2026-06-11): anonymized + aggregated cross-customer data so Lora's industry understanding benefits every customer in that vertical. MANDATORY SEQUENCE: (1) legality review of Google Ads API + Meta Platform Terms re: aggregated/anonymized derivatives (binding constraint is platform contract, not privacy law; folds into pre-Q4 legal review); (2) consent language + explicit opt-in toggle ("contribute anonymized data, see benchmarks in return") — never buried in ToS, never retroactive; (3) guardrails: min cohort ~10+ businesses/segment, derived aggregates only (medians/ranges of CTR/CPA/ROAS), never raw rows or campaign names, published methodology page; (4) BOOTSTRAP with Cote Media's clients under express opt-ins Russ obtains (~6 likely already covered; paper to this specific use); (5) integrates with Industry selector + warm-start context as Lora's third knowledge leg. Positioning: transparent opt-in benchmarking with real guardrails = selling point.
- [ ] URL-state navigation (2026-06-11, AFTER Meta freeze lifts): move client/tab view state into the URL (/clients/{id}/... ) — deep links, share links, working refresh/back, bookmarkable views. Merge with Mer-as-route + mobile nav/IA workstreams.
- [ ] Instant cross-device sync as product principle (2026-06-11): same state on phone and desktop, instantly; LoraMer must NEVER fork or lag across devices. Mechanism: URL-held state + Supabase realtime.
- [ ] Context semantics audit, all adapters (2026-06-11): systematically verify every field fed to Lora means what the model will assume (Meta status vs effective_status, Shopify order states, GA sampling flags, etc.) — template: the Google primary_status fix. Kill error classes, not errors.
- [ ] Dashboard "active" count alignment (2026-06-11, after freeze): dashboard fetchers (src/lib/platforms/google.ts, api/platform, combined.ts) still count toggle status==='active' — align with primary_status truth so UI and Lora agree.
- [ ] Unified per-client Lora memory across surfaces (2026-06-11): display may be scoped per tab/surface; KNOWLEDGE must not fragment — one per-client conversation memory shared by all Lora surfaces, with corrections superseding stale claims.
- [ ] Lora Honesty Spec → system prompt (2026-06-11, part of 95% accuracy path): encode query-don't-guess, gaps-out-loud, three-level confidence language, corrections-outrank-memory, no unverified meta-claims ("nothing has changed"), no speculation tails (e.g. "resolve billing issues" absent evidence). Pairs with provenance footer.
- [ ] Cosmetic follow-up: advertising_channel_type renders as raw enum number ("[3]") in context — extend normalizeChannelType numeric mapping.

## Brand principle candidate — added June 3, 2026
"LoraMer is your permanent system of record" — platforms purge granular history at ~37 months; LoraMer keeps it from connect-day forward. Honest framing: permanent from capture onward + bounded backfill; never claim recovery of already-purged data.

- [x] **All Claude surfaces scroll-to-bottom on open (June 4, 2026 - LORAMER_ALLSURFACE_SCROLL_V1):** Extends the May 29 ChatTab fix to the rest. RightPanel desktop AND mobile bottom-sheet containers, plus the InsightChat blue top-of-page box, now instant-scroll to the latest message on mount and smooth-scroll on new messages. Mobile RightPanel previously had no scroll logic at all. See handoff lesson 26.

- [x] **Phase 0b query layer BUILT + WIRED + HARDENED (June 4 → 2026-06-11):** src/lib/metrics-query.ts (paginated aggregation over metrics_daily + equal-length multi-period windows + derived CTR/CPC/CPA/ROAS/AOV) and read-only proving route /api/query-metrics (CRON_SECRET auth). WIRED into Claude chat + insight via the shared capped tool-use loop (clientId server-injected; see the [x] item below, LORAMER_QUERY_METRICS_TOOL_0B_V1). HARDENED 2026-06-11 (LORAMER_QUERY_METRICS_OWNERSHIP_V1): ownership gate on /api/chat + /api/insight + /api/intelligence routes AND inside runClaudeToolLoop (tool withheld unless the signed-in user owns clientId) — closes a cross-tenant read on the service-role path. Phase 0b query item COMPLETE.

- [x] **Phase 0b query_metrics wired into Claude chat (June 4, 2026 - LORAMER_QUERY_METRICS_TOOL_0B_V1):** /api/chat now runs a capped (<=5) tool-use loop exposing the query_metrics tool; clientId injected server-side, never a model input. Claude answers period-over-period / historical questions from metrics_daily instead of a live fetch; single-shot behavior preserved when no tool is called. /api/insight (Haiku) unchanged. Completes the earlier [~] query-layer item: built, proven via curl, now Claude-facing. PHASE 0b DONE. Next: Phase 1 (generalize backfill to Meta/Shopify/GA/Woo + in-app backfill button).

- [x] **query_metrics on ALL Claude surfaces (June 4, 2026 - LORAMER_QUERY_METRICS_SHARED_LOOP_V1 + LORAMER_INSIGHT_FOLLOWUP_SONNET_V1):** Extracted tool def + executor + tool-use loop to src/lib/claude-tools.ts (single source of truth, no twin-drift). /api/chat refactored to call it (behavior unchanged). /api/insight: auto one-liner banner stays Haiku/no-tool; typed follow-ups now run Sonnet + the shared loop (maxTokens 2000). All 3 doorways (Ask Claude, star panel, blue insight box) can now answer historical / period-over-period questions from metrics_daily. clientId injected server-side on every path.

- [x] **query_metrics arbitrary explicit date ranges (June 5, 2026 — LORAMER_QUERY_METRICS_DATE_FLEX_V1):** Claude can query any explicit YYYY-MM-DD range (e.g. Q4 2024 vs Q4 2025); fixes the prior approximate-and-mislabel bug.

- [~] **Phase 1: Meta backfill BUILT (June 4, 2026 - LORAMER_BACKFILL_META_0B_V1):** src/lib/meta-ads.ts (fetchMetaDailyMetrics: account-level daily Insights, Graph v18, time_increment=1, paginated) + /api/backfill/meta (mirrors the Google backfill: resumable via sync_state, 36-month cap, 90-day chunks). Account-level only, like Google. CONVERSION SEAM: backfilled Meta conversions use the account-level daily definition (sum of purchase/lead/etc.; value=purchase); the forward-capture cron uses a per-campaign priority-pick that cannot be reproduced from account-level daily data. Spend/impressions/clicks reconcile exactly; conversion counts may differ at the backfill/forward boundary. TODO next: add a Meta conversion caveat into the query_metrics result so Claude can state the limit. NOT yet run/verified.

- [x] **Meta backfill VERIFIED + conversion caveat shipped (June 4, 2026 - LORAMER_QUERY_METRICS_META_CAVEAT_V1):** Ran /api/backfill/meta on My Vacation Network - 565 account-level daily rows back to the 36-mo cap (2023-06-04), complete. query_metrics platform=meta reconciles (spend/clicks/impressions exact; CTR/CPC/CPA math checks). query_metrics result now carries a `notes` provenance caveat when Meta is in scope, so Claude can state the Meta conversion precision limit honestly (and only when conversions are central). Meta done for Phase 1. Remaining Phase 1: Shopify/GA/Woo backfills (same template) + in-app backfill button to retire the curl.


---

## Historical Backfill - Universal Pattern (added June 4-5, 2026)
<!-- LORAMER_BACKFILL_DEEP_SESSION_2026_06_04 -->

LoraMer's moat is being the permanent system of record as platforms purge history.
Every connected platform must have BOTH forward-capture AND a backfill adapter that
pulls as deep as the platform will serve and labels depth honestly.

STATUS:
- Google Ads - forward-capture + backfill: DONE (deep, proven on a $2.29M account).
- Meta - forward-capture + backfill: DONE (deep).
- GA4 - forward-capture + backfill: DONE (engine V3 hooks; floor 2015-08-14;
    proven on My Vacation Network 1266 rows + a second client).
- Shopify - forward-capture only. TODO: backfill adapter (no purge clock).
- WooCommerce - forward-capture only. TODO: backfill adapter (no purge clock).

PER-PLATFORM RETENTION (drives urgency):
| Platform | Granular limit | Aggregate | LoraMer urgency |
|----------|----------------|-----------|-----------------|
| Google Ads | rolling 37 months (eff. Jun 1 2026; not yet enforced on API) | 11 years | HIGH - backfill before the purge bites |
| Meta | ~37 months | - | medium |
| GA4 | event/user 2-14mo (50 on 360) | indefinite (aggregate via Data API) | low (aggregate safe) |
| Shopify | none | none | none |
| WooCommerce | none (merchant DB) | none | none |

ENGINEERING: the engine (`src/lib/backfill/run-backfill.ts`), the session
run/status routes, the read-only probe, and `BackfillControl` are all
platform-agnostic. A new platform = one adapter in `src/lib/backfill/adapters.ts`
+ a <BackfillControl> on its /clients row. The shared engine is now genuinely
platform-agnostic via the V3 optional hooks (resolveContext / buildRows /
floorDate) — see LORAMER_BACKFILL_GA_SESSION_2026_06_05 in the handoff.

OPEN POLISH: "history coming soon" on non-backfillable rows; per-adapter floor for
Meta; backfill UX; optional "backfill all clients" bulk action.

## 🧭 NAVIGATION & IA REBUILD — 2026-06-05
<!-- LORAMER_ROADMAP_NAV_MOAT_2026_06_05 -->
Decided in design session (mockup: loramer_nav_concept.html). Principle: wayfinding stays familiar (convention beats novelty); novelty lives in the intelligence.
- [ ] Overview-first home: combined by default, customizable + savable sectioned cards. Replaces the Combined/Overview throwback. Ties to Project 18.
- [x] Corner client switcher (top-left, Slack/Linear pattern) — search + filtered list + check on current + "All clients" → /clients + account email/sign-out; portal dropdown (sidebar overflow can't clip it). Clients list, "+ Edit", Sign Out removed from the rail. Desktop only; mobile select untouched. (LORAMER_CLIENT_SWITCHER_V1, 2026-06-05; "recent" section deferred)
- [x] Channels group in the rail: dynamic per connected source, identical structure for all, scales to N. "Connect a source" inline. (LORAMER_NAV_REGROUP_V1, 2026-06-06)
- [x] Demote Campaigns + Keywords from top-level → in-channel tabs inside Google Ads (sub-tab row; Meta gets Overview/Campaigns). (LORAMER_NAV_REGROUP_V1, 2026-06-06)
- [ ] Mer = per-client deep structured brain (depth into ONE client). Rail destination; NOT the clients list.
- [x] De-emoji all nav icons → one consistent family; sentence-case labels (LORAMER_NAV_ICONS_TYPE_V1, 2026-06-05)
- [x] Numbers in ink + card emoji swept on Overview (LORAMER_NUMBERS_INK_V1) and on ShopifyTab/GA tab (LORAMER_VISUAL_CONSISTENCY_V1); accent reserved. 2026-06-05.
- [ ] Compare control in the date picker (compare to prior period / prior year).
- [x] Type pass — card/section titles de-shouted (Title Case, sans, ink), heading scale up toward homepage (LORAMER_TYPE_PASS_V1, 2026-06-05).

## 🧠 MOAT — PROACTIVE LORA & BLEND ENGINE — 2026-06-05
<!-- LORAMER_ROADMAP_PROACTIVE_LORA_2026_06_05 -->
- [ ] Proactive Lora engine: daily + on-anomaly pass per client → RANKED, deduped, provenance-grounded observations + recommended actions, cached by client × surface × date so every screen is already thought-through (instant, no spinner). Cheap model for the broad sweep, Sonnet for deep on-demand. It's prioritization (what's worth saying per surface), NOT pre-computing every screen. The moat.
- [ ] Blend-anything: separated "Blend" rail button → popout to checkbox ANY sources → generated page with unified viz + Lora's ready analysis scoped to those sources. Saveable blends pin onto Overview. Retires fixed "Combined".
- [ ] Blend Phase 2 — drag-to-combine: drag one metric box onto another (Conversions → Spend) → Lora narrates the relationship. Signature interaction; built on the blend engine, after it exists.
- [ ] Compounding per-client brain: memory + the daily pass references prior recs ("the shift I flagged 2 weeks ago is paying off"). Extends Project 9.
- [ ] Unified viz vocabulary: MER / blended ROAS headline, revenue-contribution-by-source over time, cross-source full funnel, profit layer (margin uploads → true CAC, LTV:CAC). Charts are substrate; Lora's recommendation is the product.
- [ ] Skills for Lora — AFTER the proactive engine shape is locked: (a) per-industry reference libraries (benchmarks/seasonality/KPIs/gotchas, provenance-grounded, human-reviewable; warm-start), (b) per-platform analysis playbooks (PMax, MER, funnel). House-style/"how Lora reasons" stays in the system prompt, not a skill. Don't build skill content before the engine or it gets built twice.
- [ ] Responsive recommendation rendering: Lora's freeform markdown tables don't fit mobile (a 3-col "angle / verdict / why" grid squishes to unreadable on a ~390px phone). Real fix = the structured Recommendation card component (severity badge, action, why, provenance) that STACKS on mobile and lays out richly on desktop — retiring freeform markdown tables for recommendations. Part of the proactive-Lora engine; deferred until we build it right (no band-aid). Mobile dogfooding 2026-06-05 is the motivating case.

<!-- LORAMER_ROADMAP_LORAMOAT_V1 — 2026-06-10 -->
- [ ] **Local folder sync agent:** a lightweight desktop agent the user points at a folder; it auto-uploads/refreshes sales & business docs into LoraMer on a schedule (daily sweep) so uploaded spreadsheets never go stale. Feeds the per-client document layer (Project 10).
- [ ] **Lora cross-platform strategy brain:** expand Lora's central prompt/skill to reason ACROSS all connected platforms — budget reallocation recommendations (spend less on Meta, more on Google: WHERE and WHY), and, when internal docs are present, broader BI (cost savings, COGS analysis, new product/service suggestions). **GATE:** ships only after the structured-accuracy program (below) clears its threshold — money-moving recommendations require proven accuracy.
- [ ] **Proactive Lora / Report & Recommendations dashboard (paid tiers):** evolve the alert bar + While You Were Sleeping digest into a daily (user-selectable cadence) dashboard showing every metric with meaningful overnight/weekly movement, each with a specific recommendation AND a connecting overall-strategy explanation; plus a matching email digest. Run adversarial-review validation on digest content (latency-free context; accuracy per Anthropic's published numbers). Extends Project 11.
- [ ] **Structured-accuracy program (the 21%→95% stack)** — per Anthropic's self-service-analytics post (claude.com/blog/how-anthropic-enables-self-service-data-analytics-with-claude): (a) finish `query_metrics` and make it Lora's MANDATORY first path with pre-rebutted fallback excuses; (b) pairwise Skills — thin router + per-platform reference docs (grain, scope, gotchas, date/timezone conventions) following the post's skeleton; (c) maintenance rule: any adapter/schema change updates the matching skill doc in the SAME commit (their accuracy decayed 95→65 in one month without this); (d) offline eval suite — a few dozen pinned-snapshot Q/A pairs per platform, results stored as telemetry, ~90% per-domain gate before cohort exposure; (e) provenance footer on every Lora answer (source tier + data freshness); (f) correction harvesting — user corrections become eval candidates + doc fixes; track %-via-`query_metrics` and correction rate weekly. NOTE the post's null result: raw retrieval over historical queries/chats moved accuracy <1 point — distill into docs, don't dump corpus. This is the GATE item #2 above depends on.
- [ ] **Search terms + keyword intelligence (new data class):** ingest Google Ads `search_term_view` + keyword performance (`keyword_view` / `ad_group_criterion`) as a PERSISTED data class. Today these are LIVE-fetch only — `getKeywords` → /api/keywords feeds the dashboard Keywords tab (top 200), and `google-intelligence.ts` pulls the top ~10 search terms into Lora's live prompt; NOTHING keyword/term-level is stored (metrics_daily is account→campaign→ad_group→ad aggregate only). Persist it so Lora reasons across keywords + search terms + performance together, interviews the user for business context, and produces an optimal keyword + negative-keyword list per client. Phase 1 = recommend (read-only); Phase 2 = APPLY via the write/ad-management roadmap once Standard Access + ads_management land. Same offline-eval gate as other money-moving recommendations (structured-accuracy program above). **PHASE 1 NIGHTLY CAPTURE SHIPPED 2026-06-12 (LORAMER_SEARCH_TERMS_CAPTURE_V1)** — persisted into metrics_daily as dimensional BREAKDOWN rows (breakdown_type='search_term'|'keyword', entity_level='ad_group', entity_id=adGroupId, parent=campaignId, term/keyword in breakdown_value; top 300/200 by cost; enum ints mapped to readable names; fully-inactive rows skipped). NO dedicated table needed — the table is ALREADY dimensional and the breakdown mechanism (as Meta uses for publisher_platform/age) carries per-term grain (earlier "dedicated table" assumption SUPERSEDED). src/lib/intelligence/google-dimensional.ts (shared fetch + collision-safe aggregating builder), wired into the cron Google forward-capture (own try/catch, loud-on-fail, never drops the platform). Still to do: (a) bounded ~90-day backfill hook (engine is account-level/windowed + Google search-term retention is short → per-day, last-90-days only), (b) query_metrics BREAKDOWN READER (it filters breakdown_type='' today → captured rows are WRITE-ONLY until then), then the recommend/APPLY phases above.
- [ ] **SHOPIFY DATA DEPTH MAX (new workstream 2026-06-12):** capture the full Shopify funnel + merchandising depth into the Historical Data Engine (metrics_daily, same dimensional breakdown pattern — no schema change). Phased by app-review posture. **Phase 2 PII-FREE first:** product-level winners + sell-through (needs `read_inventory` scope) + aggregate ship-to geo from orders (entity_level='product' / breakdown_type='geo_country'). **DEFER (separate review):** customer-identified geo/segments (`read_customers`, PII → extends the deletion/deauthorize surface). **Web Pixels lift (not a scope add):** add-to-cart / checkout-initiated funnel events come from the Web Pixels / Customer Events API, not the Admin API. **NOT available from Shopify:** demographics (age/gender) — drop or source from GA. Checkout-initiated ≈ abandoned checkouts (already partially captured, fail-soft). ANY new scope ⇒ Shopify partner re-submission — plan deliberately. (Full feasibility in the 2026-06-12 recon.)
- [x] Visual cleanup queue (post type-pass): leftover card-title emoji, mobile hamburger platform buttons, DrillTable platform dots, empty-states → Tabler icons; ShopifyTab + GA tab metric numbers → ink (LORAMER_VISUAL_CONSISTENCY_V1, 2026-06-05); Overview campaign-row dots + CombinedChart tooltip series names de-glyphed (b2ffe1f, 2026-06-06). Remaining: spacing/roominess pass toward the mockup. **Platform-pill interaction-state SYSTEM (2026-06-10):** pill styles are ad hoc today — Meta hovers solid-dark, WooCommerce hovers dashed-dark, Shopify-connected is green, Google-not-connected had no hover at all (fixed in LORAMER_GOOGLE_PILL_CONNECT_V1). Define ONE deliberate set of states — connected / connectable / coming-soon — with consistent hover + color treatment, and apply uniformly across all platform pills on /clients (and the dashboard). Folds into the spacing/roominess reconciliation pass.

## 📝 Dogfooding — running notes
<!-- LORAMER_ROADMAP_RUNNING_NOTES_2026_06_05 -->
- [ ] Persistent personal "notes" section Russ keeps while using LoraMer daily — separate from client user_notes; a running product-observation log.
