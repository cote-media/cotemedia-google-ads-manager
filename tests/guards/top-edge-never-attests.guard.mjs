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
import { restAll } from '../../scripts/lib/rest-all.mjs' // LORAMER_REST_ROW_CAP_READER_V1 — pages from the server total, throws on a partial set

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

// ── LORAMER_LOOKBACK_LANE_V1 — THE DRIVEN TABLE: 'lookback' ATTESTS, 'top-edge' NEVER, AND THE REFUSAL STILL WINS ──
// The lookback lane is the top-edge lane converted (DECISIONS LORAMER_SESSION_2026_09_05_RULINGS (j)); its terminal
// ATTESTS because its window ends at or below the account's restatement boundary by construction. The resolver
// must therefore name a third lane, and a redelivery that EVER asked at the top edge must still resolve to the
// refusal — a key with one top-edge start and one lookback start is the shape whose zero must not be trusted.
// Findings here are FINDINGS (exit 1), not CANNOT-RUN: the instrument works; the property is what is being judged.
if (typeof C.resolveTerminalLane === 'function') {
  const L = new Map([
    ['k-look', [{ invocationId: 'inv-l', lane: 'lookback' }]],
    ['k-redelivered-look', [{ invocationId: 'inv-a', lane: 'lookback' }, { invocationId: 'inv-b', lane: 'lookback' }]],
    ['k-mixed-look-descend', [{ invocationId: 'inv-a', lane: 'descend' }, { invocationId: 'inv-b', lane: 'lookback' }]],
    ['k-mixed-look-top', [{ invocationId: 'inv-a', lane: 'lookback' }, { invocationId: 'inv-b', lane: 'top-edge' }]],
  ])
  const table = [
    { name: 'exact key+invocation, LOOKBACK', r: { message_key: 'k-look', invocation_id: 'inv-l' }, want: 'lookback' },
    { name: 'REDELIVERY — all starts lookback', r: { message_key: 'k-redelivered-look', invocation_id: 'inv-zzz' }, want: 'lookback' },
    { name: 'REDELIVERY — descend + lookback starts, invocation unknown → lookback (both attest; the more specific lane names the row)', r: { message_key: 'k-mixed-look-descend', invocation_id: 'inv-zzz' }, want: 'lookback' },
    { name: 'REDELIVERY — lookback + TOP-EDGE starts, invocation unknown → the refusal wins', r: { message_key: 'k-mixed-look-top', invocation_id: 'inv-zzz' }, want: 'top-edge' },
    { name: 'exact invocation on the mixed key → lookback', r: { message_key: 'k-mixed-look-top', invocation_id: 'inv-a' }, want: 'lookback' },
  ]
  for (const c of table) {
    const got = C.resolveTerminalLane(c.r, L)
    if (got !== c.want) findings.push(`LOOKBACK TABLE — ${c.name}: resolveTerminalLane → ${JSON.stringify(got)}, expected ${JSON.stringify(c.want)}. ⛔ A lookback terminal that resolves as anything but 'lookback' either cannot attest (the lane observes and never seals — the top-edge cost again) or attests under the wrong name.`)
  }
  // the attesting set is exactly {descend, lookback}: read from the compiled module's own filter, never re-derived
  const covSrc = readFileSync(resolve(ROOT, COVERAGE), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  if (!/lane\s*!==\s*'descend'\s*&&\s*lane\s*!==\s*'lookback'/.test(covSrc) && !/\['descend',\s*'lookback'\]/.test(covSrc)) {
    findings.push(`LOOKBACK TABLE — attestedEmptyDays in ${COVERAGE} does not admit BOTH 'descend' and 'lookback' as attesting lanes (and only those). Expected a filter of the shape \`lane !== 'descend' && lane !== 'lookback'\`.`)
  }
  if (!findings.some((f) => f.startsWith('LOOKBACK TABLE'))) console.log('[top-edge-never-attests] LOOKBACK TABLE PASS — 5/5: a lookback terminal resolves as lookback, a redelivery that ever touched the top edge still refuses, and attestedEmptyDays admits exactly {descend, lookback}.')
}

// ── LIVE — WHAT ACTUALLY LANDED ──────────────────────────────────────────────────────────────────────
// ⛔ LORAMER_REST_ROW_CAP_READER_V1 — the first cut read `…&limit=1000` through a bare fetch and examined 1,000 of 9,097
// top-edge starts (measured 2026-09-11): 8,097 were never looked at and the verdict read PASS. Every read here now pages
// from the server's own total and THROWS on a partial set. The terminal join is sent in chunks of IN_CHUNK keys per
// in.() request — 9,097 quoted keys in one URL is unsendable — the pattern check-google-forward-account-day.mjs:66 uses.
const IN_CHUNK = 50 // ⇐ the house in.() chunk at check-google-forward-account-day.mjs:66,98, in production today
const dayList = (a, b) => {
  const outD = []; const d = new Date(a + 'T00:00:00Z'), end = new Date(b + 'T00:00:00Z')
  while (d <= end) { outD.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1) }
  return outD
}

try {
  // every message the TOP-EDGE lane ever started
  const topStarts = await restAll(`universe_attempt_log?select=client_id,vendor,resource,segment,message_key&phase=eq.attempt_started&lane=eq.top-edge`)
  if (topStarts.length === 0) {
    console.log(`[top-edge-never-attests] LIVE LEG VACUOUS — no top-edge attempt_started rows exist yet, so there is nothing that COULD have attested. This is not a green for the property; it is the absence of a subject, and it is said out loud rather than counted as a pass.`)
  } else {
    const keys = [...new Set(topStarts.map((r) => r.message_key).filter(Boolean))]
    const keySet = new Set(keys)
    // the terminals those messages wrote, whatever lane column they happen to carry — IN_CHUNK keys per request, concatenated
    const terms = []
    for (let i = 0; i < keys.length; i += IN_CHUNK) {
      const chunk = keys.slice(i, i + IN_CHUNK)
      terms.push(...await restAll(`universe_attempt_log?select=client_id,vendor,resource,segment,window_start,window_end,outcome,lane,message_key&phase=eq.attempt_finished&outcome=in.(zero,nongrain)&message_key=in.(${chunk.map((k) => `"${k}"`).join(',')})`))
    }
    let checkedSurfaces = 0, checkedDays = 0
    // one entry per distinct terminal window, in first-seen order (the same dedupe the sequential loop performed)
    const seen = new Set()
    const windows = terms.filter((t) => {
      const sk = `${t.client_id}|${t.vendor}|${t.resource}|${t.segment ?? ''}|${t.window_start}|${t.window_end}`
      if (seen.has(sk)) return false
      seen.add(sk); return true
    })
    // ⛔ LORAMER_REST_ROW_CAP_READER_V1 (resume) — WINDOWS_IN_FLIGHT windows examined concurrently. The honest set is 292
    // windows (9× what the 1,000-row page showed) at ~0.66 s each sequentially = 194 s, over the 130,104 ms check:data
    // budget. Same predicate, same compiled attestedEmptyDays call per window; results land by index so counters and
    // findings are order-independent and the report reads identically. A rejected window rejects the leg (CANNOT RUN).
    const WINDOWS_IN_FLIGHT = 6 // ⇐ 292 × 0.66 s / 6 ≈ 35 s, under a third of the budget; six short reads do not stack statement time
    const pool = async (items, size, fn) => {
      const out = new Array(items.length); let next = 0
      const worker = async () => { for (;;) { const i = next++; if (i >= items.length) return; out[i] = await fn(items[i]) } }
      await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker))
      return out
    }
    const results = await pool(windows, WINDOWS_IN_FLIGHT, async (t) => {
      // days that a DESCENDING message also attests are legitimately attested — exclude them, or this leg
      // would red on ground the descent answered for itself.
      const descend = await restAll(`universe_attempt_log?select=window_start,window_end,message_key&phase=eq.attempt_finished&outcome=in.(zero,nongrain)&client_id=eq.${t.client_id}&vendor=eq.${t.vendor}&resource=eq.${encodeURIComponent(t.resource)}&window_start=lte.${t.window_end}&window_end=gte.${t.window_start}`)
      const descendDays = new Set()
      for (const d of descend) {
        if (keySet.has(d.message_key)) continue // that is a top-edge message's row
        for (const day of dayList(String(d.window_start), String(d.window_end))) descendDays.add(day)
      }
      const bt = t.segment ? String(t.segment).replace(/^segments\./, '').replace(/\./g, '_') : String(t.resource)
      const k = { clientId: t.client_id, platform: t.vendor, entityLevel: t.resource, breakdownType: bt }
      const attested = await C.attestedEmptyDays(k, String(t.window_start), String(t.window_end))
      const sealed = attested.filter((d) => !descendDays.has(d))
      return { t, sealed, days: dayList(String(t.window_start), String(t.window_end)).length }
    })
    for (const { t, sealed, days } of results) {
      checkedSurfaces++
      checkedDays += days
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
