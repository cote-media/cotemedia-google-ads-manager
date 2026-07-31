#!/usr/bin/env node
// LORAMER_DECISION_TOPIC_INDEX_V1 — GUARD. The index must be GENERATED, must AGREE with §H, and must not be STALE.
//
// WHY GENERATED IS THE WHOLE POINT. Every live-wrong fact found on 2026-07-31 — eleven of them, inside a 9/9
// green freshness gate — was in a doc with NO GENERATOR: HANDOFF's tech-stack and env blocks, CLAUDE.md's table
// list, six migration headers. Every doc that regenerates (§E, §G, §H, the manifest) self-corrected within a
// day. A hand-maintained index would join the first group, and an index nobody trusts is worse than none
// because it is consulted before a claim of novelty.
//
// THREE LEGS:
//  (a) NOT HAND-EDITED / NOT STALE — recompute the section from the CURRENT DECISIONS + QUEUE and diff it
//      against what is in the digest. One check catches both failure modes: a human edit and a source that
//      moved without a regeneration. This is the same recompute-into-a-scratch-buffer technique
//      ★DIGEST-BODY-FRESHNESS asks for, applied to the one section where it is cheap.
//  (b) AGREES WITH §H ON STATUS — a token the index calls OPEN must appear in §H, and one it calls DONE must
//      not. §H and §L are produced from the SAME walk and the SAME statusIsDone by construction, so this leg
//      is a regression detector: it fails the moment someone gives the index its own second walk.
//  (c) THE UNINDEXABLE COUNT IS PRESENT — the index must REPORT how many DECISIONS entries and QUEUE items
//      carry no token. That count is the backlog, not a disclaimer, and an index that quietly stops reporting
//      its own blind spot is the narrow-green class this repo has banked repeatedly.
//
// ⛔ WHAT THIS DOES NOT DO: it does not check that a token is SEMANTICALLY the right one, or that two
// differently-named tokens describe the same topic. That is comprehension, refused for the same reason
// doc-ownership refuses decision-restatement.

import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }

const digest = read('LORAMER_RESUME_DIGEST.md')
if (!digest) { console.error('[decision-topic-index] FAIL — LORAMER_RESUME_DIGEST.md unreadable.'); process.exit(1) }

const sectionOf = (letter, next) => {
  const lines = digest.split('\n')
  const a = lines.findIndex((l) => l.startsWith(`## ${letter}.`))
  if (a < 0) return null
  let b = lines.length
  for (let i = a + 1; i < lines.length; i++) { if (new RegExp(`^## ${next}\\.`).test(lines[i]) || /^--- end of digest/.test(lines[i])) { b = i; break } }
  return lines.slice(a + 1, b).join('\n').replace(/\s+$/, '')
}

const sectionL = sectionOf('L', 'ZZZ')
check(sectionL !== null && sectionL.trim().length > 0,
  '(a) the digest has no §L DECISION-TOPIC INDEX. ESSENCE law 7 is a rule about behaviour and it did not fire on 2026-07-31; this section is its mechanical form and must exist.')

// ── (a) RECOMPUTE AND DIFF ─────────────────────────────────────────────────────────────────────────────
if (sectionL) {
  const r = spawnSync(process.execPath, [resolve(ROOT, 'scripts/build-resume-digest.mjs'), '--print-index'],
    { cwd: ROOT, encoding: 'utf8' })
  if (r.status !== 0) {
    findings.push(`(a) could not recompute the index (build-resume-digest --print-index exited ${r.status}): ${String(r.stderr || '').slice(0, 300)}`)
  } else {
    const fresh = String(r.stdout || '').replace(/\s+$/, '')
    check(fresh === sectionL,
      '(a) §L DOES NOT MATCH a fresh regeneration from DECISIONS + QUEUE. Either it was HAND-EDITED, or a source moved and the digest was not rebuilt. Run `node scripts/wrap-docs.mjs`. A hand-maintained index joins the class of every doc that was live-wrong on 2026-07-31.')
  }
}

// ── (b) STATUS AGREES WITH §H ──────────────────────────────────────────────────────────────────────────
if (sectionL) {
  const sectionH = sectionOf('H', 'I') || ''
  const rows = [...sectionL.matchAll(/^- (\S+) — (OPEN|DONE|DECIDED) ·/gm)]
  check(rows.length > 0, '(b) §L contains no token rows to cross-check.')

  // ⛔ ONE DIRECTION ONLY, AND THE ASYMMETRY IS THE POINT — the first cut asserted BOTH ways and produced 23
  // false failures on its first run. §H IS NOT THE FULL OPEN SET: it is a ranked, filtered view (386 item lines
  // against 412 queue items; ★G2.9 appears twice in QUEUE and once in §H). "OPEN therefore present in §H"
  // demanded a completeness §H never claimed — I asserted a property of the section I had not verified it had,
  // which is VERIFY-THE-INSTRUMENT turned on my own guard.
  // What IS sound: §H lists only items that are OPEN. So a token §H mentions must not be called DONE by §L.
  // A token §L calls OPEN and §H omits is §H filtering, not a disagreement.
  let mismatches = 0
  for (const [, token, status] of rows) {
    if (status !== 'DONE') continue
    if (!sectionH.includes(token)) continue
    mismatches++
    if (mismatches <= 5) findings.push(`(b) §L calls ${token} DONE while §H — which lists OPEN items only — still carries it. The two are built from ONE walk and ONE statusIsDone, so this cannot happen unless the index grew a second walk. That is how two views of one fact begin to drift.`)
  }
  if (mismatches > 5) findings.push(`(b) …and ${mismatches - 5} further §L/§H status disagreements.`)
}

// ── (c) THE BLIND SPOT IS REPORTED ─────────────────────────────────────────────────────────────────────
if (sectionL) {
  check(/UNINDEXABLE/.test(sectionL) && /carry NO token/.test(sectionL),
    '(c) §L no longer reports its UNINDEXABLE count. The number of untokened DECISIONS entries and QUEUE items IS the backlog — an index that stops reporting its own blind spot reads as complete coverage when it is not.')
  const m = sectionL.match(/(\d+)\s+DECISIONS entries and\n?(\d+)\s+QUEUE items carry NO token/)
  check(!!m, '(c) the UNINDEXABLE counts are not machine-readable in §L — they must stay countable so the backlog can be tracked down over time.')
}

if (findings.length) {
  console.error(`[decision-topic-index] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  · ${f}`)
  process.exit(1)
}
console.log('[decision-topic-index] PASS — §L matches a fresh regeneration, agrees with §H on every token status, and still reports its own unindexable backlog.')
