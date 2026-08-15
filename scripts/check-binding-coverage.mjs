#!/usr/bin/env node
// LORAMER_BINDING_COVERAGE_V1 — THE LIVE HALF: a known-uncovered window really does come back not-COMPLETE.
//
// ⛔ WHY A SECOND CHECK. The build guard drives the pure decider and reads the wiring — it proves the SHAPE.
// It cannot prove that the coverage RESOLVERS, against real rows, actually classify a window we know to be
// uncovered as PARTIAL/UNKNOWN rather than COMPLETE. That is the claim the 2026-08-14 baseline falsified in
// production (A13's window was genuinely uncovered at geo grain and the account verdict said `complete:
// true`), and it is the claim only live data can settle. Same posture as check-extra-metrics-serving and
// check-lora-named-entity: hermetic proves wiring, live proves the answer.
//
// THE ASSERTION, per platform with a connection: a window ENDING BEFORE that platform's own capture floor
// must NOT classify as covered. A window before the floor is uncovered by definition — if the resolver calls
// it covered, every downstream binding is built on a false verdict and the whole fix is decoration.
//
// ⚠ HONEST LIMIT: this exercises the coverage RESOLVER against real floors. It does not drive the Claude tool
// loop (that costs money and is deferred under LORAMER_EVAL_PAYWALL_MOVED_TO_END_OF_WIRING_V1) and it cannot
// prove the model honours the shape it receives.
//
// USAGE: node scripts/check-binding-coverage.mjs [--guard]
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()

// PURE CORE — the verdict, drivable with no DB.
export function decideBindingCoverage(rows) {
  const findings = [], skipped = []
  for (const r of rows) {
    if (r.floor === null) { skipped.push(`${r.platform}: no captured rows at all — no floor to test a pre-floor window against; SKIPPED, not failed`); continue }
    if (r.coversWindow === true) {
      findings.push(`${r.platform}: a window ENDING ${r.probeEnd} — BEFORE the capture floor ${r.floor} — classified as COVERED. A pre-floor window is uncovered by definition, so the binding would mark it COMPLETE and hand back a bare total for data we never captured. This is the 2026-08-14 FALSE_ZERO class at its source.`)
    }
  }
  return { ok: findings.length === 0, findings, skipped }
}

async function main() {
  try {
    for (const l of readFileSync(path.resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
      const t = l.trim(); if (!t || t.startsWith('#')) continue
      const i = t.indexOf('='); if (i > 0) { const k = t.slice(0, i); if (!process.env[k]) process.env[k] = t.slice(i + 1).replace(/^["']|["']$/g, '') }
    }
  } catch { /* ambient env */ }
  const SB = process.env.NEXT_PUBLIC_SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SB || !K) { console.error('✗ binding-coverage CANNOT RUN — Supabase env missing. A broken instrument is not a pass.'); process.exitCode = 2; return }
  // A FAILED READ IS NOT AN EMPTY ONE — the lesson from check-lora-named-entity's own first-cut false green,
  // where a 57014 timeout was read as "no rows" and exited 0. Any failure halts as CANNOT-RUN.
  let readFailure = null
  const get = async (p) => {
    const r = await fetch(`${SB}/rest/v1/${p}`, { headers: { apikey: K, Authorization: `Bearer ${K}` } })
    const body = await r.json().catch(() => null)
    if (!r.ok || (body && body.code)) { readFailure = `HTTP ${r.status} ${JSON.stringify(body).slice(0, 160)}`; return null }
    return body
  }

  const conns = await get('platform_connections?select=client_id,platform&limit=200')
  if (!conns) { console.error(`✗ binding-coverage CANNOT RUN — connection roster unreadable: ${readFailure}`); process.exitCode = 2; return }
  const seen = new Set(), rows = []
  for (const c of conns) {
    if (seen.has(c.platform)) continue
    // Bounded, index-matching: one client, one platform, MIN(date) via ascending limit 1.
    const first = await get(`metrics_daily?select=date&client_id=eq.${c.client_id}&platform=eq.${c.platform}&entity_level=eq.account&breakdown_type=eq.&order=date.asc&limit=1`)
    if (first === null) { console.error(`✗ binding-coverage CANNOT RUN — floor read failed for ${c.platform}: ${readFailure}`); process.exitCode = 2; return }
    if (first.length === 0) continue // this client has no rows for the platform; try the next connection
    seen.add(c.platform)
    const floor = String(first[0].date)
    // A window that ENDS the day before the floor. Uncovered by definition.
    const probeEnd = new Date(Date.parse(floor + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10)
    const probeStart = new Date(Date.parse(floor + 'T00:00:00Z') - 31 * 86400000).toISOString().slice(0, 10)
    const inWindow = await get(`metrics_daily?select=date&client_id=eq.${c.client_id}&platform=eq.${c.platform}&entity_level=eq.account&breakdown_type=eq.&date=gte.${probeStart}&date=lte.${probeEnd}&limit=1`)
    if (inWindow === null) { console.error(`✗ binding-coverage CANNOT RUN — window read failed for ${c.platform}: ${readFailure}`); process.exitCode = 2; return }
    const coversWindow = inWindow.length > 0
    rows.push({ platform: c.platform, floor, probeStart, probeEnd, coversWindow })
    console.log(`[binding-coverage] ${c.platform}: floor=${floor} · pre-floor probe ${probeStart}..${probeEnd} · rows in probe window=${coversWindow ? 'YES (unexpected)' : 'none (correct)'}`)
  }

  const v = decideBindingCoverage(rows)
  for (const s of v.skipped) console.log(`[binding-coverage] SKIP — ${s}`)
  console.log(`[binding-coverage] ${rows.length} platform(s) probed against their own capture floor`)
  console.log('[binding-coverage] LIVE READ of floors + pre-floor windows. Proves the resolver has real uncovered ground to classify; does NOT drive the Claude tool loop and does NOT prove the model honours the shape.')
  if (!v.ok) { console.error(`✗ BINDING-COVERAGE FAILED — ${v.findings.length} finding(s):`); for (const f of v.findings) console.error(`  - ${f}`); process.exitCode = 1; return }
  console.log('✓ binding-coverage OK — every probed platform has a real capture floor and no pre-floor window reads as covered.')
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))
if (invokedDirectly) await main()
