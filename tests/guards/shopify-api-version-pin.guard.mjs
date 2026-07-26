#!/usr/bin/env node
// LORAMER_SHOPIFY_VERSION_PIN_GUARD_V1
//
// THE FAILURE MODE THIS EXISTS FOR: a PARTIAL FLIP. The Shopify API version is pinned in FOUR separate
// files, each with its own `const GRAPHQL_API_VERSION`. Flipping three of four is silent — every call still
// succeeds, because Shopify serves whatever version each URL names. The result is two versions answering the
// same fleet, with the money path on one and the OAuth path on another, and NOTHING errors. That is the exact
// shape of every silent-substitution defect in this repo.
//
// It also guards the second half of the same lesson: Shopify does NOT reject a sunset version, it FALLS
// FORWARD to the oldest accessible stable one and only says so in the X-Shopify-API-Version response header.
// So a pin is a claim, not a fact — and the code must at least make the claim consistently, and must observe
// what actually answers (LORAMER_SHOPIFY_VERSION_OBSERVED_V1).
//
// FOUR LEGS:
//   1. Every `GRAPHQL_API_VERSION` declaration in src/ carries the SAME literal.
//   2. At least the four known pin sites are present — so deleting one to make the guard pass fails instead.
//   3. No fetch URL hardcodes /admin/api/<version>/ — the constant must be the only source.
//   4. The served-version instrument still exists and is CALLED (not merely defined).
//
// AUTHORITATIVE SOURCE = THE CODE. HERMETIC: filesystem reads only, no network, no DB.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join, relative } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SRC = resolve(ROOT, 'src')
const failures = []
const fail = (m) => failures.push(m)

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p)
  }
  return out
}

const files = walk(SRC)
const strip = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

// ── 1 + 2. ONE VERSION ACROSS EVERY PIN SITE ──────────────────────────────────────────────────────────────
const pins = []
for (const f of files) {
  const code = strip(readFileSync(f, 'utf8'))
  for (const m of code.matchAll(/GRAPHQL_API_VERSION\s*=\s*['"]([^'"]+)['"]/g)) {
    pins.push({ file: relative(ROOT, f), version: m[1] })
  }
}

if (pins.length === 0) {
  fail('NO PIN FOUND: not one `GRAPHQL_API_VERSION = "..."` declaration exists in src/. Either the constant was renamed (update this guard with it) or the version is now inlined at call sites, which is the ungovernable shape this guard exists to prevent.')
} else {
  const versions = [...new Set(pins.map((p) => p.version))]
  if (versions.length > 1) {
    const detail = pins.map((p) => `${p.file} → '${p.version}'`).join(' · ')
    fail(`PARTIAL FLIP: ${versions.length} different Shopify API versions pinned across ${pins.length} sites — ${detail}. Every call still succeeds, so nothing will surface this: the money path and the OAuth path would be answered by DIFFERENT versions of the API. Pin them together or not at all.`)
  }
}

// The four sites we know carry a pin. If one disappears, that is either a real refactor (update this list) or
// a pin quietly deleted — and a deleted pin means the URL falls back to whatever is inlined.
const EXPECTED_PIN_SITES = [
  'src/lib/intelligence/shopify-intelligence.ts',
  'src/lib/backfill/shopify-dimensional-backfill.ts',
  'src/app/api/shopify/daily/route.ts',
  'src/app/api/shopify/callback/route.ts',
]
const pinned = new Set(pins.map((p) => p.file))
const missing = EXPECTED_PIN_SITES.filter((f) => !pinned.has(f))
if (missing.length) {
  fail(`PIN SITE MISSING: ${missing.join(', ')} no longer declares GRAPHQL_API_VERSION. If that file legitimately stopped calling Shopify, remove it from EXPECTED_PIN_SITES in this guard — deliberately, in the same commit. Silently losing a pin site is how a partial flip hides.`)
}

// ── 3. NO HARDCODED VERSION IN A URL ──────────────────────────────────────────────────────────────────────
for (const f of files) {
  const code = strip(readFileSync(f, 'utf8'))
  for (const m of code.matchAll(/admin\/api\/(\d{4}-\d{2})\//g)) {
    fail(`HARDCODED VERSION IN A URL: ${relative(ROOT, f)} contains \`admin/api/${m[1]}/\` as a literal. A flip that greps for the constant will not find it, so this call would keep talking to ${m[1]} forever. Build the URL from GRAPHQL_API_VERSION.`)
  }
}

// ── 4. THE SERVED-VERSION INSTRUMENT MUST SURVIVE ─────────────────────────────────────────────────────────
// A pin is a claim about what we ASK for. Only the response header says what ANSWERED. Deleting this
// instrument returns us to 2026-07-25, when the question "what version is serving us" had no answer at all.
const intel = resolve(ROOT, 'src/lib/intelligence/shopify-intelligence.ts')
let intelCode = ''
try { intelCode = readFileSync(intel, 'utf8') } catch { fail('CANNOT READ shopify-intelligence.ts — treat as failure.') }
if (intelCode) {
  const bare = strip(intelCode)
  if (!/x-shopify-api-version/i.test(bare)) {
    fail("SERVED-VERSION INSTRUMENT GONE: nothing reads the `x-shopify-api-version` response header. Shopify falls forward off a sunset version silently, so without this the pin is an unverifiable claim.")
  }
  if (!/noteServedApiVersion\s*\(\s*endpoint\s*,\s*res\s*\)/.test(bare)) {
    fail('SERVED-VERSION INSTRUMENT NOT CALLED: the helper exists but is not invoked on the response inside shopifyGraphQL. A defined-but-unused instrument observes nothing — the same class as a fetchErrors field nothing renders.')
  }
}

if (failures.length) {
  console.error('\n❌ LORAMER_SHOPIFY_VERSION_PIN_GUARD_V1 FAILED\n')
  failures.forEach((f) => console.error('  • ' + f))
  console.error('')
  process.exit(1)
}
console.log(`shopify-api-version-pin.guard: PASS — ${pins.length} pin sites all on '${pins[0].version}', no hardcoded version URLs, served-version instrument present and called.`)
