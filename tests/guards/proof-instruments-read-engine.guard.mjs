#!/usr/bin/env node
// LORAMER_ENGINE_KEYED_INSTRUMENTS_V1 (2026-09-23; drafted read-only in round 37, seen RED on HEAD before the build) — the done-done proof's instruments read the google
// account row through googleAccountKeyFor(engine), never at the legacy key alone. Scoped to the PROOF'S instruments by
// name (the proof roster below) — legacy-only instruments are not in the roster and are never flagged.
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch { return '' } }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')
// THE PROOF ROSTER — the six conditions' instruments (DECISIONS LORAMER_COLD_PROOF_ESCENTIAL_COMPLETE_V1 card):
// honest instruments (check:data's capture-landing), interior (the hole-map proof), no-owed-day, the alias live leg.
const PROOF_INSTRUMENTS = [
  'scripts/check-capture-landing.mjs',
  'scripts/google-hole-map-proof.ts',
  'tests/guards/no-owed-day-left-behind.guard.mjs',
  'tests/guards/drain-alias-coverage.guard.mjs',
]
const ACCOUNT_ROW = /entity_level\s*=\s*'account'[\s\S]{0,120}breakdown_type\s*=\s*''|\.eq\('entity_level',\s*'account'\)[\s\S]{0,80}\.eq\('breakdown_type',\s*''\)/
const MIRROR = 'scripts/lib/engine-keys.mjs', SRC = 'src/lib/backfill/engine-keys.ts'
// (a) each proof instrument that reads the google account row imports the predicate
for (const f of PROOF_INSTRUMENTS) {
  const s = strip(read(f))
  if (!s) { findings.push(`(a) ${f} unreadable — a roster entry that does not exist is a stale roster`); continue }
  if (ACCOUNT_ROW.test(s)) {
    check(/googleAccountKeyFor/.test(s) && /engine-keys/.test(s), `(a) ${f} reads the google account row at the legacy key without googleAccountKeyFor(engine) (engine-keys) — it misreports a walk-marked connection (Tri-Copy: 590 false findings, 2026-09-23)`)
  }
}
// (b) the mirror and the source agree, and (c) the predicate refuses an unknown engine
{
  check(existsSync(resolve(ROOT, MIRROR)), `(b) ${MIRROR} missing — the .mjs instruments have no predicate to import`)
  check(existsSync(resolve(ROOT, SRC)), `(b) ${SRC} missing — src readers have no predicate to import`)
  if (existsSync(resolve(ROOT, MIRROR)) && existsSync(resolve(ROOT, SRC))) {
    const out = mkdtempSync(join(tmpdir(), 'engine-keys-'))
    try {
      const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [resolve(ROOT, SRC), '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node', '--skipLibCheck', '--noResolve', '--rootDir', ROOT, '--outDir', out], { encoding: 'utf8' })
      if (r.error) throw new Error(r.error.message)
      const T = createRequire(import.meta.url)(join(out, 'src/lib/backfill/engine-keys.js'))
      const M = await import(resolve(ROOT, MIRROR))
      for (const e of ['legacy', 'walk']) check(JSON.stringify(T.googleAccountKeyFor(e)) === JSON.stringify(M.googleAccountKeyFor(e)), `(b) googleAccountKeyFor('${e}') differs between ${SRC} and ${MIRROR}`)
      check(JSON.stringify(M.googleAccountKeyFor('legacy')) === JSON.stringify({ entity_level: 'account', breakdown_type: '', breakdown_value: '' }), `(b) legacy key is not the '' account row`)
      check(JSON.stringify(M.googleAccountKeyFor('walk')) === JSON.stringify({ entity_level: 'customer', breakdown_type: 'customer', breakdown_value: '' }), `(b) walk key is not customer|customer`)
      let threw = false; try { M.googleAccountKeyFor('drain') } catch { threw = true }
      check(threw, `(c) googleAccountKeyFor('drain') did not throw — an unknown engine must refuse, never default`)
    } catch (e) { findings.push(`(b) could not drive the predicate: ${e.message}`) } finally { rmSync(out, { recursive: true, force: true }) }
  }
}
if (findings.length) { console.error(`[proof-instruments-read-engine] FAIL — ${findings.length} finding(s):`); for (const f of findings) console.error(`  ✗ ${f}`); process.exit(1) }
console.log(`[proof-instruments-read-engine] PASS — the proof's ${PROOF_INSTRUMENTS.length} instruments read the google account row through googleAccountKeyFor(engine); mirror and source agree; an unknown engine refuses`)
