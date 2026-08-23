#!/usr/bin/env node
// LORAMER_FAILURE_IS_NOT_A_FACT_V1 — GUARD. A FAILED READ MUST NEVER BECOME A NEGATIVE FACT.
//
// ⛔ THE CLASS, MEASURED 2026-08-23 ACROSS SIX SITES: a three-state question ("did the read succeed, and
// what did it say") forced into a boolean, so any timeout or permission fault reads as a confident NO.
//   · client-metrics `ever()` → `!!data` → hasDataEver:false → the UI renders the literal "not connected"
//     for a platform holding years of rows.
//   · the Meta failure branch wrote `{...EMPTY_PLATFORM}` (connected:false) instead of fetchFailed, so a
//     failed Meta fetch reached Lora as "not connected" — and was CACHED for 15 minutes.
// ⛔ AND THE ROOT WAS A SENTENCE, NOT A LINE OF CODE: the route's own header documented the OLD contract
// ("Failed platform fetches return { connected: false } not null"). Google, Shopify and Woo were patched to
// fetchFailed; the header was never corrected, so the old rule kept propagating to every platform added
// after. Leg (d) exists so the sentence cannot silently come back.
//
// FIVE LEGS. What each can and cannot see is stated on its face.
//  (a) ERROR DESTRUCTURED — mechanical PROXY, deliberately wider than the true set. Which reads drive a
//      user-visible negative is a human call and is not computable, so the guard demands `error` on EVERY
//      supabase call in the two -next data directories. REMOVE-ONLY baseline: may fall, may never rise.
//  (b) LADDER SYMMETRY — every platform that gets a "populated" rung in build-claude-context must also get
//      a fetch-FAILED rung. Symmetry across five platforms is exactly what a string check reads well.
//  (c) NO FAILURE BRANCH ASSIGNS connected:false — that literal may appear only in EMPTY_PLATFORM's own
//      definition. An else/catch that assigns it is the defect restated.
//  (d) THE HEADER STATES THE CORRECTED CONTRACT — placement, and it is the propagation vector.
//  (e) THE CACHE REFUSES A FAILED READ — the write sites must be gated by the named predicate, and the read
//      site must treat a cached failure as a miss. RFC 9111 in the general case; this route already argued
//      it about its own quota state and did not apply it to platform payloads.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { ERROR_DESTRUCTURE_BASELINE } from './failure-is-not-a-fact.baseline.mjs'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }

// ── (a) ERROR DESTRUCTURED ────────────────────────────────────────────────────────────────────────────────
const DIRS = ['src/lib/next', 'src/app/api/next']
const walk = (d) => {
  const abs = resolve(ROOT, d)
  if (!existsSync(abs)) return []
  return readdirSync(abs).flatMap((n) => {
    const p = join(d, n)
    return statSync(resolve(ROOT, p)).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []
  })
}
const offenders = []
for (const f of DIRS.flatMap(walk)) {
  const src = read(f)
  src.split('\n').forEach((line, i) => {
    // A supabase call whose result is destructured WITHOUT `error`. `{ data }`, `{ data: rows }`, both fail.
    if (/const\s*\{\s*data(\s*:\s*\w+)?\s*\}\s*=\s*await\s+supabase/.test(line)) offenders.push(`${f}:${i + 1}`)
  })
}
if (offenders.length > ERROR_DESTRUCTURE_BASELINE) {
  findings.push(`(a) ${offenders.length} supabase read(s) discard \`error\`, ABOVE the baseline of ${ERROR_DESTRUCTURE_BASELINE}. A discarded error becomes \`data: null\` becomes a confident NO:\n      ${offenders.join('\n      ')}`)
} else if (offenders.length < ERROR_DESTRUCTURE_BASELINE) {
  console.log(`[failure-is-not-a-fact] ⇢ offenders FELL to ${offenders.length} (baseline ${ERROR_DESTRUCTURE_BASELINE}) — lower the baseline in the same commit that earned it.`)
}

// ── (b) LADDER SYMMETRY ───────────────────────────────────────────────────────────────────────────────────
const ctx = read('src/lib/intelligence/build-claude-context.ts')
if (!ctx) findings.push('(b) build-claude-context.ts unreadable — the ladder cannot be checked.')
else {
  for (const [key, label] of [['google', 'Google'], ['meta', 'Meta'], ['shopify', 'Shopify'], ['woocommerce', 'WooCommerce'], ['ga', 'GA']]) {
    const populated = new RegExp(`platformStatus\\.push\\([^)]*\`?${label}: populated`).test(ctx) || new RegExp(`${label}: populated`).test(ctx)
    const failed = new RegExp(`intelligence\\.${key}\\?\\.fetchFailed`).test(ctx)
    if (populated && !failed) findings.push(`(b) build-claude-context emits a "${label}: populated" rung but NO fetch-FAILED rung for \`${key}\`. A failed fetch therefore reaches Lora as an empty or disconnected platform — a confident answer over a window we did not have.`)
  }
}

// ── (c) NO FAILURE BRANCH ASSIGNS connected:false ─────────────────────────────────────────────────────────
const intel = read('src/app/api/intelligence/route.ts')
if (!intel) findings.push('(c) api/intelligence/route.ts unreadable.')
else {
  const bad = []
  intel.split('\n').forEach((line, i) => {
    if (/intelligence\.\w+\s*=\s*\{\s*connected:\s*false/.test(line)) bad.push(`${i + 1}: ${line.trim().slice(0, 110)}`)
    if (/intelligence\.\w+\s*=\s*\{\s*\.\.\.EMPTY_PLATFORM(?![^}]*fetchFailed)/.test(line)) bad.push(`${i + 1}: ${line.trim().slice(0, 110)}`)
  })
  if (bad.length) findings.push(`(c) ${bad.length} failure branch(es) still collapse a failed fetch into "not connected". Only EMPTY_PLATFORM's own definition may carry connected:false:\n      ${bad.join('\n      ')}`)
}

// ── (d) THE HEADER STATES THE CORRECTED CONTRACT ──────────────────────────────────────────────────────────
if (intel) {
  const head = intel.split('\n').slice(0, 20).join('\n')
  if (/Failed platform fetches return \{ connected: false \} not null/.test(head)) {
    findings.push('(d) api/intelligence/route.ts still documents the OLD contract in its header ("Failed platform fetches return { connected: false } not null"). That sentence is the propagation vector: it is why meta, the woo focused path and ga were written the wrong way after google/shopify/woo were fixed.')
  }
  if (!/fetchFailed/.test(head)) {
    findings.push('(d) the header does not state the CORRECTED contract. It must say that a failed fetch is connected:true + fetchFailed:true — never connected:false — or the next platform inherits the defect.')
  }
}

// ── (e) THE CACHE REFUSES A FAILED READ ───────────────────────────────────────────────────────────────────
if (intel) {
  if (!/function\s+hasFailedFetch/.test(intel)) {
    findings.push('(e) no `hasFailedFetch` predicate exists. The cache rule needs ONE named test, not an inline condition repeated at three sites.')
  } else {
    const writes = [...intel.matchAll(/existingCache\[cacheKey\] = intelligence/g)]
    for (const m of writes) {
      const before = intel.slice(Math.max(0, m.index - 400), m.index)
      if (!/hasFailedFetch\(/.test(before)) {
        findings.push(`(e) a cache WRITE at offset ${m.index} is not gated by hasFailedFetch(). A failed read cached as a finding outlives the outage it describes — the argument this route already makes about its own quota state at :228-229.`)
      }
    }
    if (writes.length < 2) findings.push(`(e) expected 2 cache write sites, found ${writes.length} — the shape changed and this leg is now pinned to the wrong thing.`)
    const readIdx = intel.indexOf('const cached = JSON.parse(context.intelligence_cache)')
    const readWin = readIdx >= 0 ? intel.slice(readIdx, readIdx + 900) : ''
    if (!/hasFailedFetch\(/.test(readWin)) findings.push('(e) the cache READ does not treat a cached failure as a MISS. An entry written before this rule (or by an older deployment) would still be served as a finding.')
  }
}

if (findings.length) {
  console.error(`✗ FAILURE-IS-NOT-A-FACT FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[failure-is-not-a-fact] PASS — ${offenders.length} error-discarding read(s) ≤ baseline ${ERROR_DESTRUCTURE_BASELINE}; all five platforms carry both a populated and a fetch-FAILED rung; no failure branch collapses to connected:false; the header states the corrected contract; both cache writes and the cache read are gated by hasFailedFetch().`)
console.log(`[failure-is-not-a-fact] LIMIT: leg (a) is a PROXY — it demands \`error\` on every supabase read in two directories because "drives a user-visible negative" is judgment and not computable. Whether an unknown then RENDERS honestly is a browser question this guard cannot see.`)
