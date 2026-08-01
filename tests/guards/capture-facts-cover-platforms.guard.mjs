#!/usr/bin/env node
// LORAMER_CAPTURE_FACTS_V1 — A PLATFORM WE CAPTURE FROM MUST HAVE ITS WALLS WRITTEN DOWN.
//
// ── WHY ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 7 of 19 graded boundary failures in the 2026-08-01 eval were Lora correctly reporting that data was absent and
// then MISNAMING THE CAUSE: a vendor retention wall called a capture gap, a forward-only family called a genuine
// zero, an API capability limit called an ingestion failure. She was never told those boundaries exist.
// docs/LORAMER_CAPTURE_FACTS.md is where they now live. This guard exists so the doc cannot fall behind the code:
// **a new platform cannot ship without its walls written down.**
//
// ⛔ IT ALREADY CAUGHT SOMETHING. Written 2026-08-01 against a doc covering google, meta and ga, it went RED on
// shopify and woocommerce — two platforms we have captured from for months with no walls recorded anywhere. They
// were added as explicitly UNVERIFIED sections rather than quietly omitted. That is the guard doing its job on the
// day it was written, not a hypothetical.
//
// ── THE ASSERTION ───────────────────────────────────────────────────────────────────────────────────────────────
// Derive the platform set FROM THE CODE — the union of `platforms:` across DRAIN_REGISTRY, which is the same list
// the drain enumerates — and require a section heading for each in the facts doc. ⛔ NEVER a hardcoded platform
// list: a hardcoded list would stay green the day a sixth platform lands, which is the only day this matters
// (FIX-WITH-GUARD: guard the class, not today's instance). If the parse yields zero platforms, that is a BROKEN
// INSTRUMENT and exits 2 — never a pass.
//
// ── HONEST LIMIT, STATED RATHER THAN IMPLIED AWAY ───────────────────────────────────────────────────────────────
// THIS CHECKS THAT A SECTION EXISTS. IT CANNOT CHECK THAT THE SECTION IS TRUE, CURRENT, OR SOURCED. A vendor can
// change a wall tomorrow and this stays green. It is a COVERAGE check, not an ACCURACY check — the accuracy of a
// vendor fact is established by fetching the vendor's page, which is not something a hermetic build-time guard can
// do. Do not read a green here as "our walls are right"; read it as "no platform is undocumented".
//
// USAGE: node tests/guards/capture-facts-cover-platforms.guard.mjs [--inject-platform]
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const read = (rel) => { try { return readFileSync(path.resolve(ROOT, rel), 'utf8') } catch { return null } }

const FACTS_DOC = 'docs/LORAMER_CAPTURE_FACTS.md'
const REGISTRY = 'src/lib/backfill/drain-registry.ts'

// How a platform is allowed to be named in a heading. `ga` is documented under its product name GA4, which is what
// a reader (and Lora) will actually look for, so the alias is explicit rather than a loose substring match.
const HEADING_ALIASES = { ga: ['ga4', 'google analytics'], woocommerce: ['woocommerce', 'woo'] }

// --inject-platform : mutation proof. Adds a synthetic platform to the DERIVED set (in memory, no file written),
//                     which is the state a newly-shipped undocumented platform would produce.
const INJECT = process.argv.includes('--inject-platform')

// ── PURE CORE — the decision, so the mutation proof drives the real logic rather than a copy of it ───────────────
export function decideCoverage(platforms, headings) {
  const hay = headings.map((h) => h.toLowerCase())
  const missing = []
  for (const p of platforms) {
    const names = [p.toLowerCase(), ...(HEADING_ALIASES[p] || [])]
    if (!names.some((n) => hay.some((h) => h.includes(n)))) missing.push(p)
  }
  return { missing, ok: missing.length === 0 }
}

// ── INPUTS ──────────────────────────────────────────────────────────────────────────────────────────────────────
const registrySrc = read(REGISTRY)
if (!registrySrc) { console.error(`✗ ${REGISTRY} unreadable — BROKEN INSTRUMENT, not a pass.`); process.exit(2) }
const platforms = new Set()
for (const m of registrySrc.matchAll(/platforms:\s*\[([^\]]*)\]/g)) {
  for (const q of m[1].matchAll(/'([a-z_]+)'/g)) platforms.add(q[1])
}
if (platforms.size === 0) { console.error(`✗ parsed ZERO platforms out of ${REGISTRY} — BROKEN INSTRUMENT, not a pass.`); process.exit(2) }
const platformList = [...platforms].sort()
if (INJECT) {
  platformList.push('synthetic_new_platform')
  console.log('  [--inject-platform] injected ONE synthetic platform into the DERIVED set (no file written) — the guard must go RED.')
}

const doc = read(FACTS_DOC)
if (!doc) { console.error(`✗ ${FACTS_DOC} is MISSING. Every platform we capture from must have its walls written down.`); process.exit(1) }
const headings = doc.split('\n').filter((l) => /^#{2,3}\s/.test(l))
if (headings.length === 0) { console.error(`✗ ${FACTS_DOC} carries no section headings — BROKEN INSTRUMENT, not a pass.`); process.exit(2) }

// ── REPORT, ALWAYS WITH ITS DENOMINATOR (LORAMER_EMPTY_CARRIES_ITS_DENOMINATOR_V1) ──────────────────────────────
const verdict = decideCoverage(platformList, headings)
console.log(`[capture-facts] ${platformList.length} platform(s) derived from ${REGISTRY}: ${platformList.join(', ')}`)
console.log(`[capture-facts] ${headings.length} section heading(s) in ${FACTS_DOC}`)
console.log('[capture-facts] COVERAGE CHECK ONLY — this cannot verify a wall is true, current or sourced. See the header.')
if (!verdict.ok) {
  console.error(`✗ capture-facts FAIL — ${verdict.missing.length} platform(s) captured with NO walls documented:`)
  for (const p of verdict.missing) console.error(`  - ${p} — add a section to ${FACTS_DOC}. If nothing is verified yet, say so explicitly; UNVERIFIED is an acceptable entry, ABSENT is not.`)
  process.exit(1)
}
console.log(`✓ capture-facts OK — every captured platform has a section.`)
process.exit(0)
