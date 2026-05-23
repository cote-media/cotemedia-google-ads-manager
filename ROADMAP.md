# LoraMer — Product Roadmap

*Last updated: May 22, 2026*

LoraMer is a business intelligence platform for marketing agencies and business owners. It pulls every signal a business produces (Shopify, Google Ads, Meta Ads, and more) into a unified intelligence layer, then lets Claude reason across all of it.

This roadmap is organized by **active project**. Items marked `[?]` are uncertain status — please confirm. Items in **Completed Archive** at the bottom are done.

---

## 🚀 PROJECT 1 — Production Launch (Shopify App Store)

The single highest-priority project. Everything else waits on this getting submitted, approved, and live.

### Submission readiness
- [x] Rebrand from Advar to LoraMer everywhere
- [x] Shopify expiring offline tokens migration
- [x] Shopify mandatory compliance webhooks (`customers/data_request`, `customers/redact`, `shop/redact`)
- [x] HMAC verification on webhooks
- [x] Custom Distribution disabled — using Public app track
- [ ] Run `shopify app deploy` to sync compliance webhook subscription to Dev Dashboard
- [ ] Confirm compliance webhook check turns green in Dev Dashboard (within ~24hr after deploy)
- [ ] Confirm "Deprecated offline token" warning clears (within ~30 days, rolling window)

### App Store listing content (drafted, not submitted)
- [ ] App introduction copy — drafted, needs final approval
- [ ] App details copy — drafted, needs final approval
- [ ] 3-5 features copy — drafted, needs final approval
- [ ] App card subtitle (62 char) — drafted
- [ ] Search terms (5) — drafted
- [ ] Title tag + meta description — drafted
- [ ] Integrations list — drafted
- [ ] Support email — DECISION NEEDED (probably `support@cotemedia.com`)
- [ ] Privacy policy URL — confirm `/privacy` page is live
- [ ] Feature media (1600×900 image or video) — needs to be created
- [ ] 3 desktop screenshots with alt text — needs to be created
  - [ ] Dashboard with AI insight banner
  - [ ] Drill-down view (campaign → ad groups → ads)
  - [ ] Cross-platform Combined view OR Ask Claude conversation
- [ ] Mobile screenshots (optional, raises odds) — needs to be created
- [ ] Demo store URL (optional, raises odds) — needs to be created
- [ ] Screencast URL (3-8 min walkthrough) — needs to be created
- [ ] Test account credentials for reviewers
- [ ] Testing instructions

### Submit as Free-only for v1
- [ ] List only the Free plan in the App Store listing for initial approval
- [ ] No billing code needed yet — Shopify Managed Pricing comes in v1.1

### Review requirements verification
- [x] App capabilities = "My app doesn't have any of these"
- [x] Authenticates immediately after install (callback redirects to /clients)
- [x] Web-based app
- [x] Uses Shopify APIs
- [x] No flagged scopes requested
- [ ] Build is green at time of submission

### LAUNCH BLOCKER: Zero-spend date range renders empty (found May 22)
- [ ] Dashboard currently shows blank when a client has zero Google Ads spend in the selected date range
- [ ] Should render fully with $0 / 0 clicks / 0 impressions / 0 conversions across all tiles, charts, and tables
- [ ] Root cause: Google Ads route returns no rows; UI conflates "no rows" with "no data fetched"
- [ ] Fix at data layer: normalize "no rows" to an explicit zeroed PlatformData in the API route, OR
- [ ] Fix at UI layer: detect successful fetch + empty result and render zeroed shell
- [ ] Same logic needed for Meta Ads, Shopify
- [ ] Reproduce: pick a client whose Google account has zero spend last 30 days, observe blank dashboard

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

The actual moat. Everything that makes Claude's answers better and harder to copy.

### Already shipping
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
- [ ] Google search term report — what queries are triggering ads
- [ ] Google auction insights — impression share, overlap rate, outranking share
- [ ] Google asset-level performance — individual RSA headlines/descriptions
- [ ] Google bid strategy — fetch `bidding_strategy_type`
- [ ] Google conversion action breakdown — `/api/google/conversions` route
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
- [ ] Better loading states (skeletons instead of "Loading...")
- [ ] Better empty states
- [ ] Metric cards redesign on Overview tab
- [ ] Visual refresh of dashboard interior

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
- [ ] Google Analytics
- [ ] Stripe (payment data for non-Shopify clients)

---

## 🏢 PROJECT 7 — Agency-Specific Features

Features that justify the Agency tier and above.

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

- [ ] **Supabase backups (logged May 22)** — currently on Supabase free tier with NO automated backups. Every piece of customer data (client profiles, OAuth tokens for every connected platform, conversations, intelligence cache, spend logs) lives only in production with no recovery path if anything goes wrong. Options to evaluate: (a) upgrade to Pro tier ($25/mo) which includes 7-day point-in-time recovery, (b) write a nightly `pg_dump` script via GitHub Actions that pushes encrypted SQL dumps to S3/R2, (c) both. Decision needed before App Store launch and definitely before paying customers exist. Priority: HIGH.
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

### Phased rollout

- **Phase 1** ✅ Per-conversation directive extraction (shipped May 21)
- **Phase 1.5** ✅ HARD CONSTRAINTS block at top of prompt (shipped May 21)
- **Phase 2 — pre-launch (next 2 weeks):** structured `client_memory` table with explicit facts. User can write/edit in UI. NO learning loop yet — manually curated memory. Ships with App Store launch.
- **Phase 3 — post-launch (~6 weeks out):** dismissed-insights tracking + basic pattern observation
- **Phase 4 — after first paying Scale customer:** full nightly learning loop with daily learning logs

---

## 📂 PROJECT 10 — Data Ingestion (User-Uploaded Business Data)

Lets owners and agencies feed Claude business signals that no API provides — sales pipelines, customer LTV, brand guidelines, persona docs, profit margins, return rates. This is where LoraMer becomes irreplaceable.

**The big idea:** Triple Whale can show ad spend and Shopify revenue. They cannot tell you "your Meta CAC is $42 but your average LTV for Meta-acquired customers is $85 vs $140 from Google." That requires data living in the operator's head, in their CRM, in a Google Sheet.

### Version 1 — Static reference docs ✅ SHIPPED

V1 is live. PDF, DOCX, TXT, CSV upload works on the client profile page. Text extracts on upload via pdf-parse and mammoth, then appends to `client_context.user_notes`. 8,000 char limit per file.

**Known gap to fix before V2:** uploaded doc content currently lives in the same `user_notes` field as user-typed directives. If a brand doc mentions ROAS in passing, the directive extraction regex could falsely match it as a user instruction. Needs to be split into a separate `uploaded_docs` field, kept distinct from `user_notes`.

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

**Phase 1 — Storage unification (pre-launch, 1-2 days)**
- [ ] Create `client_conversations` table (id, client_id, user_email, surface, scope, role, content, timestamp)
- [ ] Migration script: pull existing `client_context.conversations` blob into the new table
- [ ] Update all read sites in dashboard to query new table
- [ ] Update all write sites to insert into new table
- [ ] Invisible to users — sets up everything else

**Phase 2 — Verify right-panel "continue from diamond"**
- [ ] Confirm diamond → right panel flow still works post-unification
- [ ] No regression on the most-used continuity path

**Phase 3 — Ask Claude tab continuity prompt (3-5 days post Phase 1)**
- [ ] Detect recent conversations (last 24h) for current client when Ask Claude tab opens
- [ ] Show subtle banner: "Continue from [surface] [time ago]?"
- [ ] One tap to load, one tap to dismiss, or type to start fresh
- [ ] Banner doesn't block input — non-modal

**Phase 4 — Cross-context references (post-launch)**
- [ ] Claude naturally references earlier exchanges when relevant
- [ ] "Earlier you mentioned Brand campaigns are your heroes — still consistent with what you're seeing here"
- [ ] No new UI; better context selection in prompts

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

## 🐛 PROJECT 17 — Popover Positioning Regression (KNOWN BAD STATE)

**Status:** Broken on both desktop and mobile as of May 21, 2026. Functional but visually wrong.

### What's wrong

Click any ✦ diamond (row-level or section-level) and the Ask Claude popover appears at JS-calculated viewport coordinates instead of being naturally anchored to the diamond. On desktop the popover used to appear with its top-right corner essentially touching the diamond — felt like the panel grew out of the button. Now it floats in the middle of the screen with no visual connection to the trigger. Mobile mirrors desktop behavior when it should be different (bottom sheet for thumb reach).

### How we got here

The original implementation was:
```jsx
<div className="absolute right-0 top-7 w-80 ...">
```
This positioned the popover relative to its `<div className="relative">` parent (the diamond's wrapper). Natural anchoring. Worked perfectly on desktop.

The actual bug we tried to fix: the campaigns table's parent has `overflow-x-auto`. When the diamond is in a row near the right edge of the table, the absolutely-positioned popover would get clipped by that overflow container on desktop. Visible bug, real problem.

**Wrong fix applied:** replaced natural CSS anchoring entirely with `position: fixed` and JS-computed viewport coordinates from `getBoundingClientRect()`. This escapes the clip container but destroys the visual anchoring.

### The right fix (do this fresh)

Three viable approaches, ranked:

**Option A — React Portal (best).** Render the popover at the body root using `createPortal`, so it lives outside the `overflow-x-auto` container entirely. Calculate position from the trigger's `getBoundingClientRect()` once on open. Popover appears anchored to the diamond AND can't be clipped by any parent overflow. This is the standard solution for this exact problem in production React apps.

**Option B — Conditional overflow override.** When the popover is open, switch the table parent from `overflow-x-auto` to `overflow-visible`. Trade-off: temporarily loses horizontal scroll capability while popover is open. Simpler than Portal but feels hacky.

**Option C — Move the diamond outside the overflow container.** Restructure the table so the action column (with the diamond) is in a separate sibling element outside the scrollable area. Largest refactor.

**My recommendation:** Option A. Standard library pattern, no compromises.

### Mobile should differ from desktop

Even with the desktop fix, mobile shouldn't mirror desktop. On mobile the popover should be a bottom sheet for thumb reach — slide up from bottom, full-width, easy to dismiss. Implementation: two completely separate rendered components, controlled by `hidden md:block` / `block md:hidden`. Never share a class string between them again (the source of every CSS bug tonight).

### Lessons captured for future Claude

- When fixing a positioning bug, identify the ROOT issue (overflow container clipping) before changing positioning fundamentals
- Don't replace working CSS anchoring with JS calculations unless absolutely necessary
- For mobile/desktop differences in popover behavior, use TWO components with `hidden md:block` / `block md:hidden`, not one component with `md:` overrides on `position` properties
- `md:` Tailwind overrides work reliably for properties like `width`, `padding`, `display` — but NOT reliably for `position` mode changes (`fixed` ↔ `absolute`)

---

## ✅ Completed Archive

### Core platform
- [x] Google Ads API connected (OAuth, campaigns, keywords, search terms, ad groups, ads)
- [x] Meta Ads integration (OAuth via Business Manager, campaigns, ad sets, ads, e-commerce actions)
- [x] Shopify integration v1 (OAuth, orders, products, customers via Admin API)
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
