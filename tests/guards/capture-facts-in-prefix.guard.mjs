#!/usr/bin/env node
// LORAMER_CAPTURE_FACTS_V1 — THE CAPTURE-BOUNDARIES BLOCK MUST STAY IN THE CACHED PREFIX.
//
// ── WHY ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 7 of 19 graded boundary failures on 2026-08-01 were Lora reporting absence CORRECTLY and naming its CAUSE
// WRONGLY. The fix is a static block of vendor-verified boundaries in her prompt. A block like that dies in one of
// three silent ways, and none of them fails a build on its own:
//   1. a context refactor moves the push BELOW `lines = suffixLines`, so it lands in the UNCACHED suffix — still
//      correct, but now billed on every single answer instead of once per cache window;
//   2. someone edits the block and drops one of the five boundary KINDS, so she goes back to guessing on that one;
//   3. someone "tidies" an UNESTABLISHED item into a confident assertion, which is worse than not having it.
// This guard fails on all three. It is the FIX-WITH-GUARD half of LORAMER_CAPTURE_FACTS_V1.
//
// ── THE PREFIX ASSERTION IS STRUCTURAL, NOT A STRING MATCH ──────────────────────────────────────────────────────
// build-claude-context.ts binds `let lines = prefixLines` and later reassigns `lines = suffixLines`. Everything
// pushed between those two statements is in the cache_control:ephemeral block; everything after is not. So the
// check is an ORDERING check on line numbers derived from the file itself — swapMarker > blockLine > prefixBind.
// That is the actual mechanism, which is why a refactor that moves the block cannot slip past it.
//
// ── HONEST LIMIT, STATED RATHER THAN IMPLIED AWAY ───────────────────────────────────────────────────────────────
// THIS IS A STATIC READ OF THE SOURCE. It proves the push SITS in the prefix region and that the block's required
// parts are present. It does NOT assemble a context, so it cannot prove the block reaches a real client's prompt —
// that was proven separately at Gate-A on 2026-08-01 against a real Foam OH intelligence payload (prefix 48,648
// chars, block at 12% in, 15/15 required fragments, contested PMax claim absent). It also cannot verify any wall
// is still TRUE at the vendor; re-fetching is the only thing that does that, and docs/LORAMER_CAPTURE_FACTS.md
// carries every source URL for exactly that reason. Read a green as "the block is wired and intact", never as
// "the walls are right".
//
// USAGE: node tests/guards/capture-facts-in-prefix.guard.mjs [--inject-suffix] [--inject-drop-kind]
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const read = (rel) => { try { return readFileSync(path.resolve(ROOT, rel), 'utf8') } catch { return null } }

const CTX = 'src/lib/intelligence/build-claude-context.ts'
const CHAT = 'src/app/api/chat/route.ts'
const MARK = '=== CAPTURE BOUNDARIES — VENDOR-VERIFIED'

// The five boundary KINDS. Dropping one sends her back to guessing on that kind specifically.
const KINDS = ['OUR CAPTURE FLOOR', 'A VENDOR RETENTION WALL', 'A FORWARD-ONLY FAMILY', 'AN API CAPABILITY LIMIT', 'UNESTABLISHED']
// Vendor numbers that must not quietly drift. Each is sourced in docs/LORAMER_CAPTURE_FACTS.md.
const FACTS = ['37 MONTHS', '13 MONTHS', '6 MONTHS', '3 YEARS ONLY', 'LIFE OF THE PROPERTY', '2026-06-27', 'engage-through']
// The unestablished/unverified carriers. These exist so she can say "we have not established this" instead of
// guessing — turning any of them into an assertion is a regression, not a tidy-up.
const HEDGES = ['UNVERIFIED against a Shopify page', 'no vendor wall exists', 'UNESTABLISHED — say exactly that']

const INJECT_SUFFIX = process.argv.includes('--inject-suffix')
const INJECT_DROP = process.argv.includes('--inject-drop-kind')

// ── PURE CORE ───────────────────────────────────────────────────────────────────────────────────────────────────
export function decidePrefixPlacement({ prefixBindLine, blockLine, swapLine, present, cacheWrapped }) {
  const f = []
  if (blockLine < 0) f.push(`the capture-boundaries block is GONE from ${CTX} — Lora is back to guessing which kind of boundary she is reporting.`)
  else {
    if (prefixBindLine < 0 || swapLine < 0) f.push(`could not locate the prefix/suffix boundary in ${CTX} — BROKEN INSTRUMENT.`)
    else if (!(blockLine > prefixBindLine && blockLine < swapLine)) {
      f.push(`the block is pushed at line ${blockLine} but the prefix region is ${prefixBindLine}..${swapLine}. It is in the UNCACHED SUFFIX — correct content, billed on EVERY answer instead of once per cache window.`)
    }
  }
  for (const p of present.missing) f.push(`required fragment missing from the block: "${p}"`)
  if (!cacheWrapped) f.push(`${CHAT} no longer applies cache_control to the prefix returned by buildClaudeContextCacheable — the block is no longer cached.`)
  return { findings: f, ok: f.length === 0 }
}

// ── INPUTS ──────────────────────────────────────────────────────────────────────────────────────────────────────
const src = read(CTX)
if (!src) { console.error(`✗ ${CTX} unreadable — BROKEN INSTRUMENT, not a pass.`); process.exit(2) }
const lines = src.split('\n')
const lineOf = (needle) => lines.findIndex((l) => l.includes(needle)) + 1 || -1
// ⛔ THE STATEMENT, NOT A MENTION OF IT. This guard's FIRST green run was RED because `lines = suffixLines`
// matched the sentence "this must stay ABOVE the `lines = suffixLines` swap" inside the very comment that documents
// the rule — so the check placed the prefix boundary 249 lines early and failed correct code. Verify the
// instrument: match a STATEMENT at the start of a line, never a substring that a comment can also contain.
const stmtLineOf = (re) => lines.findIndex((l) => re.test(l) && !/^\s*(\/\/|\*)/.test(l)) + 1 || -1
const prefixBindLine = stmtLineOf(/^\s*let lines: string\[\] = prefixLines\b/)
let blockLine = lineOf(MARK)
const swapLine = stmtLineOf(/^\s*lines = suffixLines\b/)

if (INJECT_SUFFIX && blockLine > 0) {
  blockLine = swapLine + 1
  console.log('  [--inject-suffix] moved the block BELOW the suffix swap in the check INPUT (no file written) — it must go RED.')
}

const required = [...KINDS, ...FACTS, ...HEDGES]
const dropped = INJECT_DROP ? required[3] : null
if (dropped) console.log(`  [--inject-drop-kind] removed required fragment "${dropped}" from the check INPUT (no file written) — it must go RED.`)
const missing = required.filter((r) => (dropped === r ? true : !src.includes(r)))

const chatSrc = read(CHAT)
if (!chatSrc) { console.error(`✗ ${CHAT} unreadable — BROKEN INSTRUMENT, not a pass.`); process.exit(2) }
const cacheWrapped = /text:\s*prefix,\s*cache_control/.test(chatSrc.replace(/\s+/g, ' '))

// ── REPORT, ALWAYS WITH ITS DENOMINATOR ─────────────────────────────────────────────────────────────────────────
const verdict = decidePrefixPlacement({ prefixBindLine, blockLine, swapLine, present: { missing }, cacheWrapped })
console.log(`[capture-facts-prefix] prefix region = lines ${prefixBindLine}..${swapLine} · block pushed at ${blockLine}`)
console.log(`[capture-facts-prefix] required fragments present: ${required.length - missing.length}/${required.length} (${KINDS.length} kinds · ${FACTS.length} vendor numbers · ${HEDGES.length} unestablished carriers)`)
console.log(`[capture-facts-prefix] ${CHAT} wraps the prefix in cache_control: ${cacheWrapped}`)
console.log('[capture-facts-prefix] STATIC READ — proves the block is wired and intact, NOT that any wall is still true at the vendor. See the header.')
if (!verdict.ok) {
  console.error(`✗ capture-facts-prefix FAIL — ${verdict.findings.length} finding(s):`)
  for (const f of verdict.findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('✓ capture-facts-prefix OK — block present, inside the cached prefix, all kinds/numbers/hedges intact.')
process.exit(0)
