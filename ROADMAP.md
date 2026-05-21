# CMAM — Cote Media Ads Manager
## Product Roadmap & Feature Backlog
*Last updated: May 12, 2026*

---

## 🔥 Immediate (This Week)
- [x] Fix Match type showing numbers (4=Broad, 3=Phrase, 2=Exact)
- [x] Fix QS column — color code green/yellow/red, add tooltip explanation
- [x] Verify Vercel auto-deploy triggering from GitHub pushes
- [x] Fix Claude saying "Cote Media" instead of client name in chat

---

## 🛠 2-Week Beta Sprint
- [x] localStorage to persist chat history across browser refreshes
- [ ] PDF and Word download options for chat transcripts
- [ ] Agency vs. business owner onboarding flow
- [ ] Mobile layout
- [ ] Apply for Google Ads Standard API access
- [ ] Add definition/legend key for metrics (Match type, QS, etc.)

---

## 🧠 AI & Chat Features
- [ ] Persistent memory across sessions (paid tier upsell)
- [ ] Pre-built prompt library
- [ ] Automated weekly client report — Claude writes it, exports to PDF/Word
- [ ] Anomaly detection with plain English alerts
- [ ] Claude remembers account-specific context permanently
- [ ] Claude voice wake word (when Anthropic supports it)

---

## 📊 Data & Reporting
- [ ] Ad group level data
- [ ] Device breakdown (mobile vs desktop)
- [ ] Time of day / day of week performance
- [ ] Audience performance data
- [ ] Conversion type segmentation (calls vs web signups)
- [ ] Cross-platform combined view
- [ ] Budget pacing alerts

---

## 🔌 Platform Integrations (Priority Order)
1. Meta Ads — full dashboard integration
2. Microsoft/Bing Ads
3. TikTok Ads
4. Amazon Ads
5. LinkedIn Ads
6. X/Twitter Ads
7. Pinterest Ads
8. Snapchat Ads
9. Reddit Ads

**Architecture note:** Consider Unified Advertising API (e.g. Unified.to) to scale to 8+ platforms without rebuilding each one.

---

## 👥 User Experience
- [ ] Platform selection onboarding
- [ ] Agency vs Business Owner onboarding (affects Claude tone, not platform access)
- [ ] Client portal — read-only view for clients
- [ ] White label option
- [ ] Team member access
- [ ] Custom domain support

---

## 💰 Pricing Tiers (Draft)
| Tier | Price | Key Features |
|------|-------|-------------|
| Basic | ~$49/mo | Reporting, 4-exchange memory, download transcript |
| Pro | ~$99/mo | Full session memory, search terms in chat, multi-account |
| Agency | ~$199/mo | Persistent memory, auto reports, client portal, white label |

---

## 🏗 Technical Debt
- [ ] Upgrade Next.js 14.2.3 (security vulnerability)
- [ ] Fix npm deprecation warnings
- [ ] Add error boundaries and user-friendly error messages
- [ ] Rate limiting on API routes

---

## 💡 Ideas & Notes
- CMAM = Cote Media Ads Manager
- Claude works for the agency, not Google — key differentiator vs Ads Advisor
- "AI that works for you, not for the platform" — potential tagline
- Business owners AND agencies both need multi-platform support
- Amazon + Google + Meta in one tool would be genuinely rare
- Siri Shortcut workaround available for voice prompting now
- Usage limit on Claude Pro resets per session (~every few hours for heavy use)

---

## ✅ Completed
- [x] Google Ads API connected
- [x] OAuth login with Google
- [x] Campaign, keyword, search term data
- [x] Date range picker
- [x] Account sticky on refresh (URL persistence)
- [x] Tab sticky on refresh
- [x] Claude chat with full account context
- [x] Markdown rendering in chat
- [x] 4-exchange memory system
- [x] Download chat transcript
- [x] Upload transcript to resume conversation
- [x] Auto-scroll to bottom on new message
- [x] Exchange counter resets after upload
- [x] Red warning banner before memory reset
- [x] Hard stop after 4 exchanges with download prompt
- [x] Campaign status labels (Active/Paused/Removed)
- [x] Campaign type labels (Search/Display/etc)

---

## ⚡ Execution Layer (High Priority Feature)
The ability to execute changes Claude recommends directly inside CMAM — no switching to Google Ads.

### Keyword Actions
- [ ] Pause/enable keywords (one-click toggle on keyword table)
- [ ] Adjust keyword bids
- [ ] Add negative keywords
- [ ] Delete keywords

### Campaign Actions  
- [ ] Pause/enable campaigns
- [ ] Adjust daily budgets
- [ ] Change bidding strategy

### "Claude Recommends" Workflow
- [ ] Claude surfaces specific action list after analysis
- [ ] User reviews with checkboxes (approve/skip each action)
- [ ] Single "Execute Selected" button pushes all approved changes to Google
- [ ] Confirmation summary of what changed

### Philosophy
Every Claude recommendation should eventually be executable from within CMAM.
"Here's what's wrong" → "Want me to fix it?" is a fundamentally different product.

## 🗂 Multi-Platform Client View
- [ ] Redesign navigation: Client-first, then Platform (not Platform-first)
- [ ] Per-client unified view with tabs: Google | Meta | Combined
- [ ] Cross-platform metrics in Combined view (total spend, total conversions across all platforms)
- [ ] Platform toggle on all data tables

## 🤖 Persistent Claude Sidebar
- [ ] Replace Chat tab with persistent Claude panel (right side, always available)
- [ ] Claude icon visible on every tab — click to open/collapse
- [ ] Context-aware: Claude knows which tab you're on and what data is visible
- [ ] Conversation persists as you navigate between tabs
- [ ] Inline ask: hover over a campaign/keyword row, Claude icon appears, click to ask about that specific item
- [ ] "Ask Claude about this campaign" → pre-filled context with that campaign's data

## 💬 Floating Claude Assistant (Replaces Chat Tab long-term)
- [ ] Persistent Claude bubble — bottom right corner, every page
- [ ] Click to open compact popup (400x500px) with current page context pre-loaded
- [ ] Hover over any campaign/keyword row → inline Claude icon appears → click opens popup with that row's data pre-filled
- [ ] Expand options: inline below view / snap to sidebar / full page
- [ ] Conversation persists as you navigate between tabs
- [ ] Context updates automatically as you switch tabs or accounts
- [ ] Full page view = current Chat tab (kept for transcript download/upload)

## 🎨 Explainer Page Polish
- [ ] Fix back navigation — replace "← Cote Media Ads Manager" with cleaner "← Back" or logo
- [ ] Add testimonial/social proof section (populate after beta feedback)
- [ ] Add pricing teaser at bottom ("Free during beta — paid plans coming soon")

## 🏷 Naming Candidates (Trademark Research Complete)
All four names below appear clear of trademark conflicts in software/AI/advertising:
- **Merali** — premium, Italian feel, tightest
- **Loravi** — most distinctive, nothing like it in tech
- **Lorami** — warmest, most conversational
- **Advar** — has "ad" built in, sharp, currently in use as working title

Current working title: **Advar** (replacing CMAM/Cote Media Ads Manager references)
Final name TBD before launch — recommend filing trademark on chosen name before going public.

## 🎨 UX/Design Overhaul (Next Priority)
### Layout Redesign — Left Sidebar Navigation
- [ ] Move from top tab navigation to left sidebar (familiar to Meta/Google Ads users)
- [ ] Client/account selector near top left (Meta-style)
- [ ] Sidebar nav items: Overview, Campaigns, Keywords, Chat, Settings
- [ ] Sidebar collapses to icons on smaller screens
- [ ] Keep top bar for date range picker and sign out

### Column Customization (Google/Meta parity)
- [ ] Campaigns table: let users add/remove/reorder metric columns
- [ ] Keywords table: same column customization
- [ ] Save column preferences per user (localStorage to start, database later)
- [ ] Column options to add: Impressions, Avg CPC, Avg CPM, Search Impression Share, Quality Score avg, Conversion Rate, Cost per Conversion, View-through Conversions, All Conversions, Phone Calls, and more
- [ ] "Columns" button above each table (like Google Ads UI)
- [ ] Drag to reorder columns

### General Design Polish
- [ ] Overvisual refresh of dashboard interior
- [ ] Better empty states
- [ ] Loading skeletons instead of plain "Loading..."
- [ ] Metric cards redesign on Overview tab

## 🛒 E-Commerce Data Layer
- [ ] Shopify integration — connect store data to AdVar
- [ ] WooCommerce integration
- [ ] Data points to pull: revenue by product, AOV, abandoned cart rate, checkout rate, return rate, inventory
- [ ] Claude uses e-commerce data to distinguish ad performance issues from pricing/product issues
- [ ] Only shown for e-commerce clients (toggle by account type)
- [ ] This closes the gap Triple Whale leaves — aggregation + diagnosis in one tool

## 🌐 Web Search for Claude
- [ ] Enable Claude to search web during analysis (competitor pricing, industry benchmarks, market context)
- [ ] Cost: ~$0.01 per exchange — negligible
- [ ] Smart trigger: Claude decides when web search adds value vs always-on
- [ ] Use cases: competitor CPC benchmarks, industry average ROAS by vertical, pricing vs market, seasonal trends
- [ ] Example insight enabled: "Your CPC is 40% above industry average for auto glass in Georgia" or "Competitor pricing in your marks $89 vs your $149"
- [ ] Phase 1: on-demand (user asks for market context)
- [ ] Phase 2: Claude auto-triggers when it detects a gap in its analysis

## 📱 Mobile QA & Polish Session
- [ ] Platform selector (Google/Meta/Combined) accessible from mobile hamburger menu
- [ ] Client list accessible on mobile
- [ ] Column picker opens upward on mobile to avoid going off-screen
- [ ] Test all new features on actual device: combined view, ecommerce columns, totals row, charts
- [ ] Charts responsive at small screen sizes
- [ ] Overview cards stack properly on mobile
- [ ] Dedicated QA session: go through every screen on phone and fix systematically

## 📊 Chart-Table Column Sync
- [ ] When user adds a column via the column picker (e.g. "Conversion Rate"), that metric automatically appears as a toggleable line option on the chart above
- [ ] Chart metric options should mirror whatever columns are currently active in the table
- [ ] Applies to all levels: campaigns, ad groups, ads
- [ ] Core metrics (Spend, Clicks, Impressions, Conversions) always available on chart regardless of column selection
- [ ] Platform-aware: Meta-only columns (CPM, Reach, Frequency) only appear as chart options on Meta view
- [ ] This makes the table and chart feel like one unified analysis tool rather than two separate components

## 🔒 Full UI State Persistence
- [ ] Chart metric selection (Spend/Clicks/Impressions/Conversions) persists on refresh
- [ ] Chart granularity (Day/Week/Month) persists on refresh  
- [ ] Ad group chart visible lines persist on refresh
- [ ] Ad bar chart metric selection persists on refresh
- [ ] Sort column and direction persists per table per platform
- [ ] All state restored from localStorage on mount, cleared only on explicit user action

## 🐛 Known Bugs to Fix
- [ ] Combined mode drill-down — clicking campaign rows does nothing; should drill using the campaign's own platform (google/meta)
- [ ] Window focus auto-refresh — app refetches data every time you switch back to the browser tab; disable Next.js focus revalidation
- [ ] Chart metric selection doesn't persist on refresh (see UI State Persistence section)

## 🎭 Demo Mode
- [ ] /demo route with realistic fake client data — no login required
- [ ] Shows full UI including Claude analysis, charts, drill-down
- [ ] "Sign up for real access" banner at top
- [ ] Shareable URL for sales/demos — no Zoom call needed
- [ ] Static JSON demo data file with fictional but realistic campaigns

## 📎 Document Upload for Client Context
- [ ] Support PDF, DOCX, TXT, CSV uploads per client
- [ ] Extract text content server-side, store in client_context (no file storage needed)
- [ ] All file types supported — size limit enforced by tier
- [ ] Tier limits: Free = ~2,000 words, Pro = ~10,000 words, Agency = unlimited
- [ ] Uploaded content injected into all Claude calls for that client automatically
- [ ] Multiple docs per client — oldest replaced when limit hit on lower tiers
- [ ] Build on top of client profile form

## 🔒 Client Profile Word Limits by Tier
- [ ] Enforce in /api/context POST route: count words in user_notes before saving
- [ ] Free tier: 500 words max
- [ ] Pro tier: 2,000 words max  
- [ ] Agency tier: 10,000 words max
- [ ] Return clear error message when limit exceeded
- [ ] Show word count and limit in UI textarea

## 🎯 Multi-KPI Selection
- [ ] Allow users to select multiple KPIs per client (e.g. Purchases AND Leads for hybrid clients)
- [ ] Store as array in client_context.primary_kpi (change from TEXT to JSONB or comma-separated)
- [ ] Update insight prompts to reference all selected KPIs
- [ ] UI: checkbox group instead of single select dropdown

## 🎯 Conversion Action Visibility
- [ ] New /api/google/conversions route — fetch all conversion actions, include_in_conversions flag, category, count
- [ ] Pass conversion action breakdown to Claude context so it can diagnose inflated conversion counts
- [ ] Optional: Conversion Setup card on overview page showing which actions are counting
- [ ] Helps identify micro-conversions (page views, time on site) accidentally inflating CPL/CPA

## 📊 Deeper Meta & Google Data for Claude Context
- [ ] Meta placement breakdown — fetch publisher_platform breakdown (Feed, Reels, Stories, etc.) per campaign/ad set via Insights API breakdown parameter
- [ ] Meta audience details — fetch targeting spec from ad set (lookalike, interest, retargeting) and pass to Claude
- [ ] Meta bid strategy — fetch bid_strategy field from campaign/ad set and include in context
- [ ] Google bid strategy — fetch bidding_strategy_type from campaign and include in context
- [ ] Conversion event details — fetch conversion action names/types from Google (/api/google/conversions) and Meta so Claude knows what's actually being counted
- [ ] Ad creative details — fetch creative type (image/video/carousel), headline, description for ads and pass to Claude at ad level
- [ ] All of the above to be injected into AskClaudeButton rowContext so Claude can actually answer "why is this working?" questions
EOFs/cotemedia-ads-manager && git add ROADMAP.md && git commit -m "Add deeper API data roadmap items" && git push
cp ~/Downloads/dashboard-final.tsx ~/Downloads/cotemedia-ads-manager/src/app/dashboard/page.tsx && cd ~/Downloads/cotemedia-ads-manager && npm run build 2>&1 | tail -5 && git add . && git commit -m "Enrich AskClaudeButton rowContext with all available fields - objective, budget, CPM, reach, frequency, ecommerce actions, ad copy" && git push
eof

## 📊 Deeper Meta & Google Data for Claude Context
- [ ] Meta placement breakdown — fetch publisher_platform breakdown (Feed, Reels, Stories, etc.) per campaign/ad set via Insights API breakdown parameter
- [ ] Meta audience details — fetch targeting spec from ad set (lookalike, interest, retargeting) and pass to Claude
- [ ] Meta bid strategy — fetch bid_strategy field from campaign/ad set and include in context
- [ ] Google bid strategy — fetch bidding_strategy_type from campaign and include in context
- [ ] Conversion event details — fetch conversion action names/types from Google (/api/google/conversions) and Meta so Claude knows what's actually being counted
- [ ] Ad creative details — fetch creative type (image/video/carousel), headline, description for ads and pass to Claude at ad level
- [ ] All of the above to be injected into AskClaudeButton rowContext so Claude can actually answer "why is this working?" questions
EOds/cotemedia-ads-manager && git add ROADMAP.md && git commit -m "Add deeper API data roadmap items" && git push
cat >> ~/Downloads/cotemedia-ads-manager/ROADMAP.md << 'EOF'

## 📊 Deeper Meta & Google Data for Claude Context
- [ ] Meta placement breakdown — fetch publisher_platform breakdown (Feed, Reels, Stories, etc.) per campaign/ad set via Insights API breakdown parameter
- [ ] Meta audience details — fetch targeting spec from ad set (lookalike, interest, retargeting) and pass to Claude
- [ ] Meta bid strategy — fetch bid_strategy field from campaign/ad set and include in context
- [ ] Google bid strategy — fetch bidding_strategy_type from campaign and include in context
- [ ] Conversion event details — fetch conversion action names/types from Google and Meta so Claude knows what's actually being counted
- [ ] Ad creative details — fetch creative type, headline, description for ads and pass to Claude at ad level
- [ ] All of above injected into AskClaudeButton rowContext so Claude can answer "why is this working?" questions

## 🔍 Intelligence Layer — Depth Improvements
- [ ] Google search term report — what queries are triggering ads
- [ ] Google auction insights — impression share, overlap rate, outranking share
- [ ] Device breakdown — mobile vs desktop vs tablet performance split
- [ ] Geographic performance — top locations by spend/conversions
- [ ] Google asset-level performance — individual RSA headlines/descriptions
- [ ] Meta placement breakdown already in adapter — verify it's surfacing correctly
- [ ] Historical trend data — week over week / month over month comparisons
- [ ] All of above to be added to google-intelligence.ts and meta-intelligence.ts adapters

## 🏢 Agency Intelligence (Future)
- [ ] Cross-client insights — spot patterns across all clients (e.g. "3 of your clients have low Quality Scores")
- [ ] Agency benchmark view — compare client performance against each other
- [ ] Best practice sharing — "Client A's audience strategy is working well, apply to Client B?"
- [ ] Panel clears on client switch (implemented) — each client has their own isolated Claude brain

## 🎨 Font/UI Polish (IN PROGRESS)
- [ ] Form elements (select, input, button) not inheriting Instrument Sans — needs font-family: inherit or explicit declaration in globals.css
- [ ] Check all native browser UI elements are using correct fonts
- [ ] Georgia displaying correctly for display/heading elements?
- [ ] Verify Instrument Serif is loading and being used somewhere

---

## 🧠 PROJECT 9 — Persistent Memory & Learning

The biggest single moat. The reason Scale-tier customers don't churn after month 6.

**Core insight:** any competitor can copy the dashboard in a quarter. They can copy persistent memory in 2 weeks. They cannot copy 6 months of accumulated learning per customer. By the time competitors are feature-matched, Scale customers have a Claude that understands their specific accounts better than any AI on the market — because no other AI has been watching their data and incorporating their feedback for that long.

**Memory vs. Learning — the distinction matters.**

- **Memory** is lookup: "the user said X 3 weeks ago, recall it now." That's what Phase 1/1.5 above started building.
- **Learning** is something different. Claude forms hypotheses from observation, updates them over time as data accumulates, notices recurring patterns across sessions, distinguishes signal from noise, builds a model of *the user* — not just the data.

The "model of the user" piece is what nobody else is doing. Triple Whale shows data. Northbeam shows attribution. LoraMer's Scale tier can be the first BI tool that learns *how the operator thinks about their business* and serves them in that frame.

### Architecture (as if every tier got the full thing)

**1. `client_memory` table — Supabase.**
Per-client persistent facts and observations.
- Facts the user told us (explicit): "Ignore ROAS," "Target CPL is $35," "Brand is our hero," "Q3 rebrand in progress."
- Patterns Claude observed: "User asks about Brand 3x more than other questions," "User dismissed 'high CPM' as actionable 4 times."
- Hypotheses with confidence scores: "Brand drives lower CPL than Generic (confidence: 0.85, observed 6 weeks)."
- Dismissed insights: "Don't surface 'high CPM' as an issue for this client."

**2. Nightly learning loop — background agent.**
Per client, runs once daily:
- Reviews the day's data
- Reviews the day's user interactions
- Updates `client_memory`: new facts learned, hypotheses confirmed/falsified/refined, dismissed insights tracked
- Outputs a "Daily Learning Log" the user can read

**3. Memory injection — prompt layer.**
Every Claude call across the app reads from `client_memory` and injects relevant facts into the system prompt. Not all of it — just what's relevant to the current question. Replaces the heuristic directive extraction with structured, scored facts.

**4. Memory editing UI — `/dashboard/[client]/memory`.**
Shows everything Claude believes about this client. User can:
- Edit facts directly ("CPL target is $30, not $35")
- Delete things Claude got wrong
- Promote things to "always cite this" status
- See Claude's hypotheses + confidence scores

Critical for trust. AI that learns silently is creepy. AI that shows its work is magic.

**5. `user_preferences` table — operator-level personalization.**
Separate from per-client memory. Learns the operator's communication preferences, level of detail, what they dismiss vs engage with.

### Tier mechanics

| Tier | Memory model |
|------|--------------|
| **Free** | Session-only. Nothing persists across sessions. |
| **Solo** | Persistent per-client memory, 50 facts max, no learning loop. |
| **Agency** | Persistent memory + dismissed-insights tracking. 500 facts/client. No nightly learning loop. |
| **Scale** | Full system: unlimited memory, nightly learning loop, hypotheses, daily learning logs, memory editing UI. |

**Memory Credits (overage product, applies to Solo and Agency):**
Solo and Agency users who hit the cap can buy memory credit packs ($X for 100 additional facts, $Y to unlock the nightly learning loop on ONE client). Same pattern as Anthropic API metering. Monetizes outliers without forcing tier upgrade — but softens the upgrade path because they're already paying.

### Phased rollout

- **Phase 1** ✅ Per-conversation directive extraction (shipped May 21)
- **Phase 1.5** ✅ HARD CONSTRAINTS block at top of prompt (shipped May 21)
- **Phase 2 — pre-launch (next 2 weeks):** structured `client_memory` table with explicit facts. User can write/edit in UI. NO learning loop yet — manually curated memory. Ships with App Store launch.
- **Phase 3 — post-launch (~6 weeks out):** dismissed-insights tracking + basic pattern observation. Claude starts noticing things, with low-confidence hypotheses.
- **Phase 4 — after first paying Scale customer:** full nightly learning loop with daily learning logs. Don't build until someone is paying for it.

---

## 📂 PROJECT 10 — Data Ingestion (User-Uploaded Business Data)

Lets owners and agencies feed Claude business signals that no API provides — sales pipelines, customer LTV, brand guidelines, persona docs, profit margins, return rates. This is where LoraMer becomes irreplaceable.

**The big idea:** Triple Whale can show ad spend and Shopify revenue. They cannot tell you "your Meta CAC is $42 but your average LTV for Meta-acquired customers is $85 vs $140 from Google — you're paying too much for inferior customers." That requires data living in the operator's head, in their CRM, in a Google Sheet. If LoraMer can ingest that and reason across it + Google + Meta + Shopify, you've built something nobody else has.

**Three versions, ordered by complexity:**

### Version 1 — Static reference docs (pre-launch, ~2 days)

- PDF, DOCX, TXT, MD upload per client
- Extract text on upload (mammoth for docx, pdf-parse for pdf, etc.)
- Store in `client_context.uploaded_docs` as text blob
- Inject into Claude system prompt on every call (with token budget)
- Tier limits: Free 500 words, Solo 5K, Agency 25K, Scale unlimited

**Use cases:** brand guidelines, brand voice, positioning, persona decks, last quarter's strategy memo. Stuff that doesn't change but gives Claude human context about WHO the client is.

**Why this matters:** turns "Claude analyzing data" into "Claude analyzing data in the context of the business." Brand campaigns winning CPL might trigger "scale Brand" — but if the brand doc says "premium positioning, never compete on price," Claude can say "Brand wins CPL but watch frequency >3x weekly; that conflicts with positioning."

### Version 2 — Structured operational data (30 days post-launch)

- CSV / XLSX upload per client
- Parse structurally (columns, types)
- User maps columns to meaning ("this is monthly revenue by product", "this is LTV by acquisition channel")
- Store as queryable structured data with schema
- Claude gets the schema in system prompt, can reason across uploaded data + API data

**Use cases:** sales pipeline, lead source attribution from CRM, LTV by segment, return rates by product, profit margins by SKU, refund reasons. Stuff that lives in operator spreadsheets.

**This is where the Agency tier earns its keep.** Agencies already have this data scattered across client folders. Letting them pull it into one place where Claude reasons on it is the upsell.

**Build approach:** ship for two early customers as design partners first. See what columns they actually have and what queries they actually want. Then generalize. Don't build for hypotheticals.

### Version 3 — Live-updating data feeds (Scale tier, post-launch on demand)

- Google Sheets connector — Claude reads sheet daily
- Notion database connector
- Custom webhook receiver for CRMs (HubSpot, Pipedrive)
- Scheduled fetcher per customer, pulls latest into intelligence layer

**Edge cases:** schema changes, auth failures, rate limits. Probably 4-6 weeks to do properly.

**Build trigger:** only after a paying Scale customer specifically asks for it. Build for the most-requested feed type first, generalize later.

### Critical foundations (build once, before any of the above ships)

- **Encryption at rest** for uploaded docs (Supabase has this — verify enabled)
- **Per-user access controls** — agency teammates shouldn't see each other's clients by default
- **Data deletion mechanism** — client offboards, docs gone in 30 days
- **Privacy policy update** — explain what we do and don't do with uploaded data (already on App Store checklist)
- **No-training assertion** — explicit statement to customers that uploaded data isn't used for model training
- **Audit log** for uploads, edits, deletions

Once handling business-critical data, liability profile changes. Do this once, properly, before any ingestion features ship. Not bolted on later.

### Onboarding integration

The upload feature is *also* a fundamental piece of activation. Today's onboarding: connect Google/Meta/Shopify, Claude has no human context, first meaningful insight requires Russ to manually fill profile or have a conversation that creates directives.

Better onboarding: connect platforms → "upload your brand doc, customer persona, goals" → Claude has rich context from minute one. Lower time-to-aha, higher activation.

**Roadmap for onboarding (separate work item):** rewrite the post-OAuth flow to make doc upload step 2, not an afterthought.
