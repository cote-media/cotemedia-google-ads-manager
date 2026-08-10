#!/usr/bin/env node
// LORAMER_FIVE_STEP_ROUNDS_V1 — PLACEMENT, NEVER OBEDIENCE (the ONE-BLOCK guard's honest limit, reused).
//
// ⛔ WHAT THIS CAN AND CANNOT DO, stated before the legs: the five-step framework binds INSTRUCTIONS AND
// FLIGHTS, which live in chat — no repo guard can observe whether a flight actually ran its rounds or a
// ROUND: header was present on an instruction. The obedience half has exactly one enforcer and it is Russ.
// What IS mechanical: the LAW's presence and integrity in the governing document. A law that quietly loses
// a step name (or the whole section) in an edit becomes unciteable, and nobody notices until a RUN-class
// step skips a round citing nothing. That is the failure this guard makes loud.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
let essence = ''
try { essence = readFileSync(resolve(ROOT, 'LORAMER_ESSENCE.md'), 'utf8') }
catch (e) { console.error(`[five-step-rounds] FAIL — LORAMER_ESSENCE.md unreadable: ${e.message}`); process.exit(1) }

// (a) the law section exists
if (!/LORAMER_FIVE_STEP_ROUNDS_V1/.test(essence)) {
  findings.push(`(a) ESSENCE no longer carries LORAMER_FIVE_STEP_ROUNDS_V1 — the framework law was removed or renamed without this guard following it.`)
}
// (b) the ladder is intact, in order, as one arrow chain
if (!/RESEARCH\s*→\s*ADVERSARY\s*→\s*TEST\s*→\s*RUN\s*→\s*VERIFY/.test(essence)) {
  findings.push(`(b) the five-step ladder "RESEARCH → ADVERSARY → TEST → RUN → VERIFY" is not present verbatim — a reordered or truncated ladder is a different law wearing the same marker.`)
}
// (c) the three load-bearing clauses survive: no RUN skips, compression is declared, VERIFY never skipped after effects
for (const [re, what] of [
  [/No RUN-class step ever skips a round/i, 'the no-skip clause for RUN-class steps'],
  [/compression is DECLARED, never silent/i, 'the declared-compression clause'],
  [/VERIFY is never skipped for anything that wrote, spent, or deployed/i, 'the mandatory-VERIFY clause'],
]) {
  if (!re.test(essence)) findings.push(`(c) ESSENCE lost ${what} — the framework without it permits exactly the failure it was banked against.`)
}
// (d) the honest limit stays stated — a placement guard that stops saying it guards placement becomes oversold
if (!/obedience lives in chat|no repo guard can observe/i.test(essence)) {
  findings.push(`(d) the law no longer states its own enforcement limit (instruction-level obedience lives in chat). An unstated limit reads as coverage that does not exist.`)
}

if (findings.length) {
  console.error(`[five-step-rounds] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[five-step-rounds] PASS — LORAMER_FIVE_STEP_ROUNDS_V1 present in ESSENCE with the full ladder verbatim, the three load-bearing clauses, and its own enforcement limit stated. LIMIT: placement only — obedience lives in chat and its enforcer is Russ.`)
