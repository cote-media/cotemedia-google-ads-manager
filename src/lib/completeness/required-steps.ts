// LORAMER_COMPLETENESS_GATE_V1 F(a) — REQUIRED step-set per platform, mirrored from src/lib/backfill/drain-registry.ts
// (DRAIN_REGISTRY). This is the completeness-gate DENOMINATOR: for a connected platform, every step here must reach
// its floor (or a recorded wall) with rows persisted, else it is short.
//
// ⚠️ SYNC OBLIGATION: a step added to DRAIN_REGISTRY MUST be added here (and vice-versa). The reconcile engine
// asserts key-set parity against the live registry when run inside the app; this file is the static, dependency-free
// projection so the engine (and its Gate harness) never has to import the heavy backfill writer tree.
//
// Each step carries:
//   key         — the onboard_steps_done key (== DRAIN_REGISTRY step.key)
//   cursor       — the sync_state.platform value the writer laps under (VERIFIED FROM CODE, not assumed):
//                    account -> the platform itself ('google'|'meta'|'ga') [run-backfill writes sync_state[platform]]
//                    woo base -> 'woocommerce_backfill' (woocommerce-backfill.ts:29 CURSOR_PLATFORM)
//                    shopify_deep -> 'shopify_deep' (shopify-dimensional-backfill.ts:172 CURSOR_PLATFORM_DEEP)
//                    every range/dimensional step -> its own key (drain-registry rangeLap cursorKey == step.key)
//   floorMonths — OPTIONAL per-step floor override (relative months). Encodes the drain's floor36() clamp on Google
//                 depth/breadth grains (drain-registry.ts:61) — those bottom out at 36mo BY DESIGN, not 132mo.
//   platformLimited — OPTIONAL: the grain genuinely stops short by platform rule (e.g. Google search_term ~90d), the
//                 one GOVERNING-LAW exception; a short cursor here is at-floor, never a defect.
//   real        — the metrics_daily signature that proves rows actually persisted (VERIFIED against live encoding
//                 2026-07-13). ridesAccount = the step's data rides the account row's extra (no distinct rows) so
//                 REAL is not row-checkable; the cursor is the only signal.

export type RealSpec = {
  entityLevels?: string[]     // metrics_daily.entity_level ∈ this set
  breakdownTypes?: string[]   // metrics_daily.breakdown_type ∈ this set
  breakdownPrefix?: string    // metrics_daily.breakdown_type starts with this (e.g. 'geo_', 'user_geo_')
  breakdownAny?: boolean      // any breakdown_type counts (only entityLevels constrains)
  ridesAccount?: boolean      // data lives on the account row's extra → not row-checkable
}

export type StepDef = {
  key: string
  cursor: string
  floorMonths?: number
  platformLimited?: boolean
  real: RealSpec
}

// A metrics_daily presence pair for a (client, platform).
export type RealPair = { entity_level: string; breakdown_type: string }

export const REQUIRED_STEPS: Record<string, StepDef[]> = {
  google: [
    { key: 'account',            cursor: 'google',            real: { entityLevels: ['account'] } },
    { key: 'google_campaign',    cursor: 'google_campaign',    floorMonths: 36, real: { entityLevels: ['campaign'] } },
    { key: 'google_adgroup_ad',  cursor: 'google_adgroup_ad',  floorMonths: 36, real: { entityLevels: ['ad_group', 'ad'] } },
    { key: 'google_device',      cursor: 'google_device',      floorMonths: 36, real: { breakdownTypes: ['device'] } },
    { key: 'google_geo',         cursor: 'google_geo',         floorMonths: 36, real: { breakdownPrefix: 'geo_' } },
    { key: 'google_user_geo',    cursor: 'google_user_geo',    floorMonths: 36, real: { breakdownPrefix: 'user_geo_' } },
    { key: 'google_hour',        cursor: 'google_hour',        floorMonths: 36, real: { breakdownTypes: ['hour'] } },
    { key: 'google_dimensional', cursor: 'google_dimensional', floorMonths: 36, platformLimited: true, real: { entityLevels: ['keyword', 'search_term'], breakdownAny: true } },
  ],
  meta: [
    { key: 'account',          cursor: 'meta',             real: { entityLevels: ['account'] } },
    { key: 'meta_campaign',    cursor: 'meta_campaign',    real: { entityLevels: ['campaign'] } },
    { key: 'meta_placement',   cursor: 'meta_placement',   real: { breakdownTypes: ['placement'] } },
    { key: 'meta_adset_ad',    cursor: 'meta_adset_ad',    real: { entityLevels: ['ad_set', 'ad'] } },
    { key: 'meta_device',      cursor: 'meta_device',      real: { breakdownTypes: ['device', 'device_platform'] } },
    { key: 'meta_age_gender',  cursor: 'meta_age_gender',  real: { breakdownTypes: ['age', 'gender', 'age_gender'] } },
    { key: 'meta_action_type', cursor: 'meta_action_type', real: { breakdownTypes: ['action_type'] } },
    { key: 'meta_video',       cursor: 'meta_video',       real: { breakdownTypes: ['video'] } },
    { key: 'meta_geo',         cursor: 'meta_geo',         real: { breakdownTypes: ['geo_country', 'geo_region'] } },
    { key: 'meta_hour',        cursor: 'meta_hour',        real: { breakdownTypes: ['hour'] } },
  ],
  ga: [
    { key: 'account', cursor: 'ga', real: { entityLevels: ['account'] } },
  ],
  shopify: [
    { key: 'shopify_deep',    cursor: 'shopify_deep',    real: { entityLevels: ['account', 'product'] } },
    { key: 'shopify_variant', cursor: 'shopify_variant', real: { entityLevels: ['variant'] } },
    { key: 'shopify_money',   cursor: 'shopify_money',   real: { ridesAccount: true } },
  ],
  woocommerce: [
    { key: 'woo',               cursor: 'woocommerce_backfill', real: { entityLevels: ['account'] } },
    { key: 'woo_variant',       cursor: 'woocommerce_variant',  real: { entityLevels: ['variant'] } },
    { key: 'woocommerce_money', cursor: 'woocommerce_money',    real: { ridesAccount: true } },
    // LORAMER_WOO_BATCH_WA_V1 — ONE step, ONE cursor, all NINE breadth families (see drain-registry for why
    // Woo must not follow the one-namespace-per-family convention). geo_country is the REAL probe: it is the
    // family that must land for a store with ANY billing address on file, so its presence proves the whole
    // breadth lap ran rather than proving one cheap dimension did.
    { key: 'woocommerce_breadth', cursor: 'woocommerce_breadth', real: { breakdownTypes: ['geo_country'] } },
  ],
}

// realPresent(spec, pairs) — does any persisted metrics_daily (entity_level, breakdown_type) pair satisfy the spec?
// Returns null when REAL is not row-checkable (ridesAccount) — the caller then trusts the cursor alone.
export function realPresent(spec: RealSpec, pairs: RealPair[]): boolean | null {
  if (spec.ridesAccount) return null
  return pairs.some((p) => {
    if (spec.entityLevels && !spec.entityLevels.includes(p.entity_level)) return false
    if (spec.breakdownAny) return true
    if (spec.breakdownPrefix) return p.breakdown_type.startsWith(spec.breakdownPrefix)
    if (spec.breakdownTypes) return spec.breakdownTypes.includes(p.breakdown_type)
    return p.breakdown_type === '' // base-grain step: require base (non-breakdown) rows
  })
}
