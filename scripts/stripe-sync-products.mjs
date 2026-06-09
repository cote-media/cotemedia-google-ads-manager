// LORAMER_STRIPE_PHASE1_V1 — idempotent Stripe product/price sync.
//
// Creates (or reuses) the Business / Agency / Scale products, each with a monthly
// and an annual recurring price, then writes the resulting price IDs back into the
// plan_entitlements table. Safe to re-run any number of times, and re-runnable for
// LIVE mode at go-live (Phase 6) — it keys off product metadata + price lookup_keys,
// never off names, so it never creates duplicates.
//
// Monthly: $79 / $199 / $999.  Annual (marketing-rounded): $750 / $1900 / $9500.
//
// Mode is inferred from STRIPE_SECRET_KEY (sk_test_ vs sk_live_). Test and live price
// IDs differ; this script overwrites plan_entitlements with whichever mode's IDs it
// just synced — that single column pair always reflects the active key's mode.
//
// Run from repo root:  npm run stripe:sync   (or: node scripts/stripe-sync-products.mjs)

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

// Load .env.local into process.env (only keys not already set in the real env).
function loadDotEnvLocal() {
  let raw
  try { raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8') }
  catch { return }
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const key = t.slice(0, eq).trim()
    let val = t.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = val
  }
}
loadDotEnvLocal()

// ── env / mode guard ────────────────────────────────────────────────────────
const KEY = process.env.STRIPE_SECRET_KEY
if (!KEY) {
  console.error('FATAL: STRIPE_SECRET_KEY not set (expected in .env.local).')
  process.exit(1)
}
const MODE = KEY.startsWith('sk_test_') ? 'TEST'
           : KEY.startsWith('sk_live_') ? 'LIVE'
           : 'UNKNOWN'
if (MODE === 'UNKNOWN') {
  console.error('FATAL: STRIPE_SECRET_KEY is neither sk_test_ nor sk_live_ — refusing to run.')
  process.exit(1)
}

const stripe = new Stripe(KEY)

// ── plan definitions (amounts in cents) ─────────────────────────────────────
const PLANS = [
  { tier: 'business', name: 'LoraMer Business', monthly: 7_900,  annual: 75_000  },
  { tier: 'agency',   name: 'LoraMer Agency',   monthly: 19_900, annual: 190_000 },
  { tier: 'scale',    name: 'LoraMer Scale',    monthly: 99_900, annual: 950_000 },
]
const CURRENCY = 'usd'

// ── product: find by metadata.loramer_tier, else create ─────────────────────
async function ensureProduct(plan) {
  const found = await stripe.products.search({
    query: `active:'true' AND metadata['loramer_tier']:'${plan.tier}'`,
    limit: 1,
  })
  if (found.data.length > 0) {
    const p = found.data[0]
    if (p.name !== plan.name) await stripe.products.update(p.id, { name: plan.name })
    return p
  }
  return stripe.products.create({
    name: plan.name,
    metadata: { loramer_tier: plan.tier },
  })
}

// ── price: find by lookup_key; reuse if amount/interval/product match, else
//    create a new price and transfer the lookup_key onto it ──────────────────
async function ensurePrice(plan, product, interval) {
  const amount = interval === 'month' ? plan.monthly : plan.annual
  const lookupKey = `loramer_${plan.tier}_${interval === 'month' ? 'monthly' : 'annual'}`

  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })
  const cur = existing.data[0]
  if (cur &&
      cur.unit_amount === amount &&
      cur.currency === CURRENCY &&
      cur.product === product.id &&
      cur.recurring?.interval === interval) {
    return { id: cur.id, action: 'reused' }
  }

  const created = await stripe.prices.create({
    product: product.id,
    currency: CURRENCY,
    unit_amount: amount,
    recurring: { interval },
    lookup_key: lookupKey,
    transfer_lookup_key: true, // moves the key off any stale price so re-runs converge
    metadata: { loramer_tier: plan.tier, loramer_interval: interval },
  })
  return { id: created.id, action: cur ? 'replaced' : 'created' }
}

// ── write price IDs back into plan_entitlements ─────────────────────────────
async function writeBack(rows) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !svc) {
    console.warn('\n⚠  Supabase env missing — skipping DB write-back. Run these in the SQL Editor:')
    for (const r of rows) {
      console.warn(`   UPDATE public.plan_entitlements SET stripe_price_monthly='${r.monthly}', stripe_price_annual='${r.annual}', updated_at=now() WHERE tier='${r.tier}';`)
    }
    return false
  }
  const sb = createClient(url, svc)
  for (const r of rows) {
    const { error } = await sb
      .from('plan_entitlements')
      .update({ stripe_price_monthly: r.monthly, stripe_price_annual: r.annual, updated_at: new Date().toISOString() })
      .eq('tier', r.tier)
    if (error) throw new Error(`Supabase write-back failed for ${r.tier}: ${error.message}`)
  }
  return true
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Stripe sync — MODE=${MODE}`)
  const rows = []
  for (const plan of PLANS) {
    const product = await ensureProduct(plan)
    const m = await ensurePrice(plan, product, 'month')
    const a = await ensurePrice(plan, product, 'year')
    console.log(`  ${plan.tier.padEnd(9)} product=${product.id}  monthly=${m.id} (${m.action})  annual=${a.id} (${a.action})`)
    rows.push({ tier: plan.tier, monthly: m.id, annual: a.id })
  }
  const wrote = await writeBack(rows)
  console.log(wrote
    ? '\n✓ Done — products/prices synced and plan_entitlements updated.'
    : '\n✓ Stripe synced — apply the printed UPDATEs to finish plan_entitlements.')
}

main().catch((e) => { console.error('\nFATAL:', e.message); process.exit(1) })
