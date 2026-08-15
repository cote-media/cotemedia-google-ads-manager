#!/usr/bin/env node
// LORAMER_POSTGREST_AGGREGATE_BAN_V1 — GUARD. NO CHECK OR GUARD MAY READ A POSTGREST AGGREGATE.
//
// ⛔ THE DEFECT CLASS (★WALK-LIVENESS-ROWS-COUNTER-IS-STRUCTURALLY-ZERO, measured 2026-08-15): PostgREST
// aggregates (`select=col.sum()`, `.avg()`, `.count()`, …) are DISABLED on this Supabase project. The live
// response to one is HTTP 400 PGRST123 "Use of aggregate functions is not allowed" — and the body is an
// error OBJECT, not a row array, so the idiomatic `Array.isArray(body) ? Number(body[0]?.sum ?? 0) : 0`
// converts the failure into a SILENT ZERO. check-walk-liveness printed that zero as `rows=0` on every run it
// ever made, and it is the Deploy 2 gate's own instrument (`rows_written > 0` opens Deploy 2): on the day the
// walk wrote rows, the gate's instrument would still have said zero. A second instance of the same trap was
// caught in check-fleet-meter-visibility's FIRST DRAFT, before it shipped, by running it.
//
// ⛔ WHY A BAN AND NOT A FIX-AND-MOVE-ON: the trap is invisible in review. The URL reads like working
// PostgREST, the fallback reads like defensive coding, and the output is a plausible number. Two authors
// (one of them the author of this guard) wrote it independently within a week. The correct patterns are:
//   · a scalar security-definer RPC (universe_lane_spend_today / universe_attempt_lane_spend_today /
//     universe_walk_rows_written) — cannot be page-capped, cannot 400, unreadable = loud;
//   · a Node-side sum over REAL ROWS, only where the grain is provably small AND the row cap is CHECKED
//     (check-fleet-meter-visibility's fire-log read: ~24 rows/24h against a 500 limit, refuses at the limit).
//
// ⛔ THE ALLOWLIST IS A CLASSIFICATION, NOT AN EXEMPTION — same rule as fleet-meter-sees-the-walk leg (c).
// It is EMPTY today: after this flight, zero live aggregate reads exist. Adding an entry requires stating why
// that read cannot 400 the same way, and "it works on my project" is not a reason — this project's PostgREST
// config is exactly what makes it fail.
//
// HERMETIC: filesystem only — safe inside `npm run guard`, which Vercel runs. LORAMER_GUARD_ROOT overrides
// the tree so it can be proven RED against an earlier checkout.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []

// Classified exceptions: rel path → one-line reason it cannot fail this way. Empty by design (see header).
const ALLOWLIST = new Map([])

// The trap: a PostgREST aggregate inside a select= parameter. Matches `select=…col.sum()` and friends,
// including multi-column selects (`select=a,b.sum()`), aliased (`select=total:b.sum()`).
const AGG = /select=[^&'"`\s]*\.(sum|avg|count|max|min)\(\)/

// Scan the instrument tree: every check under scripts/ and every guard under tests/guards/. These are the
// files that talk to PostgREST over REST; app code goes through supabase-js builders, a different shape.
const DIRS = ['scripts', 'tests/guards']
const files = []
for (const dir of DIRS) {
  let names = []
  try { names = readdirSync(resolve(ROOT, dir)) } catch { continue }
  for (const n of names) {
    const rel = join(dir, n)
    try { if (statSync(resolve(ROOT, rel)).isFile() && /\.(mjs|js|ts)$/.test(n)) files.push(rel) } catch { /* skip */ }
  }
}
if (files.length === 0) {
  console.error('[postgrest-aggregate-ban] FAIL — scanned zero files. A guard with no evidence is not a pass.')
  process.exit(1)
}

for (const rel of files) {
  let src = ''
  try { src = readFileSync(resolve(ROOT, rel), 'utf8') } catch { findings.push(`${rel} is unreadable — a guard that cannot read its subject is not a pass.`); continue }
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue // comments may DESCRIBE the trap; only code springs it
    if (!AGG.test(line)) continue
    if (ALLOWLIST.has(rel)) continue
    findings.push(
      `${rel}:${i + 1} — a PostgREST aggregate in a select= parameter. Aggregates are DISABLED on this project: this read returns HTTP 400 PGRST123 with an error-object body, and the usual Array.isArray fallback converts that into a SILENT ZERO — a failed read wearing a number (★WALK-LIVENESS-ROWS-COUNTER-IS-STRUCTURALLY-ZERO). Use a scalar security-definer RPC (see migrations/070) or a checked Node-side sum over real rows. If this read genuinely cannot fail this way, classify it in ALLOWLIST with the reason.`)
  }
}

// ── THE FIX PIN — the instance that motivated the ban stays fixed ─────────────────────────────────────
// The class ban above stops NEW instances; this pins the repaired one, so a revert cannot slip through as
// "just restoring the old read". Comment lines are excluded above, so the check's own history note is fine.
{
  const rel = 'scripts/check-walk-liveness.mjs'
  let src = ''
  try { src = readFileSync(resolve(ROOT, rel), 'utf8') } catch { src = '' }
  if (src) {
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    if (!/rpc\/universe_walk_rows_written/.test(code)) {
      findings.push(`${rel} no longer reads rows_written through the universe_walk_rows_written RPC (migrations/070). The Deploy 2 gate's instrument must not go back to a read that can silently zero.`)
    }
    if (!/CANNOT RUN[\s\S]{0,400}?process\.exitCode = 2/.test(src.slice(src.indexOf('universe_walk_rows_written')))) {
      findings.push(`${rel} — the rows-written read no longer fails LOUD (CANNOT RUN + exit 2) on an unreadable counter. An unreadable counter reading as zero is the most permissive answer an instrument can give.`)
    }
  } else {
    findings.push(`${rel} is missing — the fix pin has nothing to pin.`)
  }
}

if (findings.length) {
  console.error('\n❌ LORAMER_POSTGREST_AGGREGATE_BAN_V1 FAILED — an instrument reads a PostgREST aggregate that this project rejects with 400\n')
  findings.forEach((f) => console.error('  • ' + f))
  console.error('')
  process.exit(1)
}
console.log(`postgrest-aggregate-ban.guard: PASS — ${files.length} instrument file(s) scanned, zero PostgREST aggregate reads outside the (empty) classified allowlist, and the walk-liveness rows read stays on the RPC with a loud failure path.`)
