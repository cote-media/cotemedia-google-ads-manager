#!/usr/bin/env node
// LORAMER_CAPABILITY_DENOMINATOR_V1 — NO FAMILY MAY BE JUDGED AGAINST ACCOUNT SPEND BY DEFAULT.
//
// ── WHY ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// The completion-claim gate's denominator was ACCOUNT-GRAIN SPEND: any day the account delivered counted as a day
// the family should have rows. Measured wrong three times on 2026-08-01, always in the same direction:
//   · Foam OH — $5,956.94 across 90 PMax days; PMax has no age/gender criteria; the gate recorded 90 days of
//     "missing demographics" that could never have existed. A live probe confirmed it.
//   · Six of six checkable demographic violations were honest empties — our first row lands on the exact day the
//     first capable campaign appears.
//   · The one "search-term gap" was an account that stopped advertising on 2026-04-05.
// Each was caught by a person asking the right question. This guard is what stops the next family shipping without
// that question being asked at all.
//
// ── THE ASSERTION ───────────────────────────────────────────────────────────────────────────────────────────────
// Every step the gate can ROW-CHECK must have an explicit CAPABILITY declaration — `all: true` (every campaign
// type emits it, so account delivery is a defensible denominator), or `capable`/`cannot` (the matrix says which
// types can), or `indeterminate` (the matrix is SILENT, so no verdict is possible).
// ⛔ SILENCE IS THE FAILURE. A step with no entry falls back to account spend, which is precisely the defect —
// so an omission must fail rather than default. `all: true` is allowed but it must be WRITTEN, not assumed.
// Also asserts the two verdicts exist and that the denominator actually consults capableFrom.
//
// ── HONEST LIMIT ────────────────────────────────────────────────────────────────────────────────────────────────
// This checks that a capability decision was MADE for every row-checkable step. It cannot check the decision is
// RIGHT — that comes from docs/LORAMER_CAMPAIGN_TYPE_DATA_MATRIX.md and the vendor pages it quotes, most of which
// are still SILENT. Read a green as "nothing is being judged by default", never as "the capability map is correct".
//
// USAGE: node tests/guards/capability-denominator.guard.mjs [--inject-missing-step]
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const read = (rel) => { try { return readFileSync(path.resolve(ROOT, rel), 'utf8') } catch { return null } }
const GATE = 'scripts/check-completion-claims.mjs'
const REQ = 'src/lib/completeness/required-steps.ts'
const MATRIX = 'docs/LORAMER_CAMPAIGN_TYPE_DATA_MATRIX.md'

const INJECT = process.argv.includes('--inject-missing-step')

const gate = read(GATE); const req = read(REQ)
for (const [n, s] of [[GATE, gate], [REQ, req]]) if (!s) { console.error(`✗ ${n} unreadable — BROKEN INSTRUMENT.`); process.exit(2) }
if (!read(MATRIX)) { console.error(`✗ ${MATRIX} is MISSING — capability decisions must cite it.`); process.exit(1) }

const section = (name) => { const i = gate.indexOf(`const ${name} = {`); return i < 0 ? '' : gate.slice(i, gate.indexOf('\n}', i)) }
const capability = [...section('CAPABILITY').matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1])
const supplementary = [...section('SUPPLEMENTARY_REAL').matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1])
// Row-checkable = has a signature: a required-steps key, or a verified supplementary one.
const rowCheckable = new Set([...[...req.matchAll(/key:\s*'([a-z_]+)'/g)].map((m) => m[1]), ...supplementary])
if (INJECT) { rowCheckable.add('synthetic_uncapped_step'); console.log('  [--inject-missing-step] added a synthetic row-checkable step with no CAPABILITY entry (no file written) — it must go RED.') }

const findings = []
for (const k of [...rowCheckable].sort()) {
  if (!capability.includes(k)) findings.push(`step '${k}' is row-checkable but has NO CAPABILITY entry — it would fall back to ACCOUNT-GRAIN SPEND, which is the defect this exists to stop. Declare all:true, capable/cannot, or indeterminate.`)
}
if (!gate.includes('HONEST_EMPTY_NO_CAPABLE_DELIVERY')) findings.push('the HONEST_EMPTY_NO_CAPABLE_DELIVERY verdict is gone — an empty family with no capable delivery would read as a violation again.')
if (!gate.includes('INDETERMINATE_CAPABILITY')) findings.push('the INDETERMINATE_CAPABILITY verdict is gone — a SILENT matrix entry would be forced into OK or violation.')
if (!/c\.capableFrom\s*\?\?\s*c\.firstActive/.test(gate)) findings.push('the bound no longer prefers capableFrom over account activity — the denominator has reverted.')
if (!/coalesce\(spend,0\) > 0 or coalesce\(impressions,0\) > 0/.test(gate.replace(/\s+/g, ' '))) findings.push('the delivery test (spend>0 OR impressions>0) is missing — campaign EXISTENCE must never stand in for delivery.')

console.log(`[capability-denominator] ${rowCheckable.size} row-checkable step(s) · ${capability.length} capability declaration(s)`)
console.log('[capability-denominator] CHECKS THAT A DECISION WAS MADE, not that it is right — the matrix and its vendor pages own correctness, and most are still SILENT. See the header.')
if (findings.length) {
  console.error(`✗ capability-denominator FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('✓ capability-denominator OK — every row-checkable step declares its capability; both verdicts and the delivery test are intact.')
process.exit(0)
