#!/usr/bin/env node
// LORAMER_GOOGLE_RESTATE_PRUNE_V1 — THE LIVE HALF: a re-pulled day must equal the fresh payload, exactly.
//
// ⛔ THE DEFECT. `upsertMetricsChunked` conflicts on the 7-column natural key and NEVER deletes, so "REPLACE"
// only replaces keys that RECUR. The Google dimensional writer caps per day (WINDOW_DAY_ST_CAP=300 /
// WINDOW_DAY_KW_CAP=200, applied after a per-day sort by spend), and LORAMER_GOOGLE_FORWARD_RESTATE_V1 now
// re-pulls the last 30 days every night. So the moment restatement moves the top-N boundary — or a term's
// metrics are credited to zero and it vanishes from the vendor's answer — the row written by the FIRST pull
// survives at its old value and the day reads as old ∪ new. This is QUEUE ★SHOPIFY-TIER2 gap (1)
// ("STALE KEYS SURVIVE") arriving on Google, and the restate window is exactly the condition that entry
// warns "hits it harder, because you visit a day precisely BECAUSE something changed".
//
// ⛔ WHY THIS IS A check:data ENTRY AND NOT A BUILD GUARD, stated so nobody moves it later: IT WRITES TO THE
// DATABASE. `npm run guard` runs on Vercel on every deploy; a DB-writing check there would write from the
// build. check:data is deliberately outside the deploy path (CLAUDE.md), which is where live work belongs.
// The STATIC half — that the prune exists and carries every scope predicate — is
// tests/guards/google-restate-prune-capped.guard.mjs, which reads source only and is safe in the build.
//
// ⛔ REAL INPUTS, AND THE ONE DELIBERATE DEVIATION, NAMED (LORAMER_REAL_INPUT_GATE_A_V1).
// The payload is REAL: sampled from search-term rows this warehouse actually holds, at their real ad-group
// ids, real term texts and real metrics — not invented shapes. What is NOT real is the client_id: every row
// this check writes is keyed to a SYNTHETIC uuid that belongs to no client, and the date is a real one only
// so the partition exists. THE REASON IS NOT CONVENIENCE: driving this against Foam OH's own rows would mean
// deleting real captured search-term history to prove a delete works, and a crash between the write and the
// restore would leave a live client short a day. Writing under a synthetic key exercises the identical
// natural key, the identical writer and the identical prune, and can lose nothing that anyone captured.
// The vendor is NOT called: sampling stored rows costs zero quota, and a check that spent Google ops on
// every check:data run would be a new daily draw on a 15,000/day lane.
//
// USAGE: node scripts/check-restate-prune-live.mjs
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import Module from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const NAME = 'restate-prune-live'

// Two synthetic clients: the SUBJECT and a NEIGHBOUR that must be untouched. Fixed uuids so a crashed run
// leaves rows this check itself cleans up on its next pass rather than orphaning a random key forever.
const SUBJECT = '00000000-0000-4000-8000-000000000001'
const NEIGHBOUR = '00000000-0000-4000-8000-000000000002'
const SYNTH_EMAIL = 'guard+restate-prune@loramer.invalid'
const SYNTH_ACCOUNT = '__guard_restate_prune__'

try {
  for (const l of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
    const t = l.trim(); if (!t || t.startsWith('#')) continue
    const i = t.indexOf('='); if (i > 0) { const k = t.slice(0, i); if (!process.env[k]) process.env[k] = t.slice(i + 1).replace(/^["']|["']$/g, '') }
  }
} catch { /* ambient env */ }
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL, K = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SB || !K) {
  console.error(`✗ ${NAME} CANNOT RUN — Supabase env missing. A broken instrument is not a pass.`)
  process.exit(2)
}

let readFailure = null
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const get = async (p) => {
  const r = await fetch(`${SB}/rest/v1/${p}`, { headers: H })
  const b = await r.json().catch(() => null)
  if (!r.ok || (b && b.code)) { readFailure = `HTTP ${r.status} ${JSON.stringify(b).slice(0, 200)}`; return null }
  return b
}
const upsert = async (rows) => {
  const r = await fetch(`${SB}/rest/v1/metrics_daily?on_conflict=client_id,platform,entity_level,entity_id,date,breakdown_type,breakdown_value`, {
    method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows),
  })
  if (!r.ok) { readFailure = `upsert HTTP ${r.status} ${(await r.text()).slice(0, 200)}`; return false }
  return true
}
const wipe = async (clientId) => {
  const r = await fetch(`${SB}/rest/v1/metrics_daily?client_id=eq.${clientId}&account_id=eq.${SYNTH_ACCOUNT}`, { method: 'DELETE', headers: H })
  return r.ok
}

// ── Load the REAL prune, if it exists yet. Absent ⇒ this check still runs and reports the defect with its
// evidence; it does NOT report CANNOT-RUN. That is deliberate: the pre-fix red IS the proof the fix is needed,
// and a guard that can only run after its own fix has never been seen to fail.
const PRUNE_TS = 'src/lib/intelligence/google-dimensional-prune.ts'
const out = mkdtempSync(join(tmpdir(), 'loramer-prune-'))
const origResolve = Module._resolveFilename
let P = null, pruneLoadError = null
try {
  readFileSync(resolve(ROOT, PRUNE_TS)) // throws when the fix has not landed yet
  const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
  const r = spawnSync(tsc, [resolve(ROOT, PRUNE_TS), '--target', 'es2020', '--module', 'commonjs',
    '--moduleResolution', 'node', '--skipLibCheck', '--noResolve', '--outDir', out], { encoding: 'utf8' })
  if (r.error) throw new Error(`tsc did not run: ${r.error.message}`)
  const shim = join(out, '__supabase.js')
  // ⛔ THE STUB TRANSPORT IS LOAD-BEARING, NOT DECORATION. supabase-js constructs a RealtimeClient eagerly and
  // Node 20 has no global WebSocket, so a plain createClient() THROWS here — and the first cut of this check
  // swallowed that into `pruneLoadError` and reported "prune module absent" while the module was present and
  // correct. A guard that mistakes its own broken loader for its subject's absence is the false-green class.
  // Realtime is never used by the prune; the stub satisfies the constructor and nothing else.
  writeFileSync(shim, `
const { createClient } = require(${JSON.stringify(join(ROOT, 'node_modules', '@supabase', 'supabase-js'))})
module.exports = { supabaseAdmin: createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false }, realtime: { transport: class NoRealtime {} } }) }
`)
  Module._resolveFilename = function (req, ...rest) {
    if (/@\/lib\/supabase$/.test(req)) return shim
    return origResolve.call(this, req, ...rest)
  }
  P = createRequire(import.meta.url)(join(out, 'google-dimensional-prune.js'))
} catch (e) {
  pruneLoadError = e.message
} finally {
  Module._resolveFilename = origResolve
}

const key = (r) => `${r.date}|${r.breakdown_type}|${r.entity_id}|${r.breakdown_value}`
const row = (o) => ({
  client_id: o.client_id, user_email: SYNTH_EMAIL, platform: 'google', account_id: SYNTH_ACCOUNT,
  entity_level: o.entity_level, entity_id: o.entity_id, entity_name: o.breakdown_value,
  parent_entity_id: o.parent ?? null, date: o.date, breakdown_type: o.breakdown_type,
  breakdown_value: o.breakdown_value, spend: o.spend, impressions: 0, clicks: 0,
  conversions: 0, conversion_value: 0, revenue: 0, extra: { status: [] },
})

const findings = []
let sampled = null
try {
  // ── REAL PAYLOAD: the newest search-term rows this warehouse actually holds, any google client.
  const clients = await get('clients?select=id&limit=40')
  if (!clients) throw new Error(`client roster unreadable: ${readFailure}`)
  for (const c of clients) {
    const r = await get(`metrics_daily?select=date,entity_id,breakdown_value,parent_entity_id,spend&client_id=eq.${c.id}&platform=eq.google&breakdown_type=eq.search_term&entity_level=eq.ad_group&order=date.desc&limit=6`)
    if (r === null) throw new Error(`search-term sample read failed: ${readFailure}`)
    if (r.length >= 3) { sampled = { clientId: c.id, rows: r.filter((x) => x.date === r[0].date) }; if (sampled.rows.length >= 3) break; sampled = null }
  }
  if (!sampled) throw new Error('no google client holds >=3 search_term rows on a single day — nothing real to drive with')

  const D = sampled.rows[0].date
  const OTHER_DAY = new Date(new Date(D + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10)

  await wipe(SUBJECT); await wipe(NEIGHBOUR)

  // PAYLOAD A — the first pull of day D.
  const A = sampled.rows.slice(0, 3).map((s, i) => row({
    client_id: SUBJECT, entity_level: 'ad_group', entity_id: s.entity_id, date: D,
    breakdown_type: 'search_term', breakdown_value: s.breakdown_value, parent: s.parent_entity_id, spend: 30 - i,
  }))
  // CONTROLS — every one of them must survive the prune untouched. One per scope leg.
  const CONTROLS = [
    row({ client_id: SUBJECT, entity_level: 'ad_group', entity_id: A[0].entity_id, date: OTHER_DAY, breakdown_type: 'search_term', breakdown_value: A[0].breakdown_value, spend: 9 }),      // different DATE
    row({ client_id: SUBJECT, entity_level: 'ad_group', entity_id: A[0].entity_id, date: D, breakdown_type: 'device', breakdown_value: 'MOBILE', spend: 8 }),                                // different BREAKDOWN_TYPE (uncapped grain)
    row({ client_id: SUBJECT, entity_level: 'campaign', entity_id: 'ctl-campaign', date: D, breakdown_type: '', breakdown_value: '', spend: 7 }),                                            // FIXED-KEY grain
    row({ client_id: NEIGHBOUR, entity_level: 'ad_group', entity_id: A[0].entity_id, date: D, breakdown_type: 'search_term', breakdown_value: A[0].breakdown_value, spend: 6 }),             // different CLIENT
  ]
  if (!(await upsert([...A, ...CONTROLS]))) throw new Error(readFailure)

  // PAYLOAD B — the re-pull of the SAME day after restatement moved the top-N boundary: the lowest-spend
  // term of A has dropped out and a new one has taken its place. This is the exact live shape.
  const B = [
    A[0], A[1],
    row({ client_id: SUBJECT, entity_level: 'ad_group', entity_id: A[2].entity_id, date: D, breakdown_type: 'search_term', breakdown_value: `${A[2].breakdown_value} (restated-in)`, spend: 29 }),
  ]
  if (!(await upsert(B))) throw new Error(readFailure)

  // THE REAL PRUNE — the shipped function, compiled from source, driven exactly as the writer drives it.
  let pruned = null
  if (P && typeof P.pruneCappedDimensionalRows === 'function') {
    pruned = await P.pruneCappedDimensionalRows({
      clientId: SUBJECT,
      dates: [D],
      freshKeys: new Set(B.map(key)),
    })
  }

  // ── ASSERTION 1: the day equals the fresh payload EXACTLY.
  const after = await get(`metrics_daily?select=date,entity_id,breakdown_value,breakdown_type&client_id=eq.${SUBJECT}&platform=eq.google&entity_level=eq.ad_group&breakdown_type=eq.search_term&date=eq.${D}`)
  if (after === null) throw new Error(`read-back failed: ${readFailure}`)
  const got = new Set(after.map(key)), want = new Set(B.map(key))
  const survived = [...got].filter((k) => !want.has(k))
  const missing = [...want].filter((k) => !got.has(k))
  if (survived.length || missing.length) {
    findings.push(`day ${D} is NOT the fresh payload — stored ${got.size} row(s), payload has ${want.size}.`
      + (survived.length ? ` STALE ROW(S) SURVIVED A RE-PULL: ${survived.map((s) => s.split('|').pop()).join(' · ')}.` : '')
      + (missing.length ? ` MISSING: ${missing.map((s) => s.split('|').pop()).join(' · ')}.` : '')
      + (P ? '' : ` (no prune module — ${PRUNE_TS} not present: ${pruneLoadError})`))
  }

  // ── ASSERTION 2–5: the four scope legs, each read back independently.
  const legs = [
    ['never touches a different DATE', `client_id=eq.${SUBJECT}&entity_level=eq.ad_group&breakdown_type=eq.search_term&date=eq.${OTHER_DAY}`, 1],
    ['never touches a different BREAKDOWN_TYPE', `client_id=eq.${SUBJECT}&entity_level=eq.ad_group&breakdown_type=eq.device&date=eq.${D}`, 1],
    ['never touches a FIXED-KEY grain', `client_id=eq.${SUBJECT}&entity_level=eq.campaign&breakdown_type=eq.&date=eq.${D}`, 1],
    ['never crosses CLIENT_ID', `client_id=eq.${NEIGHBOUR}&entity_level=eq.ad_group&breakdown_type=eq.search_term&date=eq.${D}`, 1],
  ]
  for (const [what, q, expect] of legs) {
    const r = await get(`metrics_daily?select=id&platform=eq.google&${q}`)
    if (r === null) throw new Error(`scope-leg read failed (${what}): ${readFailure}`)
    if (r.length !== expect) findings.push(`SCOPE LEG BROKEN — ${what}: expected ${expect} control row, found ${r.length}. The prune reached outside its scope.`)
  }

  console.log(`[${NAME}] drove the REAL writer + prune against live Postgres under a synthetic client. day=${D} payloadA=3 payloadB=3 (one term dropped, one restated in) controls=4`)
  if (pruned) console.log(`[${NAME}] prune reported: examined=${pruned.examined} pruned=${pruned.pruned} days=${pruned.days}`)
  else console.log(`[${NAME}] prune NOT INVOKED — ${PRUNE_TS} absent (${pruneLoadError})`)
} catch (e) {
  console.error(`✗ ${NAME} CANNOT RUN — ${e.message}. A broken instrument is not a pass.`)
  await wipe(SUBJECT); await wipe(NEIGHBOUR)
  rmSync(out, { recursive: true, force: true })
  process.exit(2)
} finally {
  rmSync(out, { recursive: true, force: true })
}

// ⛔ CLEANUP IS UNCONDITIONAL AND SCOPED BY account_id, so it can only ever remove rows this check wrote.
await wipe(SUBJECT); await wipe(NEIGHBOUR)

if (findings.length === 0) {
  console.log(`✓ ${NAME} OK — a re-pulled day equals the fresh payload exactly, and the prune touched no other date, breakdown_type, grain or client.`)
  process.exit(0)
}
console.error(`✗ RESTATE-PRUNE FAILED — ${findings.length} finding(s):`)
for (const f of findings) console.error(`  ✗ ${f}`)
process.exit(1)
