// LORAMER_STRIPE_PHASE4_PORTAL_V1
// One-off: create the TEST-mode Customer Portal configuration via the Stripe API
// (Dashboard activation deferred — it forces full business verification we're holding to Phase 6).
// Idempotency: re-running creates a NEW config each time, so run once and capture the bpc_ id.
// Phase 6 must repeat this in LIVE mode (configs do NOT cross modes) and set the LIVE env var.
import Stripe from 'stripe'
import { readFileSync } from 'node:fs'

// Pull STRIPE_SECRET_KEY from .env.local (this machine's Stripe TEST key; never echoed).
function keyFromEnvLocal() {
  if (process.env.STRIPE_SECRET_KEY) return process.env.STRIPE_SECRET_KEY
  const txt = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*STRIPE_SECRET_KEY\s*=\s*(.+?)\s*$/)
    if (m) return m[1].replace(/^['"]|['"]$/g, '')
  }
  throw new Error('STRIPE_SECRET_KEY not found in env or .env.local')
}

const PRICES = {
  business: ['price_1TgVtUEAFDrT56pMmRw6VWLV', 'price_1TgVtVEAFDrT56pMtu6H4j0Z'],
  agency: ['price_1TgVtWEAFDrT56pMVEco3MVa', 'price_1TgVtWEAFDrT56pMgXdAQgiy'],
  scale: ['price_1TgVtXEAFDrT56pM5sokisZF', 'price_1TgVtXEAFDrT56pMNwhCFTJ4'],
}

const stripe = new Stripe(keyFromEnvLocal())

async function main() {
  if (stripe._api?.auth?.startsWith?.('Bearer sk_live_')) throw new Error('refusing: LIVE key, this script is TEST-only')

  // Resolve each price -> its product, and group both prices under that product.
  const byProduct = new Map()
  for (const [tier, priceIds] of Object.entries(PRICES)) {
    for (const pid of priceIds) {
      const price = await stripe.prices.retrieve(pid)
      const prod = typeof price.product === 'string' ? price.product : price.product.id
      if (!byProduct.has(prod)) byProduct.set(prod, { tier, prices: [] })
      byProduct.get(prod).prices.push(pid)
    }
  }

  const products = [...byProduct.entries()].map(([product, v]) => ({ product, prices: v.prices }))
  console.log('Products mapped for portal:', JSON.stringify([...byProduct.entries()], null, 2))

  const config = await stripe.billingPortal.configurations.create({
    business_profile: {
      headline: 'LoraMer billing',
      privacy_policy_url: 'https://loramer.com/privacy',
      terms_of_service_url: 'https://loramer.com/terms',
    },
    features: {
      subscription_update: {
        enabled: true,
        default_allowed_updates: ['price'],
        products, // Business/Agency/Scale, each with monthly + annual prices
        proration_behavior: 'create_prorations', // Stripe default proration
      },
      subscription_cancel: {
        enabled: true,
        mode: 'at_period_end', // grace: stays entitled until period end, then -> free
      },
      payment_method_update: { enabled: true },
      // quantity updates intentionally omitted (not allowed)
    },
  })

  console.log('PORTAL_CONFIG_ID=' + config.id)
  console.log('livemode=' + config.livemode)
}

main().catch((e) => {
  console.error('FAILED:', e?.message || e)
  process.exit(1)
})
