<!-- QUEUE-EXEMPT: GA V1 connector shipped; historical design record, not a build backlog. -->
# Google Analytics 4 Connector — V1 Design Doc

*Filed May 29, 2026. Written BEFORE any code so the V1 build sequence has a
single source of truth. Future Claude or Russ reads this doc to know exactly
what V1 is and what's deferred. Marker: LORAMER_GA_CONNECTOR_V1.*

---

## Why this exists

LoraMer's brand promise is "Claude understands your whole business." Today Claude
sees Google Ads, Meta Ads, and Shopify. The next obvious gap is **what happens
between the ad click and the order**. Google Analytics 4 is the only system that
tells you:

- Which traffic source actually drove a conversion (not just clicks — sessions and on-site behavior)
- Where the funnel leaks (landing page → product page → cart → checkout)
- Cross-channel attribution that ad platforms can't see (Meta-attributed click but the conversion happened after a Google organic re-visit)
- E-commerce reconciliation against Shopify (does Shopify's $100K match GA4's $94K? Why the delta?)

The Shopify-reconciliation angle is the differentiator for LoraMer's e-comm audience. Most BI tools show GA4 OR Shopify; LoraMer reads both and notices the gaps.

---

## What V1 ships

### Brand-aligned scope: "Essentials, done right" over "everything, done shallow"

Same approach as Shopify deeper signals V1 (refund rate, AOV split, etc) before
Phase 2 (LTV, abandoned cart, cohorts). Ship the highest-value 80% first; design
doc captures the rest as V2.

### V1 = 7 query buckets per GA property

1. **Account totals** — sessions, users, new vs returning, engagement rate, conversions count, total revenue, total transactions
2. **Top traffic sources** — sessions + conversions + revenue, dimensioned by `sessionSource` and `sessionMedium` (top 20)
3. **Top campaigns** — sessions + conversions + revenue, dimensioned by `sessionCampaignName` (top 20). *This is THE cross-platform attribution.*
4. **Top landing pages** — sessions + conversion rate, dimensioned by `landingPagePlusQueryString` (top 20)
5. **Top conversion events** — count + value, dimensioned by `eventName` filtered to conversion events
6. **Geographic + device split** — top 10 countries by sessions; sessions split by `deviceCategory`
7. **E-commerce (Shopify reconciliation gold)** — itemName + itemsPurchased + itemRevenue (top 20 products); transactions split by source/medium; cart-to-purchase conversion rate; refund count if available via the API in 2025-01.

All 7 buckets get fetched per `/api/intelligence` refresh. Each is small enough that
the total payload stays manageable; rendered footprint matches what Google Ads + Meta
already do.

### V2 (deferred, captured here for the future)

- Funnel events (custom funnel steps)
- Cohort retention
- Custom dimensions / custom events
- Multiple attribution models (data-driven, first-click, etc.) — V1 uses GA's default
- In-market segments + interests (demographics)
- Scroll depth + engagement events
- Page-level exit analysis
- Real-time data (different endpoint)
- Cross-domain tracking signals
- Property comparison across multiple clients

---

## Architecture decisions (locked)

### Google Cloud project
**Same Cloud project as Google Ads OAuth, but NEW OAuth client ID specifically for GA.**

Rationale: cleaner audit trail, separate billing visibility, easier to revoke just GA
later if needed. The downside (10 minutes of setup vs 3) is worth it for a platform
LoraMer is betting on.

### Env vars
```
GOOGLE_ANALYTICS_CLIENT_ID=<from new OAuth client>
GOOGLE_ANALYTICS_CLIENT_SECRET=<from new OAuth client>
GOOGLE_ANALYTICS_REDIRECT_URI=https://cotemedia-google-ads-manager.vercel.app/api/ga/callback
```
*(Distinct from `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` used for Google Ads OAuth + NextAuth login.)*

### Scopes
- `https://www.googleapis.com/auth/analytics.readonly` — required for all GA4 Data API reads. Sensitive scope; Google requires verification before public use, but works fine for testing and for internal/agency clients in the meantime.
- We do NOT request `analytics.edit` or `analytics.manage.users`. Read-only is the brand promise.

### One GA property per LoraMer client
Mirrors how Google Ads, Meta, and Shopify connections work today. The agency owner
signs in with Google once per LoraMer client and picks ONE GA property from a dropdown
of every property their Google account can access.

### Future V2.x — Bulk property matching (filed in roadmap)
Agency owners managing 30+ clients will eventually want a "Bulk Connect" flow:
- Sign in once at the agency level
- See all GA properties their Google account has access to (could be 100+)
- See all existing LoraMer clients in a checklist
- Drag/drop or matrix-style match GA properties to LoraMer clients
- Apply same flow to Google Ads accounts and Meta accounts

This is a real and obvious agency-tier feature. NOT in V1. Filed to Project 7
(Agency-Specific Features) in ROADMAP.md as LORAMER_ROADMAP_BULK_CONNECT_V1.

### Supabase schema
New table `ga_tokens`:
```sql
create table ga_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_email    text not null,
  client_id     uuid references clients(id) on delete cascade,
  ga_property_id text not null,           -- e.g. "properties/123456789"
  ga_account_id  text,                    -- the GA account that owns the property (for display)
  ga_property_name text,                  -- the friendly name picked from the dropdown
  access_token   text not null,
  refresh_token  text not null,
  expires_at     timestamptz not null,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index ga_tokens_client_idx on ga_tokens(client_id);
create unique index ga_tokens_client_unique on ga_tokens(client_id);
```

`platform_connections` already supports a generic `platform` text column. We allow the
value `'ga'` (consistent with `'google'`, `'meta'`, `'shopify'`, `'woocommerce'`).

### Token refresh
Mirrors `getValidShopifyToken` and Meta's equivalent. Helper at
`src/lib/ga-token.ts` exports `getValidGaToken(clientId, userEmail)` which:
1. Reads the row from `ga_tokens`
2. If `expires_at` is in the future, returns `access_token`
3. Otherwise refreshes via Google's token endpoint, updates the row, returns the new token

Google's OAuth refresh rotates the refresh token sometimes (not always — different
from Shopify's always-rotates behavior). Helper handles both cases by ALWAYS writing
back whatever the refresh response returns.

### Caching
GA data goes into the same `client_context.intelligence_cache` JSON blob the other
platforms use. Same TTL (15 min currently). Same prompt-cache discipline (the GA
section is part of the cacheable prefix).

### PII handling
GA4 returns sessions and events. We do NOT request `userId`, `clientId`, IP-based
fields, or anything that joins to identifiable users. Sessions and conversions are
aggregated at source/medium/campaign/page level only. No personal data passes into
the intelligence layer.

---

## File layout (what gets created)

```
src/
  app/
    api/
      ga/
        start/route.ts             # initiate OAuth — redirects to Google
        callback/route.ts          # receive OAuth response, store tokens
        properties/route.ts        # list properties for the signed-in user (post-OAuth picker)
        connect/route.ts           # POST: associate a property with a client
        disconnect/route.ts        # POST: revoke + remove tokens
  lib/
    ga-token.ts                    # getValidGaToken helper
    intelligence/
      ga-intelligence.ts           # 7 queries → IntelligenceGa shape
      intelligence-types.ts        # add IntelligenceGa interface + add to ClientIntelligence
      build-claude-context.ts      # render Google Analytics section
```

The dashboard `GoogleAnalyticsTab` component is V1.1 — V1 ships the data flowing into
Claude's context without a dedicated UI tab. Claude can answer GA questions immediately;
the visual dashboard surface follows once the data layer is verified.

---

## Build sequence (each step is a separate commit)

### Phase 1 — Foundation (Russ does Google Cloud Console step manually)
- **Step 1.1** *(Russ)* — Enable "Google Analytics Data API" on the existing Cloud project, create new OAuth client (Web Application), add redirect URI, add `analytics.readonly` scope to consent screen. Capture client_id + secret.
- **Step 1.2** *(Russ)* — Add three env vars to Vercel: GOOGLE_ANALYTICS_CLIENT_ID, GOOGLE_ANALYTICS_CLIENT_SECRET, GOOGLE_ANALYTICS_REDIRECT_URI.
- **Step 1.3** *(SQL)* — Run the `ga_tokens` table migration in Supabase.

### Phase 2 — OAuth wiring (one commit, marker LORAMER_GA_OAUTH_V1)
- `/api/ga/start` — initiates OAuth with proper scopes + state + `access_type=offline` + `prompt=consent` (to force refresh token issuance)
- `/api/ga/callback` — exchanges code for tokens, but does NOT yet write to `ga_tokens` — instead returns a temporary code or stashes the tokens in session for the property picker
- Verify: clicking Connect kicks off OAuth, redirects back successfully with a code

### Phase 3 — Property picker (LORAMER_GA_PROPERTY_PICKER_V1)
- `/api/ga/properties` — uses the just-obtained access token to call GA Admin API and list properties the user can access
- UI on `/clients` page: after OAuth returns, show modal/dropdown of properties, user picks one
- `/api/ga/connect` — receives the chosen property_id, NOW writes the `ga_tokens` row and `platform_connections` row
- Verify: connect button → OAuth → property picker → select → connection appears in client list

### Phase 4 — Token helper + intelligence adapter (LORAMER_GA_INTELLIGENCE_V1)
- `src/lib/ga-token.ts` — `getValidGaToken()`
- `src/lib/intelligence/ga-intelligence.ts` — 7 queries via GA Data API `runReport`
- Type: `IntelligenceGa` added to intelligence-types.ts
- `/api/intelligence` route: fetch GA when `ga_tokens` row exists for the client; add to the returned object
- Verify in production: hit `/api/intelligence?clientId=X` for a GA-connected client, confirm `ga` block is populated

### Phase 5 — Prompt builder render (LORAMER_GA_CLAUDE_CONTEXT_V1)
- `build-claude-context.ts`: render the GA section in the cacheable prefix block (same pattern as Google/Meta)
- Update the dynamic completeness header to include GA (`GA: populated | connected but no data | not connected`)
- Verify: ask Claude in Ask Claude tab to quote GA data; cross-reference against Shopify revenue

### Phase 6 — Disconnect + V1 polish (LORAMER_GA_DISCONNECT_V1)
- `/api/ga/disconnect` — revokes token via Google + deletes ga_tokens row + removes platform_connections row
- UI: disconnect button on the GA connection row in `/clients`
- Verify: disconnect cleans up state fully

### V1.1 — Dashboard tab (separate ship, after V1 verified)
- `GoogleAnalyticsTab` component
- Routing: add GA to the platform selector + tab logic
- Visual: revenue chart, top traffic sources card, conversion events card

---

## Open questions Russ should think about before Phase 1 begins

1. **OAuth verification.** Google requires app verification for sensitive scopes like `analytics.readonly` before public production use. For LoraMer's current scale (private agency clients, demo testers), unverified works — Google shows a warning screen the user clicks through. **Public launch beyond ~100 users will require verification** which is a separate multi-week process. Filed as a future concern; not a V1 blocker.

2. **GA quota.** GA4 Data API has token-based limits per property per day. The 7 V1 queries are well within free tier. At scale (hundreds of clients × 15-min refresh × 7 queries), we'd hit limits. Solutions: longer cache, lower-priority background fetch, or paid GA quota. Defer to scale.

3. **Property-level vs account-level scope.** The OAuth scope grants access to ALL properties the user can see. If an agency owner connects their personal Google account, they could accidentally grant LoraMer access to their client's GA data. **The property picker is the safety boundary** — we only store the ONE property they explicitly pick. Document this in the UI clearly ("LoraMer only reads the property you choose").

---

## Acceptance criteria

V1 is shipped when:
- A LoraMer client with GA connected returns `intelligence.ga.connected === true` with populated data
- Claude can quote (verbatim, in Ask Claude) GA sessions, top sources, top campaigns, top products, and revenue
- Claude can compare GA4 revenue against Shopify revenue and surface the delta with a reason
- Disconnect cleanly removes all GA data from the client's intelligence

V1.1 adds the dashboard tab.
