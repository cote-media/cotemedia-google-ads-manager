#!/usr/bin/env node
// LORAMER_CARD_PLATFORM_RESOLUTION_V1 — THE PLATFORM A CARD REQUESTS IS RESOLVED, NOT ASSUMED TO BE STORED.
//
// ⛔ THE CLIENT NAMED BELOW IS THE REGISTRY'S, NOT A NAME I TYPED: c39ee088-c635-4bfe-b308-43fe9640f1ca is
// 'The Escential Group' in src/lib/clients/canonical.ts:80 (role cohort, owner cotebrandmarketing@gmail.com) —
// the entry that exists precisely because "Escential Group" and "The Escential Group" differ by one article.
//
// ⛔ THIS GUARD EXISTS BECAUSE THE LAST ONE ANSWERED THE WRONG QUESTION, 2026-08-16. fde8122 added
// platform:'meta' to the DEFAULT Overview card and default-card-platform-claim.guard.mjs went green on it.
// The Age card stayed broken on Russ's phone, because `defaultOverviewView()` is consulted ONLY by a user with
// no saved layout — and every real user has one. His stored d-age (dashboard_layouts, written 2026-07-09 and
// RE-WRITTEN at 00:29:40Z after the deploy) carries no platform, and 0 of 37 stored breakdown cards across the
// whole fleet do. A green suite and a working card were never the same claim.
//
// ⛔ QUEUE:1015 — "the wiring was right. THE WIRING WAS NOT THE QUESTION." The four hops (card-types →
// useCardData → card-breakdown → queryBreakdown) were each correct and the feature was still dead, because the
// INPUT came from stored JSON that predated them. So this guard drives the RESOLUTION with the exact object
// that is in the database, not with the default the code ships.
//
// ⛔ WHY RESOLUTION AND NOT A DATA MIGRATION: BREAKDOWN_CATALOG has carried `{key:'age', platform:'meta'}` since
// it was written. Reading it at render time makes stored-vs-default divergence stop mattering, for saved rows,
// new users and user-added cards alike, with no write to anyone's data.
//
// USAGE: node tests/guards/card-platform-resolution.guard.mjs
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return null } }
const findings = []

const TYPES = 'src/components/redesign/cards/card-types.ts'
const HOOK = 'src/components/redesign/cards/useCardData.ts'
const FN = 'resolveCardPlatform'
const types = read(TYPES)
const hook = read(HOOK)
if (types === null) findings.push(`${TYPES} unreadable — the resolution cannot be driven, which is a broken instrument and never a pass.`)
if (hook === null) findings.push(`${HOOK} unreadable — the call site cannot be checked.`)

// ── LIFT THE REAL CATALOG + THE REAL RESOLVER FROM THE SHIPPED SOURCE ────────────────────────────────────
// The catalog is the thing under test as much as the function is: a resolver reading a catalog that has lost
// its platforms would pass a reimplementation and fail in production.
// ⛔ THE VALUE'S BRACKET IS FOUND AFTER THE `=`, NOT AFTER THE NAME: the declaration's TYPE is `BreakdownOption[]`,
// so bracket-matching from the name returns the empty type brackets and stops — a truncated lift that surfaces
// downstream as "Missing initializer in const declaration" rather than as the real problem.
function extractBlock(source, header, openCh, closeCh) {
  const at = source.indexOf(header)
  if (at < 0) return null
  const eq = source.indexOf('=', at)
  if (eq < 0) return null
  const open = source.indexOf(openCh, eq)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === openCh) depth++
    else if (source[i] === closeCh) { depth--; if (depth === 0) return source.slice(at, i + 1) }
  }
  return null
}
function extractFn(source, name) {
  const at = source.indexOf(`export function ${name}(`)
  if (at < 0) return null
  const closeParen = source.indexOf(')', at)
  if (closeParen < 0) return null
  const open = source.indexOf('{', closeParen)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(at, i + 1) }
  }
  return null
}
// Named annotations and the one optional-param marker. NEVER a blanket `: { … }` strip — it cannot tell a type
// from an object literal, and this catalog is nothing but object literals.
const stripTypes = (s) => s
  .replace(/:\s*BreakdownOption\s*\|\s*undefined/g, '')
  .replace(/:\s*BreakdownOption\[\]/g, '')
  .replace(/:\s*CardConfig\b/g, '')
  .replace(/:\s*string\s*\|\s*undefined/g, '')
  .replace(/\(\s*(\w+)\?\s*:\s*string\s*\)/g, '($1)')

let mod = null
if (types !== null) {
  const catalog = extractBlock(types, 'export const BREAKDOWN_CATALOG', '[', ']')
  const helper = types.split('\n').find((l) => l.startsWith('export const breakdownOption'))
  const fn = extractFn(types, FN)
  if (!catalog) findings.push(`(a) could not lift BREAKDOWN_CATALOG from ${TYPES} — the guard cannot drive a resolution against a catalog it cannot read.`)
  if (!helper) findings.push(`(a) could not lift breakdownOption from ${TYPES}.`)
  if (!fn) {
    findings.push(`(a) ${TYPES} exports no pure \`${FN}\` — the platform a card requests is decided INLINE in the hook's query construction (${HOOK}), where no guard can drive it. That is exactly how fde8122 shipped green with the card still broken: a rule inside a hook body is a rule nobody can prove.`)
  }
  if (catalog && helper && fn) {
    const tmp = mkdtempSync(join(tmpdir(), 'loramer-card-platform-'))
    try {
      const file = join(tmp, 'resolve.mjs')
      writeFileSync(file, [catalog, helper, fn].map(stripTypes).join('\n\n') + '\n')
      mod = await import(pathToFileURL(file).href)
    } catch (e) {
      findings.push(`(a) could not import the lifted catalog + ${FN} — ${e?.message}. A leg that cannot run is not a pass.`)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }
}

// ── (a) THE OBJECT THAT IS ACTUALLY IN THE DATABASE ──────────────────────────────────────────────────────
// Verbatim from dashboard_layouts, cotebrandmarketing@gmail.com / page_key='overview' /
// client_id='c39ee088-c635-4bfe-b308-43fe9640f1ca', read 2026-08-16. Not the default — the STORED card.
const STORED_D_AGE = {
  id: 'd-age',
  viz: 'bar',
  kind: 'breakdown',
  topN: 8,
  title: 'Age (Meta)',
  rankBy: 'spend',
  dateRange: 'LAST_30_DAYS',
  breakdownType: 'age',
}
if (mod && typeof mod[FN] === 'function') {
  const got = mod[FN](STORED_D_AGE)
  if (got !== 'meta') {
    findings.push(`(a) ${FN}(<the stored d-age card, no platform field>) returned ${JSON.stringify(got)} — expected 'meta'. This exact object is what the engine loads for a real user, and with no platform the request omits it and metrics-query.ts:586-589 renders its refusal onto the card: 'breakdownType "age" is captured on multiple platforms (google, meta); pass platform to choose one.'`)
  }
  // An explicitly-set card must NEVER be overridden by the catalogue — the stored value is the user's, the
  // catalogue is only the fallback for a card that never said.
  const explicit = mod[FN]({ ...STORED_D_AGE, platform: 'google' })
  if (explicit !== 'google') {
    findings.push(`(a) ${FN}(<d-age with platform:'google'>) returned ${JSON.stringify(explicit)} — an explicit platform must win over the catalogue, or a user who chose one silently gets another.`)
  }
  // A catalogue entry with no platform (device, hour) must resolve to NOTHING, so the request stays silent and
  // the resolver's honest refusal survives. Inventing a platform here would be the guess we refused to make.
  for (const bt of ['device', 'hour']) {
    const blank = mod[FN]({ id: 'x', kind: 'breakdown', viz: 'table', dateRange: 'LAST_30_DAYS', breakdownType: bt })
    if (blank !== undefined) {
      findings.push(`(a) ${FN}({breakdownType:'${bt}'}) returned ${JSON.stringify(blank)} — that catalogue entry declares no platform, so the resolution must yield undefined and let queryBreakdown refuse. A resolver that fills the blank is the server-side guess this design rejected.`)
    }
  }
  const unknown = mod[FN]({ id: 'x', kind: 'breakdown', viz: 'table', dateRange: 'LAST_30_DAYS', breakdownType: 'not_a_family' })
  if (unknown !== undefined) {
    findings.push(`(a) ${FN}({breakdownType:'not_a_family'}) returned ${JSON.stringify(unknown)} — an unknown family has no catalogue answer and must resolve to undefined.`)
  }
  // The catalogue is under test too: the fallback is worthless if the entries lose their platforms.
  const age = mod.BREAKDOWN_CATALOG?.find((b) => b.key === 'age')
  if (age?.platform !== 'meta') {
    findings.push(`(a) BREAKDOWN_CATALOG's 'age' entry declares platform ${JSON.stringify(age?.platform)} — the resolution reads the catalogue, so an entry that loses its platform silently reopens this defect.`)
  }
}

// ── (b) THE HOOK MUST USE THE RESOLUTION, AND REFETCH WHEN IT CHANGES ────────────────────────────────────
// Text-based and stated as such: leg (a) proves the RULE, this proves the hook did not keep a private copy.
if (hook !== null) {
  const body = hook.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  if (!body.includes(`${FN}(`)) {
    findings.push(`(b) ${HOOK} never calls ${FN}( — it sends cfg.platform alone, which is absent on every one of the 37 stored breakdown cards in production. Whatever leg (a) proves, the hook does not run it.`)
  }
  // The resolved value is a function of cfg.platform AND cfg.breakdownType; both must be dependencies or a card
  // edited from one family to another keeps the previous family's platform.
  const deps = body.slice(body.lastIndexOf('}, [')).split('\n')[0]
  for (const d of ['cfg.platform', 'cfg.breakdownType']) {
    if (!deps.includes(d)) {
      findings.push(`(b) ${HOOK}'s effect dependency list does not include ${d} (${deps.trim()}) — the resolved platform depends on it, so a change would not refetch.`)
    }
  }
}

if (findings.length) {
  console.error(`\n✗ CARD-PLATFORM-RESOLUTION FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  console.error(`  LIMIT: this proves the RESOLUTION and that the hook runs it. It does not call the network, so whether the warehouse then returns rows is the route's job — and whether the card DRAWS them is Gate-B on a real phone.`)
  process.exit(1)
}
console.log(`[card-platform-resolution] PASS — the REAL catalogue and ${FN} were lifted from ${TYPES} and driven with the VERBATIM stored d-age card from production (no platform field): it resolves to 'meta'. An explicit platform still wins, a catalogue entry with no platform resolves to undefined so queryBreakdown's refusal survives, an unknown family resolves to undefined, and ${HOOK} calls the resolution with both inputs in its dependency list. LIMIT: the resolution only — the network read is the route's job and the drawn bars are Gate-B.`)
