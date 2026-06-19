# LORAMER_REDESIGN_SPEC

Canonical design spec for the LoraMer navigation + Overview + "one picture" redesign.
Source of truth = `docs/design/loramer_nav_concept.html` (the copied mockup, do not modify).
This doc derives the spec from that file faithfully and adds the operating model + queue sort.

---

## SECTION 1 — DESIGN SPEC (canonical)

Derived by reading `docs/design/loramer_nav_concept.html`. The mockup is a **static
HTML/CSS concept — zero JavaScript** (no `<script>`; charts are hand-drawn inline SVG
polylines + fixed-height CSS divs with hardcoded numbers). It is a **polish + structure
preview, not a working prototype** — it previews the brand polish (Georgia/serif headings,
Instrument Sans body, numbers in ink, accent used sparingly, no emoji) as well as the IA.

### Nav / IA structure (left rail)
A single constant shell — **swap the centre, never the chrome**. Order, top to bottom:
- **Wordmark** "LoraMer" (serif).
- **Client switcher** (avatar chip + client name + chevron). The clients list, "+ Edit",
  and Sign Out all LEAVE the rail — they live behind the switcher's "all clients".
- **Overview** (first / front-door item).
- **CHANNELS** group label, then ONE nav item per CONNECTED source (in the mockup:
  Google Ads, Meta Ads, Analytics, Shopify) + a muted **"Connect a source"** item.
  The Channels group is the ONLY part that changes per user; its STRUCTURE never changes.
- separator
- **Lora** (sparkles) — the AI analyst surface.
- **Mer** (microscope) — per-client deep structured brain (distinct from the clients list).
- pinned bottom: **account row** (avatar + user name + settings gear).

**Scale principle:** adding a 6th or 12th source needs ZERO nav work — the shell, switcher,
and date control are constant; only the centre changes. **Campaigns & Keywords are GONE from
the top level** — they live as in-channel tabs (see channel drill-down).

### Overview layout + interaction model (the front door)
"Combined by default · customizable · savable." Crumbbar = "<client> · last 14 days" + pills
[Last 14 days] [Customize] [Ask Lora]. Title "Overview". Two reorderable sections:
- **Top stats** — section header carries a grip handle + "drag to reorder". 4-up stat cards
  (e.g. Total spend, Conversions, Revenue, Sessions) with delta vs prior (green up / red down).
  **Interaction: draggable to reorder.**
- **Channels** — section header + "open any to drill in". 2-col card grid; each card = lead
  platform icon + name + one-line sub-metric + right arrow.
  **Interaction: clickable / open-to-drill — clicking routes INTO that channel (not an inline
  expand).**
- Foot cues: **[+ Add section]** and **[Save view]** — the arrangement is savable as a named,
  customizable view.

### Channel drill-down shell + in-channel sub-tabs
"Drill into a platform on its own" = open its channel. **Same shell, same switcher, same date
control — only the centre changes.** In-channel tab row (Google Ads example):
**Summary · Campaigns · Keywords · Search terms · Assets**. Channel body = stat cards
(Spend/Clicks/Conversions/ROAS) + over-time chart + top-entities table.

### The "one picture" viz vocabulary (#3 — showing everything as one picture)
"The industry methods, applied to your data." Four tiles + a Lora narrative card:
- **MER / blended tile** — big "Marketing efficiency (MER)" number (all revenue ÷ all ad
  spend) + Blended ROAS / Blended CAC / New-customer-revenue row. "The one number that only
  exists when every source is in one place."
- **Revenue contribution by source** — weekly STACKED bars, segments Google / Meta /
  Organic-direct / Other (palette below), with legend.
- **Full funnel — across sources** — horizontal funnel: Impressions → Clicks → Sessions →
  Add to cart → Orders → Revenue (revenue step in green).
- **Profit layer — unlocked by uploads** — contribution profit after COGS & ad spend; appears
  ONLY once a margin sheet is uploaded; True CAC / LTV:CAC / Gross margin row; amber
  "Upload margins to turn revenue into profit" cue. "The picture no ad platform can draw."
- **Lora "reads the unified picture" card** (warm background) — plain-language read of the
  blended picture + recommended next move + "Ask a follow-up, or send this to Mer for the deep
  dive." Closing principle: **the charts are the substrate; the recommendation is the product.**

### Exact chart palette (PRESERVE)
Revenue-contribution-by-source stacked bars + legend:
- **Google — `#2563eb`** (also the app `--accent`)
- **Meta — `#7da6f0`** (lighter blue, NOT Meta brand blue)
- **Organic / direct — `#1d9e75`**
- **Other — `#cbd5e1`**

Supporting palette (same #3 band):
- green-positive — `#0f6e56` (text) / `#d8f0e9` (fill)
- amber upload cue — `#b45309`
- ink `#0f172a` · muted `#64748b` · border `#e2e8f0` · warm Lora card `#e7e2d8` bg `#fbfaf7`

### Implied component inventory (what we'd build)
- App shell: rail + client switcher (with "all clients" overflow), per-connection CHANNELS
  group (dynamic, scales to N), Lora + Mer destinations, pinned account row.
- Overview page engine: draggable/reorderable Top-stats row; open-to-drill Channels card grid;
  Add-section + Save-view (named, savable, customizable layouts).
- Channel drill-down shell: in-channel tab row (Summary/Campaigns/Keywords/Search terms/Assets)
  sharing one shell / switcher / date control.
- Unified-viz vocabulary (the moat): MER/blended tile, revenue-contribution-by-source stacked
  bars, full-funnel-across-sources, profit-layer (margin-upload-gated → true CAC / LTV:CAC /
  gross margin), and the margin-upload affordance.
- Lora "reads the unified picture" recommendation card (narrative + ask-follow-up + hand-to-Mer).
- Mer = per-client deep structured brain (rail destination).

(Maps 1:1 to ROADMAP "🧭 NAVIGATION & IA REBUILD" + "🧠 MOAT — PROACTIVE LORA & BLEND ENGINE":
Overview-first home, Channels group [SHIPPED], Mer, MER/blended viz, profit layer via uploads.)

---

## SECTION 2 — OPERATING MODEL

OPERATING MODEL — BUILD-DARK BEHIND A PER-USER PREVIEW GATE (set 2026-06-18)

Constraint: the Meta App Review reviewer signs in as demo@loramer.com at app.loramer.com and must see UI identical to the submitted screencast (sign-in → /clients cards → +Meta connect → blue Meta pill → dashboard Meta tab → Ask Lora). The reviewer-path UI freeze ("no visual changes that diverge from the screencast") covers the shared app shell, /clients, the Meta connect flow, the dashboard Meta tab, and Ask-Lora's Meta answer.

Model: the entire redesign is built in production but DARK, rendered ONLY for an allowlist of Russ's own accounts (a per-user gate). demo@loramer.com and every non-allowlisted user see the CURRENT screencast-matching UI. Russ signs in as himself → sees the full redesign with real client data. No OAuth/consent/domain config is touched (the gate is purely application-level), so the preview cannot disturb the Google or Meta reviews.

Discipline: the redesign is built as NEW, ISOLATED components gated by the preview flag; current production components are NOT refactored in place until flip day, so the live reviewer path stays byte-identical and instantly revert-safe. Default is always the OLD UI; the allowlist is an explicit positive list; any gate failure falls back to OLD UI.

Go-live: flipping the redesign ON for everyone is META-GATED — only after Meta App Review approval, never before. If Meta has not cleared by July 14, soft launch runs on the current UI and the redesign flips the day approval lands. Building dark does not change this; it ensures the redesign is DONE and ready to flip.

DO-NOT-CROSS until Meta clears: any visible change to the LIVE /clients, the Meta connect flow, the dashboard Meta tab, or Ask-Lora's Meta answer for non-allowlisted users.

Clean rule: until Meta clears, ship ONLY backend/data/invisible work LIVE; ALL UI builds behind the preview gate. No per-screen guesswork.

---

## SECTION 3 — QUEUE SORT

QUEUE SORT — SHIP-NOW-LIVE vs BUILD-DARK (set 2026-06-18)

SHIP-NOW-LIVE (backend / data / capture / investigation — invisible to the reviewer):
- Auto-backfill-on-connect ENGINE (cron sweep + 'pending' cursor; the UI control builds dark).
- Flight-2 #9 — more Meta data: the CAPTURE half (adapters / metrics_daily columns / intelligence). Display half builds dark.
- Flight-2 #4 — Shopify month-view perf (live-fetch-vs-metrics_daily / missing index). GO so long as no visual change.
- TOP OF QUEUE 1 — Woo revenue reconciliation (NET via WooCommerce Analytics API; remove top-10 product cap).
- TOP OF QUEUE 3 — error-path false-zero hardening. MUST-HARDEN-BEFORE-LAUNCH.
- Flight-2 #8 — "Clear" button: READ-ONLY investigation first; any UI change after builds dark.
- Carry-overs: token-dedup hardening; WS1b-2 cron alert+prune; write-boundary chokepoint extension.
- Stripe Phase 6 go-live (external lead-time; not UI-frozen).

BUILD-DARK (all UI — behind the per-user preview gate; flips on Meta approval):
- The full mockup: app shell / rail / client switcher; Overview (drag-reorder Top stats, open-to-drill Channels cards, Add section, Save view) = Project 18; channel drill-down shell + sub-tabs; the "one picture" viz (MER, revenue-by-source, full funnel, profit layer) = the moat; Lora "reads the unified picture" card; Mer destination.
- Flight-2 #7 — Overview-as-default (folds into new shell).
- Flight-2 #3 — mobile path to /clients (folds into new nav).
- hasBoth per-connection nav fix (explicitly frozen) — folds into new nav.
- Meta-pill routing fix (explicitly frozen).
- TOP OF QUEUE 2 — Budget-utilization fix, daily vs lifetime (explicitly frozen; Meta tab).
- Flight-2 #2 — Lora content bleed / table overflow, mobile + desktop (Lora is on the reviewer path).
- Flight-2 #9 display half (Meta conversions / ROAS display).
- Flight-2 #5 — Shopify graph day/week/month toggle.
- Flight-2 #1 + #6 — backfill progress meter + auto-continue UI.

DO-NOT-CROSS until Meta clears: live /clients, Meta connect flow, dashboard Meta tab, Ask-Lora Meta answer for non-allowlisted users.

---

## SECTION 4 — MOBILE, NAVIGATION & LANDING

SECTION 4 — MOBILE, NAVIGATION & LANDING (set 2026-06-18; mobile concept approved by Russ)

STANDING RULE: every increment is "done" only when verified on BOTH desktop and mobile. Target = near-app-like responsive web (ultimately an installable PWA), NOT a separate native app. Reference bar: Shopify mobile web.

NAV — one shell, responsive presentation:
• Desktop: persistent left rail (current).
• Mobile: HYBRID — a bottom tab bar for the few global destinations [Overview/Home · Lora · Mer · Menu] + a slide-in drawer (= the rail) holding the client switcher, the dynamic Channels list (scales to N sources), and account/settings. A client-switcher chip sits top-left inside a client.
• Best-practice basis: bottom tab bar = thumb-zone, high discoverability, 3–5 items; hamburger reserved for secondary/overflow; complex apps combine both (Gmail/Slack/Maps).
• BACK-TO-CLIENTS (resolves Flight-2 #3): three visible paths inside a client — a "‹ All clients" crumb at top, the client-switcher chip, and an "All clients" entry at the top of the drawer.

LANDING — opening screen by account shape:
• Agency (>1 client) → NEW Multi-Client Overview (portfolio): card per client with headline metric + delta + status; proactive-Lora "who needs attention" strip on top; priority clients pinnable; rest drag-to-reorder. This is the EVOLUTION of /clients (folds in the queued sort/filter/custom-order work) and is itself a customizable surface.
• Single business (1 client) → the per-client Overview.
• Detection: client count (>1 = agency landing; exactly 1 = that client's Overview).
• Later (roadmap): user-configurable default landing.

ICONS / NAMING: Mer icon = atom (nucleus + interlocking orbits) — signals science/unique, reinforces "Mer = the client's brain." Lora icon = sparkle.

PROACTIVE LORA (INTELLIGENCE PHASE — NOT now; move to the Lora north-star when we get there):
• Lora shifts reactive → proactive everywhere, surfacing what matters (good AND bad) before being asked (cf. Shopify Insight cards).
• Two modes: (1) best-practice proactivity (anomalies, trend breaks, benchmark misses); (2) custom rules ("tell me when X"), user/agency-defined.
• Mer becomes the visible, editable per-client brain: facts, context, thresholds, rules — where you see and tune what Lora knows/watches.
• Portfolio "who's up / who's down" is the first instance of this engine, applied across clients.

POLISH (pre-flip): self-host fonts + icons (currently external CDN <link>s in the dark build) before going live.

ARTIFACT: loramer_mobile_concept.html — 3 frames (agency multi-client overview, per-client mobile overview, rail-as-drawer). Add to docs/design/ when available on the machine.

TABLES: every table is sortable on every column where the data allows — universal rule across all redesign tables.

---

## CLIENT PAGE & CLIENT BRAIN (redesign) — locked 2026-06-18

### IA
- ONE clients list = the Multi-Client Overview (portfolio). Everything ABOUT a client lives INSIDE the client, never on a second list.
- Portfolio card: tap card body -> that client's Overview; tap the card AVATAR -> that client's page (brain). Alerts deep-link to the EVIDENCE (the specific view the alert is about), not the generic Overview.
- On the portfolio, the top-bar client switcher reads "Select a client" (or is hidden) since no client is active.
- Connection management lives IN the client page (Connections section); the rail's "Connect a source" is a shortcut to it. Adding a NEW client = a top-level action on the portfolio.

### The client page = a full sectioned route (replaces the legacy expand-down, which is RETIRED)
- Mobile: inline stacked sections. Web: full sectioned layout. Same content, adapted chrome (gospel).
- Reached by tapping the client avatar (top-bar chip or portfolio card).
- ENTITY MODEL: an entity (a client OR the agency itself) = identity + connections + brain + dashboard. The SAME page component serves the agency profile (top-right avatar); the agency can use LoraMer for its own marketing (it's an entity that also owns the account).

### Sections (order: General -> Connections -> Rules -> Facts; mobile = inline stacked, web = full sectioned layout, one responsive component)
1. General -
   - name; logo (manual upload + first-letter monogram fallback); website (+ Scan).
   - service area / geography (e.g. local / regional / nationwide / global, or specific regions) — analytical context that changes how Lora reads the data.
   - "What this business does" — free-text descriptor, the PRIMARY classification signal (rich natural language, e.g. "modular foam furniture for kids, DTC"; scan-prefillable). Replaces the old 9-bucket Industry dropdown (which threw away precision).
   - NAICS code(s) — OPTIONAL, structured. Searchable picker over a bundled NAICS dictionary so Lora reads each code's OFFICIAL DEFINITION; multiple allowed (a business can span two). This is the warm-start / benchmark key (replaces business_type as that key). Caveat: NAICS is North American; the free-text descriptor carries non-NA clients.
   - NO Primary KPI field (REMOVED — campaign-era remnant; how a client defines success is captured better by a Rule + inferred from sources/data). NO funnel.
   - Business model (ecomm / lead-gen / local-service / SaaS) is INFERRED from the descriptor + connected sources, NOT a forced field.
2. Connections - platform_connections rows (platform · account · health) PLUS a "+ Connect a source" affordance in this section (the rail's "Connect a source" is a shortcut to it).
3. Rules - header "**Rules** — directions Lora has to follow for this client" (bold label + explainer in serif/Georgia). One-at-a-time structured items = client_memory category='directive'. Add / edit / archive.
4. Facts - header "**Facts** — what Lora knows about this client" (bold label + explainer in serif/Georgia). One-at-a-time structured items, PARALLEL to Rules = client_memory non-directive. Source-marked ("You told Lora" vs "Lora learned"), pinnable, soft-delete. Optional "brain dump -> Lora structures into facts you confirm" fast-entry helper. The old free-text "Additional context" (user_notes) blob is REMOVED as a permanent field (it conflicted with the structure and was the upload-bug target); existing user_notes is still READ so nothing is lost, and migrates into facts over time.

Section header styling: bold label + explainer sentence in serif (Georgia) paragraph text.

### Brain taxonomy - SIMPLIFIED to two user-facing buckets
- User sees TWO ideas: RULES (Lora must obey) and FACTS (Lora should know). No category dropdown - the SECTION implies the category.
- Old 4-way (directive/fact/context/preference) collapses: directive -> Rules; fact/context/preference -> Facts; observation/claude_extracted -> surfaces under Facts as "Lora learned."
- The DB keeps client_memory's richer `category` field (no data loss, reversible); only the UI is simplified.
- Rationale: the only split that changes model behavior is rule-as-hard-constraint vs fact-as-knowledge; finer buckets added confusion without proportional accuracy gain. Structure kept where it matters; explainable to customers ("Rules Lora follows + Facts Lora knows").

### Scans (client + competitor) - conversational, confirmable
- Website scan (client): enter website -> Scan -> Lora reads key pages and presents findings CONVERSATIONALLY ("here's what I see - do you agree?"). Confirmed -> facts (source=learned). Strong first draft of public positioning/offers/tone/pricing; cannot get private info; depth tunable.
- Competitor scan: a Competitors area - add competitor URLs -> scan -> conversational summary -> competitor-context facts. PUBLIC face only (positioning/offers/pricing/tone), NOT competitor private performance - frame honestly.
- WARM-START: client scan + competitor scans + industry context + auto-extracted facts = a new client's brain is pre-filled (all proposed/confirmable), never blank.

### Build order (all launch-critical per gospel; order only)
(a) Sectioned client-page shell + faithful sections wired to existing tables (General, Connections, Rules, What Lora knows, Saved chats browser).
(b) Uploads done right (separate Knowledge store per the design doc; fixes the user_notes bug).
(c) Scan flow (client + competitor), conversational + confirmable.
