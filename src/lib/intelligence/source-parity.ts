// LORAMER_LIVE_VS_CAPTURED_SOURCE_PARITY_V1 — layers 1+2 of the §3 truth-spine, on the EXISTING captured store.
//
// THE LAW THIS IMPLEMENTS: LORAMER_LIVE_VS_CAPTURED_ARE_TWO_SOURCES_V1 (2026-07-25, Russ), itself an application of
// LORAMER_ESSENCE.md:26 MULTI-SOURCE METRIC PROVENANCE to the live-vs-captured axis — "surfaces EVERY source's
// value, each labeled with its origin and basis. Never hide, blend, collapse, or silently pick one … explains WHY
// they differ." Russ: "it's not either or … in most cases for honesty it should be BOTH."
//
// WHAT WAS BROKEN: build-claude-context renders ONLY the live snapshot. The captured store reaches Lora exclusively
// through the query_metrics / query_breakdown tools, so no turn ever presents the two as SOURCES — she cannot label
// what she was never told exists. Same family as the false zero closed by LORAMER_LORA_FETCHERRORS_DEGRADED_V1:
// our code, not a boundary, kept her from her own user's data.
//
// WHAT THIS IS NOT — the locked design is NOT pre-empted (docs/LORAMER_LIVE_BREADTH_UNIFIED_DESIGN_V1):
//   · NO sibling as_of live store, NO query_live tool. Those are Phase 3 and are NOT built here.
//   · §2 PROVABILITY WALL untouched — this writes nothing, anywhere. Prompt text only.
//   · §3 layer 3 (structural post-hoc provenance check) NOT built. Layers 1+2 only, and said so.
//   · §5 CAPTURED ALWAYS WINS ON OVERLAP is taught here, not contradicted.
// "BOTH" MEANS BOTH LABELED, NEVER BOTH AVERAGED — §3 forbids a bare fused figure, and the rule below says so.
//
// TOKEN DISCIPLINE IS A DESIGN CONSTRAINT, not an afterthought: the whole point of this shape is that LABELS are
// cheap and NUMBERS are pulled on demand. One rule block for the whole prompt + one compact line-group per
// connected platform. Measured add is reported in the ship record; the guard does not police tokens, the gate does.
import { REGISTRY } from '@/lib/breakdown-registry'
import type { BreakdownEntry } from '@/lib/breakdown-registry'

// ── CLASSIFICATION ────────────────────────────────────────────────────────────────────────────────────────────
// BOTH   = the family is in the live prompt AND in the captured registry → dual-source line, tools must be called.
// LIVE   = live-only, no captured counterpart → labeled, NO redirect (a redirect to a tool that cannot answer
//          manufactures a second false zero — the lesson already banked in LORAMER_LORA_FETCHERRORS_DEGRADED_V1).
// STORE  = captured-only, absent from this prompt → labeled as tool-reachable so she knows it EXISTS.
// The STORE list is COMPUTED from the registry (see capturedOnlyFor), never typed out — that is what makes a new
// registry family show up automatically instead of silently vanishing from Lora's view.
export type PlatformKey = 'google' | 'meta' | 'shopify' | 'woocommerce' | 'ga'

export interface DualFamily { label: string; toolType: string }

// Families the LIVE fetcher puts in the prompt AND the registry captures. `toolType` MUST exist in BREAKDOWN —
// the guard fails the build if it does not (no invented breakdown types, same rule as the degraded renderer).
export const BOTH_FAMILIES: Record<PlatformKey, DualFamily[]> = {
  google: [
    { label: 'account/campaign totals', toolType: '' },
    { label: 'keywords', toolType: 'keyword' },
    { label: 'search terms', toolType: 'search_term' },
    { label: 'device', toolType: 'device' },
    { label: 'geo', toolType: 'geo' },
    { label: 'geo country', toolType: 'geo_country' },
    { label: 'geo region', toolType: 'geo_region' },
    { label: 'hour', toolType: 'hour' },
    { label: 'age', toolType: 'age' },
    { label: 'gender', toolType: 'gender' },
    { label: 'impression share', toolType: 'impression_share' },
    { label: 'conversion actions', toolType: 'conversion_action' },
  ],
  meta: [
    { label: 'account/campaign totals', toolType: '' },
    { label: 'placement', toolType: 'placement' },
    { label: 'device', toolType: 'device' },
    { label: 'age', toolType: 'age' },
    { label: 'gender', toolType: 'gender' },
    { label: 'geo country', toolType: 'geo_country' },
    { label: 'geo region', toolType: 'geo_region' },
    { label: 'hour', toolType: 'hour' },
    { label: 'action types', toolType: 'action_type' },
    { label: 'video', toolType: 'video' },
  ],
  shopify: [
    { label: 'store totals (orders/net sales/AOV)', toolType: '' },
    { label: 'geo country', toolType: 'geo_country' },
    { label: 'geo region', toolType: 'geo_region' },
  ],
  woocommerce: [
    { label: 'store totals (orders/net sales/AOV)', toolType: '' },
  ],
  ga: [
    { label: 'property totals (sessions/users/revenue)', toolType: '' },
    { label: 'source/medium', toolType: 'ga_source_medium' },
    { label: 'channel', toolType: 'ga_channel' },
    { label: 'campaign', toolType: 'ga_campaign' },
    { label: 'landing page', toolType: 'ga_landing_page' },
    { label: 'device', toolType: 'ga_device' },
    { label: 'geo country', toolType: 'ga_geo_country' },
    { label: 'events', toolType: 'ga_event' },
    { label: 'items', toolType: 'ga_item' },
  ],
}

// LIVE-ONLY — in the prompt, never captured. Google's six are the SAME six the degraded renderer refuses to
// redirect (LORAMER_LORA_FETCHERRORS_DEGRADED_V1), kept consistent on purpose: one truth about what is captured.
export const LIVE_ONLY_FAMILIES: Record<PlatformKey, string[]> = {
  google: ['audiences', 'RSA assets', 'PMax asset groups/assets/combinations', 'Google recommendations', 'campaign metadata (budget/bidding/status)'],
  meta: ['live ad-set/ad structure + creative detail'],
  shopify: ['top-products live list'],
  woocommerce: [],
  ga: [],
}

// CAPTURED-ONLY = every registry toolType for the platform that is NOT in BOTH_FAMILIES. COMPUTED, never typed:
// add a family to the registry and it appears here automatically instead of becoming invisible to Lora.
export function capturedOnlyFor(platform: PlatformKey): string[] {
  const both = new Set(BOTH_FAMILIES[platform].map((f) => f.toolType))
  // REGISTRY is the ONE declared source the query_breakdown enums are generated from; filter to real breakdown
  // surfaces so base rows never appear as a "captured-only family".
  const all = new Set<string>(
    REGISTRY.filter((e: BreakdownEntry) => e.platform === platform && e.surface === 'breakdown')
      .map((e: BreakdownEntry) => String(e.toolType ?? '')),
  )
  return [...all].filter((t: string) => !!t && !both.has(t)).sort()
}

// ── THE WHY PAYLOAD ───────────────────────────────────────────────────────────────────────────────────────────
// Verbatim from LORAMER_RESTATEMENT_WINDOW_LAW_V1 (2026-07-24, vendor-verified). DO NOT RE-DERIVE these windows —
// they were researched once against vendor docs and banked precisely so no session re-derives them.
export const RESTATEMENT_BASIS: Record<PlatformKey, string> = {
  google: 'restates 30d, conversions move up to 90d (late conv + attribution recalc) — captured runs UNDERSTATED until restated, so live>captured is EXPECTED',
  meta: 'restates 9d minimum (1-day/7-day attribution), 28d if 28-day attribution is in use',
  shopify: 'NO time window — change-based on updated_at, so a refund years later still moves it; captured is refund-adjusted as of its last re-sum',
  woocommerce: 'NO time window — change-based on updated_at, same as Shopify',
  ga: 'restates 7d; GA4 processing takes 24-48h and data CHANGES during it; intraday has gaps in event-scoped source dims + more "(other)" rows',
}

// Difference sources that are NOT settlement windows. Repo-sourced, each traceable:
//  · timezone — Meta hour buckets are ADVERTISER-timezone (banked at the meta-hour ship); Google/Shopify differ.
//  · spend>0 — Meta Insights hard-filters on spend>0, so a quiet entity is indistinguishable from a missing one
//    in the LIVE payload (already stated at build-claude-context's connected-but-empty branch).
//  · direction — §5 of the locked design: live is provisional, captured ALWAYS WINS on overlap.
const CROSS_CUTTING_WHY =
  'Non-settlement reasons they differ: TIMEZONE (Meta hour buckets are advertiser-timezone), the LIVE spend>0 FILTER (Meta omits zero-spend entities, so a quiet entity looks missing live but IS captured), and DIRECTION (live is provisional; captured WINS on overlap once settled).'

// ── THE STANDING RULE — emitted ONCE per prompt ───────────────────────────────────────────────────────────────
// Mirrors the forbidden-answer framing proven in LORAMER_LORA_FETCHERRORS_DEGRADED_V1. Same idiom, deliberately:
// "NEVER answer X without calling the tool named for it." One vocabulary for source honesty, not two.
export const SOURCE_PARITY_RULE = [
  '\n=== SOURCE PARITY — LIVE vs CAPTURED (two sources) ===',
  'This prompt carries the LIVE snapshot only; the CAPTURED store (query_metrics / query_breakdown / query_money) holds the same metrics and legitimately DISAGREES with it.',
  'For any family marked IN BOTH you MUST call the captured tool and report BOTH values, each labeled with source and basis (live/provisional/as-of vs captured/settled-through), even when they agree, and SAY WHY they differ from the basis given — a settlement gap is not a discrepancy, a bug, or missing data.',
  'NEVER report one source silently as the only number; NEVER average, blend, or fuse them (a bare combined figure is FORBIDDEN); NEVER call live settled or captured current-to-the-minute. LIVE-ONLY = no captured counterpart, no tool to call. CAPTURED-ONLY = absent here but IN the store — never call it unavailable without calling the tool.',
].join('\n')

// ── PER-PLATFORM RENDER ───────────────────────────────────────────────────────────────────────────────────────
// Compact by design: one group per connected platform, families comma-joined rather than one line each.
// `capturedThrough` is the REAL max captured account-grain date for (client, platform) — never a constant, never
// "today". null ⇒ nothing captured yet, and we say exactly that rather than implying a settled figure exists.
export function buildSourceParityLines(
  platform: PlatformKey,
  name: string,
  capturedThrough: string | null | undefined,
  liveAsOf: string | undefined,
): string[] {
  const both = BOTH_FAMILIES[platform]
  if (!both?.length) return []
  const liveOnly = LIVE_ONLY_FAMILIES[platform] ?? []
  const storeOnlyCount = capturedOnlyFor(platform).length
  // Emit the toolType, not a prose label: the toolType is the token she must actually pass to query_breakdown, and
  // the label was near-duplicate prose. 'base' stands for the account/campaign totals (query_metrics, no breakdown).
  const names = both.map((f) => f.toolType || 'base').join(', ')
  const asOf = liveAsOf ? String(liveAsOf).slice(0, 16).replace('T', ' ') + 'Z' : 'this turn'
  const lines: string[] = []
  lines.push(`\n${name} SOURCES — IN BOTH: ${names}`)
  lines.push(
    capturedThrough
      ? `  LIVE = figures above, PROVISIONAL as-of ${asOf}. CAPTURED = settled through ${capturedThrough}; ${RESTATEMENT_BASIS[platform]}.`
      : `  LIVE = figures above, PROVISIONAL as-of ${asOf}. CAPTURED = NOTHING CAPTURED YET here — say that plainly, do NOT report zero; ${RESTATEMENT_BASIS[platform]}.`,
  )
  if (liveOnly.length) lines.push(`  LIVE-ONLY (no captured counterpart, no tool to call): ${liveOnly.join(', ')}`)
  // COUNT, not the list — the enumeration was the single biggest token cost and query_breakdown can produce it on
  // demand. Still COMPUTED from the registry, so a new registry family raises this number automatically.
  if (storeOnlyCount) lines.push(`  CAPTURED-ONLY: ${storeOnlyCount} more families in the store, not here — call query_breakdown to list; never say unavailable.`)
  return lines
}

export { CROSS_CUTTING_WHY }
