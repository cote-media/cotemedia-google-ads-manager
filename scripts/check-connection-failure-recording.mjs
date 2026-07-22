#!/usr/bin/env node
// LORAMER_CONN_FAILURE_STREAK_V1 — FIX-WITH-GUARD for connection-health.ts.
//
// THE CLASS IT GUARDS: a connection FAILURE branch that decides NOT to flip health must NOT be silent —
// it must record the consecutive-failure streak (recordFailureStreak) before returning. The pre-fix bug
// was two such branches ending in a BARE `return`, so a persistent 5xx (Shelley: every fire for 12 days)
// accumulated zero state and stayed invisible on every surface.
//
// The two not-flippable failure DECISIONS in this file (the whole set — this module is the ONLY health
// writer): (A1) recordConnectionResult's transient/empty/unknown branch `if (authClass == null)`; (A2)
// recordConnectionAuthFailure's `probe === 'indeterminate'` fail-safe branch. For EACH occurrence of either
// decision, the guard requires a recordFailureStreak(...) call BEFORE the branch's first `return`. A new
// branch added with either of those two decision shapes is caught; a novel shape is NOT (stated limit).
//
// Hermetic: reads source text only. No network, no DB, CI-safe.

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const FILE = path.join(ROOT, 'src/lib/connection-health.ts')
const src = fs.readFileSync(FILE, 'utf8')

const findings = []
const RECORDER = 'recordFailureStreak('

// 1) The recorder must exist (single source the branches route through).
if (!/\bfunction\s+recordFailureStreak\b/.test(src)) {
  findings.push('recordFailureStreak is NOT defined — there is no single failure-recording path to route branches through.')
}

// 2) Success must RESET the streak (so a recovered connection stops reading as failing).
const resets = /consecutive_failures\s*:\s*0/.test(src) && /first_failure_at\s*:\s*null/.test(src)
if (!resets) {
  findings.push('The success path does not RESET the streak (expected consecutive_failures: 0 + first_failure_at: null in recordConnectionSuccess).')
}

// 3) CLASS CHECK — every not-flippable failure decision records before it returns.
//    For each anchor occurrence, scan to the branch's first `return` and require the recorder before it.
const ANCHORS = [
  { name: 'transient/empty/unknown branch (authClass == null)', re: /if\s*\(\s*authClass\s*==\s*null\s*\)/g },
  { name: 'indeterminate-probe fail-safe branch (probe === \'indeterminate\')', re: /probe\s*===\s*['"]indeterminate['"]/g },
]

for (const anchor of ANCHORS) {
  let m
  let seen = 0
  while ((m = anchor.re.exec(src)) !== null) {
    seen++
    const from = m.index
    const retIdx = src.indexOf('return', from)
    if (retIdx === -1) {
      findings.push(`${anchor.name}: no return found after the decision — cannot verify recording (unexpected shape).`)
      continue
    }
    const branch = src.slice(from, retIdx)
    if (!branch.includes(RECORDER)) {
      const snippet = src.slice(from, Math.min(retIdx + 6, from + 120)).replace(/\s+/g, ' ')
      findings.push(`${anchor.name}: returns WITHOUT recording the streak (no ${RECORDER} before the return). SILENT FAILURE. → "${snippet}"`)
    }
  }
  if (seen === 0) {
    findings.push(`${anchor.name}: decision not found — the file shape changed; guard cannot confirm this failure class is covered.`)
  }
}

if (findings.length) {
  console.error('✗ GATE FAILED — connection-health has a SILENT failure branch (a persistent failure would accrue no state):')
  for (const f of findings) console.error('  · ' + f)
  console.error(`\n${findings.length} finding(s). Every not-flippable failure branch must call ${RECORDER} before returning; success must reset. (Guards the two known decision shapes, NOT a full AST proof.)`)
  process.exit(1)
}

console.log('✓ GATE PASSED — every not-flippable failure branch records the streak before returning; success resets it.')
console.log('  (LORAMER_CONN_FAILURE_STREAK_V1 — guards the authClass==null + indeterminate-probe decisions; recording centralized in recordFailureStreak.)')
process.exit(0)
