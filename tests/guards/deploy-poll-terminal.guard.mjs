#!/usr/bin/env node
// LORAMER_DEPLOY_POLL_UNTIL_TERMINAL_V1 — a push/deploy report is INCOMPLETE unless the deploy state is
// TERMINAL (READY or FAILED) at report time.
//
// ⛔ THE DEFECT, 2026-08-25, twice in one day: the executor handed the wait to a background timer and
// ENDED THE TURN — the deploy went READY within minutes and the report arrived only when Russ prompted
// (45 minutes on 02e79b7; ~20 more on the prune's check:data verdict). The wait was never the problem;
// stopping was.
//
// ⛔ ENFORCEABILITY, STATED HONESTLY, per A LAW IS NOT BANKED UNTIL IT CAN FAIL A BUILD: NO REPO GUARD
// CAN OBSERVE CHAT CONDUCT OR A VERCEL POLL — the deploy confirmation lives in the conversation, which
// never touches the filesystem, a commit, or a build (the one-block law's limit, inherited unchanged).
// A headless poller is also not buildable today: .env.local carries no VERCEL token (checked 2026-08-25),
// so a script cannot ask Vercel anything. What IS mechanical is PLACEMENT — the same posture as
// one-block-output.guard.mjs: this guard fails the build if the rule is absent from the push section of
// CLAUDE.md, the one file the executor re-reads every session before any push. Obedience has exactly one
// enforcer and it is Russ seeing a report whose deploy line is not terminal.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []

let claudeMd = ''
try { claudeMd = readFileSync(resolve(ROOT, 'CLAUDE.md'), 'utf8') } catch (e) {
  console.error(`deploy-poll-terminal: CANNOT READ CLAUDE.md — ${e.message}`)
  process.exit(1)
}

// The rule's load-bearing phrases. Paraphrase-resistant on the two words that carry the law:
// TERMINAL (the state) and the timer-handoff ban (the defect).
if (!/LORAMER_DEPLOY_POLL_UNTIL_TERMINAL_V1/.test(claudeMd)) {
  findings.push('CLAUDE.md does not carry LORAMER_DEPLOY_POLL_UNTIL_TERMINAL_V1 — the deploy-poll rule has no home in the one file the executor reads before every push')
} else {
  const i = claudeMd.indexOf('LORAMER_DEPLOY_POLL_UNTIL_TERMINAL_V1')
  const block = claudeMd.slice(Math.max(0, i - 200), i + 1200)
  if (!/TERMINAL\s*\(READY or FAILED\)/.test(block)) {
    findings.push('the rule no longer states the terminal condition "TERMINAL (READY or FAILED)" — a deploy-poll rule without its terminal set does not say when polling may stop')
  }
  if (!/timer/i.test(block) || !/end(ing)? the turn/i.test(block)) {
    findings.push('the rule no longer names the defect (handing off to a timer and ending the turn) — a rule that omits its failure mode reads as advice')
  }
}

if (findings.length === 0) {
  console.log('deploy-poll-terminal: PASSED — the deploy-poll rule is placed in CLAUDE.md with its terminal condition and its named defect. (Placement only; obedience is unenforceable by construction and stamped so.)')
  process.exit(0)
}
console.error(`deploy-poll-terminal: FAILED — ${findings.length} finding(s)`)
for (const f of findings) console.error(`  ✗ ${f}`)
process.exit(1)
