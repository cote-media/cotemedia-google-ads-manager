#!/usr/bin/env node
// LORAMER_WIRE_COVERAGE_INSTRUMENT_V1 — GUARD. The breakdown-grain completeness verdict must REACH Lora, must
// CHANGE what she is told to say, and must not be reachable from the paths it does not belong on.
//
// WHY THIS EXISTS. Before this wiring the instrument was built, applied and read by NOTHING. MEASURED
// 2026-07-30, Foam OH GA, window 2023-07-01..2025-12-31: base grain min 2022-02-02 / max 2026-07-29, so
// `coversWindow` said 'covered' and `coverageNotes` emitted nothing at all — its loop opens
// `if (c.state === 'covered') continue` — while that window held ZERO dimensional rows across all 12 families.
// 915 base-active days. She would have named a top source/medium over a window with no dimensional data and no
// hedge. ESSENCE law 6's dangerous state: a confident answer over an uncaptured window.
//
// FIVE LEGS, each independently red-able:
//  (a) query_breakdown returning a result with NO breakdownCoverage field
//  (b) a PARTIAL verdict producing no note
//  (c) two different unknownReasons producing the SAME note text — re-collapsing what was just separated
//  (d) a COMPLETE verdict producing a note — silence is the correct signal on a clean window
//  (e) getBreakdownCoverage reachable from query_metrics or from a per-turn path
//
// ⛔ HERMETIC. Drives the REAL transpiled note builder and pins the wiring at source, because a route/tool
// cannot be executed inside `npm run build`. That split is stated, not sold as a full proof.
//
// ⛔ AND THE LIMIT THIS GUARD CANNOT CROSS, stated here so a green is never over-read: it proves the field is
// ATTACHED and the directive is DISTINCT. It cannot prove Lora WORDS it correctly — that she says "partial" and
// names the gap rather than reporting the ranking flat. That is the eval set's question, and it is the same
// limit LORAMER_QUERY_COMPLETENESS_V1 stated for its own flag.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Module, { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const fail = (m) => { console.error(`[breakdown-coverage-wired] FAIL — ${m}`); process.exit(1) }
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }

const COV = 'src/lib/next/coverage.ts'
const TOOLS = 'src/lib/claude-tools.ts'
if (!existsSync(resolve(ROOT, COV))) fail(`${COV} is missing.`)

// ── (a) THE FIELD IS ATTACHED, AND ONLY FROM THIS TOOL ──────────────────────────────────────────────────
{
  const src = read(TOOLS)
  check(!!src, `(a) ${TOOLS} unreadable.`)
  const i = src.indexOf('export async function runQueryBreakdownTool')
  check(i > 0, `(a) runQueryBreakdownTool not found — the breakdown tool is where completeness must attach.`)
  // The tool body runs to the next top-level export.
  const rest = src.slice(i)
  const end = rest.indexOf('\nexport ', 1)
  const rawBody = end > 0 ? rest.slice(0, end) : rest
  // ⛔ QUOTATION IS NOT ASSERTION — strip comment lines BEFORE matching, and assert the ASSIGNMENT rather than
  // the bare word. THIRD RECURRENCE of this class, and the first one INSIDE the guard written to catch it:
  // leg (a)'s first cut tested /breakdownCoverage/ against the raw body, so deleting the real assignment still
  // PASSED — the word survives in the header comment above it. A guard matching its own documentation is a
  // comment wearing an assertion's clothes. Banked previously on canonical-client-identity and on
  // ga-dim-completion-honesty; caught here only because the mutation test was actually run.
  const body = rawBody.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  check(/result\.breakdownCoverage\s*=/.test(body),
    `(a) runQueryBreakdownTool does not ASSIGN result.breakdownCoverage. The verdict exists, is applied, and reaches nobody — which is the state this flight exists to end.`)
  check(/getBreakdownCoverage\(/.test(body),
    `(a) runQueryBreakdownTool never calls getBreakdownCoverage.`)
  check(/result\.coverageNote\s*=/.test(body),
    `(b) runQueryBreakdownTool does not ASSIGN result.coverageNote — attaching the verdict alone makes it AVAILABLE to her; ESSENCE law 6 requires it to CHANGE WHAT SHE SAYS.`)
  // The window must come from queryBreakdown's own resolution, not a second date resolver (Lesson 19).
  check(/result\??\.window|const win = result/.test(body),
    `(a) the coverage window is not taken from queryBreakdown's own resolved window — a second date resolver here is free to drift from the rows it describes.`)
}

// ── (e) NOT REACHABLE FROM query_metrics OR A PER-TURN PATH ─────────────────────────────────────────────
{
  const src = read(TOOLS)
  const metricsIdx = src.indexOf('export async function runQueryMetricsTool')
  if (metricsIdx > 0) {
    const rest = src.slice(metricsIdx)
    const end = rest.indexOf('\nexport ', 1)
    const body = end > 0 ? rest.slice(0, end) : rest
    check(!/getBreakdownCoverage\(/.test(body),
      `(e) query_metrics calls getBreakdownCoverage. Its totals are ACCOUNT grain and a breakdown hole does not change them, so the caveat would hang on a number it does not bear on — the noise that trains a reader to skip captions.`)
  }
  // The per-turn path: the tool LOOP must not call it outside a query_breakdown dispatch.
  const loopIdx = src.indexOf('runClaudeToolLoop')
  if (loopIdx > 0) {
    const body = src.slice(loopIdx)
    check(!/getBreakdownCoverage\(/.test(body),
      `(e) the tool LOOP calls getBreakdownCoverage — that is a per-turn read. Most turns never touch breakdown grain, and on a wide window it costs seconds for nothing (measured: Foam OH meta 30d 11ms, 7mo 1,295ms, 3.5yr 13,316ms).`)
  }
  // Nothing outside coverage.ts, its guards and the breakdown tool may call it.
  const walk = (dir, out = []) => {
    for (const e of require('node:fs').readdirSync(resolve(ROOT, dir))) {
      const p = join(dir, e)
      if (require('node:fs').statSync(resolve(ROOT, p)).isDirectory()) walk(p, out)
      else if (/\.(ts|tsx)$/.test(e)) out.push(p)
    }
    return out
  }
  let files = []
  try { files = walk('src') } catch {}
  const ALLOWED = ['src/lib/next/coverage.ts', 'src/lib/claude-tools.ts']
  for (const f of files) {
    const rel = f.replace(/\\/g, '/')
    if (ALLOWED.includes(rel)) continue
    check(!/getBreakdownCoverage\(/.test(read(f)),
      `(e) ${rel} calls getBreakdownCoverage. This instrument is wired to the breakdown TOOL only; a second caller is a second cost centre and a second place the caveat can drift.`)
  }
}

// ── BEHAVIOURAL: drive the REAL note builder ────────────────────────────────────────────────────────────
const out = mkdtempSync(join(tmpdir(), 'loramer-covwire-'))
const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
const r = spawnSync(tsc, [resolve(ROOT, COV), '--target', 'es2020', '--module', 'commonjs', '--moduleResolution',
  'node', '--skipLibCheck', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
if (r.error) { rmSync(out, { recursive: true, force: true }); fail(`could not run tsc — ${r.error.message}`) }
const stub = join(out, '__stub.js')
writeFileSync(stub, `module.exports = {
  supabaseAdmin: { rpc: async () => ({ data: null, error: new Error('rpc absent') }) },
  reconcile: () => [null], isConnectedForCoverage: () => true,
}\n`)
const origResolve = Module._resolveFilename
Module._resolveFilename = function (q, ...rest) { return q.startsWith('@/lib/') ? stub : origResolve.call(this, q, ...rest) }
const mod = require(join(out, 'src/lib/next/coverage.js'))
Module._resolveFilename = origResolve

// ⛔ COLLECT, DO NOT HARD-EXIT. An early exit here would print ONE finding and hide the source legs that
// already ran — the same short-circuit defect LORAMER_GUARD_RUNALL_V1 fixed one level up, where a green tail
// that never executed was indistinguishable from a green tail that passed.
const hasNote = typeof mod.breakdownCoverageNote === 'function'
check(hasNote, `(b) coverage.ts does not export breakdownCoverageNote — there is no directive to give her, so the verdict can only ever be available, never binding.`)
const { breakdownCoverageNote, resolveBreakdownCoverage } = mod
if (hasNote) {
const days = (from, n) => { const o = []; const d = new Date(from + 'T00:00:00Z'); for (let i = 0; i < n; i++) { o.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1) } return o }

// (b) PARTIAL MUST PRODUCE A NOTE, and it must be a DIRECTIVE naming the gap.
{
  const base = days('2023-07-01', 915)
  const cov = resolveBreakdownCoverage('ga', base, [])
  check(cov.verdict === 'PARTIAL', `(b) fixture did not resolve PARTIAL, got ${cov.verdict}.`)
  const note = breakdownCoverageNote(cov, 'ga_source_medium')
  check(!!note, `(b) a PARTIAL verdict produced NO note. The Foam OH shape — 915 reporting days, zero rows — would reach her with nothing said.`)
  check(/915/.test(note || ''), `(b) the note does not name the hole COUNT.`)
  check(/ga_source_medium/.test(note || ''), `(b) the note does not name the FAMILY.`)
  check(/2023-07-01/.test(note || ''), `(b) the note does not name the actual DATES.`)
  check(/more/.test(note || ''), `(b) the note does not count the un-listed remainder — a truncated date list that does not say it is truncated reads as the whole gap.`)
  check(/PARTIAL|partial/.test(note || ''), `(b) the note never uses the word partial — it must tell her what to SAY, not describe state.`)
}

// (c) FOUR REASONS, FOUR DIFFERENT SENTENCES. Re-collapsing here would undo the fix at the last inch.
{
  const mk = (conn) => breakdownCoverageNote(resolveBreakdownCoverage('ga', [], [], {}, conn), 'ga_device')
  // ⛔ LORAMER_UNATTESTED_ABSENCE_V1 (2026-08-15): the no_activity fixture now REQUIRES attestation — the old
  // `{connected, everCaptured}` shape yields 'unattested_absence', and this map briefly passed with the WRONG
  // note under the old label (the `account` regex matched inside the unattested note's "Do NOT say the account
  // was inactive"). Both reasons are pinned separately so that lucky green cannot recur.
  const notes = {
    read_failed: mk({ readError: 'canceling statement due to statement timeout' }),
    not_connected: mk({ connected: false }),
    never_captured: mk({ connected: true, everCaptured: false }),
    unattested_absence: mk({ connected: true, everCaptured: true }),
    no_activity_in_window: mk({ connected: true, everCaptured: true, attestationCoversWindow: true }),
  }
  for (const [k, v] of Object.entries(notes)) check(!!v, `(c) unknownReason '${k}' produced NO note.`)
  const keys = Object.keys(notes)
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      check(notes[keys[i]] !== notes[keys[j]],
        `(c) '${keys[i]}' and '${keys[j]}' produced the IDENTICAL note text. Separating "we could not measure" from "the account was idle" is the whole of LORAMER_COVERAGE_UNKNOWN_REASON_V1; collapsing them in the note undoes it at the last inch, and the reader here is Lora.`)
    }
  }
  check(/statement timeout/.test(notes.read_failed || ''),
    `(c) the read_failed note does not carry the underlying error text — the one fact that identifies the failure.`)
  // The two that must never be confused for each other: ours vs the account's.
  check(/OUR side|our side/.test(notes.read_failed || ''),
    `(c) the read_failed note does not say the failure is OURS — she must not report it as a fact about the account.`)
  check(/ACCOUNT|account/.test(notes.no_activity_in_window || '') && /attest/i.test(notes.no_activity_in_window || ''),
    `(c) the no_activity_in_window note must say it is a fact about the ACCOUNT and NAME the attestation that licenses it — it is the ONLY reason that licenses saying the account was inactive, and attestation is why.`)
  check(/NOT CAPTURED|cannot be confirmed/i.test(notes.unattested_absence || '') && !/may say the account was inactive|is genuine/i.test(notes.unattested_absence || ''),
    `(c) the unattested_absence note must say NOT CAPTURED / cannot confirm activity and must NOT license an inactivity claim — that licence is what E7-meta walked through (LORAMER_UNATTESTED_ABSENCE_V1).`)
}

// (d) COMPLETE MUST BE SILENT.
{
  const base = days('2026-01-01', 30)
  const cov = resolveBreakdownCoverage('ga', base, base.slice())
  check(cov.verdict === 'COMPLETE', `(d) fixture did not resolve COMPLETE, got ${cov.verdict}.`)
  const note = breakdownCoverageNote(cov, 'ga_device')
  check(note === null,
    `(d) a COMPLETE verdict produced a note (${JSON.stringify(note)}). A caveat that fires when nothing is wrong is the noise that teaches a reader to skip captions — the same failure that made stale_tail fire fleet-wide nightly.`)
}

} // end if (hasNote)

// ── (c) THE TOOL DESCRIPTION TEACHES THE FIELD ──────────────────────────────────────────────────────────
// An enum member with no prose is reachable in principle and invisible in practice — LORAMER_LORA_GROUNDING_GATE_V1.
{
  const src = read(TOOLS)
  const i = src.indexOf("name: 'query_breakdown'")
  const j = src.indexOf('input_schema', i)
  const desc = i > 0 && j > i ? src.slice(i, j) : ''
  check(/breakdownCoverage/.test(desc), `(c-prose) the query_breakdown description never mentions breakdownCoverage — the field is reachable in principle and invisible in practice.`)
  for (const r of ['PARTIAL', 'read_failed', 'not_connected', 'never_captured', 'unattested_absence', 'no_activity_in_window']) {
    check(new RegExp(r).test(desc), `(c-prose) the query_breakdown description does not teach '${r}'.`)
  }
}

rmSync(out, { recursive: true, force: true })
if (findings.length) {
  console.error(`[breakdown-coverage-wired] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  · ${f}`)
  process.exit(1)
}
console.log('[breakdown-coverage-wired] PASS — the verdict reaches the breakdown tool and only it, PARTIAL emits a directive naming the gap, four unknownReasons emit four distinct sentences, COMPLETE stays silent, and the tool prose teaches the field. It does NOT prove she words it correctly — that is the eval set.')
