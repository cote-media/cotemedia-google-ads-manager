#!/usr/bin/env node
// LORAMER_GOOGLE_AD_NAME_COMPOSE_V1 — GUARD. ONE COMPOSITION, ONE HOME; THE WRITER CANNOT STAMP '' WHEN
// MATERIAL WAS SERVED; JUNK LOSES AND REAL VENDOR NAMES WIN.
//
// ⛔ THE DEFECT (★GOOGLE-AD-ENTITY-NAMES-MISSING, VENDOR-EMPTY by probe 2026-08-15): Google serves no ad.name
// for search-type ads, so `ad.name || ''` stored '' on 22,607 ad-grain rows while the SAME response carried
// the RSA headlines a display name composes from. The live surface had composed names since PROJECT_3; the
// warehouse never did — two answers to "what is this ad called" in one product.
//
// LEGS:
//  (a)  ONE HOME — the three consumers (live route, forward intelligence mapper, backfill writer) all import
//       composeGoogleAdName, and none re-derives a local ' | ' join over headlines.
//  (a2) The history-repair script's inline .mjs copy stays byte-equivalent in behavior — driven, not diffed.
//  (b)  BEHAVIOR, driven on the compiled function: RSA composition beats junk vendor names; ETA composes;
//       real vendor names (video/image — no material) WIN; nothing-at-all → ''.
//  (c)  THE WRITER'S GAQL selects the material — a widened extract with an unwidened SELECT silently
//       composes '' forever (the material can't ride a row it was never asked onto).
//  (d)  check-lora-named-entity stays live truth: still in the check:data roster, not baselined away.
//
// HERMETIC: transpiles + drives the real TS function; no DB, no network. LORAMER_GUARD_ROOT overrides.
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const require_ = createRequire(resolve(process.cwd(), 'package.json'))
const findings = []
const check = (ok, msg) => { if (!ok) findings.push(msg) }
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch { return null } }
const codeOnly = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

const HOME = 'src/lib/google-ad-display-name.ts'
const CONSUMERS = [
  ['src/app/api/google/ads/route.ts', 'the live surface'],
  ['src/lib/intelligence/google-intelligence.ts', 'the forward twin (feeds google-metrics-row pushRow(\'ad\'))'],
  ['src/lib/backfill/google-adgroup-ad-backfill.ts', 'the ad-grain backfill/drain writer'],
]
const home = read(HOME)
if (!home) { console.error(`[google-ad-name-compose] FAIL — ${HOME} is missing; the one home does not exist.`); process.exit(1) }

// ── (a) ONE HOME ────────────────────────────────────────────────────────────────────────────────────────
for (const [rel, why] of CONSUMERS) {
  const src = read(rel)
  if (!src) { findings.push(`(a) ${rel} unreadable — cannot prove ${why} uses the shared composition.`); continue }
  check(/composeGoogleAdName/.test(codeOnly(src)),
    `(a) ${rel} (${why}) does not call composeGoogleAdName — the composition has grown a second home or none.`)
  // No local re-derivation: a headlines slice-join outside the home is the drift this leg exists to stop.
  check(!/headlines[\s\S]{0,80}?\.join\(' \| '\)/.test(codeOnly(src)),
    `(a) ${rel} re-derives a local headlines join — one composition, one home.`)
}

// ── transpile the home and drive it ─────────────────────────────────────────────────────────────────────
const out = mkdtempSync(join(tmpdir(), 'loramer-adname-'))
const tsc = join(process.cwd(), 'node_modules', '.bin', 'tsc')
spawnSync(tsc, [resolve(ROOT, HOME), '--target', 'es2020', '--module', 'commonjs', '--outDir', out, '--skipLibCheck'], { encoding: 'utf8' })
let mod
try { mod = require_(join(out, 'google-ad-display-name.js')) } catch (e) {
  rmSync(out, { recursive: true, force: true })
  console.error(`[google-ad-name-compose] FAIL — could not load the compiled composition (${e.message}). BROKEN INSTRUMENT, not a pass.`)
  process.exit(2)
}
const compose = mod.composeGoogleAdName

// ── (b) BEHAVIOR — the adversary's cases, driven ────────────────────────────────────────────────────────
{
  // Junk vendor name LOSES to RSA composition (the probe's literal shapes).
  const rsaJunk = compose({ name: 'Ad 1', responsive_search_ad: { headlines: [{ text: "Don't FOMO, Foam-Oh" }, { text: 'More Pieces than any other' }, { text: 'ONLY sofa with personalization' }, { text: 'Free Shipping. Made in the USA' }] } })
  check(rsaJunk === "Don't FOMO, Foam-Oh | More Pieces than any other | ONLY sofa with personalization",
    `(b) RSA composition wrong or junk won: got ${JSON.stringify(rsaJunk)} — expected the first 3 headlines joined ' | ' (byte-compatible with the live surface since PROJECT_3).`)
  // ETA composes part1 | part2.
  const eta = compose({ name: '', expanded_text_ad: { headline_part1: 'FoamOh Headboards for sale', headline_part2: 'Made in the USA' } })
  check(eta === 'FoamOh Headboards for sale | Made in the USA', `(b) ETA composition wrong: ${JSON.stringify(eta)}.`)
  // Real vendor name WINS when no material exists (video/image/display-upload — the vendor-named types).
  const video = compose({ name: '(Ad 1) auto-generated video ad' })
  check(video === '(Ad 1) auto-generated video ad',
    `(b) a vendor name with no material did not win (got ${JSON.stringify(video)}) — video/image/display names are the only identity served and must survive.`)
  // Nothing at all → '' (absence stays absence; nothing is invented).
  check(compose({}) === '' && compose(null) === '', `(b) empty input did not compose to '' — a name from nothing is an invention.`)
  // Whitespace-only headlines must not produce ' | ' soup.
  check(compose({ responsive_search_ad: { headlines: [{ text: '  ' }, { text: '' }] }, name: 'Real Name' }) === 'Real Name',
    `(b) whitespace-only headlines beat a real vendor name — blank material is not material.`)
}

// ── (a2) THE REPAIR SCRIPT'S INLINE COPY — driven equivalent, not diffed ────────────────────────────────
{
  const script = read('scripts/repair-google-ad-names.mjs')
  if (!script) findings.push('(a2) scripts/repair-google-ad-names.mjs is missing — the history repair has no executor.')
  else {
    const m = script.match(/const composeGoogleAdName = \(ad\) => \{[\s\S]*?\n\}/)
    if (!m) findings.push('(a2) could not slice the repair script\'s inline composition to drive it.')
    else {
      let inline
      try { inline = new Function(`return ${m[0].replace('const composeGoogleAdName = ', '')}`)() } catch (e) { findings.push(`(a2) inline composition does not evaluate: ${e.message}`) }
      if (inline) {
        const cases = [
          { name: 'Ad 1', responsive_search_ad: { headlines: [{ text: 'A' }, { text: 'B' }, { text: 'C' }, { text: 'D' }] } },
          { name: '', expanded_text_ad: { headline_part1: 'P1', headline_part2: 'P2' } },
          { name: 'Video Name' }, {}, null,
        ]
        for (const c of cases) check(inline(c) === compose(c),
          `(a2) repair-script composition diverges from the home on ${JSON.stringify(c).slice(0, 80)}: ${JSON.stringify(inline(c))} vs ${JSON.stringify(compose(c))}.`)
      }
      check(/--execute/.test(script) && /LORAMER_REPAIR_CONFIRM/.test(script),
        '(a2) the repair script lost its double gate (--execute + LORAMER_REPAIR_CONFIRM) — an ungated history UPDATE.')
    }
  }
}

// ── (c) THE WRITER'S GAQL CARRIES THE MATERIAL ─────────────────────────────────────────────────────────
{
  const w = read('src/lib/backfill/google-adgroup-ad-backfill.ts') || ''
  const gaql = (w.match(/gaql: `SELECT[^`]*FROM ad_group_ad[^`]*`/) || [''])[0]
  check(/responsive_search_ad\.headlines/.test(gaql) && /expanded_text_ad\.headline_part1/.test(gaql),
    `(c) the ad-grain writer's GAQL no longer selects the headline material — composeGoogleAdName will compose '' forever, silently, because the material never rides the row.`)
}

// ── (d) THE LIVE CHECK STAYS THE TRUTH ─────────────────────────────────────────────────────────────────
{
  const roster = read('scripts/run-checkdata.mjs') || ''
  check(/check-lora-named-entity/.test(roster),
    '(d) check-lora-named-entity left the check:data roster — the standing TRUE red was baselined away instead of fixed.')
}

rmSync(out, { recursive: true, force: true })
if (findings.length) {
  console.error('\n❌ LORAMER_GOOGLE_AD_NAME_COMPOSE_V1 FAILED\n')
  findings.forEach((f) => console.error('  • ' + f))
  console.error('')
  process.exit(1)
}
console.log('google-ad-name-compose.guard: PASS — one composition home imported by all three consumers, junk loses / real vendor names win / nothing composes from nothing, the repair copy matches by drive, the writer GAQL carries the material, and the live check stays rostered.')
