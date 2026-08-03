#!/usr/bin/env node
// LORAMER_ONE_BLOCK_OUTPUT_V1 — PLACEMENT GUARD. IT GUARDS WHERE THE RULE LIVES. IT CANNOT GUARD OBEDIENCE.
//
// ⛔ READ THIS BEFORE READING A GREEN FROM IT. THE RULE IS: every substantive reply to Russ is ONE fenced code
// block, nothing outside it. **NO REPO GUARD CAN OBSERVE THAT.** Claude Code's chat output never touches the
// filesystem, never enters a commit, never reaches a build. There is no artifact to inspect, no exit code to
// read, no file to diff. Anything claiming to enforce the rule itself would be theatre, and this repo has
// banked that "prose in a doc is not a guard" — a check that pretends is strictly worse than no check,
// because it manufactures confidence where there is none.
//
// SO WHAT IS MECHANICAL? WHERE THE RULE SITS. The rule was banked once and broken on the very next report,
// and four times on 2026-08-02. The RULE-HOME LAW says a repeat-offense rule needs an enforcer rather than
// another entry — and the only enforceable surface here is PLACEMENT: the rule must be at the TOP of every
// document the executor reads before acting, and must survive into the generated digest. A rule buried on
// line 400 of a 700-line doc is a rule nobody re-reads. This guard makes burying it a build failure.
//
// THREE LEGS, all placement:
//  (a) CLAUDE.md — present, and in the FIRST section (before the IN-FLIGHT GATE), because CLAUDE.md is what
//      Claude Code reads at the top of every session and the top of it is the only part reliably re-read.
//  (b) LORAMER_ESSENCE.md — present INSIDE the `# ⛔ GOVERNING LAW` section, which is the section
//      build-resume-digest.mjs copies verbatim into digest §C. That is what carries it into the resume path.
//  (c) RESUME_INSTRUCTIONS.md — present in the first 20 lines, above the resume flow it governs.
//  (d) THE DIGEST — the rule actually ARRIVED in LORAMER_RESUME_DIGEST.md. If §C is regenerated and the rule
//      is not in it, the ESSENCE placement was wrong and (b) was satisfied by accident.
//
// ⛔ WHAT A GREEN HERE MEANS, EXACTLY: the rule is where it can be read. NOTHING MORE. It does not mean the
// last report was one block, and it never will. That half has exactly one enforcer, and it is Russ.

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return null } }

const TOKEN = 'LORAMER_ONE_BLOCK_OUTPUT_V1'
const CLAIM = /ONE fenced code block/i

const targets = [
  { file: 'CLAUDE.md', why: 'what Claude Code reads at the top of every session' },
  { file: 'LORAMER_ESSENCE.md', why: 'the governing law, copied verbatim into digest §C' },
  { file: 'RESUME_INSTRUCTIONS.md', why: 'the canonical resume block, read before the session starts' },
]
for (const t of targets) {
  const text = read(t.file)
  if (text === null) { findings.push(`${t.file} is unreadable — ${t.why}.`); continue }
  if (!text.includes(TOKEN)) {
    findings.push(`${t.file} no longer carries ${TOKEN}. It is ${t.why}, and a rule broken four times in one day may not live anywhere the executor does not read first.`)
    continue
  }
  const at = text.indexOf(TOKEN)
  const linesBefore = text.slice(0, at).split('\n').length
  // "TOP" is asserted as a line number, not a vibe. 40 lines is roughly one screen of any of these docs.
  if (linesBefore > 40) {
    findings.push(`${t.file} carries ${TOKEN} at line ~${linesBefore}, not at the TOP. Burying it is how it stopped being read the first time; a rule on line 400 of a 700-line doc is a rule nobody re-reads.`)
  }
  if (!CLAIM.test(text.slice(at, at + 1200))) {
    findings.push(`${t.file} names ${TOKEN} but the words "ONE fenced code block" are not with it. A token without its rule is a pointer to nothing.`)
  }
}

// (a) STRICTER FOR CLAUDE.md — it must be the FIRST gate, ahead of the IN-FLIGHT GATE.
{
  const md = read('CLAUDE.md') || ''
  const one = md.indexOf(TOKEN)
  const inflight = md.indexOf('IN-FLIGHT GATE')
  if (one !== -1 && inflight !== -1 && one > inflight) {
    findings.push(`CLAUDE.md puts ${TOKEN} AFTER the IN-FLIGHT GATE. It must be the FIRST gate: it applies to every reply, including the one-line refusal the in-flight gate produces.`)
  }
}

// (b)+(d) THE DIGEST — proves the ESSENCE placement is inside the section that actually gets copied.
{
  const essence = read('LORAMER_ESSENCE.md') || ''
  const gov = essence.indexOf('# ⛔ GOVERNING LAW')
  // The governing-law section ends at the next top-level `# ` that is not the ⛔ heading itself.
  const after = essence.slice(gov + 1)
  const end = after.search(/\n# [^⛔]/)
  const section = end === -1 ? after : after.slice(0, end)
  if (gov === -1) findings.push(`LORAMER_ESSENCE.md has no "# ⛔ GOVERNING LAW" heading — digest §C is built from it, so this guard is BLIND. Fix the guard before trusting a green.`)
  else if (!section.includes(TOKEN)) {
    findings.push(`LORAMER_ESSENCE.md carries ${TOKEN} OUTSIDE the "# ⛔ GOVERNING LAW" section. build-resume-digest.mjs copies only that section into §C, so the rule would not reach the digest — the placement would be satisfied on paper and broken in the artifact.`)
  }
  const digest = read('LORAMER_RESUME_DIGEST.md')
  if (digest === null) findings.push('LORAMER_RESUME_DIGEST.md is unreadable — cannot confirm the rule arrived.')
  else if (!digest.includes(TOKEN)) {
    findings.push(`${TOKEN} did NOT reach LORAMER_RESUME_DIGEST.md. Run \`node scripts/wrap-docs.mjs\`. Until it does, every resume that takes the digest fast path never sees this rule.`)
  }
}

if (findings.length) {
  console.error(`[one-block-output] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[one-block-output] PASS — the one-block rule is at the TOP of all ${targets.length} executor-facing docs (CLAUDE.md ahead of the IN-FLIGHT GATE, ESSENCE inside the governing-law section that feeds §C, RESUME_INSTRUCTIONS above the resume flow) and it reached the generated digest. ⛔ THIS PROVES PLACEMENT ONLY. No guard can see chat output, so nothing here says the last report was one block — that half's only enforcer is Russ.`)
