# Project 3 — Intelligence Layer Depth Expansion

**Author:** Claude (May 26, 2026)
**Status:** Design pending Russ approval. Do not execute until reviewed.

---

## North Star — the one question that drives the whole project

**"For a given conversion, which campaign × ad group × keyword × audience × ad asset combination drove it?"**

This is the question Google's own Ads Advisor cannot answer. It's the question every operator asks and no platform gives them straight. If LoraMer can answer this — even partially, even with caveats — that's a real differentiator.

Everything else in this project is in service of that north star, or in service of "what other things would a real analyst notice that the dashboard hides."

Three things ladder to this:

1. **Deeper data ingestion.** We need more fields, more breakdowns, more raw signal feeding Claude.
2. **Smarter prompt assembly.** We can't dump everything into every prompt — Claude needs the right slice for the question being asked.
3. **Surface health signals.** Things that are quietly broken (conversion tracking, account disapprovals, asset rejections) deserve attention.

---

## What this project IS and ISN'T

**IS:**
- An exhaustive sweep of what each platform's API can give us that we're not yet using
- A token-budget strategy so the deeper data doesn't blow the prompt
- A health-signal layer that surfaces quietly-broken things
- The PMax creative attribution piece as a headline feature

**IS NOT:**
- A UI overhaul (separate project)
- A new dashboard tab per data type (we can render some, but not all)
- An attribution model improvement (we use what platforms report, not build our own multi-touch model)
- A switch to a Unified Advertising API aggregator (defer — for now, native integrations are deeper)

---

## Inventory: what we pull today, what we don't

### Google Ads — current

`fetchGoogleIntelligence` returns:
- Campaigns (name, status, objective, channel type, budget, bid strategy, metrics)
- Ad groups (name, status, metrics)
- Ads (name, status, type, headline, description, metrics)
- Keywords (text, match type, status, QS, metrics)
- Conversion actions (name, category, count, includeInConversions)

### Google Ads — gaps we'll fill

**Higher-value (Tier 1 — ship in Step 2):**
- **Search term report** — what actual user queries triggered ads. The single most valuable Google data point we're missing. Reveals wasted spend at granular level and intent patterns.
- **Asset-level RSA performance** — individual headlines and descriptions and their performance labels (BEST/GOOD/LOW). What headline is doing the heavy lifting?
- **PMax asset group + asset breakdown** — by far the messiest API surface, but critical. Each asset group has headlines/descriptions/images/videos/logos. Performance labels per asset.
- **Conversion action breakdown per campaign** — currently we have account-level conversion actions. We need them broken down: which campaign drove which conversion type? This is half the north-star question.
- **Audience segments** — in-market, affinity, custom audience, life events. For each campaign, which audience segments are observed?
- **Demographics** — age range, gender, parental status, household income brackets.

**Mid-value (Tier 2 — ship in Step 3):**
- **Geographic performance** — top locations by spend/conversions. State, city, postal code where possible.
- **Device breakdown** — mobile/desktop/tablet share + conversion rate by device.
- **Time-of-day / day-of-week** — when do conversions happen vs. when does spend happen?
- **Auction insights** — impression share, overlap rate, outranking share. Reveals competitive position.
- **Recommendations API** — Google's auto-suggestions, surfaced as advisory notes.

**Health signals (Tier 3 — ship in Step 4):**
- **Conversion tracking health** — when was the last conversion received per action? Stale tracking is silent killer.
- **Policy/disapproval issues** — ads or keywords disapproved, account warnings.
- **Account-level warnings** — billing issues, payment failures, missing settings.
- **Budget exhaustion / pacing** — campaign hit its budget and stopped serving.

### Meta Ads — current

`fetchMetaIntelligence` returns:
- Campaigns (name, status, objective, budget, bid strategy, metrics including e-commerce actions)
- Ad sets (name, status, optimization goal, bid strategy, metrics)
- Ads (name, status, type, headline, body, CTA, image_url, metrics)
- E-commerce action metrics (purchases, ATC, checkout init, view content, cost per)

### Meta Ads — gaps we'll fill

**Tier 1:**
- **Placement breakdown** — Facebook Feed, Instagram Feed, Reels, Stories, Audience Network, Messenger. Per-placement spend + performance.
- **Targeting spec details** — for each ad set: lookalikes (% similarity, source), custom audiences, interest categories, retargeting flags, exclusions.
- **Audience demographics breakdown** — age/gender/region performance.

**Tier 2:**
- **Creative-level performance** — for image ads, the image; for video ads, ThruPlays, watch %, drop-off curve.
- **Asset performance within DCT/Dynamic Creative** — if ad set is using Dynamic Creative, which variants are winning?
- **Frequency / reach** — currently only on campaign level, expand to ad set level.

**Health signals — Tier 3:**
- **Learning phase status** — is the ad set still in Learning, Learning Limited, or Active? Critical for interpretation.
- **Ad rejections / disapprovals.**
- **Pixel firing health** — was the Purchase event received recently? Match quality score?

### Shopify — current

`fetchShopifyIntelligence` (now GraphQL) returns:
- Total orders, revenue, AOV
- Top products (id, name, revenue, units)
- New vs. returning customers

### Shopify — gaps we'll fill

**Tier 1:**
- **Revenue by product** with deeper depth (not just top 5; rolled categories)
- **AOV trend** — daily/weekly AOV evolution
- **Customer LTV** — at minimum, repeat purchase rate
- **Abandoned cart rate** — checkouts initiated vs. completed
- **Checkout completion rate**
- **Return rate** — refunded orders / total orders
- **First-time vs. returning customer revenue split** — separate from count
- **Top referrers / UTMs from orders** — what marketing channel actually closed sales? Critical for tying Shopify back to ads.

**Tier 2:**
- **Inventory levels** — out-of-stock products, low-stock alerts
- **Customer journey before purchase** — visits before order (if available via Customer Journey Summary)
- **Order tags + discount codes used** — which promos are driving sales?

**Tier 3 (deferred):**
- Product reviews, customer reviews, etc. — out of scope for v1.

---

## The north star piece — PMax creative attribution

PMax is the messiest of all Google data because Google deliberately obscures channel mix and reports performance via labels not raw numbers in some cases. But it's the most important to get right because that's where the operator-pain is.

### What we can pull from PMax via Google Ads API

- **Asset groups** — each campaign has 1+ asset groups
- **Assets within asset group** — headlines, descriptions, long headlines, business names, images, logos, videos
- **Performance labels** — BEST / GOOD / LOW / PENDING / UNRATED (Google's qualitative rating, NOT raw metrics)
- **Asset metrics** — impressions, clicks, conversions are AVAILABLE at the asset level via `asset_group_asset_view` and `asset_view` in newer API versions (2025-01+)
- **Audience signals** — what audience seeds were given to the campaign
- **Search categories** — what query themes drove conversions (this is partial — Google doesn't fully expose query-level data for PMax)

### Building the attribution story

Combine these into a per-conversion narrative:

> "This conversion came from: campaign X (PMax), asset group 'Spring Bundles', the BEST-rated headline 'Save 30% on Bundles', BEST-rated image #4 (sunset photo), to audience seed 'Past Purchasers Lookalike 1%', driven by search category 'gift bundles'."

We can't get a perfectly granular 1:1 mapping (Google won't give us that), but we CAN give the operator the working set of high-performers and let them reason about combinations.

### What Claude does with this

When the user asks "what's driving conversions in PMax?", Claude has:
- The asset group breakdown
- Performance labels per asset
- Audience signals
- Top search themes
- Conversion counts and values per asset group

Claude's answer becomes specific: "Spring Bundles asset group is closing 70% of your PMax conversions. Within it, the BEST-rated assets are headline 'Save 30%' and image #4. Audience seed 'Past Purchasers Lookalike' is doing the heavy lifting — try expanding to a 3% lookalike to scale."

That answer is the north-star value-proposition. No other tool does this.

---

## Token budget strategy (CRITICAL)

We cannot dump all the new data into every prompt. The current `buildClaudeContext` already has HARD CONSTRAINTS + memory + conversations + platform data. Adding everything blows the prompt past usable limits and balloons cost.

### Approach: context-aware data inclusion

The `buildClaudeContext` function takes a `focus` parameter. We expand its meaning:

**Default focus (overview):**
- Account-level totals
- Top 5 campaigns by spend
- Top 5 ad groups
- Top 5 ads
- Top 10 keywords
- Top 5 products (Shopify)
- Customer mix (new/returning)
- Active alerts / health signals
- Memory facts (all)
- Recent conversations

**Drill-down focus (e.g. "campaign-performance:google"):**
- Account totals
- ALL campaigns (full breakdown, ~15-30 typical)
- For top 5 campaigns by spend: ad groups + ads under each
- Memory facts (all)

**Asset-attribution focus (e.g. "ad-creative:google"):**
- Top 5 PMax campaigns
- For each: asset groups, assets, performance labels, audience signals
- This is the expensive prompt — only loaded when user is in the asset view

**Search term focus:**
- Last 30 days of search terms with conversion counts
- Linked to the campaign that triggered them

**Audience focus:**
- Audience segment performance per campaign
- Demographic breakdown

Etc.

**Implementation:** the existing `focus` string gets richer. We map each surface (overview tab, campaigns tab, drill states, card-level Ask Claude) to a focus mode, and `buildClaudeContext` switches what platform data it includes.

This is a meaningful refactor to `build-claude-context.ts` but it's the right architecture going forward.

### Caps and truncation

- Max ~50 items in any list (top by spend or conversions; tail trimmed)
- Per-item character cap (campaign descriptions truncated to 200 chars)
- 50 keywords max in any prompt
- 20 audience segments max
- Search terms: top 50 by spend OR top 50 by conversions, whichever the focus calls for

### Caching

- **Hot data (15 min TTL):** account totals, campaign metrics, ad group metrics — same as today
- **Warm data (1 hour TTL):** asset groups, asset-level metrics, audience segments
- **Cold data (4-24 hour TTL):** search term reports (heavy API cost), recommendations, policy/disapproval reports
- **Health signals (1 hour TTL):** conversion tracking timestamps, account warnings

Multiple TTLs in `client_context.intelligence_cache` keyed by data type, not just by date range.

---

## API quota considerations

### Google Ads

- Currently on **Basic access** (15,000 ops/day cap)
- New data adds ~5-15 extra queries per dashboard refresh:
  - Search term report (1 query, large response)
  - Asset performance (1-3 queries depending on asset count)
  - Audience segments (1 query)
  - Geographic / device (1 query each)
  - Recommendations (1 query)
- At our current volume (Russ's clients), we're fine. At ~50 clients with daily refreshes, we'd approach the cap and need to apply for Standard access (separately tracked in Project 8).

### Meta Marketing API

- Per-app rate limits (call_count, total_cputime, total_time)
- Placement and demographic breakdowns are `breakdown` parameters on the existing Insights call — same API call, just slower with more breakdowns
- No new quota concern in the small term; tier limits hit when we scale

### Shopify

- 2 calls / second baseline, 80 burst — comfortable margin
- New analytics queries are GraphQL — same surface, just larger queries
- The Customer Journey Summary requires Shopify Plus on some endpoints — we'll detect and skip gracefully

---

## Health signal surface

### Where do they show up?

Three places:

1. **In the prompt** — injected near the top as "ACCOUNT HEALTH ALERTS" so Claude knows about them and references them when relevant. Example: "Conversion tracking has not received a conversion in 14 days for Lead Form action. This may indicate broken tracking."

2. **In the alerts box (Project 11)** — surfaced in the existing yellow-warning area as user-facing flags.

3. **NOT a new tab** — health signals are noise as a category, signal in context. They belong in existing surfaces.

### Examples

**Google:**
- "Conversion action 'Purchase' has 0 conversions in last 7 days. Last conversion was 14 days ago."
- "Ad 'Spring Bundle Headline V3' is DISAPPROVED for policy reason: 'Promotional disclaimers required.'"
- "Campaign 'Brand Search' hit daily budget on 6 of last 7 days. Consider raising budget."
- "Recommendation: add 5 keywords to ad group 'Generic Terms.' (Google's recommendation, surfaced with severity)"

**Meta:**
- "Ad set 'Lookalike 1%' is in LEARNING_LIMITED state — needs more conversions per week to exit Learning."
- "Purchase pixel event received 142 events in last 7 days. Match quality: HIGH."
- "Ad 'Reel V2' was REJECTED. Reason: 'Personal Attribute references.'"

**Shopify:**
- "5 products are out of stock that drove 23% of last month's revenue."
- "Abandoned cart rate is 78% (industry median: 70%). Possible checkout friction."

---

## Phased build

Each phase independently verifiable. No batching across phases.

### Step 1 — Architecture refactor (1 hr)
- Expand the `focus` parameter on `buildClaudeContext` to support context-aware slicing
- Add per-focus data limits (top-N items, truncation rules)
- Add multi-TTL cache support in intelligence route
- No new data fetched yet — just the scaffolding for it

### Step 2 — Google Tier 1 (1.5 hr)
- Search term report (`search_term_view`)
- Asset performance (`asset_group_asset_view`, `asset_view`)
- PMax asset groups + assets
- Conversion action × campaign breakdown
- Audience segments (`audience_view`)
- Demographics (`age_range_view`, `gender_view`, etc.)

### Step 3 — Google Tier 2 (1 hr)
- Geographic (`geographic_view`)
- Device (`hotel_performance_view` no — `campaign` segmented by device)
- Time-of-day (`hour_view`)
- Auction insights (`campaign_auction_insight_domain_view`)
- Recommendations API

### Step 4 — Google Tier 3 health (45 min)
- Conversion tracking health (last-conversion timestamp)
- Policy / disapproval issues
- Account warnings
- Budget pacing flags
- Inject into prompt + alerts box

### Step 5 — Meta Tier 1 (1 hr)
- Placement breakdown (`publisher_platform`, `platform_position`)
- Targeting spec (read ad set targeting object)
- Demographics (`age,gender,region` breakdowns)

### Step 6 — Meta Tier 2 + Tier 3 (1 hr)
- Video metrics (ThruPlays, watch %)
- Dynamic Creative variants
- Learning phase status
- Ad rejections
- Pixel health

### Step 7 — Shopify Tier 1 (1 hr)
- Revenue by product (full depth)
- AOV trend
- LTV / repeat rate
- Abandoned cart / checkout completion
- Return rate
- First-time vs. returning revenue split
- Top referrers / UTMs

### Step 8 — Shopify Tier 2 (30 min)
- Inventory levels
- Discount codes used
- Customer journey (if Plus)

### Step 9 — End-to-end test
- Pick one client with Google + Meta + Shopify connected
- Walk through each focus mode: overview, drill, asset attribution, audience
- Confirm Claude's analysis quality has stepped up
- Watch token usage — confirm no prompt-size explosions

**Estimated total: 7-9 hours.** Tight but doable in 2-3 sessions.

---

## What's INTENTIONALLY out of scope for this project

- **UI for new data tabs** — Claude is the primary surface for new depth. Some data renders in existing tables (e.g. PMax asset groups could get a table view) but not all of it needs UI. Operators ask Claude.
- **Custom attribution modeling** — we use platform-reported attribution. Building our own multi-touch model is its own large project.
- **Cross-platform attribution stitching** — knowing that Meta drove the visit and Google drove the purchase. Out of scope for this; that's a separate project (UTMs + Shopify referrer tracking can hint at it but not solve it).
- **Real-time data** — we still cache. No webhook-driven live updates.
- **A new agent automation layer** — that's Project 4 (Execution Layer).

---

## Risks

### Risk 1: Token budget blows up despite focus-aware slicing
At some focus modes (asset attribution) the data IS legitimately big. Even with caps we could hit Anthropic context limits OR balloon cost-per-query.
**Mitigation:** measure on real clients in Step 9. If asset attribution prompts exceed 30K tokens, add summarization step — pre-compute a summary of asset performance and inject the summary, not raw data.

### Risk 2: Google Ads API quota hit
Basic access cap. Each new data type is 1+ queries per refresh per client.
**Mitigation:** harder cache TTLs on expensive data (search terms = 4 hours, not 15 min). Apply for Standard access (Project 8 has this; bump priority).

### Risk 3: PMax data is messy
Some metrics not available at asset level for new asset groups. Performance labels can be UNRATED for weeks. Search themes not exposed at granular level.
**Mitigation:** graceful fallback. "If asset metrics unavailable, show performance label only. If label is UNRATED, say so honestly." Don't fabricate.

### Risk 4: Health signals create alert fatigue
If we flag every minor thing, users tune out.
**Mitigation:** severity-tier health signals (info/warning/critical). Only critical + warning surface in alerts box; info goes to Claude's prompt but doesn't trigger UI noise.

### Risk 5: Real cost increase per Claude call
More input tokens = more $ at scale. At $3/M Sonnet input + $15/M output, a 30K-token prompt costs ~$0.09 input. Run at 100 calls/day per client → $9/client/day = $270/client/month just in token cost.
**Mitigation:** this is what tier pricing (Project 2) exists for. Token cost per response must be tracked and reflected in plan limits. Track per-call usage starting Step 1; we already have `logSpend` infra (`spend-logger.ts`) — extend it to capture per-call detail.

### Risk 6: Asset attribution promises too much
North-star claim ("which combination drove the conversion") will sometimes return less than the user hopes because Google withholds 1:1 mapping.
**Mitigation:** Claude's answers are honest about what's known vs. inferred. "Asset group X drove the conversion volume; within it, the BEST-rated assets are [list]. Google doesn't give us per-conversion asset-level attribution, so the working pattern is [X+Y] together."

---

## Open questions for Russ

1. **Should new data render in NEW UI tables, or only in Claude's responses?** My take: only in Claude's responses for now. Asset table for PMax might be worth a UI later. Confirm.

2. **Granular conversion attribution per ad — is the per-conversion-action breakdown (Tier 1) sufficient, or do you need per-conversion-action × per-asset × per-audience all in one matrix?** The fuller matrix is harder and Google may not give it at all. Confirm what "sufficient" means.

3. **For health signals — surface in alerts box AND prompt, or prompt only?** My take: both, but with severity gating (only warning+critical in alerts box).

4. **Cache TTLs — comfortable with 4-hour TTL on expensive things like search term reports?** A user opening LoraMer fresh each morning would always see ~yesterday's search terms. Acceptable for the value gained.

5. **At what point does this project ship behind a feature flag?** Or do we ship each Tier as it lands? My take: ship incrementally. Each Tier is self-contained.

---

## What changes for the user

**Before:**
- Claude knows the campaign exists and its top-level metrics
- Claude can say "Spend up, conversions down — investigate"

**After:**
- Claude knows search terms, asset performance, audience signals, placements, demographics
- Claude can say: "Conversions are down. The asset group 'Spring Bundles' lost its BEST-rated image last Tuesday (rotated out). Spend shifted to 'Generic Promo' asset group which has LOW-rated assets. Search term volume is steady; the issue is the creative rotation."

**That's the difference.** Same data live in the platform. Claude just sees more of it.

---

## What I am NOT doing right now

Not writing code. Waiting on Russ to read the doc, push back, answer questions.
