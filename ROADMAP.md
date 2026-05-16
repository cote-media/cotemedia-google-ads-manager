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
