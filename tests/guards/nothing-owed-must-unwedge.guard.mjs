#!/usr/bin/env node
// LORAMER_NOTHING_OWED_MUST_UNWEDGE_V1 — A PUBLISHER THAT CAN SAY "NOTHING OWED" MUST ADVANCE PAST IT.
//
// ⛔ THE DEFECT, TWICE NOW, IN TWO DIFFERENT PUBLISHERS. The anchor recedes only past a window the rotation
// index has seen ASKED — `deriveAnchorEnd` reads `universe_surface_rotation`, and migration 064 builds that
// from `phase='attempt_started'` rows. So a publisher that derives a FULLY-COVERED window, refuses it, and
// writes NOTHING pins the rotation forever and re-derives the same window every time.
//   · 2026-08-13/14 — the RESUMER. All 346 surfaces wedged by 23:30Z; 21+ hours of hourly fires with
//     candidates:0; reproduced live 2026-08-14 with refusals {'nothing-owed': 60}. Fixed by
//     LORAMER_WALK_UNWEDGE_AND_HEARTBEAT_V1: a started(requests:0) + finished('skipped') pair.
//   · 2026-08-17 — the DRIVE, a NEW publisher, which omitted the unwedge and spun on ONE covered window
//     **566 consecutive passes**. Same defect, same day the fix was being celebrated one file over.
// **THAT IS TWICE, WHICH BY THE RULE-HOME LAW MEANS IT NEEDS AN ENFORCER RATHER THAN A THIRD FIX.**
//
// THE RULE: any file that publishes to the walk topic AND has a branch keyed on nothing-being-owed must, in
// that branch, append the skipped pair. Both halves are required — the started row is what the rotation
// reads, and the finished row is what closes it.
//
// ⛔ HONEST LIMIT, STATED RATHER THAN IMPLIED: this is a SOURCE-SHAPE check. It proves the calls are present
// in the branch, never that they run, and never that the rotation actually advanced. The behavioural proof is
// the live red→green on the drive (566 no-ops → the anchor moving) recorded in DECISIONS. A guard that reads
// text cannot watch a database, and pretending otherwise is how a green check answers a narrower question
// than its reader assumes.
//
// USAGE: node tests/guards/nothing-owed-must-unwedge.guard.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const TOPIC_LIT = 'google-ads-universe-v2'

function walk(dir) {
  const out = []
  for (const e of readdirSync(resolve(ROOT, dir))) {
    const rel = join(dir, e)
    const st = statSync(resolve(ROOT, rel))
    if (st.isDirectory()) out.push(...walk(rel))
    else if (e.endsWith('.ts')) out.push(rel)
  }
  return out
}
// A COMMENT CANNOT PUBLISH — the same stripping the consumer guard's publisher leg had to learn, for the same
// reason: a doc comment naming the topic made an innocent module look like a publisher.
const nocomment = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

let checked = 0
for (const f of walk('src')) {
  const raw = readFileSync(resolve(ROOT, f), 'utf8')
  const src = nocomment(raw)
  // ⛔ PUBLISHERS IMPORT THE TOPIC, THEY DO NOT SPELL IT. The first locator tested for the literal
  // 'google-ads-universe-v2' and found ZERO publishers — because both the resumer and the drive take TOPIC
  // from `universe-v2-contract`, which is the whole point of that module. It failed loudly (a guard that
  // checks nothing must fail) rather than passing on an empty set, and that is the only reason it was caught.
  const publishes = /universe-v2-contract/.test(src) && /\bsend\s*\(\s*TOPIC\b/.test(src)
  if (!publishes) continue
  // Does it have a nothing-owed branch? Both publishers spell it from the coverage result.
  const hasNothingOwed = /ranges\.length\s*===\s*0/.test(src) || /verdict\s*===\s*'nothing-owed'/.test(src)
  if (!hasNothingOwed) continue
  checked++
  // ⛔ THE KEY VARIABLE IS NOT PART OF THE RULE — ★GUARD-LOCATORS-PIN-TODAYS-CALL-SITE. The first version
  // demanded the literal `appendAttemptStarted(key, 0)` and went red on a correct fix that named its key
  // `coveredKey`. What matters is a started row charged ZERO requests, whatever the key is called.
  const hasStarted = /appendAttemptStarted\s*\(\s*\w+\s*,\s*0\s*\)/.test(src)
  const hasSkipped = /appendAttemptFinished\([^)]*'skipped'/.test(src) && /COVERED_SKIP/.test(raw)
  if (!hasStarted || !hasSkipped) {
    findings.push(
      `${f} publishes to '${TOPIC_LIT}' and has a NOTHING-OWED branch, but ${!hasStarted ? 'does not append a started(0-requests) row' : ''}${!hasStarted && !hasSkipped ? ' and ' : ''}${!hasSkipped ? "does not append a finished('skipped') row carrying the COVERED_SKIP marker" : ''}. ` +
      `⛔ THE ANCHOR RECEDES ONLY PAST A WINDOW THE ROTATION HAS SEEN ASKED (migration 064 reads phase='attempt_started'). ` +
      `Without the pair this publisher re-derives the same covered window forever — the resumer did it for 21 hours across 346 surfaces on 2026-08-13/14, and the drive did it for 566 consecutive passes on 2026-08-17. ` +
      `COPY the resumer's block (universe-resume/route.ts, the LORAMER_WALK_UNWEDGE_AND_HEARTBEAT_V1 branch); do not re-derive it.`)
  }
}

if (checked === 0) {
  findings.push(`no publisher with a nothing-owed branch was found at all. Either the topic literal moved, the branch is spelled a third way, or the locator is wrong — and a guard that checks nothing must fail rather than pass. (Expected at least the resumer and the drive.)`)
}

if (findings.length) {
  console.error(`[nothing-owed-must-unwedge] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exitCode = 1
} else {
  console.log(`[nothing-owed-must-unwedge] PASS — ${checked} publisher(s) with a nothing-owed branch, each appending the started(0)+skipped(COVERED_SKIP) pair.`)
  console.log(`⛔ LIMIT: source shape only. It proves the calls are THERE, never that the rotation advanced — that proof is the live red→green in DECISIONS.`)
}
