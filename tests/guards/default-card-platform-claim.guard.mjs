#!/usr/bin/env node
// LORAMER_DEFAULT_CARD_PLATFORM_CLAIM_V1 — A CARD WHOSE TITLE NAMES A PLATFORM MUST REQUEST THAT PLATFORM.
//
// ⛔ OBSERVED ON DEVICE 2026-08-16 (Gate-B, iPhone, The Escential Group): the default Overview's "Age (Meta)"
// card rendered, to a paying customer, the sentence
//     breakdownType "age" is captured on multiple platforms (google, meta); pass platform to choose one.
// The message is CORRECT and the refusal behind it is correct — metrics-query.ts:586-589 will not guess when a
// breakdown family exists on two platforms, and this client genuinely has age rows on BOTH (google 5,541 /
// meta 11,556, measured 2026-08-16). The defect is that the card's TITLE claimed a platform its REQUEST never
// stated (card-types.ts d-age had no platform field; useCardData sent none; the route read none).
//
// ⛔ THE LATENT HALF, WHICH IS WHY THIS GUARD IS BROADER THAN THE ONE BUG: "Keywords (Google)" and "Search
// terms (Google)" worked only because those families happen to live on ONE platform today, so the resolver
// could infer what the request failed to say. The day a second platform captures keywords, they break exactly
// as Age did — with no code change and no warning. A title is a promise; this guard makes the request keep it.
//
// ⛔ BEHAVIOURAL, NOT A GREP (QUEUE:1015; checkdata-verdict-line.guard.mjs:126-160): the default views are
// LIFTED from the shipped source and CALLED, so what is checked is the card set the product actually builds.
//
// USAGE: node tests/guards/default-card-platform-claim.guard.mjs
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return null } }
const findings = []

const SRC = 'src/components/redesign/cards/card-types.ts'
const src = read(SRC)
if (src === null) findings.push(`${SRC} unreadable — the default views cannot be built, which is a broken instrument and never a pass.`)

// The body brace is the first `{` AFTER the param list's `)` — a return type or an inline param type can put a
// brace earlier, and matching from there returns the TYPE and stops (a silently truncated lift).
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
// Named type annotations only — never a `: { … }` strip, which cannot tell a type from an object literal and
// would mangle these card literals into a syntax error the guard would then report as a broken import.
const stripTypes = (s) => s
  .replace(/:\s*CardConfig\[\]/g, '')
  .replace(/:\s*GridItem\[\]/g, '')
  .replace(/:\s*SavedView/g, '')
  .replace(/(\(\s*\w+)\s*:\s*string/g, '$1')

let mod = null
if (src !== null) {
  const parts = ['defaultOverviewView', 'storeDefaultView'].map((n) => extractFn(src, n)).filter(Boolean)
  if (parts.length !== 2) {
    findings.push(`could not lift both default views from ${SRC} (got ${parts.length}/2) — the guard cannot check a card set it cannot build.`)
  } else {
    const tmp = mkdtempSync(join(tmpdir(), 'loramer-default-cards-'))
    try {
      const file = join(tmp, 'views.mjs')
      writeFileSync(file, parts.map(stripTypes).join('\n\n') + '\n')
      mod = await import(pathToFileURL(file).href)
    } catch (e) {
      findings.push(`could not import the lifted default views — ${e?.message}. A leg that cannot run is not a pass.`)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }
}

// A title names a platform → the card must REQUEST it. Order matters: "Google Analytics" is GA, not Google.
const CLAIMS = [
  { re: /google analytics|\bGA\b/i, platform: 'ga', kindOfField: 'platform' },
  { re: /\bmeta\b|\bfacebook\b/i, platform: 'meta', kindOfField: 'platform' },
  { re: /\bgoogle\b/i, platform: 'google', kindOfField: 'platform' },
  { re: /\bshopify\b/i, platform: 'shopify', kindOfField: 'storePlatform' },
  { re: /\bwoocommerce\b|\bwoo\b/i, platform: 'woocommerce', kindOfField: 'storePlatform' },
]
const claimOf = (title) => CLAIMS.find((c) => c.re.test(title || '')) || null

function checkView(viewName, view) {
  let claimed = 0
  for (const c of view.cards || []) {
    const claim = claimOf(c.title)
    if (!claim) continue
    claimed += 1
    const got = claim.kindOfField === 'storePlatform' ? c.storePlatform : c.platform
    if (got !== claim.platform) {
      findings.push(`${viewName} card "${c.id}" is titled ${JSON.stringify(c.title)} but its ${claim.kindOfField} is ${JSON.stringify(got ?? null)} — the title promises ${claim.platform} and the request does not say so. Either the request states the platform or the title stops claiming one; a resolver that has to infer it will one day infer differently (metrics-query.ts:586-589 refuses to, and renders that refusal on the card).`)
    }
  }
  return claimed
}

let claimedTotal = 0
if (mod?.defaultOverviewView && mod?.storeDefaultView) {
  claimedTotal += checkView('defaultOverviewView()', mod.defaultOverviewView())
  claimedTotal += checkView("storeDefaultView('shopify')", mod.storeDefaultView('shopify'))
  claimedTotal += checkView("storeDefaultView('woocommerce')", mod.storeDefaultView('woocommerce'))
}

if (findings.length) {
  console.error(`\n✗ DEFAULT-CARD-PLATFORM-CLAIM FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  console.error(`  LIMIT: this checks the BUILT-IN default views only. A card a user adds by hand is the config panel's job, and whether the platform then reaches the warehouse is the route's — neither is asserted here.`)
  process.exit(1)
}
console.log(`[default-card-platform-claim] PASS — the REAL default views were lifted from ${SRC} and built; ${claimedTotal} card title(s) name a platform and every one of them requests that platform explicitly. LIMIT: built-in defaults only — user-added cards and the route's handling of the field are asserted elsewhere.`)
