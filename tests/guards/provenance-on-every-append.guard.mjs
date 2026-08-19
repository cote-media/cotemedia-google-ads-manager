#!/usr/bin/env node
// LORAMER_PROVENANCE_ON_EVERY_APPEND_V1 — AN OPTIONAL PARAMETER IS A PARAMETER NOBODY PASSES.
//
// ⛔ THE DEFECT THIS EXISTS FOR, MEASURED ON THE FIRST LIVE FIRE OF migrations/083 (2026-08-19 02:03Z).
// The completion-signal work added `message_key` and `invocation_id` and threaded a `prov?: WriteProvenance`
// argument through FOUR append helpers. Three were wired at their call sites. The fourth was not, at ALL NINE
// of its exits — and the live ledger said so in one read:
//     attempt_started    38/38 stamped
//     day_committed      66/66 stamped
//     message_finished   33/33 stamped
//     attempt_finished   39/39 NULL on BOTH ids   ← every closing row of every range, unattributable
//
// ⛔ AND THE READER THAT NEEDED IT MOST WAS THE ONE LEFT BLIND. `drive-one-surface.mjs` reads the ranges a
// pass walked with `phase=eq.attempt_finished&message_key=eq.<key>`. Against unstamped rows that returns the
// EMPTY SET — so every pass would have reported `0 range(s) · rows=0`, and the vendor-wall test
// `walked.some(w => w.outcome === 'error')` could never fire. A silent instrument, one layer below the
// silence this whole arc was built to remove.
//
// ⛔ WHY IT PASSED EVERY GATE. `prov` is OPTIONAL, so `tsc` is happy at every call site; the columns are
// nullable, so Postgres is happy; the phase CHECK does not mention them, so the migration's assertions were
// happy; and `completion-signal-on-every-exit` proves the terminal row's SHAPE and says in its own header
// that it cannot reach a row's CONTENT. **Optionality is what made it invisible: nothing anywhere is obliged
// to notice an argument that was never passed.** This is the same shape as LORAMER_NO_DANGLING_REFERENCE_V1
// hours earlier — a change proven at the site it was made and never at the sites it had to reach — which is
// LORAMER_SEAMS_PROOF_V1 in its most literal form: a new writer, an unwalked set of callers.
//
// ⛔ IT USES THE TYPESCRIPT COMPILER, NOT A REGEX, AND THAT IS LOAD-BEARING. These call sites span up to six
// lines and carry template literals containing parentheses and apostrophes; every text-scanning version of
// this check gets one of those wrong. `typescript` is already a devDependency — the same argument acorn got.
//
// THE RULE, derived rather than listed: read `universe-attempt-log.ts`, find EVERY exported function with a
// parameter named `prov`, learn its POSITION from the declaration, then require every call to that function
// anywhere in `src/` to supply at least that many arguments. Nothing is hard-coded — a fifth helper added
// tomorrow is covered the day it declares the parameter.
//
// ⚠ LIMITS, so a green is not over-read: it proves an ARGUMENT IS PASSED, never that its value is right (a
// call passing a stale or empty provenance passes every leg). It follows the identifier, not the value, so a
// helper aliased through a variable is invisible to it. And it is scoped to `src/` — a script calling these
// helpers directly is not checked.
//
// USAGE: node tests/guards/provenance-on-every-append.guard.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const require = createRequire(resolve(ROOT, 'package.json'))
const DECL = 'src/lib/backfill/universe-attempt-log.ts'
const PARAM = 'prov'
const findings = []

let ts
try { ts = require('typescript') } catch (e) {
  console.error(`[provenance-on-every-append] CANNOT RUN — typescript is not resolvable (${e.message}). A guard that cannot parse its subject FAILS rather than passing.`)
  process.exitCode = 2
  process.exit()
}

const parse = (rel) => {
  const src = readFileSync(resolve(ROOT, rel), 'utf8')
  return ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

// ── LEARN THE CONTRACT FROM THE DECLARATION ───────────────────────────────────────────────────────────────
// Position, not presence: `prov` is 5th on appendAttemptFinished and 4th on appendAttemptStarted, so a
// per-helper index is the only thing that can distinguish "passed" from "passed something else".
const required = new Map()
let declSrc
try { declSrc = parse(DECL) } catch (e) {
  console.error(`[provenance-on-every-append] CANNOT RUN — ${DECL} unreadable (${e.message}).`)
  process.exitCode = 2
  process.exit()
}
const visitDecl = (n) => {
  if (ts.isFunctionDeclaration(n) && n.name) {
    const i = n.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === PARAM)
    if (i >= 0) required.set(n.name.text, i)
  }
  ts.forEachChild(n, visitDecl)
}
visitDecl(declSrc)

if (required.size === 0) {
  findings.push(`${DECL} declares NO function taking a \`${PARAM}\` parameter. Either the provenance thread was removed — in which case migrations/083's two columns are dead and this guard should go with them — or this guard is reading the wrong file and is measuring nothing.`)
}

// ── EVERY CALL IN src/ MUST SUPPLY IT ─────────────────────────────────────────────────────────────────────
const files = []
const walkDir = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e)
    if (statSync(p).isDirectory()) { if (e !== 'node_modules') walkDir(p); continue }
    if (/\.tsx?$/.test(e)) files.push(p)
  }
}
walkDir(resolve(ROOT, 'src'))

let callsChecked = 0
for (const abs of files) {
  const rel = abs.slice(resolve(ROOT).length + 1)
  let sf
  try { sf = parse(rel) } catch { continue }
  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && required.has(n.expression.text)) {
      const name = n.expression.text
      const need = required.get(name)
      callsChecked++
      if (n.arguments.length <= need) {
        const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf))
        findings.push(`${rel}:${line + 1} calls \`${name}\` with ${n.arguments.length} argument(s); \`${PARAM}\` is parameter ${need + 1} and is not supplied. That row lands with message_key and invocation_id NULL — indistinguishable from a pre-083 row, and invisible to every reader that joins on either.`)
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
}

if (findings.length) {
  console.error(`[provenance-on-every-append] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  console.error(`  ⇒ An OPTIONAL parameter is one nothing obliges anybody to pass: tsc is happy, the columns are nullable, and the row is written. The live ledger is the only place it shows up, and by then the reader is already blind.`)
  process.exitCode = 1
} else {
  console.log(`[provenance-on-every-append] PASS — ${required.size} helper(s) declare \`${PARAM}\` (${[...required].map(([k, v]) => `${k}@${v + 1}`).join(', ')}); all ${callsChecked} call site(s) in src/ supply it. ⛔ LIMIT: this proves an ARGUMENT IS PASSED, never that its VALUE is right, and it follows the identifier rather than the value.`)
}
