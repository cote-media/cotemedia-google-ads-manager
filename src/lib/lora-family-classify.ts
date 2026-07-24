// LORAMER_LORA_TOOL_DECISION_LOG_V1 — ONE source for the L2 family classifier. Used at WRITE time
// (src/lib/lora-tool-log.ts) to label each tool-call decision with a breakdown FAMILY, and by
// scripts/lora-tool-decision-rate.mjs (via isNarratedFamily) to split the skip rate. Pure, no imports.
//
// A NARRATED family is one build-claude-context already puts in the prompt → a from-context answer is CORRECT.
// A captured-history-only family is NOT in the prompt → a from-context answer is a SKIP (the metric). Heuristic
// over the question text; captured rules are checked FIRST (more specific); no match → 'unknown' (excluded from
// the rate — never silently bucketed).
type FamRule = { re: RegExp; family: string; narrated: boolean }
const RULES: FamRule[] = [
  // ── CAPTURED-HISTORY-ONLY (not narrated) — checked first ──────────────────────────────────────────────────
  { re: /\bplacement/i, family: 'placement', narrated: false },
  { re: /action ?type|type[s]? of conversion|which .*conversion|conversion_action|name .*conversion action/i, family: 'action_type', narrated: false },
  { re: /age and gender|age_gender|age.*combined.*gender/i, family: 'age_gender', narrated: false },
  { re: /attribution window|\d-day-?click|1-day click|7-day click/i, family: 'attribution_window', narrated: false },
  { re: /body |headline|title.*(variant|asset)|creative.*(text|copy|variant)|image asset|call.?to.?action asset|which .*creative/i, family: 'creative_asset', narrated: false },
  { re: /video (ad|asset)|thruplay|watch time/i, family: 'video', narrated: false },
  { re: /catalog|product_id|which .*product.*(spend|meta)/i, family: 'product_id', narrated: false },
  { re: /channel grouping|default channel|ga4? channel/i, family: 'ga_channel', narrated: false },
  { re: /ga4? event|which events|events fired/i, family: 'ga_event', narrated: false },
  { re: /item (category|brand)/i, family: 'ga_item', narrated: false },
  { re: /order time|time of day.*order/i, family: 'order_time', narrated: false },
  { re: /sales channel/i, family: 'sales_channel', narrated: false },
  { re: /discount code|coupon (code|type)/i, family: 'discount_code', narrated: false },
  { re: /order status|financial status|fulfillment status/i, family: 'order_status', narrated: false },
  { re: /cohort|lifetime value|\bltv\b|repeat customer/i, family: 'customer_cohort', narrated: false },
  { re: /abandoned (checkout|cart)/i, family: 'abandoned_checkout', narrated: false },
  { re: /device_platform|comscore/i, family: 'meta_other', narrated: false },
  // ── NARRATED (already in the prompt → a from-context answer is correct) ────────────────────────────────────
  { re: /impression share/i, family: 'impression_share', narrated: true },
  { re: /search term/i, family: 'search_term', narrated: true },
  { re: /traffic source|source ?\/ ?medium/i, family: 'traffic_source', narrated: true },
  { re: /asset group|pmax/i, family: 'asset_group', narrated: true },
  { re: /\bhour|dayparting/i, family: 'hour', narrated: true },
  { re: /\bdevices?\b/i, family: 'device', narrated: true },
  { re: /\bgender\b/i, family: 'gender', narrated: true },
  { re: /\bage\b/i, family: 'age', narrated: true },
  { re: /\bgeo\b|location|which (state|city|region)|top .*(state|city|region)/i, family: 'geo', narrated: true },
  { re: /top ads?|ad performance|best (performing )?ad/i, family: 'ads', narrated: true },
  { re: /campaign/i, family: 'campaign', narrated: true },
  { re: /sessions?|\busers?\b/i, family: 'ga_sessions', narrated: true },
  { re: /net (sales|revenue)|\brevenue\b|\borders?\b|\baov\b|transactions/i, family: 'store_revenue', narrated: true },
  { re: /(total )?spend|how much.*spent/i, family: 'spend', narrated: true },
]

export function classifyFamily(q: string): { family: string; narrated: boolean } {
  const t = q || ''
  for (const r of RULES) if (r.re.test(t)) return { family: r.family, narrated: r.narrated }
  return { family: 'unknown', narrated: false }
}

const NARRATED_SET = new Set(RULES.filter((r) => r.narrated).map((r) => r.family))
export function isNarratedFamily(family: string): boolean { return NARRATED_SET.has(family) }
