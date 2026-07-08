// LORAMER_META_ALIAS_CANON — Meta action_type alias-canonicalization resolver.
// READ-LAYER ONLY: pure, NO DB, NO fetch, NO capture-path change. Implements the SPEC banked in
// LORAMER_DECISIONS.md ("META ACTION-TYPE ALIAS CANONICALIZATION (SPEC)"). Meta reports one event under
// MULTIPLE parallel action_type aliases; a value/ROAS surface that sums them multi-counts. This collapses
// each alias family to ONE canonical alias per base_event. DATA-DRIVEN parser (prefix-strip + classification
// sets), NOT a hardcoded raw→canonical alias table. Raw rows are NEVER mutated in storage — this projects an
// already-read result set at query/display time only.
//
// KEY FINDING (DB-verified 2026-07-08): the dollar VALUE is PICK-INVARIANT (every value-bearing alias in a
// family carries the same value), so the canonical pick changes only the CONVERSION COUNT (and CPA/ROAS
// denominators), never reported revenue.

export type ActionKind = 'standard' | 'custom' | 'engagement' | 'unclassifiable'

export interface ActionClass {
  base_event: string
  // 'bare' | one of PREFIXES | 'engagement' | 'custom' | 'unclassifiable'
  prefix_class: string
  is_custom: boolean
  kind: ActionKind
}

// Known conversion-event prefixes, LONGEST-FIRST so the most specific wins
// (onsite_web_app_ before onsite_web_; web_app_in_store_ before web_in_store_).
const PREFIXES: string[] = [
  'offsite_conversion.fb_pixel_',
  'onsite_web_app_',
  'onsite_web_',
  'onsite_app_',
  'onsite_conversion.',
  'web_app_in_store_',
  'web_in_store_',
  'omni_',
]

// Canonical PICK priority (SPEC): omni_ > offsite_conversion.fb_pixel_ > bare, then the remaining surfaces
// as deterministic fallbacks so any non-empty family always resolves.
const CANON_PRIORITY: string[] = [
  'omni_',
  'offsite_conversion.fb_pixel_',
  'bare',
  'onsite_web_',
  'onsite_web_app_',
  'onsite_app_',
  'onsite_conversion.',
  'web_in_store_',
  'web_app_in_store_',
]

// Engagement / social singles — NEVER folded, always kept distinct (SPEC).
const ENGAGEMENT_EXACT = new Set<string>([
  'page_engagement', 'post_engagement', 'link_click', 'video_view',
  'post_reaction', 'like', 'comment', 'photo_view', 'post',
])
const ENGAGEMENT_PREFIX: string[] = ['post_interaction_', 'onsite_conversion.post_', 'onsite_conversion.messaging_']

// Client-defined custom-conversion suffixes — kept DISTINCT, excluded from the standard-event sum (SPEC).
const CUSTOM_SUFFIX: string[] = ['_add_meta_leads', '_add_20_s_calls']

// Recognized STANDARD conversion base-events (the vocabulary that participates in alias-collapse). A parsed
// base_event NOT in this set surfaces LOUDLY as unclassifiable and is passed through raw — never silently folded.
const KNOWN_EVENTS = new Set<string>([
  'view_content', 'purchase', 'add_to_cart', 'lead', 'search', 'initiate_checkout',
  'complete_registration', 'landing_page_view', 'add_payment_info', 'contact', 'subscribe',
  'start_trial', 'submit_application', 'schedule', 'add_to_wishlist', 'donate',
  'find_location', 'customize_product',
])

// Base-event spelling normalization (verb-form variance Meta emits across surfaces, e.g. omni_ uses
// "initiated_checkout" while others use "initiate_checkout"). NOT an alias table — a base-event normalizer.
const BASE_NORMALIZE: Record<string, string> = { initiated_checkout: 'initiate_checkout' }

// Classify a raw Meta action_type string → {base_event, prefix_class, is_custom, kind}. Pure/deterministic.
export function parseActionType(raw: string): ActionClass {
  const r = String(raw || '')

  // 1. Engagement singles (never folded).
  if (ENGAGEMENT_EXACT.has(r) || ENGAGEMENT_PREFIX.some((p) => r.startsWith(p)) || r.includes('messaging')) {
    return { base_event: r, prefix_class: 'engagement', is_custom: false, kind: 'engagement' }
  }

  // 2. Client custom conversions (suffix-tagged) — kept distinct, excluded from the standard sum.
  if (CUSTOM_SUFFIX.some((s) => r.endsWith(s))) {
    return { base_event: r, prefix_class: 'custom', is_custom: true, kind: 'custom' }
  }

  // 3. Prefix-strip → base_event + prefix_class (data-driven).
  let prefix_class = 'bare'
  let base = r
  for (const p of PREFIXES) {
    if (r.startsWith(p)) { prefix_class = p; base = r.slice(p.length); break }
  }
  base = BASE_NORMALIZE[base] || base

  if (KNOWN_EVENTS.has(base)) {
    return { base_event: base, prefix_class, is_custom: false, kind: 'standard' }
  }
  // onsite_conversion.<unknown> = a client-defined onsite custom conversion → distinct, not folded.
  if (prefix_class === 'onsite_conversion.') {
    return { base_event: r, prefix_class: 'custom', is_custom: true, kind: 'custom' }
  }

  // 4. Unclassifiable — surfaced loudly + passed through raw by projectActionCanon (never dropped).
  return { base_event: r, prefix_class: 'unclassifiable', is_custom: false, kind: 'unclassifiable' }
}

// Pick the canonical alias member of a standard family by CANON_PRIORITY. Returns the chosen member.
export function canonicalPick<M extends { cls: ActionClass }>(members: M[]): M {
  for (const prio of CANON_PRIORITY) {
    const m = members.find((x) => x.cls.prefix_class === prio)
    if (m) return m
  }
  return members[0]
}

export interface CanonResult<T> { rows: T[]; notes: string[] }

// Collapse Meta action_type rows (already value-grouped + entity-level-scoped) to ONE canonical row per
// standard base_event. Custom conversions, engagement singles, and unclassifiable values are kept as their
// OWN distinct rows (never folded). The canonical row keeps the CHOSEN alias's metrics (value is
// pick-invariant) and is relabeled to the clean base_event. Unclassifiable values are console.error'd, added
// to notes, AND passed through raw. Generic over any row carrying a string `value` label.
export function projectActionCanon<T extends { value: string }>(rows: T[]): CanonResult<T> {
  const notes: string[] = []
  const families = new Map<string, { base: string; members: { row: T; cls: ActionClass }[] }>()
  const passthrough: T[] = [] // custom + engagement + unclassifiable, kept distinct
  const unclassifiable: string[] = []

  for (const row of rows) {
    const cls = parseActionType(row.value)
    if (cls.kind === 'standard') {
      let fam = families.get(cls.base_event)
      if (!fam) { fam = { base: cls.base_event, members: [] }; families.set(cls.base_event, fam) }
      fam.members.push({ row, cls })
    } else {
      if (cls.kind === 'unclassifiable') {
        unclassifiable.push(row.value)
        // Loud surfacing per SPEC — silent false-zero is the house pathology (L15/L47). Passed through below.
        console.error(`[meta-action-canon] UNCLASSIFIABLE action_type "${row.value}" — passed through raw, not folded.`)
      }
      passthrough.push(row)
    }
  }

  const out: T[] = []
  for (const [, fam] of families) {
    const chosen = canonicalPick(fam.members)
    const canonAlias = chosen.cls.prefix_class === 'bare' ? fam.base : chosen.cls.prefix_class + fam.base
    // Keep the chosen alias's metrics; relabel the display value to the clean base_event.
    out.push({ ...(chosen.row as any), value: fam.base } as T)
    if (fam.members.length > 1) {
      notes.push(`Meta ${fam.base}: collapsed ${fam.members.length} aliases → 1 canonical (${canonAlias}); value is pick-invariant.`)
    }
  }
  for (const p of passthrough) out.push(p)
  if (unclassifiable.length) {
    notes.push(`Meta action_type: ${unclassifiable.length} unclassifiable value(s) passed through raw (not folded): ${unclassifiable.slice(0, 8).join(', ')}${unclassifiable.length > 8 ? '…' : ''}.`)
  }
  return { rows: out, notes }
}
