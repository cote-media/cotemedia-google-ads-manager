#!/usr/bin/env node
// LORAMER_FIRE_PLANS_UNTIL_FULL_V1 — A COVERAGE READ IS ONE ROUND TRIP, NEVER ONE PER DAY.
//
// windowCoverage used to probe metrics_daily once per day of the window from the Vercel host (`.eq('date', day)
// .limit(1)`, 64-way concurrent): 360 round trips per read, two reads per candidate, 60 candidates per fire. On a
// cold account (Tri-Copy, 2026-09-23) the fire's scan took 249–286 s of its 282 s budget and every unit was deferred.
// The per-day probe now runs INSIDE Postgres (migrations/103 universe_coverage_dates: generate_series × LATERAL
// limit-1), one RPC per read. This guard pins the shape from both sides:
//   (a) SOURCE: windowCoverage calls `.rpc('universe_coverage_dates'` and carries no per-day `.eq('date', day)` probe
//       and no `mapBounded(days` fan-out
//   (b) DRIVEN: the real compiled module, against a counting fake of supabaseAdmin, answers a 360-day window with
//       AT MOST 3 queries (the RPC + the committed-day read + the attested-empty read) and yields 360 uncovered days
//       when every read is empty
//   (c) MIGRATION: 103 creates universe_coverage_dates with eight parameters and refuses windows over 900 days
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import Module, { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}`); return '' } }
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')

const COVERAGE = 'src/lib/backfill/universe-coverage.ts'
const SURFACES = 'src/lib/backfill/universe-surfaces.ts'
const MIGRATION = 'migrations/103_universe_coverage_dates.sql'

// (a)
{
  const src = strip(read(COVERAGE))
  const start = src.indexOf('export async function windowCoverage(')
  const end = src.indexOf('\nexport ', start + 1)
  const body = start >= 0 ? src.slice(start, end > 0 ? end : undefined) : ''
  check(start >= 0, `(a) ${COVERAGE}: windowCoverage not found`)
  check(/\.rpc\('universe_coverage_dates'/.test(body), `(a) ${COVERAGE}: windowCoverage does not call .rpc('universe_coverage_dates') — the per-day probe still crosses the network.`)
  check(!/\.eq\('date',\s*day\)/.test(body), `(a) ${COVERAGE}: windowCoverage still probes metrics_daily per day (.eq('date', day)) — 360 round trips per read.`)
  check(!/mapBounded\(days/.test(body), `(a) ${COVERAGE}: windowCoverage still fans out per day (mapBounded(days …)).`)
}

// (b)
{
  const out = mkdtempSync(join(tmpdir(), 'coverage-one-rpc-'))
  try {
    const files = [COVERAGE, SURFACES]
    const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [...files.map((f) => join(ROOT, f)),
      '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node', '--skipLibCheck', '--noResolve', '--rootDir', ROOT, '--outDir', out], { encoding: 'utf8' })
    if (r.error) throw new Error(`could not run tsc — ${r.error.message}`)
    const counter = { queries: 0, rpc: 0, perDay: 0 }
    const stub = join(out, '__stub.js')
    writeFileSync(stub, `
      const counter = global.__coverageCounter
      function chain() {
        const q = { _date: false }
        const p = new Proxy(q, { get: (t, k) => {
          if (k === 'then') return (res) => res({ data: [], error: null, count: 0 })
          if (k === 'eq') return (col) => { if (col === 'date') counter.perDay++; return p }
          return () => p
        } })
        return p
      }
      const supabaseAdmin = {
        from: () => { counter.queries++; return chain() },
        rpc: () => { counter.queries++; counter.rpc++; return Promise.resolve({ data: [], error: null }) },
      }
      module.exports = new Proxy({ supabaseAdmin, mapBounded: async (items, n, fn) => { const o = []; for (const i of items) o.push(await fn(i)); return o } },
        { get: (t, k) => (k in t ? t[k] : (() => {})) })
    `)
    global.__coverageCounter = counter
    const real = { '@/lib/backfill/universe-surfaces': join(out, 'src/lib/backfill/universe-surfaces.js') }
    const origResolve = Module._resolveFilename
    Module._resolveFilename = function (request, ...rest) {
      if (real[request]) return real[request]
      if (request.startsWith('@/') || request.startsWith('./') || request.startsWith('../')) return stub
      return origResolve.call(this, request, ...rest)
    }
    let C
    try { C = createRequire(import.meta.url)(join(out, 'src/lib/backfill/universe-coverage.js')) } finally { Module._resolveFilename = origResolve }
    const cov = await C.windowCoverage({ clientId: '00000000-0000-0000-0000-000000000000', platform: 'google', entityLevel: 'ad_group', breakdownType: 'device' }, '2025-09-27', '2026-09-21') // fixture: a made-up client id — the counting fake answers empty for any key
    check(counter.perDay === 0, `(b) a 360-day windowCoverage still issued ${counter.perDay} per-day date probe(s).`)
    check(counter.rpc === 1, `(b) a 360-day windowCoverage issued ${counter.rpc} RPC call(s); expected exactly 1.`)
    check(counter.queries <= 3, `(b) a 360-day windowCoverage issued ${counter.queries} queries; at most 3 (RPC + committed + attested) are allowed.`)
    check(cov && cov.uncovered.length === 360 && cov.covered.length === 0, `(b) with every read empty a 360-day window must read 360 uncovered / 0 covered — got ${cov ? `${cov.uncovered.length}/${cov.covered.length}` : 'nothing'}.`)
  } catch (e) {
    findings.push(`(b) could not drive windowCoverage: ${e.message}`)
  } finally { rmSync(out, { recursive: true, force: true }) }
}

// (c)
{
  const m = read(MIGRATION)
  check(/create or replace function public\.universe_coverage_dates\(/.test(m), `(c) ${MIGRATION} does not create universe_coverage_dates`)
  check((m.match(/p_[a-z_]+ (uuid|text|date)/g) || []).length === 8, `(c) ${MIGRATION}: universe_coverage_dates must take eight parameters`)
  check(/> 900/.test(m) && /raise exception/.test(m), `(c) ${MIGRATION}: a window over 900 days must RAISE, never truncate (COVERAGE_WINDOW_MAX_DAYS)`)
  check(/cross join lateral/.test(m) && /limit 1/.test(m), `(c) ${MIGRATION}: the probe must be the LATERAL limit-1 form (EXISTS let the planner scan: 13 s on Foam OH)`)
}

if (findings.length) { console.error(`[coverage-is-one-rpc] FAIL — ${findings.length} finding(s):`); for (const f of findings) console.error(`  ✗ ${f}`); process.exit(1) }
console.log('[coverage-is-one-rpc] PASS — windowCoverage is one RPC round trip (per-day probes run inside Postgres), a 360-day read costs ≤ 3 queries, and migration 103 refuses windows over 900 days')
