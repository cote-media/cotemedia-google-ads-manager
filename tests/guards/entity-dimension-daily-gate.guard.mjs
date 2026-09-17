#!/usr/bin/env node
// LORAMER_ENTITY_DIMENSION_DAILY_GATE_V1 — "REFRESHED TODAY" AND "CHANGED TODAY" ARE DIFFERENT FACTS, AND THE
// ONCE-A-DAY GATE MUST READ THE FIRST ONE.
//
// ⛔ THE MEASURED DEFECT THIS EXISTS TO MAKE UNREPEATABLE (found 2026-09-17 while proving the first scheduled
// refresh): the gate read max(google_entity_dimension.updated_at) and asked "is that today?". updated_at moves
// ONLY when a row is WRITTEN, and an unchanged entity is deliberately never written (entity-dimension.guard leg
// (d)). So on every day after the first population a stable account writes nothing, its stamp stays on the day
// its names last changed, and every one of the driver's 38 fires re-reads it: 3 × 38 × 17 = 1,938 vendor
// requests a day — the exact number LORAMER_ENTITY_DIMENSION_DAILY_V1's own comment says it removed. It held
// on day one only because day one wrote every row. THE ADJACENT NUMBER, exactly as ESSENCE describes it.
//
// THE FIX: the refresh MOMENT is a PASS fact and lives in capture_pass_log (one 'ok' row per client per
// account per day, written only when every read succeeded); the row-change moment stays in updated_at. Two
// facts, two owners — the original comment's "a second marker would be a second owner" conflated them.
//
// LEGS — behavioural, driven on the REAL captureEntityDimension with a fake database and a fake vendor:
//  (a) STEADY STATE: an account whose names did not change since yesterday is read ONCE today and skipped on
//      the next fire with 0 vendor reads. (Pre-fix: read again, because nothing was written.)
//  (b) A FAILED READ IS NOT A REFRESH: when one of the three reads fails, the fire that follows reads again —
//      a broken account is RETRIED, never skipped. (Pre-fix: the two reads that succeeded wrote rows stamped
//      today, and the account was skipped for the rest of the day with a third of its names missing.)
//  (c) AN EMPTY ACCOUNT IS STILL A REFRESH: three successful reads that observe nothing are recorded, and the
//      next fire skips. (Pre-fix: no row exists to carry a stamp, so an empty account is read 38 times a day.)
//  (d) force bypasses the gate — the manual path is unchanged.
//  (e) the pass row carries its denominator (entities examined) and the marker, so the ledger explains WHY the
//      later fires skipped without a Vercel log that expires in an hour.
//  (f) SOURCE: the gate no longer selects updated_at from the dimension — the proxy cannot come back by edit.
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import Module from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (rel) => {
  try { return readFileSync(resolve(ROOT, rel), 'utf8') }
  catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' }
}

const CAPTURE = 'src/lib/backfill/entity-dimension-capture.ts'
const DIM = 'src/lib/backfill/entity-dimension.ts'
const SURFACES = 'src/lib/backfill/universe-surfaces.ts'

// ── A FAKE DATABASE THAT BEHAVES LIKE THE BUILDER THE CODE USES ─────────────────────────────────────────
// from(table).select(..).eq(..).eq(..).order(..).limit(..) is awaited; .maybeSingle() returns one row or null;
// .insert(row) / .upsert(rows) append. Every read is served from `state`, every write lands in `state`.
function makeDb(state) {
  const builder = (table) => {
    const q = { table, op: 'select', filters: [], order: null, limit: null, single: false, payload: null }
    const b = {
      select() { q.op = 'select'; return b },
      eq(col, val) { q.filters.push([col, val]); return b },
      order(col, o) { q.order = [col, !!(o && o.ascending)]; return b },
      limit(n) { q.limit = n; return b },
      maybeSingle() { q.single = true; return b },
      insert(row) { q.op = 'insert'; q.payload = row; return b },
      upsert(rows) { q.op = 'upsert'; q.payload = rows; return b },
      then(res) { return Promise.resolve(run()).then(res) },
    }
    const run = () => {
      state.calls.push({ table, op: q.op })
      if (q.op === 'insert') { (state.tables[table] ??= []).push({ ran_at: new Date().toISOString(), ...q.payload, id: state.calls.length }); return { data: null, error: null } } // ran_at: the column's DEFAULT now()
      if (q.op === 'upsert') {
        const t = (state.tables[table] ??= [])
        for (const r of q.payload) {
          const i = t.findIndex((x) => x.client_id === r.client_id && x.platform === r.platform && x.entity_level === r.entity_level && x.entity_id === r.entity_id)
          if (i >= 0) t[i] = { ...t[i], ...r }; else t.push({ ...r })
        }
        return { data: null, error: null }
      }
      let rows = [...(state.tables[table] ?? [])]
      for (const [c, v] of q.filters) rows = rows.filter((r) => r[c] === v)
      if (q.order) rows.sort((x, y) => (x[q.order[0]] < y[q.order[0]] ? -1 : x[q.order[0]] > y[q.order[0]] ? 1 : 0) * (q.order[1] ? 1 : -1))
      if (q.limit != null) rows = rows.slice(0, q.limit)
      return q.single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null }
    }
    return b
  }
  return { from: builder }
}

const out = mkdtempSync(join(tmpdir(), 'loramer-entity-dim-gate-'))
try {
  const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
  const r = spawnSync(tsc, [resolve(ROOT, CAPTURE), resolve(ROOT, DIM), resolve(ROOT, SURFACES), '--target', 'es2020', '--module', 'commonjs',
    '--moduleResolution', 'node', '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
  if (r.error) findings.push(`could not run tsc — ${r.error.message}`)

  // The two seams the capture module reaches through, replaced by fakes the legs control.
  const stubDir = join(out, 'stubs'); mkdirSync(stubDir, { recursive: true })
  writeFileSync(join(stubDir, 'supabase.js'), 'module.exports = { get supabaseAdmin() { return globalThis.__dimDb } }\n')
  writeFileSync(join(stubDir, 'google-ads-client.js'), 'module.exports = { withGoogleAdsCustomer: (k, fn) => fn(globalThis.__dimVendor) }\n')
  const origResolve = Module._resolveFilename
  Module._resolveFilename = function (request, ...rest) {
    if (request === '@/lib/supabase') return join(stubDir, 'supabase.js')
    if (request === '@/lib/google-ads-client') return join(stubDir, 'google-ads-client.js')
    if (request === '@/lib/backfill/entity-dimension') return join(out, 'src/lib/backfill/entity-dimension.js')
    if (request === '@/lib/backfill/universe-surfaces') return join(out, 'src/lib/backfill/universe-surfaces.js')
    return origResolve.call(this, request, ...rest)
  }
  let M
  try { M = createRequire(import.meta.url)(join(out, 'src/lib/backfill/entity-dimension-capture.js')) }
  finally { Module._resolveFilename = origResolve }

  const CID = '1234567890' // fixture: synthetic — the id shape only; the vendor's own doc uses this exact placeholder
  const CLIENT = 'client-a' // fixture: not a uuid on purpose — the gate keys on equality, not on shape
  // The vendor's three reads, as the library returns them (resource names; the module canonicalises).
  const VENDOR_ROWS = {
    campaign: [{ campaign: { resource_name: `customers/${CID}/campaigns/111`, name: 'Brand Search' } }],
    ad_group: [{ ad_group: { resource_name: `customers/${CID}/adGroups/222`, name: 'Exact — core' }, campaign: { resource_name: `customers/${CID}/campaigns/111` } }],
    ad_group_ad: [{ ad_group_ad: { resource_name: `customers/${CID}/adGroupAds/222~333`, ad: { name: 'RSA v2' } }, ad_group: { resource_name: `customers/${CID}/adGroups/222` } }],
  }
  const levelOf = (gaql) => /FROM (\w+)\s*$/.exec(gaql.trim())?.[1]
  const vendor = (opts = {}) => ({
    query: async (gaql) => {
      const level = levelOf(gaql)
      if (opts.fail && opts.fail.includes(level)) throw new Error(`vendor refused ${level}`)
      return opts.empty ? [] : VENDOR_ROWS[level] ?? []
    },
  })
  const freshState = () => ({ calls: [], tables: { google_tokens: [{ user_email: 'u', refresh_token: 'tok' }] } })
  const yesterday = new Date(Date.now() - 86_400_000).toISOString()
  const seedDimensionAsOfYesterday = (state) => {
    state.tables.google_entity_dimension = [
      { client_id: CLIENT, platform: 'google', entity_level: 'campaign', entity_id: '111', entity_name: 'Brand Search', parent_entity_id: null, customer_id: CID, updated_at: yesterday },
      { client_id: CLIENT, platform: 'google', entity_level: 'ad_group', entity_id: '222', entity_name: 'Exact — core', parent_entity_id: '111', customer_id: CID, updated_at: yesterday },
      { client_id: CLIENT, platform: 'google', entity_level: 'ad_group_ad', entity_id: `customers/${CID}/adGroupAds/222~333`, entity_name: 'RSA v2', parent_entity_id: '222', customer_id: CID, updated_at: yesterday },
    ]
  }
  const fire = async (state, v, opts) => {
    globalThis.__dimDb = makeDb(state); globalThis.__dimVendor = v
    return M.captureEntityDimension({ clientId: CLIENT, userEmail: 'u', customerId: CID, log: () => {} }, opts)
  }
  const passRows = (state) => (state.tables.capture_pass_log ?? [])

  // ── (a) STEADY STATE ────────────────────────────────────────────────────────────────────────────────
  {
    const state = freshState(); seedDimensionAsOfYesterday(state)
    const f1 = await fire(state, vendor())
    check(f1.readsAttempted === 3 && f1.readsFailed === 0, `(a) the day's first fire did not make its three reads (attempted ${f1.readsAttempted}, failed ${f1.readsFailed}).`)
    check(f1.written === 0 && f1.unchanged === 3, `(a) an unchanged account wrote ${f1.written} row(s) (unchanged ${f1.unchanged}). Leg (d) of entity-dimension.guard already forbids this; it is restated here because it is the precondition that exposes the gate.`)
    const f2 = await fire(state, vendor())
    check(f2.readsAttempted === 0 && f2.skippedAlreadyToday === true,
      `(a) THE SECOND FIRE OF THE DAY READ THE VENDOR AGAIN (attempted ${f2.readsAttempted}, skippedAlreadyToday=${f2.skippedAlreadyToday}). An account whose names did not change writes nothing, so a gate that reads the dimension's own updated_at never sees "today" and re-reads on all 38 fires — 1,938 requests a day, the number the daily gate claimed to remove.`)
  }

  // ── (b) A FAILED READ IS NOT A REFRESH ──────────────────────────────────────────────────────────────
  {
    const state = freshState()
    const f1 = await fire(state, vendor({ fail: ['ad_group_ad'] }))
    check(f1.readsFailed === 1, `(b) fixture: expected exactly one failed read, got ${f1.readsFailed}.`)
    check(f1.skippedAlreadyToday !== true, '(b) fixture: the first fire must not be a skip.')
    const afterFailedFire = [...passRows(state)]
    const f2 = await fire(state, vendor())
    check(f2.readsAttempted === 3 && f2.skippedAlreadyToday !== true,
      `(b) A FIRE WITH A FAILED READ WAS TREATED AS THE DAY'S REFRESH (next fire attempted ${f2.readsAttempted}, skipped=${f2.skippedAlreadyToday}). The two reads that succeeded wrote rows stamped today and the account was skipped for the rest of the day with a third of its names missing. A broken account is RETRIED, never skipped.`)
    check(!afterFailedFire.some((p) => p.outcome === 'ok'), `(b) an 'ok' pass row was recorded for a fire with a failed read. The ledger would then say "refreshed" about a refresh that did not finish.`)
    check(afterFailedFire.some((p) => p.outcome === 'error'), `(b) the failed refresh left NO pass row. An empty result must carry its denominator (LORAMER_EMPTY_CARRIES_ITS_DENOMINATOR_V1): "we could not look" is a fact the ledger must hold.`)
    check(f2.readsFailed === 0 && passRows(state).some((p) => p.outcome === 'ok'), `(b) the retry that succeeded did not record 'ok' — the day would never close.`)
  }

  // ── (c) AN EMPTY ACCOUNT IS STILL A REFRESH ─────────────────────────────────────────────────────────
  {
    const state = freshState()
    const f1 = await fire(state, vendor({ empty: true }))
    check(f1.readsAttempted === 3 && f1.observed === 0, `(c) fixture: expected three reads observing nothing, got attempted ${f1.readsAttempted} observed ${f1.observed}.`)
    const f2 = await fire(state, vendor({ empty: true }))
    check(f2.readsAttempted === 0 && f2.skippedAlreadyToday === true,
      `(c) AN EMPTY ACCOUNT WAS RE-READ ON THE SECOND FIRE (attempted ${f2.readsAttempted}). With no dimension row to carry a stamp, a gate that reads the dimension reads an empty account 38 times a day. A refresh that observed nothing is still a refresh.`)
    const ok = passRows(state).find((p) => p.outcome === 'ok')
    check(!!ok && ok.entities_examined === 0, `(c) the empty refresh's pass row does not say it examined 0 entities (${JSON.stringify(ok)}). Zero output PLUS a pass row = nothing there; no pass row = nothing ran. The table exists to keep those apart.`)
  }

  // ── (d) force bypasses the gate ─────────────────────────────────────────────────────────────────────
  {
    const state = freshState(); seedDimensionAsOfYesterday(state)
    await fire(state, vendor())
    const f = await fire(state, vendor(), { force: true })
    check(f.readsAttempted === 3 && f.skippedAlreadyToday !== true, `(d) force did not bypass the gate (attempted ${f.readsAttempted}). The manual path must still be able to re-read on demand.`)
  }

  // ── (e) the pass row is readable on its own ─────────────────────────────────────────────────────────
  {
    const state = freshState(); seedDimensionAsOfYesterday(state)
    await fire(state, vendor())
    const ok = passRows(state).find((p) => p.outcome === 'ok')
    check(!!ok, '(e) a successful refresh recorded no pass row — the later skips would be explained by nothing durable.')
    if (ok) {
      check(typeof ok.pass_marker === 'string' && ok.pass_marker.length > 0 && ok.pass_marker === M.ENTITY_DIMENSION_PASS_MARKER, `(e) the pass row's marker (${ok.pass_marker}) is not the exported ENTITY_DIMENSION_PASS_MARKER — the gate and the writer must agree on one string, exported once.`)
      check(ok.client_id === CLIENT && ok.platform === 'google' && ok.account_id === CID, `(e) the pass row is not keyed to (client, platform, account): ${JSON.stringify([ok.client_id, ok.platform, ok.account_id])}. A client with two accounts must be refreshed per account.`)
      check(ok.entities_examined === 3, `(e) entities_examined=${ok.entities_examined}, expected 3 — the denominator is what was observed, not what was written.`)
    }
    // and the SKIP is recorded too — a skipped pass still writes a row (the table's own law)
    await fire(state, vendor())
    check(passRows(state).some((p) => p.outcome === 'skipped'), '(e) the gated skip wrote no pass row. LORAMER_EMPTY_CARRIES_ITS_DENOMINATOR_V1: "we did not look, and here is why" is a fact, and the ledger must hold it — otherwise a fire that skipped is indistinguishable from a fire that never reached the client.')
  }
} catch (e) {
  findings.push(`the behavioural legs could not run — ${e.message}. A guard that cannot execute its subject FAILS; it does not pass quietly.`)
} finally {
  rmSync(out, { recursive: true, force: true })
}

// ── (f) SOURCE: the proxy cannot come back ──────────────────────────────────────────────────────────
{
  const src = read(CAPTURE)
  const gate = /if \(!opts\?\.force\) \{[\s\S]*?\n  \}/.exec(src)?.[0] ?? ''
  check(gate.length > 0, `(f) ${CAPTURE} has no \`if (!opts?.force)\` gate block to inspect.`)
  check(!/google_entity_dimension/.test(gate), `(f) the once-a-day gate reads google_entity_dimension. updated_at there means "row last written", and an unchanged account writes nothing — the gate must read the refresh moment (capture_pass_log), never the change moment.`)
  check(/capture_pass_log/.test(gate), `(f) the once-a-day gate does not read capture_pass_log — the refresh moment has no other durable home.`)
}

if (findings.length) {
  console.error(`[entity-dimension-daily-gate.guard] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('[entity-dimension-daily-gate.guard] OK — an unchanged account is read once a day; a failed read is retried, not skipped; an empty account is still a refresh; the ledger explains every skip.')
