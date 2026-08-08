#!/usr/bin/env node
// LORAMER_UNIVERSE_SURFACE_LABELS_V1 — EVERY DELIVERING RESOURCE MUST HAVE A NAME A CLIENT WOULD RECOGNISE.
//
// ⛔ WHY THIS IS A GUARD AND NOT A CONVENTION. The failure surface says "Google search terms are incomplete
// from 2025-11-07 to 2025-12-06". The coverage model speaks VENDOR vocabulary — `campaign_search_term_view`,
// `segments.ad_network_type` — and a client has never heard of either. **A delivering resource with no label
// cannot appear in that sentence, so it vanishes from the report while still being incomplete.** That is
// silence, and silence is the failure class this whole arc exists to end.
//
// ⛔ THE CLASS, NOT THE INSTANCE: the catalog is REGENERATED from GoogleAdsFieldService
// (LORAMER_VENDOR_CATALOG_IS_THE_DENOMINATOR_V1), so Google can add a resource at any time. This leg fails
// the moment a NEW delivering resource appears unlabelled — which is the only way to stop the report quietly
// narrowing as the vendor's surface grows.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (rel) => {
  try { return readFileSync(resolve(ROOT, rel), 'utf8') }
  catch (e) { findings.push(`UNREADABLE ${rel} under ROOT ${ROOT} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' }
}

const MAP = 'src/lib/backfill/universe-surfaces.ts'
const ARTIFACT = 'docs/google-ads-capture-universe.json'

const mapSrc = read(MAP)
let doc = null
try { doc = JSON.parse(read(ARTIFACT) || '{}') } catch (e) { findings.push(`(a) ${ARTIFACT} is not valid JSON — ${e.message}`) }

const delivering = [...new Set((doc?.entries ?? []).filter((e) => e.delivers === true).map((e) => e.resource))].sort()

if (!mapSrc) {
  findings.push(`(a) ${MAP} does not exist. ${delivering.length} delivering resource(s) have NO client-facing label, so none of them can be named in a completeness statement: ${delivering.join(', ')}`)
} else {
  // The table is a literal object so it is readable by a human AND by this guard without executing anything.
  const labelled = new Set()
  for (const m of mapSrc.matchAll(/^\s*([a-z0-9_]+)\s*:\s*\{\s*surface:\s*'([^']+)'/gm)) labelled.add(m[1])
  const missing = delivering.filter((r) => !labelled.has(r))
  if (missing.length) {
    findings.push(`(a) ${missing.length} delivering resource(s) carry no surface label and would VANISH from the completeness report while still being incomplete: ${missing.join(', ')}`)
  }

  // ── (b) THE LABELS MUST BE CLIENT VOCABULARY, NOT VENDOR VOCABULARY ────────────────────────────────────
  // The test Russ set: would a Foam OH stakeholder recognise this without explanation? Mechanically, a label
  // carrying an underscore or a `_view` suffix is the vendor's name wearing a label's clothes.
  for (const m of mapSrc.matchAll(/surface:\s*'([^']+)'/g)) {
    const label = m[1]
    if (/_/.test(label) || /view$/i.test(label)) {
      findings.push(`(b) surface label "${label}" is vendor vocabulary, not client vocabulary. A client has never heard of a "view" and does not read snake_case.`)
    }
  }

  // ── (c) TWO RESOURCES THAT ARE DIFFERENT FACTS MAY NOT SHARE A LABEL ──────────────────────────────────
  // ⛔ EACH PAIR BELOW IS PINNED WITH ITS REASON, because collapsing it would make an incomplete surface
  // report as complete under the OTHER surface's name — the exact half-truth this report exists to prevent.
  const mustDiffer = [
    ['geographic_view', 'user_location_view',
      'presence-vs-target geography: where we TARGETED versus where the user actually WAS. The audit records these as different declared families (GEO_LOSS in DEFERRED_ENTRIES); one being complete says nothing about the other.'],
    ['ad_group_ad_asset_view', 'ad_group_ad_asset_combination_view',
      'an ASSET is not a COMBINATION. Asset-combination conversion attribution is a banked CORE capability (ESSENCE, THINGS RUSS SHOULD NEVER HAVE TO RE-STATE) — collapsing it into "creative assets" makes the flagship capability invisible in the report.'],
    ['search_term_view', 'paid_organic_search_term_view',
      'the paid-and-organic report joins Search Console data; its completeness depends on a second source, so it can be incomplete while paid search terms are whole.'],
  ]
  const surfaceOf = (res) => {
    const m = new RegExp(`^\\s*${res}\\s*:\\s*\\{\\s*surface:\\s*'([^']+)'`, 'm').exec(mapSrc)
    return m ? m[1] : null
  }
  for (const [a, b, why] of mustDiffer) {
    const sa = surfaceOf(a), sb = surfaceOf(b)
    if (sa && sb && sa === sb) {
      findings.push(`(c) '${a}' and '${b}' share the surface label "${sa}" — ${why}`)
    }
  }

  // ── (d) EVERY LABEL CARRIES ITS REASON, so a future reader can judge the collapse rather than inherit it.
  const surfaceBlock = /SURFACE_BY_RESOURCE[\s\S]*?\n\}/.exec(mapSrc)?.[0] ?? ''
  for (const [, res, body] of surfaceBlock.matchAll(/^\s*([a-z0-9_]+)\s*:\s*\{([^}]*)\}/gm)) {
    if (!/why:\s*'/.test(body)) {
      findings.push(`(d) '${res}' has a surface label with no 'why'. A collapse without its reason is a judgment nobody can re-examine — and this table is the one place vendor vocabulary becomes a customer-facing claim.`)
    }
  }

  // ── (e) THE SEGMENT AXIS NEEDS THE SAME TREATMENT ─────────────────────────────────────────────────────
  // A surface alone cannot carry the sentence. "Search terms are incomplete" is wrong when only the
  // split-by-device slice is missing. The report line is SURFACE + QUALIFIER, so an unlabelled segment
  // takes its slice out of the report exactly the way an unlabelled resource takes its surface out.
  const segments = [...new Set((doc?.entries ?? []).filter((e) => e.delivers === true).map((e) => e.segment || null))]
    .filter(Boolean).sort()
  const qualBlock = /QUALIFIER_BY_SEGMENT[\s\S]*?\n\}/.exec(mapSrc)?.[0] ?? ''
  if (!qualBlock) {
    findings.push(`(e) QUALIFIER_BY_SEGMENT is missing from ${MAP}. ${segments.length} delivering segment(s) have no client-facing qualifier, so no report line can name which SLICE of a surface is incomplete.`)
  } else {
    const qualified = new Map()
    for (const m of qualBlock.matchAll(/^\s*'([^']+)'\s*:\s*\{([^}]*)\}/gm)) qualified.set(m[1], m[2])
    const missingSeg = segments.filter((s) => !qualified.has(s))
    if (missingSeg.length) {
      findings.push(`(e) ${missingSeg.length} delivering segment(s) carry no qualifier label: ${missingSeg.join(', ')}`)
    }
    for (const [seg, body] of qualified) {
      const label = /label:\s*'([^']*)'/.exec(body)?.[1]
      if (label === undefined) { findings.push(`(e) '${seg}' has no 'label'.`); continue }
      // A time grain is legitimately unlabelled — it is the SAME fact rolled up, not a different slice —
      // but it must SAY SO, so that "no label" is never indistinguishable from "forgot to label".
      const isTime = /timeGrain:\s*true/.test(body)
      if (!label && !isTime) findings.push(`(e) '${seg}' has an empty label and is not marked timeGrain. Silence about which slice is missing is the failure class this table exists to end.`)
      if (label && (/_/.test(label) || /\bsegments\./.test(label))) {
        findings.push(`(f) qualifier "${label}" for '${seg}' is vendor vocabulary, not client vocabulary.`)
      }
    }

    // ── (g) ONE VOCABULARY, NOT TWO. docs/LORAMER_BREAKDOWN_REGISTRY.md ALREADY NAMES THESE DIMENSIONS
    // for the forward-capture path. If the walk invents a second word for the same dimension, Lora ends up
    // with two names for one question and the drift is invisible until a client is confused by it.
    const registryPins = [
      ['segments.device', 'device'], ['segments.hour', 'hour'],
      ['segments.ad_network_type', 'network'], ['segments.conversion_action', 'conversion action'],
      ['segments.conversion_action_name', 'conversion action'], ['segments.keyword.info.text', 'keyword'],
    ]
    for (const [seg, word] of registryPins) {
      const body = qualified.get(seg)
      if (!body) continue
      const label = (/label:\s*'([^']*)'/.exec(body)?.[1] ?? '').toLowerCase()
      if (!label.includes(word)) {
        findings.push(`(g) '${seg}' is labelled "${label}" but docs/LORAMER_BREAKDOWN_REGISTRY.md already calls this dimension "${word}". Two vocabularies for one dimension is how this drifts.`)
      }
    }
  }
}

if (findings.length) {
  console.error(`[universe-surface-labels] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[universe-surface-labels] PASS — all ${delivering.length} delivering resources carry a client-vocabulary surface label with its reason, and the three different-fact pairs stay distinct.`)
