#!/usr/bin/env node
// LORAMER_CHAT_PASTE_ABLE_OUTPUT_V1 — guard the paste-able-output instruction's PRESENCE and PLACEMENT.
//
// ⛔ THE LIMIT FIRST, BECAUSE IT IS THE WHOLE HONEST FRAME OF THIS FILE: **A PRESENCE CHECK IS NOT A
// BEHAVIOUR CHECK.** Nothing here proves Lora actually emits a bare-line fence when asked for 50 negative
// keywords. That is a property of a model reading a prompt, and no static check in this repo can observe
// it. What IS mechanical is that the instruction exists, is reachable, and says the load-bearing things
// rather than a diluted version of them — so a future edit cannot quietly delete or soften it. The
// behaviour half has exactly one instrument, `npm run evals`, and it was DELIBERATELY DEFERRED by Russ on
// 2026-08-06 (formatting-only change; the eval runs later as a baseline check, not as this flight's gate).
// Recorded so nobody reads a green run here as "the output format is verified". It is not.
//
// ⛔ AND THE SECOND REASON THIS GUARD EARNS ITS PLACE IS PLACEMENT, WHICH *IS* FULLY MECHANICAL. The
// instruction must land in the CACHED PREFIX, above the `lines = suffixLines` swap. In the suffix it would
// be re-sent on every single answer instead of once per cache window — the same failure the
// capture-facts-in-prefix guard exists to prevent one block up.
//
// LEGS:
//  (a) the instruction exists in the prompt builder
//  (b) it names the paste-able CASES, so it is not a vague "format nicely"
//  (c) it forbids the four things that actually break a destination field: numbering, bullets, quotes,
//      commentary/metrics inside the fence
//  (d) it puts prose OUTSIDE the fence
//  (e) PLACEMENT — it is in the cached PREFIX, not the per-answer suffix
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const SRC = 'src/lib/intelligence/build-claude-context.ts'
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }

if (!existsSync(resolve(ROOT, SRC))) {
  console.error(`[paste-able-output] FAIL — ${SRC} is missing; that file builds Lora's system prompt.`)
  process.exit(1)
}
const raw = readFileSync(resolve(ROOT, SRC), 'utf8')
// ⛔ QUOTATION IS NOT ASSERTION — banked repeatedly here, and it has turned a real RED into a false green
// in this repo before. A code COMMENT describing the rule must not satisfy a check that the PROMPT carries
// it, so line comments are stripped before matching. What survives is what the model actually receives.
const code = raw.split('\n').filter((l) => {
  const t = l.trim()
  return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
}).join('\n')

// ── (a) THE INSTRUCTION EXISTS ─────────────────────────────────────────────────────────────────────
check(/PASTE-ABLE OUTPUT/.test(code),
  `(a) the PASTE-ABLE OUTPUT instruction is absent from ${SRC}. Without it Lora answers a "give me 50 negative keywords" request as prose or a numbered list, and the copy button shipped in LORAMER_CHAT_COPY_BLOCKS_V1 has nothing to attach to — which is exactly the "looks shipped and is useless" outcome ★CHAT-COPY-BLOCKS warned about by name.`)
check(/fenced code block/i.test(code),
  `(a) the instruction never says to use a FENCED CODE BLOCK. The copy affordance overrides the \`pre\` element; an answer that is not fenced never renders one.`)

// ── (b) IT NAMES THE CASES ─────────────────────────────────────────────────────────────────────────
{
  const cases = ['negative keyword', 'ad copy', 'SKU', 'URL']
  for (const c of cases) {
    check(new RegExp(c, 'i').test(code),
      `(b) the instruction does not name '${c}' as a paste-able case. A rule that says "format lists nicely" without naming the destinations is one the model applies inconsistently, and the whole point is the specific boxes these answers get pasted into.`)
  }
}

// ── (c) IT FORBIDS WHAT ACTUALLY BREAKS THE DESTINATION FIELD ──────────────────────────────────────
{
  // Each of these is a real breakage, not a style preference: Google Ads' negative-keyword box splits on
  // newline and takes the WHOLE line as the value, so a leading "1. " or "- " becomes part of the keyword.
  const forbids = [
    [/NO numbering/i, 'numbering', '`1. running shoes` is submitted as the literal keyword "1. running shoes"'],
    [/NO bullets/i, 'bullets', '`- running shoes` is submitted with the dash attached'],
    [/NO quotes/i, 'quotes', 'a quoted value changes the match type or is rejected outright'],
    [/NO commentary/i, 'commentary/metrics', '`running shoes (142 clicks)` carries the metric into the field'],
    [/NO header row/i, 'a header row', 'the header is submitted as a value'],
  ]
  for (const [re, name, why] of forbids) {
    check(re.test(code),
      `(c) the instruction does not forbid ${name} inside the fence — ${why}. A fenced block that copies cleanly and then breaks on paste is WORSE than no fence, because it looks like it worked.`)
  }
  check(/ONE VALUE PER LINE/i.test(code),
    `(c) the instruction never states the one-value-per-line requirement, which is the actual contract with the destination field.`)
  check(/running shoes/.test(code),
    `(c) the concrete worked example is gone. The rule is easy to satisfy in the letter and miss in the spirit; the "running shoes" / "1. running shoes" pair is what makes the distinction unambiguous.`)
}

// ── (d) PROSE OUTSIDE THE FENCE ────────────────────────────────────────────────────────────────────
check(/PROSE GOES OUTSIDE THE FENCE/i.test(code),
  `(d) the instruction does not place prose OUTSIDE the fence. Explanation inside the fence is the same defect as numbering — it gets pasted.`)
check(/never inside/i.test(code),
  `(d) the instruction does not say prose may NEVER go inside the fence.`)

// ── (e) PLACEMENT — CACHED PREFIX, NOT PER-ANSWER SUFFIX ───────────────────────────────────────────
{
  const at = code.indexOf('PASTE-ABLE OUTPUT')
  const swap = code.indexOf('lines = suffixLines')
  check(swap > 0, `(e) could not locate the \`lines = suffixLines\` swap in ${SRC}; placement cannot be verified, so this guard is not proving what it claims.`)
  if (at > 0 && swap > 0) {
    check(at < swap,
      `(e) the PASTE-ABLE OUTPUT instruction sits AFTER the \`lines = suffixLines\` swap, i.e. in the per-answer SUFFIX rather than the cached PREFIX. It would then be re-sent on every single answer instead of once per cache window — the same waste capture-facts-in-prefix.guard.mjs exists to prevent one block up.`)
  }
}

if (findings.length) {
  console.error(`[paste-able-output] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  · ${f}`)
  process.exit(1)
}
console.log('[paste-able-output] PASS — the paste-able-output instruction is present in the CACHED PREFIX, names its cases, forbids numbering/bullets/quotes/commentary/headers inside the fence, carries the worked example, and puts prose outside. ⛔ PRESENCE ONLY — whether Lora OBEYS it is unguarded here and belongs to `npm run evals`, deliberately deferred 2026-08-06.')
