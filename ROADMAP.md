# LoraMer — Product Roadmap

*Last updated: May 21, 2026*

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
