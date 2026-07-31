import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Client-side client (anon key)
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// LORAMER_NO_CACHED_DB_READ_V1 — ⛔ THE SERVER CLIENT MAY NEVER BE SERVED A CACHED READ.
//
// Next.js 14's App Router patches global `fetch` and caches GET requests in its Data Cache. supabase-js
// reads ARE GETs, so a `.select()` inside a route handler can be answered from a snapshot of the database
// taken at some earlier moment — with no error, no warning, and no invalidation when the table changes.
//
// ⛔ THIS IS OBSERVED IN THIS REPO, THREE TIMES, AND IT HAS COST REAL DATA:
//  1. 2026-07-26 — the order-grain one-op-per-shop check returned [] on four consecutive submits while the
//     byte-identical PostgREST query returned four rows to curl. FOUR bulk operations were started where ONE
//     was allowed, and nothing errored (LORAMER_ORDER_GRAIN_NOSTORE_READ_V1).
//  2. 2026-07-30 — /api/backfill/ga-dimensional-recover overwrote a LIVE GA credential with a cached dead
//     token, twice, inside two minutes.
//  3. 2026-07-31 — cron/catchup's google op-budget read. MEASURED on a production build: the shared client
//     answered in 0.71-3.16ms while a no-store client answered the SAME query in 144-340ms, i.e. the shared
//     read did no network round trip at all, and the Data Cache held an entry whose content-location was
//     verbatim `/cron_runs?platform=eq.google&select=mode,connections_attempted,days_filled&started_at=gte…`.
//     Consequence: the drain (force-dynamic + force-no-store) saw the day's climbing spend and declined 58
//     times, while catchup replayed a near-zero snapshot and was NEVER declined — 22 of its 24 runs should
//     have blocked by the budget's own arithmetic. The ranked geo lap starved on a lane that had spent nothing.
//
// ⛔ WHY THIS LIVES HERE AND NOT ON THE ROUTES. Per-route `dynamic`/`fetchCache` directives are a CONVENTION,
// and a convention across 105 route files is exactly the shape this repo has repeatedly paid for: measured
// 2026-07-31, 52 routes carry no directives and 20 of those READ live-state tables — including /api/intelligence
// (Lora's own read path) and the Shopify / Meta / Woo callbacks that WRITE TOKENS. A new route is born
// unhardened by default, which means the safe state is the one you have to remember. FIX-WITH-GUARD is
// explicit about the remedy: where a pattern lives in N files, do not guard the convention — COLLAPSE IT TO
// ONE SOURCE AND GUARD THAT. This is that one source; every route inherits it and cannot opt out by accident.
//
// The pattern itself is already proven in production by `sbNoStore` in src/lib/order-grain/shopify-bulk.ts,
// which has run since 2026-07-26. This generalises it rather than inventing anything.
//
// ⚠ WHAT THIS COSTS, STATED: a read that was being answered from the Data Cache in ~1ms now performs its real
// round trip (~150ms measured). That is not a regression — it is the removal of a false speedup that was
// returning stale rows. Nothing in this app wants a cached database read; /api/intelligence keeps its OWN
// deliberate 15-minute cache in client_context, which is unaffected because it is a DB value, not a fetch cache.
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey, {
  auth: { persistSession: false },
  global: {
    fetch: (url: any, init?: any) => fetch(url, { ...(init ?? {}), cache: 'no-store' }),
  },
})
