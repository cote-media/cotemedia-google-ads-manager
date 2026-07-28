#!/usr/bin/env node
// LORAMER_LORA_FETCHERRORS_DEGRADED_GUARD_V1
//
// FAILS if a platform records sub-query fetch failures that Lora's prompt never renders.
//
// THE BUG IT GUARDS (found 2026-07-25, live): google-intelligence's safeQuery catches a REJECTED sub-query, returns
// [], and records {label,message} into `fetchErrors`. That array was returned on the object and typed — and consumed
// ONLY by cron/sync + cron/catchup. build-claude-context never read it. So on an ON-DEMAND chat turn a quota failure
// on device/geo/keyword/audience/... reached Lora as an EMPTY family with NO label: indistinguishable from a true
// zero, on data the captured store holds. Observed live at 15:31:17Z — base campaigns SUCCEEDED (so fetchFailed
// stayed false and the loud fetchFailed branch never fired) while ELEVEN families died on Google quota_error 2.
// A FALSE ZERO, which ESSENCE ranks worse than absence, and a LORA-SEES-EVERYTHING violation.
//
// IT GUARDS THE CLASS, NOT GOOGLE. Nothing here is hardcoded to today's platform or today's 19 families:
//   1. RENDERER EXISTS — any *-intelligence.ts that PUSHES into fetchErrors must have its channel consumed by
//      build-claude-context. A future Meta/Shopify/Woo/GA fetcher that starts recording fetchErrors while the
//      renderer is absent (or the renderer gets deleted) FAILS here.
//   2. FAMILY COVERAGE — every safeQuery('<label>', ...) in any fetcher must have a FETCH_ERROR_FAMILIES entry.
//      Add a 20th sub-query and forget to map it → its failure would render as a bare label with no recovery
//      instruction → FAILS.
//   3. NO INVENTED TOOL TYPES — every breakdownType this renderer tells Lora to call must EXIST in the generated
//      registry enum (breakdown-registry.ts). Pointing her at a breakdown that does not exist would manufacture a
//      SECOND false zero one layer down: she calls the tool, gets nothing, and reports absence with confidence.
//   4. ORDERING — the render call must precede the campaigns-empty early-return in buildPlatformSection. If it sat
//      after, a turn with zero in-window campaigns AND failed families would drop every degraded family silently,
//      reintroducing the exact bug.
//
// AUTHORITATIVE SOURCE = THE CODE, never a doc (a doc can be honest-but-false; the fetchers cannot lie about which
// labels they pass to safeQuery). HERMETIC: pure filesystem reads. No network, no DB, no writes. Safe in CI/build.
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const INTEL_DIR = resolve(ROOT, 'src/lib/intelligence')
const CONTEXT = resolve(INTEL_DIR, 'build-claude-context.ts')
const REGISTRY = resolve(ROOT, 'src/lib/breakdown-registry.ts')

const read = (p) => { try { return readFileSync(p, 'utf8') } catch { return null } }
const failures = []
const fail = (m) => failures.push(m)

const ctx = read(CONTEXT)
if (!ctx) { console.error('FAIL: cannot read build-claude-context.ts'); process.exit(1) }

// ── 1. DISCOVER: which fetchers record sub-query failures into fetchErrors ─────────────────────────────────────
const fetcherFiles = readdirSync(INTEL_DIR).filter((f) => f.endsWith('-intelligence.ts'))
const recordingPlatforms = []
const declaredLabels = new Set()
for (const f of fetcherFiles) {
  const src = read(resolve(INTEL_DIR, f))
  if (!src) continue
  if (!/fetchErrors\.push\(/.test(src)) continue
  recordingPlatforms.push(f)
  // Every soft sub-query is registered by its label as the FIRST arg to safeQuery.
  for (const m of src.matchAll(/safeQuery\(\s*'([a-z0-9_]+)'/g)) declaredLabels.add(m[1])
  // LORAMER_ENRICHED_CAMPAIGN_FALLBACK_VISIBLE_V1 — …and a fetcher may also record DIRECTLY, outside safeQuery,
  // when the failure is not a soft sub-query at all (google-intelligence's enriched-campaign fallback records
  // 'campaign_status' from its own catch). Reading only safeQuery labels made this guard's "N/N families mapped"
  // answer a NARROWER question than its name — a direct push with an unmapped label would render as a bare
  // internal string and the guard would still print PASS. That is the banked narrow-green failure mode, so the
  // extractor now covers BOTH recording shapes.
  for (const m of src.matchAll(/fetchErrors\.push\(\s*\{\s*label:\s*'([a-z0-9_]+)'/g)) declaredLabels.add(m[1])
}

if (recordingPlatforms.length === 0) {
  console.log('fetch-errors-rendered.guard: no fetcher records fetchErrors — nothing to guard. PASS')
  process.exit(0)
}

// ── 2. RENDERER EXISTS + is actually wired into the platform section ──────────────────────────────────────────
const hasRenderer = /export function buildFetchErrorLines\s*\(/.test(ctx)
const hasCall = /lines\.push\(\.\.\.buildFetchErrorLines\(/.test(ctx)
if (!hasRenderer) {
  fail(`NO RENDERER: ${recordingPlatforms.length} fetcher(s) record fetchErrors (${recordingPlatforms.join(', ')}) but build-claude-context.ts defines no buildFetchErrorLines(). Sub-family failures reach Lora as unlabeled empties = FALSE ZERO.`)
}
if (!hasCall) {
  fail('RENDERER NEVER CALLED: buildFetchErrorLines() exists but buildPlatformSection never pushes its output — the channel is still dead.')
}

// ── 3. ORDERING: the render must precede the campaigns-empty early-return ─────────────────────────────────────
if (hasCall) {
  const callIdx = ctx.indexOf('lines.push(...buildFetchErrorLines(')
  const emptyIdx = ctx.indexOf('if (!platform.campaigns?.length)')
  if (emptyIdx !== -1 && callIdx > emptyIdx) {
    fail('ORDERING: buildFetchErrorLines() is rendered AFTER the `!platform.campaigns?.length` early-return. A turn with zero in-window campaigns AND failed sub-families would silently drop every degraded family — the original bug.')
  }
}

// ── 4. FAMILY COVERAGE: every safeQuery label must be mapped ──────────────────────────────────────────────────
const mapBlock = ctx.match(/export const FETCH_ERROR_FAMILIES[\s\S]*?\n\}/)
if (!mapBlock) {
  fail('NO FAMILY MAP: FETCH_ERROR_FAMILIES is absent — every failed family would render as a bare internal label with no recovery instruction.')
} else {
  const mapped = new Set([...mapBlock[0].matchAll(/^\s{2}([a-z0-9_]+):\s*\{/gm)].map((m) => m[1]))
  const missing = [...declaredLabels].filter((l) => !mapped.has(l)).sort()
  if (missing.length) {
    fail(`UNMAPPED FAMILIES (${missing.length}): ${missing.join(', ')} — these sub-queries can fail and would render with no recovery instruction. Add each to FETCH_ERROR_FAMILIES.`)
  }
  // ── 5. NO INVENTED TOOL TYPES ───────────────────────────────────────────────────────────────────────────────
  const reg = read(REGISTRY)
  if (reg) {
    const realTypes = new Set([...reg.matchAll(/toolType:\s*'([a-z0-9_]*)'/g)].map((m) => m[1]).filter(Boolean))
    const named = [...mapBlock[0].matchAll(/toolType:\s*'([a-z0-9_]+)'/g)].map((m) => m[1])
    const bogus = [...new Set(named.filter((t) => !realTypes.has(t)))].sort()
    if (bogus.length) {
      fail(`INVENTED breakdownType(s): ${bogus.join(', ')} — not present in breakdown-registry.ts. Telling Lora to call a breakdown that does not exist manufactures a second false zero (tool returns nothing → she reports absence).`)
    }
  }
  // ── 6. THE FOUR FORBIDDEN ANSWERS must be restated in the degraded copy ─────────────────────────────────────
  const body = ctx.slice(ctx.indexOf('export function buildFetchErrorLines'), ctx.indexOf('function buildPlatformSection'))
  for (const phrase of ['$0', 'no spend', 'NOT zero']) {
    if (!body.includes(phrase)) {
      fail(`COPY DRIFT: the degraded block no longer contains "${phrase}". It must mirror the fetchFailed branch's forbidden-answer language or Lora can still answer zero.`)
    }
  }
}

// ── REPORT ────────────────────────────────────────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error('\n❌ LORAMER_LORA_FETCHERRORS_DEGRADED_GUARD_V1 FAILED\n')
  failures.forEach((f) => console.error('  • ' + f))
  console.error(`\n  recording fetchers: ${recordingPlatforms.join(', ')}`)
  console.error(`  declared safeQuery families: ${declaredLabels.size}\n`)
  process.exit(1)
}
console.log(`fetch-errors-rendered.guard: PASS — ${recordingPlatforms.length} recording fetcher(s), ${declaredLabels.size}/${declaredLabels.size} families mapped, renderer wired before the empty-state return, all breakdownTypes real.`)
