#!/usr/bin/env node
// LORAMER_INCEPTION_STOP_V1 — the account inception stop: discovered by ONE unfiltered query, scoped
// PER-ACCOUNT with provenance, composed in EXACTLY ONE site, and UNKNOWN never falls through to a date.
//
// ⛔ COVERAGE LIMIT, STATED FIRST: google-account-floor.guard.mjs leg (b) forbids ISO date literals in the
// ADAPTER and the v2 CONSUMER only. The WRITER cannot be swept the same way while VENDOR_FLOOR_DATE
// legitimately survives there for the v1 consumer (★V1-CONSUMER-STILL-ON-A-GLOBAL-FLOOR) — so leg (d) here
// scans the ONE writer function where a fallback literal could now do damage: composeWalkStop's own body.
import { readFileSync, mkdtempSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import Module from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (rel) => {
  try { return readFileSync(resolve(ROOT, rel), 'utf8') }
  catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' }
}
const WRITER = 'src/lib/backfill/google-ads-universe-writer.ts'
const MIG = 'migrations/063_universe_account_inception.sql'
const writerSrc = read(WRITER)

// ── (a) THE DISCOVERY QUERY: start_date_time, NO STATUS FILTER ───────────────────────────────────────
{
  const m = writerSrc.match(/INCEPTION_DISCOVERY_GAQL\s*=\s*\n?\s*['"`]([^'"`]+)['"`]/)
  if (!m) findings.push(`(a) ${WRITER} exports no INCEPTION_DISCOVERY_GAQL — the discovery query is not pinned and any caller can improvise one.`)
  else {
    const q = m[1]
    if (!/campaign\.start_date_time/.test(q)) {
      findings.push(`(a) the discovery query does not select campaign.start_date_time. campaign.start_date does NOT exist in API v23 ` +
        `(probe op 5: query_error 32, verbatim in the registry) — any other field is unproven.`)
    }
    if (/status/i.test(q)) {
      findings.push(`(a) the discovery query contains a STATUS predicate: "${q}". The API includes REMOVED campaigns by default ` +
        `(cookbook, verbatim: "The Google Ads UI implicitly filters out removed entities, whereas the API does not"), and filtering ` +
        `them SILENTLY OVERSTATES the floor on old accounts whose earliest campaigns are removed — sealing their history unwalked.`)
    }
    if (!/ORDER BY campaign\.start_date_time ASC/i.test(q) || !/LIMIT 1/i.test(q)) {
      findings.push(`(a) the discovery query is not ORDER BY campaign.start_date_time ASC LIMIT 1 — anything else is not "the earliest campaign" or costs more than one row.`)
    }
  }
}

// ── (b) PER-ACCOUNT SCOPE + PROVENANCE — the mirror of wall-is-surface-scoped, opposite direction ────
{
  // Call sites: every readAccountInception/recordAccountInception must pass clientId (+ raw provenance on write).
  const SRC = resolve(ROOT, 'src')
  const files = []
  ;(function walk(dir) {
    let entries = []
    try { entries = readdirSync(dir) } catch { return }
    for (const name of entries) {
      const p = join(dir, name)
      let st; try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(name)) files.push(p)
    }
  })(SRC)
  let sites = 0
  for (const abs of files) {
    const rel = abs.slice(resolve(ROOT).length + 1)
    let src = ''
    try { src = readFileSync(abs, 'utf8') } catch { continue }
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    for (const fn of ['readAccountInception', 'recordAccountInception']) {
      const re = new RegExp(`${fn}\\s*\\(\\s*\\{([\\s\\S]*?)\\}\\s*\\)`, 'g')
      let m
      while ((m = re.exec(code)) !== null) {
        if (/export\s+(async\s+)?function\s*$/.test(code.slice(Math.max(0, m.index - 40), m.index))) continue
        sites++
        if (!/\bclientId\b/.test(m[1])) findings.push(`(b) ${rel}: ${fn}({…}) omits clientId — an inception without an account is a global.`)
        if (fn === 'recordAccountInception' && !/rawStartDateTime/.test(m[1])) {
          findings.push(`(b) ${rel}: recordAccountInception({…}) omits rawStartDateTime — the derived date must stay reproducible from the vendor's own string.`)
        }
      }
    }
  }
  if (sites === 0) findings.push(`(b) NO inception read/write call site found in src/ — either the stop was removed or it moved to a name this guard does not know.`)
  // The store: PK (client_id, vendor), provenance columns, and LEAST() so a purged earliest campaign cannot RAISE the stop.
  const sql = read(MIG)
  if (sql) {
    const pk = sql.match(/PRIMARY\s+KEY\s*\(([^)]*)\)/i)
    if (!pk || !/client_id/.test(pk[1]) || !/vendor/.test(pk[1])) findings.push(`(b) ${MIG} PRIMARY KEY is not (client_id, vendor) — the inception is an ACCOUNT fact.`)
    if (/resource|segment/.test(pk ? pk[1] : '')) findings.push(`(b) ${MIG} keys the inception per-surface — that is the WALL's scope, not this fact's.`)
    for (const col of ['raw_start_date_time', 'source', 'discovered_at']) {
      if (!new RegExp(col).test(sql)) findings.push(`(b) ${MIG} lacks provenance column ${col} — an inception with no provenance is a guess.`)
    }
    if (!/LEAST\(/.test(sql)) findings.push(`(b) ${MIG}'s record RPC does not keep the EARLIEST via LEAST() — a re-discovery against a purged earliest campaign would RAISE the stop and orphan ground below it.`)
  }
}

// ── (c) COMPOSITION IN EXACTLY ONE SITE ──────────────────────────────────────────────────────────────
{
  const SRC = resolve(ROOT, 'src')
  let calls = 0
  const where = []
  ;(function walk(dir) {
    let entries = []
    try { entries = readdirSync(dir) } catch { return }
    for (const name of entries) {
      const p = join(dir, name)
      let st; try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(name)) {
        let src = ''
        try { src = readFileSync(p, 'utf8') } catch { return }
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
        const m = code.match(/composeWalkStop\s*\(/g)
        if (m) {
          const isWriter = p.endsWith('google-ads-universe-writer.ts')
          const n = m.length - (isWriter ? 1 : 0) // the definition itself is not a call site
          if (n > 0) { calls += n; where.push(`${p.slice(resolve(ROOT).length + 1)} ×${n}`) }
        }
      }
    }
  })(SRC)
  if (calls === 0) findings.push(`(c) composeWalkStop is never called — the wall and the inception are being composed somewhere else, or not at all.`)
  if (calls > 1) findings.push(`(c) composeWalkStop has ${calls} call sites (${where.join(', ')}). TWO compositions of the same two facts is the ` +
    `two-owners shape that put a floor on a queue message. Exactly one site may compose the stop.`)
}

// ── (d) UNKNOWN NEVER FALLS THROUGH TO A DATE — DRIVEN, and the function body carries no literal ─────
{
  const body = writerSrc.match(/export function composeWalkStop[\s\S]*?\n\}/)
  if (body && /'\d{4}-\d{2}-\d{2}'|"\d{4}-\d{2}-\d{2}"/.test(body[0])) {
    findings.push(`(d) composeWalkStop's body contains an ISO date literal — a fallback epoch hiding inside the one composition site.`)
  }
  const out = mkdtempSync(join(tmpdir(), 'loramer-inception-'))
  const origResolve = Module._resolveFilename
  try {
    const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
    const r = spawnSync(tsc, [resolve(ROOT, WRITER), '--target', 'es2020', '--module', 'commonjs',
      '--moduleResolution', 'node', '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
    if (r.error) findings.push(`could not run tsc — ${r.error.message}`)
    const stub = join(out, '__stub.js')
    writeFileSync(stub, `module.exports = new Proxy({}, { get: () => (() => {}) })`)
    Module._resolveFilename = function (request, ...rest) {
      if (request.startsWith('@/') || request.startsWith('./') || request.startsWith('../')) return stub
      return origResolve.call(this, request, ...rest)
    }
    const w = createRequire(import.meta.url)(join(out, 'src/lib/backfill/google-ads-universe-writer.js'))
    const unknown = w.composeWalkStop({ wallDate: null, inceptionDate: null, earliestHeldDate: '2020-01-01' })
    if (unknown.stopDate !== null || unknown.inceptionKnown !== false) {
      findings.push(`(d) UNKNOWN inception + no wall produced ${JSON.stringify(unknown)} — it must be stopDate null, inceptionKnown false. ` +
        `Held data alone may NOT become a stop: it bounds the CLAIM, it does not replace the discovery.`)
    }
    const wallOnly = w.composeWalkStop({ wallDate: '2022-01-01', inceptionDate: null, earliestHeldDate: null })
    if (wallOnly.stopDate !== '2022-01-01' || wallOnly.inceptionKnown !== false) {
      findings.push(`(d) a wall with UNKNOWN inception produced ${JSON.stringify(wallOnly)} — the wall may still stop the walk, but inceptionKnown must stay false so the unbounded refusal still fires.`)
    }
    const held = w.composeWalkStop({ wallDate: null, inceptionDate: '2022-03-04', earliestHeldDate: '2021-06-01' })
    if (held.stopDate !== '2021-06-01') {
      findings.push(`(d) held data BELOW the claimed inception did not lower the stop (${JSON.stringify(held)}) — rows we hold are proof the vendor served below the claim; the stop must never orphan them.`)
    }
    const wallWins = w.composeWalkStop({ wallDate: '2023-01-01', inceptionDate: '2022-03-04', earliestHeldDate: '2022-03-05' })
    if (wallWins.stopDate !== '2023-01-01') {
      findings.push(`(d) a HIGHER vendor refusal did not outrank the inception (${JSON.stringify(wallWins)}) — the vendor's own refusal is the stronger fact.`)
    }
  } catch (e) {
    findings.push(`(d) could not DRIVE composeWalkStop — ${e.message}. A guard that cannot run its subject FAILS rather than passing.`)
  } finally {
    Module._resolveFilename = origResolve
  }
  // And the consumer's refusal branch must exist and be conditioned on the explicit operator flag.
  const consumer = read('src/app/api/queues/google-ads-universe-v2/route.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  if (!/inceptionKnown\s*&&\s*remaining\s*===\s*undefined\s*&&\s*msg\.walkToEpoch\s*!==\s*true/.test(consumer.replace(/!stop\./g, 'stop.').replace(/stop\.inceptionKnown/g, 'inceptionKnown'))) {
    if (!/walkToEpoch/.test(consumer)) {
      findings.push(`(d) the v2 consumer has no walkToEpoch operator override — either UNKNOWN never refuses (silent epoch walk) or it refuses with no explicit way through. Both are wrong.`)
    }
    if (!/REFUSED-UNBOUNDED/.test(consumer)) {
      findings.push(`(d) the v2 consumer never refuses an unbounded walk on UNKNOWN inception — the silent walk-to-epoch is back.`)
    }
  }
}

if (findings.length) {
  console.error(`[inception-stop] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[inception-stop] PASS — the discovery query is pinned (start_date_time, no status filter, ASC LIMIT 1) · every inception read/write carries clientId with raw provenance and the store is PK (client_id, vendor) with LEAST() · composeWalkStop has exactly ONE call site · and DRIVEN: UNKNOWN yields stopDate null (held data alone is never a stop), a wall still stops but leaves inceptionKnown false, held data below the claim lowers the stop, and a higher vendor refusal outranks the inception. LIMIT: the consumer's refusal branch is checked structurally; v2 has never run.`)
