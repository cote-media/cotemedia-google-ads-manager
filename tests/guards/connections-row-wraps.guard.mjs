#!/usr/bin/env node
// LORAMER_ONE_CLICK_WALK_V1 (1/2) — THE CONNECTIONS ROW WRAPS INSTEAD OF OVERFLOWING THE CARD ON A PHONE.
//
// Round 14 (2026-09-10): .connRow is a single-line flex row whose badge and two buttons are flex-shrink: 0 with
// content-width minimums (≈ 360–410 px of fixed width, font-metric estimate), so on a 375–393 px viewport the row
// overflowed the card whenever the badge read "Capture failing" or Reconnect was lit. One rule: flex-wrap.
//
// LEGS
//  (a) src/components/redesign/redesign.module.css: the `.connRow {` rule carries `flex-wrap: wrap`
//  (b) …and a `row-gap` so the wrapped line does not collide
//  (c) `.connMeta` keeps `min-width: 0` (the ellipsis path for long account names)
//  (d) registered in scripts/run-guards.mjs
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const CSS = 'src/components/redesign/redesign.module.css'
const css = read(CSS)
const rule = css.match(/\.connRow\s*\{([^}]*)\}/)
if (!rule) findings.push(`(a) ${CSS} has no .connRow rule`)
else {
  if (!/flex-wrap\s*:\s*wrap/.test(rule[1])) findings.push(`(a) .connRow lacks flex-wrap: wrap — the badge and buttons overflow the card below ~410 px`)
  if (!/row-gap\s*:/.test(rule[1])) findings.push(`(b) .connRow lacks a row-gap — a wrapped second line collides with the first`)
}
const meta = css.match(/\.connMeta\s*\{([^}]*)\}/)
if (!meta || !/min-width\s*:\s*0/.test(meta[1])) findings.push(`(c) .connMeta lost min-width: 0 — long account names would stop the ellipsis`)
const roster = read('scripts/run-guards.mjs')
if (roster && !roster.includes('tests/guards/connections-row-wraps.guard.mjs')) findings.push('(d) this guard is not registered in scripts/run-guards.mjs — an unregistered guard never runs')

if (findings.length) { console.error('✗ connections-row-wraps FAILED:'); for (const f of findings) console.error('  ' + f); process.exit(1) }
console.log('[connections-row-wraps] PASS — .connRow wraps (flex-wrap: wrap + row-gap) and .connMeta keeps min-width: 0.')
