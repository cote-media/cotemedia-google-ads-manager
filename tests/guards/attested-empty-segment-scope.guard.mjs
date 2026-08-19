#!/usr/bin/env node
// LORAMER_ATTESTED_EMPTY_SEGMENT_SCOPE_V1 — A ZERO ATTESTS EXACTLY ITS OWN (resource, segment) SURFACE.
//
// ⛔ THE DEFECT THIS PINS, FOUND BY THE ENGINE'S FIRST WET RUN (2026-08-10 23:52Z), NOT BY REVIEW:
// `attestedEmptyDays` filtered `universe_attempt_log` by RESOURCE ONLY — no segment scope — so a `zero` on
// `ad_group / segments.ad_destination_type` attested EVERY other ad_group segment empty. 17 of the 20
// published surfaces were declared "already covered — nothing owed" on a SIBLING'S evidence and never asked
// the vendor. Which sibling "wins" is a race under maxConcurrency 2, so the leak is nondeterministic too.
// That is claiming COVERED when it is not — the catastrophic direction universe-coverage.ts's own header
// names — and scheduled, it seals ~90% of the declared universe unwalked with a durable record saying it
// was fine. The 214 false floor36 completions, one door over.
//
// ⛔ HERMETIC AND IT DRIVES THE REAL CODE. The module under test (universe-coverage) and its vocabulary
// dependency (universe-surfaces) are COMPILED, never stubbed — a guard that stubs its subject tests the
// stub (Lesson 68 shape (b), universe-entity-axis's own harness hole). Only `@/lib/supabase` is scripted,
// and the script is FAITHFUL to PostgREST in the one way that matters here: it PROJECTS the selected
// columns, so a fix that filters on `segment` without SELECTING it goes red instead of green.
//
// ⛔ SEGMENT STORAGE FACT THIS GUARD RESTS ON (verified live, rows 5/7 of the first wet run): the base
// entry's segment is '' — NOT NULL — per migrations/061:95 `segment text not null` ('' convention matching
// 054). `.eq` semantics are therefore safe and `.is()` is not needed; leg (e) pins the migration line so a
// relaxed column cannot silently break the convention (PostgREST: `eq` is SQL `=`, which never matches
// NULL; `is` exists for exactly that — docs.postgrest.org/en/stable/references/api/tables_views.html).
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire, Module } from 'node:module'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch (e) { findings.push(`UNREADABLE ${p} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' } }

const COVERAGE = 'src/lib/backfill/universe-coverage.ts'
const SURFACES = 'src/lib/backfill/universe-surfaces.ts'
const WRITER = 'src/lib/backfill/google-ads-universe-writer.ts'
const MIG = 'migrations/061_universe_attempt_log.sql'

// ── (e) STATIC: ONE OWNER OF THE MAPPING, AND THE STORAGE CONVENTION STANDS ──────────────────────────────
{
  const writer = read(WRITER).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  const btBody = writer.match(/export function breakdownTypeFor\s*\([\s\S]*?\n\}/)
  if (!btBody || !/breakdownTypeForSurface\s*\(/.test(btBody[0])) {
    findings.push(`(e) ${WRITER} breakdownTypeFor does not delegate to breakdownTypeForSurface — TWO copies of the segment→breakdown_type mapping can drift, and the coverage scope filter would be comparing against a different vocabulary than the writer writes.`)
  }
  const cov = read(COVERAGE).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  if (/segments\\?\./.test(cov)) {
    findings.push(`(e) ${COVERAGE} contains a 'segments.' literal — vendor vocabulary in the core (capture-adapter-seam leg (a) territory). The mapping belongs to universe-surfaces; consult it, never inline it.`)
  }
  const mig = read(MIG)
  if (!/segment\s+text\s+not\s+null/i.test(mig)) {
    findings.push(`(e) ${MIG} no longer declares \`segment text not null\` — the '' base-entry convention this scope filter and every .eq('segment', …) read rest on has been relaxed. NULL never matches .eq (PostgREST eq = SQL '='); every segment read would need .is() and this guard's premises re-proving.`)
  }
}

// ── COMPILE THE REAL SUBJECT + ITS REAL VOCABULARY DEPENDENCY ────────────────────────────────────────────
const out = mkdtempSync(join(tmpdir(), 'loramer-attest-scope-'))
const origResolve = Module._resolveFilename
try {
  const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
  const r = spawnSync(tsc, [resolve(ROOT, COVERAGE), resolve(ROOT, SURFACES),
    '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
  if (r.error) findings.push(`could not run tsc — ${r.error.message}`)

  // The scripted supabase: applies eq/lte/gte over seeded rows and PROJECTS the select list — faithful to
  // PostgREST, which returns ONLY selected columns. That fidelity is what turns "filters on a column it
  // never selected" into a red guard instead of a silent undefined.
  const stub = join(out, '__supabase_stub.js')
  writeFileSync(stub, `
class Q {
  constructor(rows) { this.rows = rows; this.conds = []; this.cols = null }
  select(cols) { this.cols = String(cols).split(',').map((s) => s.trim()); return this }
  eq(c, v) { this.conds.push((r) => String(r[c]) === String(v)); return this }
  // ⛔ ADDED 2026-08-17 (LORAMER_NONGRAIN_ATTESTS_V1) BECAUSE THE SUBJECT STARTED USING IT AND THIS GUARD
  // WENT RED RATHER THAN GREEN — which is the stub's fidelity contract working. attestedEmptyDays now reads
  // .in('outcome', ['zero','nongrain']); a stub that silently lacked .in would have thrown, and a stub that
  // silently ACCEPTED it without filtering would have let an unfiltered row attest. Same semantics as
  // PostgREST: membership over the string form.
  in(c, vs) { const set = new Set((vs ?? []).map(String)); this.conds.push((r) => set.has(String(r[c]))); return this }
  lte(c, v) { this.conds.push((r) => String(r[c]) <= String(v)); return this }
  gte(c, v) { this.conds.push((r) => String(r[c]) >= String(v)); return this }
  limit() { return this }
  then(res) {
    const hit = this.rows.filter((r) => this.conds.every((f) => f(r)))
      .map((r) => Object.fromEntries((this.cols ?? Object.keys(r)).map((c) => [c, r[c]])))
    return Promise.resolve({ data: hit, error: null }).then(res)
  }
}
module.exports = { supabaseAdmin: { from: (t) => new Q(globalThis.__GUARD_ATTEMPT_ROWS ?? []) } }
`)
  const surfacesJs = join(out, 'src/lib/backfill/universe-surfaces.js')
  Module._resolveFilename = function (request, ...rest) {
    if (/universe-surfaces$/.test(request)) return surfacesJs   // REAL — the vocabulary under test
    if (/@\/lib\/supabase$/.test(request)) return stub          // scripted, faithful projection
    if (request.startsWith('@/') || request.startsWith('./') || request.startsWith('../')) {
      if (/universe-coverage|universe-surfaces/.test(request)) return origResolve.call(this, request, ...rest)
      return stub
    }
    return origResolve.call(this, request, ...rest)
  }
  const req = createRequire(import.meta.url)
  const cov = req(join(out, 'src/lib/backfill/universe-coverage.js'))

  const W = { window_start: '2026-08-03', window_end: '2026-08-09' }
  // ⛔ `lane` ADDED 2026-08-19 (LORAMER_TOP_EDGE_LANE_V1) BECAUSE THE SUBJECT STARTED FILTERING ON IT AND
  // THIS GUARD WENT RED RATHER THAN GREEN — the stub's fidelity contract working for the second time, in
  // exactly the shape its own `.in()` comment predicted. `attestedEmptyDays` now reads `.eq('lane','descend')`
  // so that a TOP-EDGE zero can never attest: at the top of the calendar a zero and a NOT-YET-SERVED day are
  // indistinguishable, and sealing a lagging day as empty is the false-all-clear class. A fixture without the
  // column is filtered out by the stub exactly as PostgREST would filter a row whose lane did not match,
  // which is why all three own-attestation legs failed rather than one.
  const base = { client_id: 'c1', vendor: 'google', resource: 'ad_group', phase: 'attempt_finished', outcome: 'zero', lane: 'descend', ...W }
  const K = (breakdownType) => ({ clientId: 'c1', platform: 'google', entityLevel: 'ad_group', breakdownType })
  const SEVEN = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09']

  // ── (a) THE WET-RUN SHAPE: a sibling segment's zero must attest NOTHING ────────────────────────────────
  globalThis.__GUARD_ATTEMPT_ROWS = [{ ...base, segment: 'segments.ad_destination_type' }]
  {
    const got = await cov.attestedEmptyDays(K('device'), W.window_start, W.window_end)
    if (got.length !== 0) {
      findings.push(`(a) SIBLING LEAK — a zero on ad_group/segments.ad_destination_type attested ${got.length} day(s) for ad_group/DEVICE. This is the live 2026-08-10 defect: 17 of 20 surfaces declared complete on a sibling's evidence, never asked. A zero attests its OWN surface only.`)
    }
  }
  // ── (b) AND ITS OWN SURFACE STILL ATTESTS — the fix must not over-narrow, and segment must be SELECTED ─
  {
    const got = await cov.attestedEmptyDays(K('ad_destination_type'), W.window_start, W.window_end)
    if (JSON.stringify(got) !== JSON.stringify(SEVEN)) {
      findings.push(`(b) OWN ATTESTATION BROKE — the zero's own surface (ad_group/ad_destination_type) attested ${JSON.stringify(got)}, expected all 7 days. Either the scope filter is too broad, or 'segment' is filtered without being SELECTED (PostgREST returns only selected columns — undefined maps to the BASE surface and the own-match fails). An honest zero that no longer attests is an infinite re-walk loop (universe-resumer.ts:160-164).`)
    }
  }
  // ── (c) THE BASE ENTRY ('' segment, migrations/061 convention) attests ONLY the base surface ──────────
  globalThis.__GUARD_ATTEMPT_ROWS = [{ ...base, segment: '' }]
  {
    const own = await cov.attestedEmptyDays(K('ad_group'), W.window_start, W.window_end)
    if (JSON.stringify(own) !== JSON.stringify(SEVEN)) {
      findings.push(`(c) BASE ATTESTATION BROKE — the bare-resource zero (segment '') attested ${JSON.stringify(own)} for its own base surface (breakdownType === resource), expected all 7 days.`)
    }
    const leak = await cov.attestedEmptyDays(K('device'), W.window_start, W.window_end)
    if (leak.length !== 0) {
      findings.push(`(c) BASE LEAK — the bare-resource zero (segment '') attested ${leak.length} day(s) for ad_group/DEVICE. The base entry is one surface among many, not a resource-wide claim.`)
    }
  }
  // ── (d) DOTTED SEGMENTS: the mapping is applied FORWARD, never inverted ('.'→'_' is lossy in reverse) ──
  globalThis.__GUARD_ATTEMPT_ROWS = [{ ...base, segment: 'segments.asset_interaction_target.asset' }]
  {
    const own = await cov.attestedEmptyDays(K('asset_interaction_target_asset'), W.window_start, W.window_end)
    if (own.length !== 7) {
      findings.push(`(d) DOTTED OWN-MATCH BROKE — segments.asset_interaction_target.asset must attest breakdown_type asset_interaction_target_asset (forward mapping, dots→underscores); got ${own.length} day(s).`)
    }
    const sib = await cov.attestedEmptyDays(K('asset_interaction_target_interaction_on_this_asset'), W.window_start, W.window_end)
    if (sib.length !== 0) {
      findings.push(`(d) DOTTED SIBLING LEAK — segments.asset_interaction_target.asset attested ${sib.length} day(s) for its SIBLING asset_interaction_target_interaction_on_this_asset.`)
    }
  }
  // ── (f) DEFENSIVE NULL: a (structurally impossible) NULL segment maps to the BASE surface, never a segmented one ──
  globalThis.__GUARD_ATTEMPT_ROWS = [{ ...base, segment: null }]
  {
    const leak = await cov.attestedEmptyDays(K('device'), W.window_start, W.window_end)
    if (leak.length !== 0) {
      findings.push(`(f) NULL-SEGMENT LEAK — a NULL segment (impossible under migrations/061 NOT NULL, driven anyway as defence) attested ${leak.length} day(s) for a SEGMENTED surface. NULL/'' may only ever read as the base entry.`)
    }
  }
} catch (e) {
  findings.push(`could not DRIVE attestedEmptyDays — ${e.message}. A guard that cannot run its subject FAILS rather than passing.`)
} finally {
  Module._resolveFilename = origResolve
  rmSync(out, { recursive: true, force: true })
  delete globalThis.__GUARD_ATTEMPT_ROWS
}

if (findings.length) {
  console.error(`[attested-empty-segment-scope] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[attested-empty-segment-scope] PASS — DRIVEN on the real compiled coverage + surfaces modules: a sibling segment's zero attests NOTHING (the 2026-08-10 wet-run leak), the zero's own surface still attests all 7 days (and 'segment' must be SELECTED — the stub projects columns like PostgREST), the base '' entry attests only the base surface, dotted segments map forward-only, a defensive NULL reads as base, the mapping has ONE owner (writer delegates to universe-surfaces), and migrations/061 still pins segment NOT NULL so .eq semantics hold.`)
