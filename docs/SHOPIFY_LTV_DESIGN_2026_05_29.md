# Shopify Phase 2 — LTV, Abandoned Cart, Cohort Retention (Design Doc)

*Filed May 29, 2026. Companion to LORAMER_SHOPIFY_DEEPER_SIGNALS_V1, which shipped the
"easy wins" (refund rate, returning rate, AOV split, revenue concentration) from the
existing GraphQL query. This doc covers the bigger asks that need real new fetch work.*

---

## The three asks

1. **True LTV** — average lifetime spend per customer, not just within the selected date range.
2. **Abandoned cart rate** — % of checkouts that didn't convert to orders.
3. **Cohort retention** — for customers who first purchased in month N, what % bought again in months N+1, N+2, N+3.

All three require fetching data the current shopify-intelligence.ts query does NOT pull.

---

## Why these matter to the brand promise

"Claude understands your whole business" hits a wall when Claude can only see one date range. A customer who bought a $200 product 18 months ago and never returned looks identical to a customer who bought $200 yesterday. LTV breaks that tie. Cohort retention is the natural extension. Abandoned cart is the leakiest bucket every e-comm operator obsesses over and Claude is currently blind to it.

---

## What's currently fetched (after V1 shipped)

Per `shopify-intelligence.ts`, one GraphQL query returns:
- Orders within selected date range (up to 250)
- For each order: total price, financial status, customer ID, customer's lifetime order count, line items with title/quantity/product ID/unit price

That's all. Customer first-purchase date, customer lifetime spend, abandoned checkouts — none of it.

---

## Option A — LTV via customer-by-customer lookup (rejected)

For each unique customer seen in the date-range orders, run a follow-up query fetching their full order history.

**Why this fails:** N+1 query pattern. 100 customers in the window means 100 additional GraphQL calls per intelligence refresh. With 15-minute cache TTL, that's potentially 100+ extra Shopify API calls every 15 minutes per client. Shopify's REST rate limit is 2 calls/sec; GraphQL has a cost-based limit (`bulkOperationRunQuery` is the right tool for this scale, see Option C).

---

## Option B — Pull all customers with aggregated order data in one query (preferred)

Single GraphQL query fetching customers with `amountSpent`, `numberOfOrders`, `firstOrder`, `lastOrder`. Computed-on-Shopify-side; just retrieved.

```graphql
query LtvSnapshot($cursor: String) {
  customers(first: 250, after: $cursor) {
    edges {
      cursor
      node {
        id
        amountSpent { amount currencyCode }
        numberOfOrders
        createdAt
        firstOrder { createdAt }
        lastOrder { createdAt }
      }
    }
    pageInfo { hasNextPage }
  }
}
```

**What we can compute from this:**
- True LTV = average of `amountSpent.amount` across all customers (or median, or both)
- LTV by customer cohort (group by `firstOrder.createdAt` month)
- Customer dormancy (time since `lastOrder.createdAt`)
- Repeat purchase rate at 30/60/90/180 days from first order (compare `firstOrder` and `lastOrder` dates against `numberOfOrders`)

**Cost:** One paginated query per intelligence refresh. For a store with 5,000 customers, that's 20 pages × ~few seconds. Heavy for a 15-min cache; reasonable for a 4-hour cache (Free tier) or scheduled background fetch (Solo+ tier).

**Open question:** Should this be a separate fetch invoked only when the user explicitly asks an LTV question, or always pre-computed? Probably separate — most chats don't need LTV, and the cost is real.

---

## Option C — Bulk operations (heaviest stores)

For stores with 50k+ customers, Shopify's `bulkOperationRunQuery` is the right pattern. Async job, polled for completion, returns a JSONL URL. Hours of work to implement well; only worth it once Scale-tier customers ask.

**Defer until at least one paying Scale customer asks for it.**

---

## Abandoned cart rate

Separate endpoint entirely: `abandonedCheckouts`. The GraphQL field is `checkouts(query: "status:abandoned")` or the REST `/admin/api/<v>/checkouts.json`.

**Computation:**
```
abandonment_rate = abandonedCheckouts / (abandonedCheckouts + completedCheckouts)
```

**Open question:** what's the right time window? Probably the same date range as orders. So one more query per refresh, scoped to the same window.

**Cost:** One additional GraphQL query, paginated, capped at maybe 250 most recent abandoned checkouts.

**Risk:** Privacy. Abandoned checkout records contain email addresses and partial billing info. We do NOT need to surface those to Claude — only count totals. Strip PII at the adapter layer before returning.

---

## Cohort retention

Already partly derivable from Option B's data. For each customer with `firstOrder.createdAt`, bucket into a cohort by first-order month. For each cohort, count how many had `lastOrder.createdAt` > firstOrder + 30 days, + 60 days, etc.

This is a derived layer on top of Option B, not a separate query. Ships once Option B ships.

---

## Phased rollout

### Phase 2.1 — Abandoned cart rate
- Add one additional GraphQL query to shopify-intelligence.ts for abandoned checkouts in the date range
- New type fields: `abandonedCheckoutCount`, `abandonedCheckoutRate`
- Render in build-claude-context as a line under Shopify section
- Estimated: 1-2 hours, low risk

### Phase 2.2 — Customer-level LTV (Option B)
- New `fetchShopifyCustomers()` function, paginated
- New type fields: `lifetimeAvgSpend`, `lifetimeMedianSpend`, `customerCohorts: { firstOrderMonth, count, retainedAt30d, retainedAt60d, retainedAt90d }[]`
- Cache the customer data separately from order data (different TTL — customer history changes slowly)
- Tier-gate (Free tier doesn't get it; cost too high per call)
- Estimated: 1 day, medium risk

### Phase 2.3 — Cohort retention rendering
- Pure derived computation from Phase 2.2 data
- Render as a small table in build-claude-context
- Estimated: 1-2 hours, low risk

### Phase 2.4 — Bulk operations for whale stores
- Defer until a paying Scale customer with 50k+ customers asks

---

## Decision points (need user input before building)

1. **Cache TTL for LTV data.** Customer lifetime data changes slowly; a 24-hour cache is probably right. But that means LTV signals can be a day stale. Acceptable for most chats; need a refresh trigger ("recompute LTV now") for the rare case where it matters.

2. **Tier gating.** Is LTV a Free-tier feature? Probably not — Shopify API costs add up. Logical split: Free gets the Phase 1 derived signals (already shipped); Solo+ gets Phase 2.1 abandoned cart; Agency+ gets Phase 2.2/2.3 LTV + cohorts.

3. **Token cost in the prompt.** Each cohort row adds tokens. For a store with 24 months of history, that's 24 rows × ~50 tokens. ~1,200 tokens per chat call. With prompt caching now in place, that's a one-time write cost; cached reads are 10%. Manageable.

4. **Privacy / PII.** Abandoned checkout records can contain email. NEVER pass through to Claude. Strip at adapter.

---

## What this design doc does NOT cover

- WooCommerce equivalents. Once Shopify Phase 2 ships, mirror to WooCommerce as a separate ship.
- Product-level retention (which products drive repeat purchases). Separate design.
- Subscription store handling (Shopify has subscription-specific endpoints). Separate design.
- Multi-currency handling. Today everything assumes shop currency. Real risk for international stores; flag for review before Phase 2.2.

---

## Recommendation

Ship Phase 2.1 (abandoned cart) next. Single query, single new metric, low risk, high "obvious value to operator" — every e-comm operator wants this number.

Defer 2.2/2.3 (LTV + cohorts) until either:
- (a) A paying customer asks for them specifically, or
- (b) We have ≥3 active Shopify-connected agency clients and the deeper-customer view becomes a sales argument for upgrades to Agency tier.

This is a "right > fast" judgment call. Phase 2.2 is real engineering work and would take a day done properly; better to ship something easy and useful (2.1) and earn the upgrade signal before investing in 2.2/2.3.
