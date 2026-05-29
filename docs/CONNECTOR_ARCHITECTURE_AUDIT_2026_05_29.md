# Connector Architecture Audit — Abstract Now, or Ship GA First?

*Read-only audit. No code was changed. Written May 29, 2026 (afternoon).*
*Author: Claude (Opus 4.8), at Russ's request. Companion to the morning's `INTELLIGENCE_ARCHITECTURE_AUDIT_2026_05_29.md`.*

---

## TL;DR for Russ (read this first)

**Recommendation: Ship GA in the current pattern now. Do NOT refactor the four existing connectors first. Extract the abstraction incrementally — and start with the one piece that's genuinely worth it today (the connection UI), not the OAuth plumbing.**

The honest finding: the duplication is **real but moderate, and the most-duplicated layer is already half-solved.** `platform_connections` is already a polymorphic table that handles any platform ([clients/connections/route.ts:12-19](../src/app/api/clients/connections/route.ts#L12-L19)). The intelligence adapters already share one output type (`PlatformIntelligence`). The OAuth flows, by contrast, are genuinely heterogeneous — they're *not* four copies of one thing, they're four different things (one isn't even OAuth). Forcing them under a single interface today would be **premature abstraction on dissimilar examples**, which produces the wrong interface and risks four live, working, App-Store-approved integrations.

Three things are worth unifying, in this order of value-per-risk:
1. **The `/clients` connection UI** — this is the worst, cleanest duplication (4 near-identical hardcoded pill blocks + 4 connection rows + 3 modals). Additive, low-risk, makes every future connector's UI nearly free. Do this *alongside* GA.
2. **Token storage** — 4 tables that are a superset apart. Unify when you add connector #6, not before.
3. **A `Connector` interface** — design it once GA exists, because GA is the *third* clean-OAuth example (with Shopify and the future ones) and the Rule of Three finally applies. Migrate connectors behind it one at a time.

On the aggregator question: **Unified.to and Merge.dev do not meaningfully cover LoraMer's core platforms.** They serve B2B SaaS categories (CRM, HRIS, accounting, ticketing). Ad networks — your actual long tail (TikTok, Bing, Amazon, LinkedIn, Pinterest, Snapchat, Reddit) — are served by *marketing-specific* aggregators (Supermetrics, Improvado, Windsor.ai, Fivetran), which are far pricier and often warehouse-based. The roadmap's premise here is slightly off and I'm flagging it directly (honesty > confidence). Native wins for the top ~6-8; reconsider a marketing aggregator only for the genuine tail, and only when a paying customer asks.

---

## Part 1 — Map of the current state

### 1.0 The four connectors at a glance

| Connector | Auth mechanism | Token table | Refresh | Intelligence adapter | Prompt section | Category |
|---|---|---|---|---|---|---|
| **Google Ads** | **None of its own** — piggybacks on NextAuth login `refreshToken` | *none* (uses session) | via `google-ads-api` lib (refresh token → access token internally) | `google-intelligence.ts` (797 lines) | `buildPlatformSection` (shared) | Ads |
| **Meta Ads** | OAuth2 code flow + short→long-lived exchange | `meta_tokens` (user-scoped) | **none** (~60-day long-lived; manual reconnect) | `meta-intelligence.ts` (287 lines) | `buildPlatformSection` (shared) | Ads |
| **Shopify** | OAuth2 code flow + HMAC verify + expiring offline tokens + 2 entry branches | `shopify_tokens` (full rotation fields) | **full helper** `getValidShopifyToken` with rotation | `shopify-intelligence.ts` (154 lines) | hardcoded `=== SHOPIFY ===` block | E-commerce |
| **WooCommerce** | **Not OAuth** — WordPress REST API key handshake | `woocommerce_tokens` (key+secret) | **none** (permanent keys) | `woocommerce-intelligence.ts` | hardcoded `=== WOOCOMMERCE ===` block | E-commerce |

The single most important structural fact: **these are not four instances of one pattern. They are four genuinely different integration shapes** — a login-piggyback, two dissimilar OAuth2 flows, and a non-OAuth key handshake. That matters enormously for whether a single interface is the right move (see Part 2).

### 1.1 OAuth flow — what's duplicated vs. what genuinely varies

**Genuinely varies (irreducible per-connector logic):**
- **Google Ads has no OAuth route at all.** It reuses the NextAuth Google login. The intelligence route passes `session.refreshToken` straight into the adapter ([intelligence/route.ts:159-170](../src/app/api/intelligence/route.ts#L159-L170)). There is no `/api/google/callback`, no `google_tokens` table.
- **Meta** does a *two-step* token exchange — short-lived code exchange ([meta/callback/route.ts:73-74](../src/app/api/meta/callback/route.ts#L73-L74)) then a long-lived exchange ([meta/callback/route.ts:78-80](../src/app/api/meta/callback/route.ts#L78-L80)) — then fans out across direct ad accounts + Business Managers + owned + client accounts ([meta/callback/route.ts:4-49](../src/app/api/meta/callback/route.ts#L4-L49)). This account-discovery logic is Meta-specific and substantial.
- **Shopify** verifies an **HMAC signature** ([shopify/callback/route.ts:27-34](../src/app/api/shopify/callback/route.ts#L27-L34)), requests **expiring offline tokens** (`expiring: '1'`, [shopify/callback/route.ts:58](../src/app/api/shopify/callback/route.ts#L58)), and handles **two entry shapes** — in-app modal vs. App-Store-initiated install with auto-user-creation ([shopify/callback/route.ts:97-224](../src/app/api/shopify/callback/route.ts#L97-L224)). This is by far the most complex flow and is App-Store-approved — touch with extreme care.
- **WooCommerce** isn't OAuth: it redirects to the store's `wc-auth/v1/authorize` page ([woocommerce/auth/route.ts:63](../src/app/api/woocommerce/auth/route.ts#L63)) and WordPress **POSTs** `consumer_key`/`consumer_secret` to a public callback ([woocommerce/callback/route.ts:22-51](../src/app/api/woocommerce/callback/route.ts#L22-L51)). No code exchange, no token endpoint.

**Genuinely duplicated (copy-paste across the OAuth-style flows):**
- **State encoding:** base64-JSON of `{clientId, email}` appears in Meta ([meta/auth/route.ts:15](../src/app/api/meta/auth/route.ts#L15), [meta/callback/route.ts:62](../src/app/api/meta/callback/route.ts#L62)) and Shopify ([shopify/callback/route.ts:41](../src/app/api/shopify/callback/route.ts#L41)). GA will repeat it.
- **Redirect-with-error-param** on every failure path (`?meta_error=…`, `?shopify_error=…`, `?woo_error=…`) — same shape, different prefix, ~6 times per file.
- **`platform_connections` delete-then-insert** to replace a prior connection: Shopify ([shopify/callback/route.ts:101-113](../src/app/api/shopify/callback/route.ts#L101-L113)) and WooCommerce ([woocommerce/callback/route.ts:78-90](../src/app/api/woocommerce/callback/route.ts#L78-L90)) do this identically; the WooCommerce comment even says *"Use the Shopify pattern"* ([woocommerce/callback/route.ts:76-77](../src/app/api/woocommerce/callback/route.ts#L76-L77)) — a literal admission of copy-paste.
- **Token upsert** into the per-platform table at the end of the callback.

**Verdict:** ~30-40% of each callback is boilerplate (state, redirects, connection write). The remaining 60-70% is real, platform-specific protocol work that no abstraction removes. A shared helper library (`encodeState`, `writeConnection`, `redirectError`) would capture the duplicated part **without** forcing the flows into one shape.

### 1.2 Token storage — four tables, one missing superset

| Field | `meta_tokens` | `shopify_tokens` | `woocommerce_tokens` | `ga_tokens` (planned) |
|---|---|---|---|---|
| `user_email` | ✅ | ✅ | ✅ | ✅ |
| `client_id` | ❌ (user-scoped!) | ❌ (shop-scoped) | ✅ | ✅ |
| account/scope key | — | `shop_domain` | `store_url` | `ga_property_id` |
| `access_token` | ✅ | ✅ | — (uses key/secret) | ✅ |
| `refresh_token` | ❌ | ✅ | ❌ | ✅ |
| `expires_at` | ❌ | ✅ | ❌ | ✅ |
| `refresh_token_expires_at` | ❌ | ✅ | ❌ | ❌ |
| secondary creds | — | — | `consumer_key`,`consumer_secret` | — |
| `scope` | ❌ | ✅ | ✅ | ❌ |

Sources: [meta/callback/route.ts:86-90](../src/app/api/meta/callback/route.ts#L86-L90); [shopify/callback/route.ts:115-129](../src/app/api/shopify/callback/route.ts#L115-L129); [woocommerce/callback/route.ts:55-68](../src/app/api/woocommerce/callback/route.ts#L55-L68); GA design doc schema ([GA_CONNECTOR_DESIGN_2026_05_29.md:102-117](GA_CONNECTOR_DESIGN_2026_05_29.md)).

**Are these legitimately different, or four near-identical tables?** Mostly the latter. Every column above fits in **one polymorphic `connector_credentials` table** with a `platform` column and a JSONB `credentials` blob for the variable parts (key/secret, property_id, shop_domain). The genuinely-different bits (Meta has no client_id; WooCommerce uses key/secret instead of a bearer token) are exactly what a JSONB column absorbs cleanly.

**Two real inconsistencies worth noting (not just cosmetic):**
- **`meta_tokens` is scoped by `user_email` only — no `client_id`** ([meta/callback/route.ts:86-90](../src/app/api/meta/callback/route.ts#L86-L90)). One Meta token serves *all* of a user's clients. That's defensible (one Meta login, many ad accounts) but it's a different scoping model than the others, and it's why disconnecting Meta only deletes the `platform_connections` row, not the token.
- **`platform_connections` already IS the polymorphic layer.** It takes any `platform` string and is written by a single generic endpoint ([clients/connections/route.ts](../src/app/api/clients/connections/route.ts)). So the join/registry table is *already abstracted*. Only the **credential** tables are un-unified.

### 1.3 Token refresh — only one connector actually refreshes

- **Shopify:** the only real refresh helper. `getValidShopifyToken` checks expiry with a 5-min buffer, refreshes, and **critically saves the rotated refresh token** ([shopify-token.ts:91-103](../src/lib/shopify-token.ts#L91-L103)). It also handles legacy non-expiring tokens ([shopify-token.ts:37-39](../src/lib/shopify-token.ts#L37-L39)) and a typed result union for failure modes ([shopify-token.ts:16-18](../src/lib/shopify-token.ts#L16-L18)). This is the gold-standard pattern.
- **Google Ads:** refresh is handled *inside* the `google-ads-api` library — the adapter just passes `refresh_token` to `client.Customer({...})` ([google-intelligence.ts:92-93](../src/lib/intelligence/google-intelligence.ts#L92-L93)). No LoraMer code owns it.
- **Meta:** **no refresh at all.** The long-lived token (~60 days) is read directly from `meta_tokens` in the intelligence route ([intelligence/route.ts:176-180](../src/app/api/intelligence/route.ts#L176-L180)). When it expires, the user reconnects. No `expires_at` is even stored.
- **WooCommerce:** **no refresh** — consumer key/secret are permanent until revoked.
- **GA (planned):** `getValidGaToken` mirroring Shopify ([GA design doc:122-131](GA_CONNECTOR_DESIGN_2026_05_29.md)), with the nuance that Google rotates the refresh token *sometimes* (unlike Shopify's always) — handled by always writing back whatever the response returns.

**Verdict:** There's a clean abstraction *latent* here — `getValid<X>Token(scopeKeys) → {ok, accessToken} | {ok:false, reason}` — and Shopify already embodies it. But two of four connectors don't refresh at all, so the abstraction is a **2-of-5 pattern today, 3-of-5 with GA.** Worth formalizing once GA validates it as the third instance. Not worth retrofitting Meta/Woo (which legitimately don't need it).

### 1.4 Intelligence adapters — strong shared shape already

All adapters share a clean contract:

```
fetch<Platform>Intelligence(creds, accountId, dateRange, customStart?, customEnd?)
  → Promise<PlatformIntelligence | IntelligenceShopify>
```

Sources: [google-intelligence.ts:81-91](../src/lib/intelligence/google-intelligence.ts#L81-L91); [meta-intelligence.ts:77-83](../src/lib/intelligence/meta-intelligence.ts#L77-L83); [shopify-intelligence.ts:30-36](../src/lib/intelligence/shopify-intelligence.ts#L30-L36).

**Shared / boilerplate (repeats in every adapter):**
- A `buildMetrics()` mapper to the common `IntelligenceMetrics` shape ([google-intelligence.ts:19-38](../src/lib/intelligence/google-intelligence.ts#L19-L38); [meta-intelligence.ts:18-60](../src/lib/intelligence/meta-intelligence.ts#L18-L60)).
- A date-range translator (`buildDateFilter` GAQL vs `buildDatePreset` Meta vs inline Shopify) ([google-intelligence.ts:8-17](../src/lib/intelligence/google-intelligence.ts#L8-L17); [meta-intelligence.ts:9-16](../src/lib/intelligence/meta-intelligence.ts#L9-L16); [shopify-intelligence.ts:44-54](../src/lib/intelligence/shopify-intelligence.ts#L44-L54)).
- A pagination helper (`fetchAll`) for the Graph API ([meta-intelligence.ts:62-75](../src/lib/intelligence/meta-intelligence.ts#L62-L75)).

**Genuinely varies (irreducible):** the query language itself — GAQL, Graph API field/breakdown strings, Shopify GraphQL, Woo REST. This is the actual work and no interface removes it.

**Output divergence to note:** ad platforms return the rich `PlatformIntelligence` (campaigns/adGroups/ads/…); e-commerce returns the much smaller `IntelligenceShopify` ([intelligence-types.ts:297-311](../src/lib/intelligence/intelligence-types.ts#L297-L311)), and WooCommerce **reuses the Shopify type** ([intelligence-types.ts:395](../src/lib/intelligence/intelligence-types.ts#L395)). GA will need a *third* output shape (`IntelligenceGa`) — sessions/sources/landing-pages don't fit either existing type. So the "one output type" story is really "two-and-soon-three families": **Ads**, **Commerce**, **Analytics**.

**Verdict:** This layer is **already well-factored.** The contract is uniform; the per-platform code is irreducible query work. ~20% is boilerplate (metrics/date/pagination helpers) that could move to a shared module. No urgent refactor needed.

### 1.5 Prompt rendering — ads share a template; commerce is copy-paste

- **Google + Meta** both render through the single `buildPlatformSection()` ([build-claude-context.ts:206](../src/lib/intelligence/build-claude-context.ts#L206), called at [836-837](../src/lib/intelligence/build-claude-context.ts#L836-L837)). One template, two platforms. Good.
- **Shopify and WooCommerce** are **two near-identical hardcoded blocks** ([build-claude-context.ts:839-867](../src/lib/intelligence/build-claude-context.ts#L839-L867) and [869-890](../src/lib/intelligence/build-claude-context.ts#L869-L890)) — same fields (revenue, orders, AOV, customers, top products), different header and variable name. Textbook duplication; a `buildCommerceSection(data, name)` would collapse both.
- **GA** will be a *third* render shape (sessions/sources/funnel), per the design doc ([GA design doc:197-201](GA_CONNECTOR_DESIGN_2026_05_29.md)).

**Note (good news from this morning):** the prompt builder was refactored today into `buildClaudeContextCacheable() → {prefix, suffix}` for prompt caching ([build-claude-context.ts:729-733](../src/lib/intelligence/build-claude-context.ts#L729-L733)), and the misleading completeness header from the morning audit is **fixed** — it now reports per-platform status dynamically ([build-claude-context.ts:821-829](../src/lib/intelligence/build-claude-context.ts#L821-L829)). GA's design doc already says to extend that dynamic header ([GA design doc:199](GA_CONNECTOR_DESIGN_2026_05_29.md)). The render layer is in good shape; only the commerce duplication is a wart.

### 1.6 Connect/disconnect UX — the worst duplication in the codebase

The `/clients` page (1,189 lines) has **no reusable connection component.** Per platform it hardcodes:
- A **pill** (connected button + "+ Connect" affordance) — Google [838-845](../src/app/clients/page.tsx#L838-L845), Meta [848-861](../src/app/clients/page.tsx#L848-L861), Shopify [864-876](../src/app/clients/page.tsx#L864-L876), WooCommerce [878-889](../src/app/clients/page.tsx#L878-L889). Each ~12 lines of nearly identical JSX differing only in brand color, SVG icon, and connect URL.
- A **connection row** in the expanded panel — Google [927-940](../src/app/clients/page.tsx#L927-L940), Meta [941-956](../src/app/clients/page.tsx#L941-L956), Shopify [957-975](../src/app/clients/page.tsx#L957-L975), WooCommerce [976-994](../src/app/clients/page.tsx#L976-L994). Same structure, four copies.
- A **connect modal** — Meta uses an account-picker (post-OAuth), Shopify [1117](../src/app/clients/page.tsx#L1117) and WooCommerce [1145](../src/app/clients/page.tsx#L1145) use domain-input modals.

**Disconnect is inconsistent across platforms** (a reliability smell):
- Meta → `disconnectMeta()` helper ([clients/page.tsx:771-775](../src/app/clients/page.tsx#L771-L775)).
- Shopify → inline `fetch(DELETE)` then `fetchClients()`, **no confirm** ([clients/page.tsx:968-973](../src/app/clients/page.tsx#L968-L973)).
- WooCommerce → inline `fetch(DELETE)` **with** a `confirm()` ([clients/page.tsx:987-992](../src/app/clients/page.tsx#L987-L992)).
- Google → **no disconnect button at all** (it's the NextAuth login, so there's nothing per-client to revoke).

**Verdict:** This is the highest-value, lowest-risk target. A registry-driven `<ConnectionPill>` / `<ConnectionRow>` reading from a `CONNECTORS` metadata table would delete ~200 lines of JSX and make every future connector's UI a one-line registry entry. It touches no OAuth, no tokens — purely presentational.

### 1.7 Summary: what's actually duplicated

| Layer | Duplication level | Already abstracted? | Worth unifying? |
|---|---|---|---|
| `platform_connections` join table | none | ✅ already polymorphic | already done |
| Intelligence adapter contract | low | ✅ uniform signature + output families | helpers only (~20%) |
| Prompt render (ads) | none | ✅ `buildPlatformSection` | done |
| Prompt render (commerce) | **high** (2 copies) | ❌ | yes — small |
| Token refresh | n/a (2 of 4 don't refresh) | partial (Shopify is the model) | formalize at GA |
| OAuth callbacks | medium (~35% boilerplate) | ❌ | helpers, not one interface |
| Token storage tables | **high** (4 superset tables) | ❌ | yes — at connector #6 |
| **`/clients` connection UI** | **highest** (4× pills+rows+modals) | ❌ | **yes — now** |

---

## Part 2 — The "ideal Connector" abstraction

The right abstraction is a **registry of declarative connector descriptors** plus **three small strategy functions per connector**, not a single god-interface that pretends Google-login, Meta-OAuth, and Woo-key-handshake are the same thing. The descriptor captures what's *declarative* (metadata, UI, scoping); the strategy functions capture what's *behavioral* (auth, refresh, fetch, render). An aggregator becomes just another descriptor whose strategy functions call the aggregator's SDK.

```ts
// src/lib/connectors/types.ts  (proposed — does not exist yet)

export type ConnectorCategory = 'ads' | 'commerce' | 'analytics'

export type AuthStrategy =
  | { kind: 'oauth2'; authUrl: string; scopes: string[]; tokenExchange: 'standard' | 'meta-longlived' | 'shopify-expiring' }
  | { kind: 'apikey-handshake'; initiateUrl: (shop: string) => string }   // WooCommerce
  | { kind: 'session-piggyback' }                                          // Google Ads (NextAuth)
  | { kind: 'aggregator'; provider: 'unified' | 'merge' | 'supermetrics' } // future

export interface ConnectorDescriptor<TData = unknown> {
  // ── Declarative metadata (drives ALL UI from one place) ──
  id: string                      // 'google' | 'meta' | 'shopify' | 'woocommerce' | 'ga' | ...
  displayName: string             // 'Google Ads', 'Google Analytics'
  category: ConnectorCategory
  brandColor: string              // '#4285F4'
  icon: 'google' | 'meta' | 'shopify' | 'woo' | 'ga'
  scoping: 'per-client' | 'per-user'   // Meta is per-user; most are per-client

  // ── Behavioral strategies ──
  auth: AuthStrategy

  // Returns a usable access credential, refreshing if needed. null strategies
  // (Woo key/secret, session-piggyback) just return what they have.
  getCredential(ctx: { clientId: string; userEmail: string }):
    Promise<{ ok: true; cred: Credential } | { ok: false; reason: string }>

  // The only irreducible work: platform query → typed slice of intelligence.
  fetchIntelligence(cred: Credential, range: DateRange): Promise<TData>

  // How this connector's data renders into Claude's prompt.
  renderPromptSection(data: TData, limits: DataLimits): string
}
```

Credentials live in **one** polymorphic table instead of four:

```sql
-- replaces meta_tokens / shopify_tokens / woocommerce_tokens / ga_tokens
create table connector_credentials (
  id            uuid primary key default gen_random_uuid(),
  platform      text not null,                 -- 'meta' | 'shopify' | 'ga' | ...
  user_email    text not null,
  client_id     uuid references clients(id) on delete cascade,  -- null for per-user (Meta)
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  credentials   jsonb default '{}',            -- shop_domain, consumer_key/secret, ga_property_id, scope, ...
  updated_at    timestamptz default now(),
  unique (platform, user_email, coalesce(client_id, '00000000-0000-0000-0000-000000000000'))
);
```

The registry wires everything:

```ts
// src/lib/connectors/registry.ts
export const CONNECTORS: Record<string, ConnectorDescriptor> = {
  google: googleAdsConnector,
  meta: metaConnector,
  shopify: shopifyConnector,
  woocommerce: wooConnector,
  ga: gaConnector,
}
```

Then the three big consumers stop having per-platform branches:

```ts
// /api/intelligence — replaces the 4 hand-written Promise.allSettled branches
const slices = await Promise.allSettled(
  connections.map(async c => {
    const conn = CONNECTORS[c.platform]
    const cred = await conn.getCredential({ clientId, userEmail })
    return cred.ok ? { id: c.platform, data: await conn.fetchIntelligence(cred.cred, range) } : null
  })
)

// build-claude-context — replaces the per-platform if-blocks
for (const slice of populatedSlices) lines.push(CONNECTORS[slice.id].renderPromptSection(slice.data, limits))

// /clients UI — replaces 4 hardcoded pills/rows/modals
{Object.values(CONNECTORS).map(c => <ConnectionPill key={c.id} connector={c} client={client} />)}
```

### 2.1 GA under the current pattern vs. under the abstraction

**Current pattern (what the GA design doc specifies — ~6 new files):**
`/api/ga/start`, `/api/ga/callback`, `/api/ga/properties`, `/api/ga/connect`, `/api/ga/disconnect`, `ga-token.ts`, `ga-intelligence.ts`, a new `ga_tokens` table, plus hand-edits to `/api/intelligence`, `build-claude-context`, and `/clients`. (Estimate: 1-2 focused days, low risk — it mirrors Shopify, which works.)

**Under the abstraction (what connector #6 onward would look like):**
```ts
// src/lib/connectors/ga.ts — ONE file
export const gaConnector: ConnectorDescriptor<IntelligenceGa> = {
  id: 'ga', displayName: 'Google Analytics', category: 'analytics',
  brandColor: '#E8710A', icon: 'ga', scoping: 'per-client',
  auth: { kind: 'oauth2', authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
          scopes: ['https://www.googleapis.com/auth/analytics.readonly'], tokenExchange: 'standard' },
  getCredential: oauth2Credential('ga'),      // shared helper handles refresh + rotation
  fetchIntelligence: fetchGaIntelligence,      // the only real work: 7 runReport queries
  renderPromptSection: renderGaSection,        // the GA prompt block
}
// + register one line in registry.ts. No new routes, no new table, no UI edits.
```

The abstraction turns GA from ~6 files + a table + 3 hand-edits into **1 file + 1 registry line + the genuinely-new query/render code.** That's the 3-day → 1-day win — but only realized *after* the abstraction exists and is paid for.

---

## Part 3 — Migration path (the three options, honestly weighed)

**Option A — Refactor the 4 existing connectors into the interface FIRST, then build GA as the first clean implementation.**
- Pro: GA ships into a clean world; one consistent pattern from here on.
- Con: You refactor **four live, working integrations** — including an **App-Store-approved Shopify flow** with HMAC, expiring tokens, two entry branches, and compliance webhooks — to enable a feature that doesn't need the refactor. This is precisely the "refactor working code speculatively" move that the handoff's "right > fast" warns against. High blast radius, zero user-visible benefit, and it delays the brand-promise feature (GA). **Reject.**

**Option B — Build GA in the current pattern, refactor everything together later.**
- Pro: GA ships fast and low-risk (it's already designed). Refactor happens once you have real evidence of the shape.
- Con: GA adds a 5th hand-written instance, so the eventual refactor is slightly bigger. Acceptable — the instances are cheap to migrate one at a time.
- This is the **safe default.**

**Option C — Build GA in the NEW pattern without refactoring the existing 4 (parallel patterns for a while).**
- Pro: GA validates the abstraction immediately; new connectors adopt it; old ones migrate opportunistically.
- Con: Two patterns coexist temporarily (some cognitive overhead). But this is *normal, healthy* strangler-fig migration — far safer than a big-bang rewrite.
- The risk is over-designing the interface from a single new example.

**Recommended: a disciplined blend of B and C.** Build GA's *data and OAuth* in the current pattern (Option B — it's designed, safe, ships the feature). Simultaneously, extract **only the connection UI registry** (the Part 1.6 win) and route GA's UI through it as the first registry citizen (a slice of Option C that touches no OAuth). Defer the token-table unification and the full `Connector` interface until connector #6, when you'll have **three clean OAuth examples (Shopify, GA, #6)** and the Rule of Three tells you the real shape. Designing the interface from today's four heterogeneous examples would bake in the wrong abstraction.

---

## Part 4 — The aggregator question (Unified.to / Merge.dev)

### 4.1 The uncomfortable truth: the named aggregators don't cover your platforms

**Merge.dev** and **Unified.to** are *Unified API* providers for **B2B SaaS categories**: CRM, HRIS/payroll, accounting, ticketing, file storage, ATS, and (more recently) marketing-automation and CRM-adjacent tools. **They do not provide unified access to ad networks** (Google Ads, Meta Ads, TikTok Ads, Bing, Amazon Ads, LinkedIn Ads, Pinterest, Snapchat, Reddit). Your roadmap's long tail is *overwhelmingly ad networks* — exactly what these two don't serve.

- Of your future list, the only ones a SaaS unified-API *might* cover: **Klaviyo** (marketing automation) and **Stripe** (payments — though Stripe's own API is famously clean, so an aggregator adds little). **Triple Whale** is itself an aggregator/BI product, not something you'd pull via Merge.
- The aggregators that *do* cover ad networks are **marketing-data platforms**: **Supermetrics, Improvado, Windsor.ai, Adverity, Fivetran (marketing connectors)**. These are a different cost class and often **warehouse/ETL-oriented** (they sync to BigQuery/Snowflake on a schedule) rather than giving you live, on-demand API reads — which is a poor fit for LoraMer's 15-min on-demand intelligence model.

**So the roadmap premise ("use Unified.to/Merge.dev for the long tail") is partly mistaken, and I'm flagging it rather than rationalizing it.** The real choice for the ad-network tail is *native vs. a marketing-ETL aggregator*, not native vs. Merge.

### 4.2 The cost/quality/time trade-off, quantified

| Dimension | Native (with the Part 2 abstraction) | Marketing aggregator (Supermetrics/Windsor/Improvado class) |
|---|---|---|
| **Eng time per connector** | ~1 day once abstraction exists (mostly query + render) | ~0.5 day to map their schema → your `IntelligenceX` type |
| **Recurring cost** | $0 (just your API quotas) | ~$200–$2,000+/mo entry, scaling with connectors/rows/clients; ad-network ETL tools commonly $1k–$10k+/mo at agency scale |
| **Data freshness** | On-demand, real-time (fits 15-min cache) | Often scheduled syncs (hourly/daily) → **breaks the "live" feel** |
| **Data quality/fidelity** | Full API surface; you choose every field (you've already hit cases where the *exact* field matters — Meta breakdowns, GAQL nuances) | Normalized to *their* schema; you lose access to platform-specific fields the BI depth depends on |
| **Maintenance** | You own breakage when APIs change | They own breakage — real value for rarely-touched platforms |
| **Auth/compliance** | You hold every OAuth app + verification (e.g. Google sensitive-scope review) | They hold the OAuth apps — removes a real burden for the tail |

### 4.3 When does the math flip?

Native wins while **(value per connector is high)** AND **(your abstraction keeps native cheap)** AND **(real-time + full-fidelity matters)** — i.e. your **top ~6-8 platforms**: Google Ads, Meta, Shopify, GA, WooCommerce, plus the next 2-3 most-requested (likely TikTok, Bing, Klaviyo). For these, native is both cheaper *and* better, and the depth is the moat.

The math flips toward an aggregator only when **all** of these hold: the platform is **rarely used** by your customers (Reddit, Snapchat, X for most agencies), **maintenance burden per use is high**, **freshness tolerance is loose**, and **you're past ~connector #10** where native eng time competes with other roadmap work. Even then, prefer a marketing aggregator that offers **live API proxying** (Windsor.ai is closer to this than Supermetrics' warehouse model) so you don't break the on-demand model.

**Recommendation:** Build native for the top 6-8 behind the Part 2 abstraction. Do **not** adopt Merge.dev/Unified.to (wrong category). Re-evaluate a *marketing-specific* aggregator for the genuine tail (Reddit/Snapchat/X/Pinterest) only when a **paying customer** asks for one of them — and even then, model it as **one more `ConnectorDescriptor` with `auth.kind: 'aggregator'`**, so it's a single implementation of the interface, never a parallel system.

---

## Part 5 — Recommendation (concrete sequence)

**Before resuming GA Phase 2, do exactly one cheap thing. Then ship GA. Then abstract incrementally.**

1. **Now (½ day, low risk, additive): extract the connection-UI registry.** Create `src/lib/connectors/registry.ts` with a `CONNECTORS` metadata table (id, displayName, brandColor, icon, category, connectUrl, scoping) for the existing four, and a `<ConnectionPill>` + `<ConnectionRow>` component. Re-route `/clients` through them. This deletes the worst duplication (Part 1.6), touches **no OAuth/tokens**, and gives GA's UI for free. Also fold the two commerce prompt blocks into one `buildCommerceSection()` ([build-claude-context.ts:839-890](../src/lib/intelligence/build-claude-context.ts#L839-L890)) while you're in there — trivial and safe.

2. **Then: ship GA exactly as its design doc specifies (current pattern).** Phases 2-6 of [GA_CONNECTOR_DESIGN_2026_05_29.md](GA_CONNECTOR_DESIGN_2026_05_29.md). Add GA to the new `CONNECTORS` registry (one line) so its pill/row come free from step 1. Do **not** block GA on any further abstraction. This ships the brand-promise feature (GA↔Shopify reconciliation) at low risk.

3. **At connector #6 (Triple Whale or Klaviyo, whichever is next): introduce the polymorphic `connector_credentials` table and the `getCredential` helper.** Migrate connectors onto it one at a time, Shopify first (it already has the richest token logic), leaving the old tables until each is cut over. Now you have three clean instances and the interface shape is evidence-based, not speculative.

4. **At connector #7-8: formalize the full `ConnectorDescriptor` interface** (Part 2) and route `/api/intelligence` + `build-claude-context` through the registry loop. By here, adding a connector is genuinely a 1-day job.

5. **Aggregators: native for the top 6-8; no Merge/Unified.** Reserve a marketing aggregator (modeled as one `ConnectorDescriptor`) for the genuine long tail, triggered by paying-customer demand, not roadmap completeness.

**Why this order honors "right > fast":** it ships the high-value feature (GA) immediately and safely, pays for abstraction only where the duplication is real and the risk is near-zero (UI), and refuses to refactor four working integrations — including an App-Store-approved flow — on speculation. The abstraction arrives exactly when the evidence (three clean instances) justifies its shape.

---

## Honesty notes

- **Where the prompt's premise was off:** the roadmap names Unified.to/Merge.dev for the long tail, but those don't serve ad networks — your actual tail. I flagged it in Part 4 rather than answering as if they fit.
- **A current pattern that's FINE and does NOT need refactoring:** the intelligence-adapter contract (Part 1.4) and the ads prompt template (Part 1.5) are already well-factored. `platform_connections` (Part 1.2) is already polymorphic. I am explicitly *not* recommending work on these.
- **The single highest-value refactor** is the `/clients` UI (Part 1.6) — and it's also the lowest-risk. That asymmetry is why it's the one thing to do before GA.
- **What I verified by reading:** all four OAuth/auth routes, the connections API, `getValidShopifyToken`, the four token-table write sites, the GA design doc, the intelligence adapters' signatures (Google adapter top + Meta/Shopify/Woo in full from this morning), the refactored `build-claude-context` render layer, and the `/clients` connection UI in full.
- **What I did NOT verify:** exact current pricing for Merge.dev/Unified.to/Supermetrics (used category-level knowledge and standard tier ranges — directionally correct, not quote-exact); the `google-intelligence.ts` query body beyond its signature/helpers (not needed for an architecture audit); and I could not find migration files for `meta_tokens`/`woocommerce_tokens` (only `001_shopify_installs`, `002-004` exist) — those tables were evidently created via direct SQL, so their exact DDL is inferred from write sites, not a schema file.
