<!-- QUEUE-EXEMPT: read-only architecture audit, not a build plan. -->
# Intelligence Architecture Audit — Per-Platform Tabs vs. "Claude Sees Everything"

*Read-only audit. No code was changed. Written May 29, 2026.*
*Author: Claude (Opus 4.8), at Russ's request.*

---

## TL;DR for Russ (read this first)

1. **The Meta-data-missing bug is real, but your diagnosis of the cause is wrong in an important way.** It is **not** the focus-aware slicing (`LORAMER_PROJECT_3_STEP_1_V1`) filtering Meta out. Focus-aware slicing only changes *how many* campaigns/ad groups/keywords get shown — it **never** decides *which platforms* Claude sees. Both Google and Meta are always sent to Claude regardless of which tab you're on.

2. **The actual culprit is a single line:** `build-claude-context.ts:206`. A platform section is dropped *entirely* — header and all — whenever that platform returns **zero campaigns**. And Meta returns zero campaigns whenever **no Meta campaign had spend in the selected date range**, because the Meta fetch hard-filters on `spend > 0` (`meta-intelligence.ts:94`). So: a Meta account that's connected and full of ad sets, but quiet in the chosen date window, vanishes completely from Claude's prompt.

3. **Why Claude then lies:** the prompt header (`build-claude-context.ts:784–785`) tells Claude *"You have access to ALL data from ALL platforms."* When the Meta section silently disappears but the header still promises it, Claude does what it was told and fabricates Meta targeting to be helpful. This is the exact same failure mode as Lesson #11 (prompt-as-mirror) — the prompt asserts something untrue, and Claude obeys the assertion over reality.

4. **Per-platform tabs are mostly NOT leaking into the AI layer today** — which is good news. The intelligence pipeline already fetches and sends *all* platforms on every call. The leak is small and fixable. The bigger architectural risk is the *opposite*: the prompt **claims** completeness it doesn't always deliver.

5. **The "keep prompts small/cheap" rationale for focus-aware slicing is weaker than it looks.** The heaviest parts of the prompt (Google Recommendations, Geographic, Device, Hourly, Impression Share, Meta Placements, conversation history) are **not sliced by focus at all** — they always render in full. So focus slicing is saving you far less money than its complexity suggests. And **prompt caching is not enabled anywhere**, which is the single biggest cost lever and it's untouched.

---

## Part 1 — Map of the current state

### 1.1 Every surface that calls Claude

There are exactly **two** API routes that call Anthropic. Everything else (memory detection, conversation storage) uses regex, not Claude.

| # | Surface (UI) | Route | Model | What it passes | What Claude sees |
|---|---|---|---|---|---|
| 1 | **Insight banner** (blue card on Overview / Campaigns / Keywords / Shopify tabs) — the `InsightChat` component | `/api/insight` ([route.ts](../src/app/api/insight/route.ts)) | `claude-haiku-4-5` (150 tok initial, 600 tok follow-up) | `location` (the tab name) → used directly as `focus` | Full `ClientIntelligence` for the client, sliced by the tab's focus mode |
| 2 | **Right panel** (slide-out from a ✦ diamond or "Ask Claude" card button) — the `RightPanel` component | `/api/chat` ([route.ts](../src/app/api/chat/route.ts)) | `claude-sonnet-4-6` (16,000 tok) | `platform`, `location`, `drillLevel`, `drillCampaign`, `drillAdGroup`, `rowContext` | Full `ClientIntelligence`, sliced by focus, plus a `rowContext` string naming the specific row |
| 3 | **Ask Claude tab** (left-sidebar "ASK CLAUDE" tab) — the `ChatTab` component, sent via `sendChat()` | `/api/chat` | `claude-sonnet-4-6` (16,000 tok) | `platform: activePlatform`, `location: activeTab` (= `'chat'`), `drillLevel/Campaign/AdGroup` from localStorage | Full `ClientIntelligence`, focus forced to `overview` |
| 4 | **Floating Claude assistant** | — | — | — | **Does not exist as a separate Claude call.** It is the same `RightPanel` / chat plumbing. There is no fourth code path. |
| 5 | **Memory auto-detect** ("save this as a fact?") — `extractProfileContext()` in the dashboard | calls `/api/insight` with a crafted prompt ([page.tsx:1259](../src/app/dashboard/page.tsx#L1259)) | `claude-haiku-4-5` | same as #1 | same as #1 |

Notes:
- The "floating assistant" and "right panel" are the **same** `RightPanel` component ([page.tsx:635](../src/app/dashboard/page.tsx#L635)); its `send()` function is the only chat-sender for both ([page.tsx:691](../src/app/dashboard/page.tsx#L691)).
- `/api/memory/route.ts` and `/api/memory/bootstrap/route.ts` were flagged by a keyword scan but do **not** call Claude — they use regex `DIRECTIVE_PATTERNS` to detect facts. Same for the `proposeMemory` logic in `/api/conversations/route.ts:164`.
- The dashboard's `sendChat()` passes a `platformData` field in the body ([page.tsx:2848](../src/app/dashboard/page.tsx#L2848)), but the chat route **ignores it** — the route re-fetches intelligence server-side via `/api/intelligence`. That client-side payload is dead weight (minor finding, see Related findings).

### 1.2 The focus / location value each surface passes

The chat route translates incoming signals into a single `focus` string ([chat/route.ts:49–64](../src/app/api/chat/route.ts#L49-L64)):

```
if (location === 'shopify')            focus = 'shopify'
else if (location === 'woocommerce')   focus = 'woocommerce'
else if (location === 'chat')          focus = 'overview'   // Ask Claude tab → full context
else if (drillLevel === 'adgroups' …)  focus = 'adgroups'
else if (drillLevel === 'ads' …)       focus = 'ads'
else if (platform is meta/google/combined) focus = 'overview'
else                                   focus = location || 'overview'
```

The insight route is simpler — it passes `location || 'overview'` straight through ([insight/route.ts:44](../src/app/api/insight/route.ts#L44)).

| Surface | Tab user is on | `location` sent | Resulting `focus` mode |
|---|---|---|---|
| Insight banner, Overview | overview | `overview` | `overview` |
| Insight banner, Campaigns | campaigns | `campaigns` | `campaigns` |
| Insight banner, Keywords | keywords | `keywords` | `keywords` |
| Insight banner, Shopify | shopify | `shopify` | `shopify` |
| Ask Claude tab (any platform) | chat | `chat` | **`overview`** |
| Right panel, drilled into ad groups | (drill state) | — | `adgroups` |
| Right panel on a row | overview/campaigns | — | `row-context` (via the row string) |

**Key fact:** In the reported bug, the user is on the **Ask Claude tab**, so `location = 'chat'` → `focus = 'overview'`. In `overview` mode, **both** Google and Meta are supposed to render in full. So focus is *not* the thing hiding Meta.

### 1.3 What "focus" actually controls

Focus is normalized to a `FocusMode` ([build-claude-context.ts:90–107](../src/lib/intelligence/build-claude-context.ts#L90-L107)) and mapped to a `DataLimits` object ([build-claude-context.ts:109–143](../src/lib/intelligence/build-claude-context.ts#L109-L143)). Those limits are **counts only** — how many campaigns, ad groups, ads, keywords, search terms, audiences, asset groups, demographics to print.

Critically, **focus limits do NOT include a platform dimension.** There is no `limits.google` / `limits.meta`. The platform-rendering lines run unconditionally for every focus mode:

```ts
// build-claude-context.ts:787-788
if (intelligence.google) lines.push(buildPlatformSection(intelligence.google, 'Google', limits))
if (intelligence.meta)   lines.push(buildPlatformSection(intelligence.meta,   'Meta',   limits))
```

So the only way a platform disappears is if `intelligence.<platform>` is missing, or if `buildPlatformSection` returns an empty string.

### 1.4 The gap between "what the user thinks Claude sees" and "what Claude actually sees"

| Surface | User's mental model | Reality |
|---|---|---|
| **Ask Claude tab on Meta** | "I'm on Meta, asking about Meta — Claude is looking at my Meta data" | Claude is sent *all* platforms at `overview` limits. But **if Meta has no spend in the date range, the entire Meta section is silently dropped** and Claude only sees Google — while still being told it has everything. |
| **Insight banner on Shopify tab** | "Claude is summarizing my store" | `focus = 'shopify'` keeps full Shopify + 5 of each ad entity. Fine. |
| **Right panel on a campaign row** | "Claude is looking at this campaign" | `focus = row-context`; Claude gets a broad slice plus the row name. Fine. |
| **Any surface, any tab** | "If a metric is on my screen, Claude can quote it" | Mostly true for Google. For Meta, true **only when Meta had spend in the window**. The tab you're on is irrelevant to platform inclusion. |
| **Any surface** | "If Claude has no data it'll tell me" | False. The header asserts completeness (`784–785`), so Claude fills gaps by inventing. |

---

## Part 2 — Root cause analysis

### 2.1 Is this a regression, an uncovered case, or a fundamental design limitation?

**It is an uncovered case in the platform-section gate — present since the universal context builder was first written, and unrelated to the focus-aware slicing refactor.**

- Not a regression from `LORAMER_PROJECT_3_STEP_1_V1` (focus-aware slicing). That refactor added *count* limits; it did not touch platform inclusion. The bug would reproduce identically with focus slicing removed.
- It's an **uncovered edge case**: the code handles "platform connected with data" and "platform not connected," but treats "platform connected, but zero campaigns with spend in this date range" the same as "not connected at all" — it emits nothing.
- It tips into a **design limitation** because of the second half: the prompt *promises* all platforms unconditionally, so the empty case isn't just missing data — it actively invites hallucination.

### 2.2 The exact code that drops Meta

This is the gate, at the top of `buildPlatformSection`:

```ts
// build-claude-context.ts:205-206
function buildPlatformSection(platform: PlatformIntelligence, name: string, limits: DataLimits = DEFAULT_LIMITS): string {
  if (!platform?.connected || !platform.campaigns?.length) return ''
```

`!platform.campaigns?.length` is the trigger. If `campaigns` is an empty array, the function returns `''` and **no `=== META ADS ===` header is ever emitted** — along with every ad set, ad, placement, and targeting field, because they're all built inside this same function below the gate.

Why is Meta's `campaigns` empty? The Meta adapter only counts campaigns that spent money in the window:

```ts
// meta-intelligence.ts:93-96 — campaigns come from insights filtered by spend > 0
const campaignInsights = await fetchAll(
  `${META_API}/${actId}/insights?level=campaign&${dateParam}&fields=…&filtering=[{"field":"spend","operator":"GREATER_THAN","value":"0"}]&limit=100`,
  accessToken
)
// …
const campaigns: IntelligenceCampaign[] = campaignInsights.map(…)  // empty if nothing spent
```

The ad-set fetch is filtered the same way (`meta-intelligence.ts:124-127`). So in a no-spend window, `campaigns`, `adGroups`, and `ads` are all empty, and `totals` are all zero — the platform section collapses to nothing.

There is also a second, simpler path to the same symptom: if the client has **no Meta connection at all**, `intelligence.meta` is `undefined` ([intelligence/route.ts:239-244](../src/app/api/intelligence/route.ts#L239-L244) only sets `intelligence.meta` when `metaConn` exists), so line 788's `if (intelligence.meta)` is false and nothing renders. (This is the *correct* behavior — but the misleading header still fires; see 2.4.)

### 2.3 Is the focus/platform separation working as designed, or incorrectly?

**The focus → limits mapping is working as designed.** It is not the bug.

**The platform-inclusion logic is working incorrectly — but the bug is independent of focus.** Specifically:

- The gate at `206` conflates "no campaigns" with "nothing to say about this platform." A Meta account can have meaningful data (ad sets with targeting, placement spend, account-level signals) that the gate throws away the moment `campaigns` is empty.
- Note also that `placements`, `geographics`, `devices`, `hourly`, `impressionShares`, `recommendations`, and `conversionsByCampaign` are all rendered *inside* `buildPlatformSection`, **below** the line-206 gate. So even if Meta had rich placement data, an empty `campaigns` array discards it.

### 2.4 The hallucination trigger (the part that makes the bug dangerous)

```ts
// build-claude-context.ts:784-785
lines.push('\n=== COMPLETE ACCOUNT DATA ===')
lines.push('(You have access to ALL data from ALL platforms. Use all of it to answer questions.)')
```

This text is emitted **unconditionally**, before the platform sections, whether or not those sections turn out empty. When Meta silently drops out, Claude reads "you have access to all data from all platforms," sees only Google, and — being a helpful assistant told it has Meta — invents Meta targeting. This is **Lesson #11 (prompt-as-mirror)** wearing a different hat: the prompt makes a confident claim, and Claude mirrors the claim rather than the reality.

---

## Part 3 — The architectural question

### 3.1 Are per-platform tabs the right abstraction for the AI layer?

**For the dashboard display: yes.** Tabs are a fine way for a human to navigate Google vs. Meta vs. Shopify views.

**For the AI layer: they are a UI concept that should NOT leak into intelligence — and today, they *mostly* don't.** The intelligence pipeline already fetches every connected platform on every call and sends them all to Claude. The tab only adjusts *counts* via focus. So the abstraction is *already* close to "Claude sees everything." The problems are:

1. The empty-platform gate (Part 2) accidentally re-introduces a platform filter that the user can't see or predict.
2. The header over-promises, converting "missing" into "fabricated."
3. The focus modes are tuned around the old Google-Ads-dashboard mental model (campaigns/adgroups/ads/keywords), so Meta-shaped questions don't get a Meta-shaped slice — but since everything is sent anyway, this is a tuning issue, not a hard wall.

**Verdict:** Per-platform tabs are *not* deeply leaking into the AI layer. The brand-promise risk is real but the fix is surgical, not a rewrite.

### 3.2 What "Claude always sees everything connected for this client" looks like architecturally

It's close to what exists. The changes:

- **Remove the empty-campaigns gate** as the platform on/off switch. Render a platform section whenever the platform is *connected*, even if `campaigns` is empty — and in the empty case, emit an explicit, honest line: *"Meta is connected but had no spend in this date range; no campaign/ad-set data to show."* (This is the same "diagnose the empty state" discipline already used for PMax combinations at `build-claude-context.ts:381-392`.)
- **Make the header honest and dynamic.** Instead of always claiming "ALL data from ALL platforms," list which platforms are present *and populated* this turn, and state plainly when one is connected-but-empty. The header should describe reality, not aspiration.
- **Keep focus as a count-tuner, not a gate.** Focus stays useful for "how much detail," never "which platform."

### 3.3 Token / cost impact — quantified

Pricing references (Anthropic list prices): Sonnet 4.6 ≈ **$3 / million input tokens**; Haiku 4.5 ≈ **$0.80 / million input tokens**. Rough rule: ~4 characters ≈ 1 token.

**Estimated system-prompt size for a data-rich 3-platform client (Google + Meta + Shopify), at `overview` focus, full context:**

| Section | Approx chars | Approx tokens |
|---|---|---|
| Hard constraints + identity + profile + rules | ~2,500 | ~600 |
| Google: campaigns (15) | ~2,300 | ~580 |
| Google: ad groups (20) | ~3,600 | ~900 |
| Google: ads (20) | ~4,000 | ~1,000 |
| Google: keywords (20) + search terms (10) | ~4,500 | ~1,100 |
| Google: conversion actions + attribution | ~1,500 | ~380 |
| Google: audiences (10) + demographics (15) | ~2,700 | ~680 |
| Google: RSA assets (25) | ~2,000 | ~500 |
| Google: **PMax asset groups (8 × ~25 assets + combos)** | ~12,000 | **~3,000** |
| Google: geo (20) + device + hourly | ~3,500 | ~880 |
| Google: impression share | ~1,500 | ~380 |
| Google: **Recommendations (up to 100) + grounding** | ~9,500 | **~2,400** |
| Meta: campaigns + ad sets (targeting) + ads + placements | ~7,000 | ~1,750 |
| Shopify | ~500 | ~130 |
| Memory facts | ~1,500 | ~380 |
| **Conversation history (last 20 msgs × up to 800 chars)** | up to ~16,000 | **up to ~4,000** |
| **TOTAL (full context)** | **~74,000** | **~18,000–20,000 tokens** |

- **Cost per Sonnet chat call at full context:** ~18–20k input tokens × $3/M ≈ **$0.054–$0.060 per message** (input side). Output (up to 16k tokens) dominates and is unaffected by context size.
- **Cost per Haiku insight at full context:** ~18k × $0.80/M ≈ **$0.014 per insight**.

**What focus-aware slicing actually saves today:** The heaviest blocks are *not* focus-controlled. Recommendations is a hardcoded `.slice(0, 100)` ([build-claude-context.ts:522](../src/lib/intelligence/build-claude-context.ts#L522)), and **geo, device, hourly, impression share, placements, and conversion attribution have no limit gate at all** — they render in full for every focus mode (verified: lines 426, 439, 463, 499, 520, 549, 281 have no `limits.*` guard). PMax asset groups *are* gated but with a high limit (8 groups × 25 assets). So focus slicing only trims campaigns/adgroups/ads/keywords/search-terms/audiences/demographics — perhaps **3,000–5,000 tokens** out of ~18,000. **Realistic savings from focus slicing: ~20–25% of input tokens, i.e. roughly $0.012–$0.015 per Sonnet call.** That is the entire financial benefit the slicing complexity is buying.

**The much bigger lever — not pulled:** **No prompt caching is implemented anywhere** (verified: zero `cache_control` in `src/app/api/`). The system prompt is large and largely stable across the turns of a single conversation. Marking it cacheable would cut input cost on cache hits by ~90% (cached input ≈ $0.30/M for Sonnet). For a multi-turn conversation, prompt caching saves far more than focus slicing ever could — and it makes "send full context always" essentially free after the first turn.

### 3.4 What breaks vs. improves if focus-aware slicing were removed entirely

**Improves:**
- The Meta-missing class of bug becomes impossible to *worsen* via focus; every platform's full detail is always present.
- Cross-surface consistency gets stronger (every surface already trends toward `overview`).
- Brand promise ("Claude understands your whole business") is literally true.

**Breaks / risks:**
- **Prompt size grows on drill-down surfaces.** Today `ads` focus shows 30 ads / 3 campaigns; removing slicing means the full account every time. With 16k output already configured, and input at ~20k, this is tolerable on cost but could approach context limits for very large accounts (hundreds of campaigns, thousands of search terms).
- **Haiku insight banner** runs at 150–600 output tokens; feeding it a 20k-token prompt is fine for quality but slightly slower and ~$0.014 vs ~$0.011 per call. Negligible.
- **Latency**: bigger prompts = marginally slower first token. Prompt caching mitigates.
- The *legitimate* use of slicing — keeping a row-level "tell me about THIS ad" question from drowning in 100 campaigns — would be lost unless replaced (see Option C).

---

## Part 4 — Recommendations

### Option A — Tabs are visual filters only; always send full context to Claude
- **What:** Delete the focus→limits gating for platform/entity counts (or raise all limits to effectively "all"). Tabs change only what the *human* sees. Every Claude call gets every connected platform in full.
- **Cost:** ~$0.05–$0.06 input per Sonnet message *without* caching; **~$0.005–$0.01 with prompt caching** on multi-turn conversations. At today's ~10 customers this is rounding error. At scale, prompt caching keeps it flat.
- **Pros:** Brand promise becomes literally true; the whole class of "tab hid my data" bugs dies; simplest mental model.
- **Cons:** Largest prompts; needs prompt caching before scale; very large accounts could strain context windows without *some* cap.

### Option B — Question-intent-aware routing (a router LLM decides what to load)
- **What:** A cheap first-pass model reads the user's question and decides which data sections to assemble ("this is a Meta placement question → load Meta placements + ad sets; skip Google PMax").
- **Cost:** Adds a Haiku routing call (~$0.001) per message; *reduces* the main call's input.
- **Pros:** Scales to many platforms without bloating prompts; theoretically the "smartest" slice.
- **Cons:** **High complexity and a new failure mode** — if the router guesses wrong, you reintroduce exactly today's bug (Claude missing data it needs) but now non-deterministically and harder to debug. Violates "right > fast": it's a lot of machinery to solve a problem prompt caching solves for free at current scale. Premature.

### Option C — Hybrid: full context by default, slice only for explicitly narrow scope
- **What:** Default every surface to full context (Option A). Keep a *narrow-scope* slice **only** for the genuinely local case — a ✦ diamond on a single row, where the user pointed at one entity. Even then, never drop a *platform*; only reduce sibling-entity counts. Honest header always reflects what's actually included.
- **Cost:** Same as A for the common case; slightly cheaper for row-level questions.
- **Pros:** Keeps the one legitimate benefit of slicing (focused row questions) without the platform-hiding risk; brand-safe; modest complexity.
- **Cons:** Two code paths instead of one (but they already exist).

### Recommended: **Option C, with the Part-5 small fix shipped first — and prompt caching as the real cost answer.**

Reasoning:
- Option A is philosophically correct and matches the brand promise, but going all-in on "always everything" without **prompt caching** in place is the kind of thing that's cheap at 10 customers and surprising at 1,000. Caching is the right cost lever, not slicing.
- Option B is the wrong amount of cleverness for the problem. It trades a deterministic, one-line bug for a probabilistic, model-dependent one. That's a downgrade against "no same mistake twice."
- Option C preserves the one defensible reason slicing exists (a single-row question shouldn't haul in the entire account) while guaranteeing the brand-critical invariant: **a connected platform is never silently absent.** It's the smallest change that makes the promise true and stays true.

The decision order that respects "right > fast":
1. Ship the small fix (Part 5) to stop the bleeding and make the prompt honest.
2. Add prompt caching to `/api/chat` and `/api/insight` — this is the cost story, independent of slicing.
3. Then, deliberately, collapse toward Option C: full context by default, narrow slice only for explicit row scope.

---

## Part 5 — Sequencing

### 5.1 Smallest viable fix for today's bug (no redesign)

Two tiny, independent changes, both in `build-claude-context.ts`:

**Fix A — stop dropping a connected platform that has no campaigns.** Change the gate at line 206 so a *connected* platform always emits at least a header + honest empty-state, instead of returning `''`. Concretely: when `connected` is true but `campaigns` is empty, emit `=== META ADS === \n Meta is connected but recorded no spend in this date range — no campaign/ad-set/ad data for this window.` This mirrors the PMax empty-state pattern already in the file (lines 381–392), so it's a known-safe shape.

**Fix B — make the completeness header honest.** Replace the unconditional "You have access to ALL data from ALL platforms" (lines 784–785) with a line generated from which platforms are actually present and populated this turn — and explicitly naming any that are connected-but-empty. This removes the hallucination invitation.

Either fix alone reduces the harm; **both together** fully address the reported symptom (no fabricated Meta targeting; Claude can truthfully say "Meta had no spend in this range" instead of inventing). Neither touches the focus-slicing machinery, the API routes, or the dashboard. Both are single-file, content-idempotent, and `tsc`-safe — but per Lesson #14, treat them as non-trivial (template literals) and let Vercel be the final build check with a clean revert ready.

> Note on the *targeting-specifically* sub-symptom: even when Meta renders, **ad-set targeting is only printed if the targeting object has populated fields** (`build-claude-context.ts:229-239`). The Meta adapter *does* parse targeting (`meta-intelligence.ts:137-164`), but real-world Advantage+/automated ad sets often return sparse `targeting` specs, so the printed targeting can be thin. If Russ wants Claude to reliably quote *real* targeting, that's the pending **Patch 4b** work (see CONTINUE_HERE.md item 3), not part of this fix. The honest header (Fix B) at least stops Claude inventing targeting when the real data is absent.

### 5.2 The right longer-term shift

- Adopt **Option C**: full context by default; honest, dynamic header; narrow slice reserved for explicit single-row scope and even then never platform-dropping.
- Add **prompt caching** to both Claude routes (mark the large stable system-prompt prefix cacheable). This is the actual cost answer and unblocks "always send everything" at scale.
- Retire the count-based focus *gating* on platforms; keep focus only as a detail-depth hint.

### 5.3 Are the small fix and the long-term shift compatible?

**Yes — the small fix is a clean stepping stone and locks in nothing wrong.**

- Fix A (honest empty-state instead of silent drop) is *exactly* the invariant Option C depends on: "a connected platform is never silently absent." Shipping it now moves toward the target architecture, not away from it.
- Fix B (honest header) is required under every option (A, B, and C all need the prompt to describe reality). It can never be wasted work.
- Neither fix entrenches focus-aware slicing; they sit *beside* it and survive its eventual removal untouched.

There is no version of the long-term design where today's small fix has to be undone. That's the test for a good stepping stone, and this passes it.

---

## Related findings (noted, not fixed — per audit constraints)

1. **Dead payload:** `sendChat()` sends `platformData` in the `/api/chat` body ([page.tsx:2848](../src/app/dashboard/page.tsx#L2848)), but the route ignores it and re-fetches intelligence server-side. Harmless but wasteful; remove when convenient.

2. **Unconditional heavy sections:** Recommendations (hardcoded `.slice(0,100)`, [build-claude-context.ts:522](../src/lib/intelligence/build-claude-context.ts#L522)) and geo/device/hourly/impression-share/placements/conversion-attribution have **no focus limit** — they render in full on every call including the 600-token Haiku insight. If cost ever matters, these are the real targets, not campaign counts.

3. **Raw-debug code still in production prompt path:** `meta-intelligence.ts:204-224` (`LORAMER_META_PLACEMENT_RAW_DEBUG_V1`) still does a direct fetch capturing `placementRawStatus` / `placementRawBodyPreview`. Lesson #15 says always pair the diagnostic with a cleanup patch — this one looks un-cleaned-up. Worth confirming it isn't bloating prompts or leaking raw API bodies.

4. **Meta spend>0 filter is invisible to the user.** Because campaigns/ad-sets/ads are all filtered `spend > 0` ([meta-intelligence.ts:94,125,168](../src/lib/intelligence/meta-intelligence.ts#L94)), a paused-but-recently-active Meta account looks empty to Claude in any zero-spend window. This is arguably correct for performance analysis but is the proximate trigger for the reported bug. Consider whether ad-set *structure* (targeting, names) should be fetched independent of the spend filter so "what's my targeting?" works even in a quiet window.

5. **`totals` for Meta are computed only from spend>0 campaigns** ([meta-intelligence.ts:252-257](../src/lib/intelligence/meta-intelligence.ts#L252-L257)), so account totals also vanish in a no-spend window even though Meta is connected.

6. **Uncertainty I could not resolve from code alone:** I cannot tell from the source whether, in the *specific* incident Russ saw, `intelligence.meta` was `undefined` (no Meta connection passed through) or present-but-empty (`campaigns: []`). Both produce the identical symptom. Confirming which would take one live check — e.g. temporarily logging `Object.keys(intelligence)` and `intelligence.meta?.campaigns?.length` for that client+date-range, or asking Claude to quote the section headers it sees (Lesson #15 style). I did not run it because this is a read-only audit.

---

## Appendix — Honesty notes

- **Where the prompt's premise was wrong:** the task framed this as focus-aware slicing "filtering OUT data the user wants Claude to see." After reading the code, focus-aware slicing does not filter platforms — it only sets counts, and both platforms render for `overview` (the Ask Claude tab's mode). I'm flagging this directly because "right > fast" means correcting the diagnosis, not confirming it. The real cause is the empty-campaigns gate plus the over-promising header.
- **What I verified by reading:** the two Claude routes, `build-claude-context.ts` in full, `intelligence-types.ts`, `intelligence/route.ts`, `meta-intelligence.ts`, `shopify-intelligence.ts`, and the three dashboard surfaces (`RightPanel.send`, `InsightChat.fetchInsight`, `ChatTab.sendChat`). I confirmed prompt caching is absent and that the heavy sections are ungated.
- **What I did NOT verify:** live runtime values for the incident (read-only); `google-intelligence.ts` internals (read its outputs via the types and the builder, not line-by-line — token counts for the Google section are estimates); exact Anthropic list prices at today's date (used standard published rates — directionally correct, not billing-exact).
