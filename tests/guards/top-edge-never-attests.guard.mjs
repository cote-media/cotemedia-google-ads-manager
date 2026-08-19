#!/usr/bin/env node
// LORAMER_TOP_EDGE_ATTESTS_BY_MESSAGE_V1 — A TOP-EDGE ZERO MAY NEVER SEAL A DAY.
//
// ⛔ THE DEFECT, MEASURED ON LIVE ROWS EIGHT MINUTES AFTER I SHIPPED IT. At the top of the calendar a `zero`
// and a NOT-YET-SERVED day are indistinguishable — Google publishes a 37-month lookback and says NOTHING
// about how far behind today a granular `segments.date` row becomes available. So the top-edge lane must not
// attest. The first cut enforced that by filtering `.eq('lane','descend')` on the TERMINAL row — and terminal
// rows do not carry the lane: they are written by direct INSERTs that omit the column, which then takes its
// DEFAULT ('descend'). Two strips finished `zero`, stamped 'descend', and ATTESTED **12 surface-days**. The
// filter written to prevent the seal performed it.
//
// ⛔ WHY THE LANE IS TAKEN FROM THE **MESSAGE**: the `attempt_started` row is the only row ever written
// through `universe_attempt_open(p_lane)`, so it is the only one that has carried the truth. Terminals are
// joined to it by `message_key`, and by `invocation_id` where both carry one.
//
// WHAT THIS GUARD DOES THAT THE WRITER GUARD CANNOT: `attempt-writers-carry-the-lane` proves the KEY is
// present in every write. This reads WHAT ACTUALLY LANDED and drives the REAL COMPILED `attestedEmptyDays`
// over live rows — so it catches a mis-stamped historical row, a new publisher, and a reader that quietly
// stops consulting the message.
//
// ⚠ LIMITS: it can only see surfaces the top-edge lane has actually touched (no top-edge rows ⇒ the live leg
// is VACUOUS and says so rather than reporting a green it did not earn); and it asserts non-attestation, not
// that the days are genuinely owed — a day covered by ROWS is legitimately not owed and is excluded here.
//
// USAGE: node tests/guards/top-edge-never-attests.guard.mjs
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import Module from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const COVERAGE = process.env.LORAMER_COVERAGE || 'src/lib/backfill/universe-coverage.ts'
const SURFACES = 'src/lib/backfill/universe-surfaces.ts'
const findings = []

// ── ENV ──────────────────────────────────────────────────────────────────────────────────────────────
try {
  for (const l of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
    const t = l.trim(); if (!t || t.startsWith('#')) continue
    const i = t.indexOf('='); if (i > 0) { const k = t.slice(0, i); if (!process.env[k]) process.env[k] = t.slice(i + 1).replace(/^["']|["']$/g, '') }
  }
} catch { /* ambient env */ }
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SB || !K) {
  console.error('✗ top-edge-never-attests CANNOT RUN — Supabase env missing. A broken instrument is not a pass.')
  process.exitCode = 2
  process.exit()
}
// ⛔ REALTIME-ONLY SHIM, and it must not be read as stubbing the database (same posture and same reason as
// scripts/check-topwindow-frontier.mjs:60-70): supabase-js validates a native WebSocket AT CONSTRUCTION and
// Node 20 has none. THE QUERY PATH IS THE REAL PostgREST CLIENT AGAINST LIVE ROWS.
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class { constructor() { throw new Error('[top-edge-never-attests] realtime is never used by this check') } }
}

// ── COMPILE THE REAL SUBJECT ─────────────────────────────────────────────────────────────────────────
const out = mkdtempSync(join(tmpdir(), 'top-edge-attest-'))
const origResolve = Module._resolveFilename
let C = null
try {
  const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
  const r = spawnSync(tsc, [resolve(ROOT, COVERAGE), resolve(ROOT, SURFACES), '--target', 'es2020',
    '--module', 'commonjs', '--moduleResolution', 'node', '--skipLibCheck', '--noResolve', '--outDir', out], { encoding: 'utf8' })
  if (r.error) throw new Error(`tsc did not run: ${r.error.message}`)
  const shim = join(out, '__supabase.js')
  writeFileSync(shim, `
const { createClient } = require(${JSON.stringify(join(ROOT, 'node_modules', '@supabase', 'supabase-js'))})
module.exports = { supabaseAdmin: createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }) }
`)
  const surfacesJs = join(out, 'universe-surfaces.js')
  Module._resolveFilename = function (req, ...rest) {
    if (/universe-surfaces$/.test(req)) return surfacesJs
    if (/@\/lib\/supabase$/.test(req)) return shim
    return origResolve.call(this, req, ...rest)
  }
  // ⛔ THE COMPILED NAME IS DERIVED FROM THE SUBJECT, NOT HARDCODED — the subject is a PARAMETER (so the
  // pre-fix module can be driven and this guard SEEN RED), and a hardcoded output name silently turns every
  // parameterised run into a CANNOT-RUN. Caught by red-proofing the guard against the state it must fail on.
  const compiled = COVERAGE.split('/').pop().replace(/\.ts$/, '.js')
  C = createRequire(import.meta.url)(join(out, compiled))
} catch (e) {
  Module._resolveFilename = origResolve
  rmSync(out, { recursive: true, force: true })
  console.error(`[top-edge-never-attests] CANNOT RUN — could not compile/load ${COVERAGE}: ${e.message}. A guard that cannot drive its subject FAILS rather than passing.`)
  process.exitCode = 2
  process.exit()
}

// ── SELF-TEST — THE FOUR PROVENANCE CASES, DRIVEN ON THE REAL EXPORTED DECISION ──────────────────────
// ⛔ INCLUDING THE TWO EDGE CASES THE LIVE DATA MAKES REAL: 20,825 rows carry a NULL message_key (they
// predate provenance stamping and every one of them was written before the top-edge lane existed), and 178
// message keys carry MORE THAN ONE invocation_id — redeliveries, each writing its own start and terminals.
if (typeof C.resolveTerminalLane !== 'function') {
  findings.push(`${COVERAGE} exports no \`resolveTerminalLane\`. THE DECISION DOES NOT EXIST AS A DRIVABLE FUNCTION — which is how the first cut came to filter on the terminal row's own lane column, unguardable and wrong.`)
} else {
  const M = new Map([
    ['k-descend', [{ invocationId: 'inv-1', lane: 'descend' }]],
    ['k-top', [{ invocationId: 'inv-2', lane: 'top-edge' }]],
    ['k-redelivered-descend', [{ invocationId: 'inv-a', lane: 'descend' }, { invocationId: 'inv-b', lane: 'descend' }]],
    ['k-redelivered-mixed', [{ invocationId: 'inv-a', lane: 'descend' }, { invocationId: 'inv-b', lane: 'top-edge' }]],
  ])
  const cases = [
    { name: 'NULL message_key (20,825 legacy rows, all pre-lane)', r: { message_key: null, invocation_id: null }, want: 'descend' },
    { name: 'exact key+invocation, descending', r: { message_key: 'k-descend', invocation_id: 'inv-1' }, want: 'descend' },
    { name: 'exact key+invocation, TOP-EDGE', r: { message_key: 'k-top', invocation_id: 'inv-2' }, want: 'top-edge' },
    { name: 'REDELIVERY — key matches, invocation does not, all starts descending', r: { message_key: 'k-redelivered-descend', invocation_id: 'inv-zzz' }, want: 'descend' },
    { name: 'REDELIVERY — key matches, invocation does not, ONE start was top-edge', r: { message_key: 'k-redelivered-mixed', invocation_id: 'inv-zzz' }, want: 'top-edge' },
    { name: 'REDELIVERY — exact invocation wins over the key-wide fallback', r: { message_key: 'k-redelivered-mixed', invocation_id: 'inv-a' }, want: 'descend' },
    { name: 'key present, NO start row anywhere', r: { message_key: 'k-orphan', invocation_id: 'inv-9' }, want: 'unknown' },
  ]
  const bad = cases.filter((c) => C.resolveTerminalLane(c.r, M) !== c.want)
  if (bad.length) {
    Module._resolveFilename = origResolve
    rmSync(out, { recursive: true, force: true })
    console.error(`[top-edge-never-attests] CANNOT RUN — the lane resolver failed its own self-test on ${bad.length} fixture(s): ` +
      bad.map((c) => `${c.name} → ${C.resolveTerminalLane(c.r, M)}, expected ${c.want}`).join(' · ') +
      `. ⛔ A BROKEN INSTRUMENT, NOT A PASS.`)
    process.exitCode = 2
    process.exit()
  }
  console.log(`[top-edge-never-attests] self-test PASS — 7/7 provenance fixtures: NULL-key ⇒ descend · exact match wins · a redelivery whose starts are all descending stays descending · a redelivery that ever asked at the top edge REFUSES · an orphan key is UNKNOWN and therefore refuses.`)
}

// ── LIVE — WHAT ACTUALLY LANDED ──────────────────────────────────────────────────────────────────────
const get = async (p) => {
  const r = await fetch(`${SB}/rest/v1/${p}`, { headers: { apikey: K, Authorization: `Bearer ${K}` } })
  const body = await r.json().catch(() => null)
  if (r.status !== 200 || !Array.isArray(body)) throw new Error(`read failed (HTTP ${r.status}) on ${p.slice(0, 90)}: ${JSON.stringify(body).slice(0, 200)}`)
  return body
}
const dayList = (a, b) => {
  const outD = []; const d = new Date(a + 'T00:00:00Z'), end = new Date(b + 'T00:00:00Z')
  while (d <= end) { outD.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1) }
  return outD
}

try {
  // every message the TOP-EDGE lane ever started
  const topStarts = await get(`universe_attempt_log?select=client_id,vendor,resource,segment,message_key&phase=eq.attempt_started&lane=eq.top-edge&limit=1000`)
  if (topStarts.length === 0) {
    console.log(`[top-edge-never-attests] LIVE LEG VACUOUS — no top-edge attempt_started rows exist yet, so there is nothing that COULD have attested. This is not a green for the property; it is the absence of a subject, and it is said out loud rather than counted as a pass.`)
  } else {
    const keys = [...new Set(topStarts.map((r) => r.message_key).filter(Boolean))]
    // the terminals those messages wrote, whatever lane column they happen to carry
    const terms = keys.length
      ? await get(`universe_attempt_log?select=client_id,vendor,resource,segment,window_start,window_end,outcome,lane,message_key&phase=eq.attempt_finished&outcome=in.(zero,nongrain)&message_key=in.(${keys.map((k) => `"${k}"`).join(',')})&limit=1000`)
      : []
    let checkedSurfaces = 0, checkedDays = 0
    const seen = new Set()
    for (const t of terms) {
      const sk = `${t.client_id}|${t.vendor}|${t.resource}|${t.segment ?? ''}|${t.window_start}|${t.window_end}`
      if (seen.has(sk)) continue
      seen.add(sk)
      // days that a DESCENDING message also attests are legitimately attested — exclude them, or this leg
      // would red on ground the descent answered for itself.
      const descend = await get(`universe_attempt_log?select=window_start,window_end,message_key&phase=eq.attempt_finished&outcome=in.(zero,nongrain)&client_id=eq.${t.client_id}&vendor=eq.${t.vendor}&resource=eq.${encodeURIComponent(t.resource)}&window_start=lte.${t.window_end}&window_end=gte.${t.window_start}&limit=1000`)
      const descendDays = new Set()
      for (const d of descend) {
        if (keys.includes(d.message_key)) continue // that is a top-edge message's row
        for (const day of dayList(String(d.window_start), String(d.window_end))) descendDays.add(day)
      }
      const bt = t.segment ? String(t.segment).replace(/^segments\./, '').replace(/\./g, '_') : String(t.resource)
      const k = { clientId: t.client_id, platform: t.vendor, entityLevel: t.resource, breakdownType: bt }
      const attested = await C.attestedEmptyDays(k, String(t.window_start), String(t.window_end))
      const sealed = attested.filter((d) => !descendDays.has(d))
      checkedSurfaces++
      checkedDays += dayList(String(t.window_start), String(t.window_end)).length
      if (sealed.length) {
        findings.push(
          `${t.resource}/${t.segment || '(base)'} ${t.window_start}..${t.window_end}: ${sealed.length} day(s) are ATTESTED EMPTY on the evidence of a TOP-EDGE message alone (${sealed.slice(0, 8).join(', ')}${sealed.length > 8 ? ', …' : ''}). ` +
          `⛔ AT THE TOP OF THE CALENDAR A ZERO CANNOT BE TOLD APART FROM A NOT-YET-SERVED DAY. Sealing it is permanent: the strip then reads as held, the lane stops asking, and nothing behind the walk ever comes back for it.`)
      }
    }
    console.log(`[top-edge-never-attests] LIVE: ${topStarts.length} top-edge start(s) · ${keys.length} message key(s) · ${checkedSurfaces} terminal window(s) examined over ${checkedDays} day(s).`)
  }
} catch (e) {
  Module._resolveFilename = origResolve
  rmSync(out, { recursive: true, force: true })
  console.error(`[top-edge-never-attests] CANNOT RUN — ${e.message}. ⛔ AN ATTESTATION VERDICT MUST NOT BE SYNTHESISED FROM A FAILED READ.`)
  process.exitCode = 2
  process.exit()
}

Module._resolveFilename = origResolve
rmSync(out, { recursive: true, force: true })

if (findings.length) {
  console.error(`[top-edge-never-attests] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  ✗ ${f}`)
  console.error(`  ⇒ SPEC: DECISIONS LORAMER_TOP_EDGE_ATTESTS_BY_MESSAGE_V1. attestedEmptyDays must resolve the lane from the MESSAGE (attempt_started, joined by message_key + invocation_id), never from the terminal row's own defaulted column.`)
  process.exitCode = 1
} else {
  console.log(`[top-edge-never-attests] PASS — no day is attested empty on the evidence of a top-edge message alone, driven through the real compiled attestedEmptyDays against live rows.`)
}
