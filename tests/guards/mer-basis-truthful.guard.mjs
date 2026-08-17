#!/usr/bin/env node
// LORAMER_MER_BASIS_TRUTHFUL_V1 — THE MER CARD MUST NAME THE REVENUE IT ACTUALLY DIVIDED.
//
// ⛔ OBSERVED ON DEVICE 2026-08-16 (Gate-B, The Escential Group): MER read 0.05× under the fixed subtitle
// "Marketing Efficiency Ratio · blended revenue ÷ all ad spend". The ARITHMETIC was right — measured from the
// warehouse for Jun 16→Aug 3: Shopify net revenue $367.75 ÷ (google $3,816.99 + meta $3,693.60) = 0.049. The
// SUBTITLE was the lie: revenue-settle.ts:59-61 is store-first with a GA FALLBACK and NEVER a sum ("blended"),
// and this client also had $322.75 of GA revenue that the settle deliberately discarded. A number whose basis
// is misdescribed is worse than no number — the reader trusts it and reasons from the wrong denominator set.
//
// ⛔ WHY A FUNCTION AND NOT A STRING: a static subtitle cannot know which source won, and the source is decided
// per client per window. The basis line must be DERIVED from the settle's own revenueSource, which is why the
// label lives next to the rule that produces it (revenue-settle.ts) rather than in the card catalogue.
//
// ⛔ BEHAVIOURAL — the real label function is LIFTED from the shipped source and CALLED (QUEUE:1015;
// checkdata-verdict-line.guard.mjs:126-160). Leg (c) is text-based and says so.
//
// USAGE: node tests/guards/mer-basis-truthful.guard.mjs
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return null } }
const findings = []

const SRC = 'src/lib/next/revenue-settle.ts'
const VIZ = 'src/components/redesign/cards/CardViz.tsx'
const HOOK = 'src/components/redesign/cards/useCardData.ts'
const TYPES = 'src/components/redesign/cards/card-types.ts'
const FN = 'revenueBasisLine'
const src = read(SRC), viz = read(VIZ), hook = read(HOOK), types = read(TYPES)
for (const [p, s] of [[SRC, src], [VIZ, viz], [HOOK, hook], [TYPES, types]]) {
  if (s === null) findings.push(`${p} unreadable — a leg that cannot run is not a pass.`)
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
// SIGNATURE ONLY — never strip the body: this function returns TEMPLATE STRINGS full of `word: value` shapes
// that a blanket type-strip cannot tell from an annotation.
function stripSignatureTypes(fn) {
  const closeParen = fn.indexOf(')')
  const bodyOpen = fn.indexOf('{', closeParen)
  if (closeParen < 0 || bodyOpen < 0) return fn
  const params = fn.slice(0, closeParen + 1).replace(/:\s*[\w.'|\s]+?(?=[,)])/g, '')
  const ret = fn.slice(closeParen + 1, bodyOpen).replace(/:\s*[\w.<>[\]| ]+/g, '')
  return params + ret + fn.slice(bodyOpen)
}

let mod = null
if (src !== null) {
  const fn = extractFn(src, FN)
  if (!fn) {
    findings.push(`(a) ${SRC} exports no \`${FN}\` — the MER card's basis line is a STATIC string (${TYPES} subtitle), which cannot know whether the store or the GA fallback won. Observed 2026-08-16: it said "blended revenue" over a store-only figure.`)
  } else {
    const tmp = mkdtempSync(join(tmpdir(), 'loramer-mer-basis-'))
    try {
      const file = join(tmp, 'basis.mjs')
      writeFileSync(file, stripSignatureTypes(fn) + '\n')
      mod = await import(pathToFileURL(file).href)
    } catch (e) {
      findings.push(`(a) could not import the lifted ${FN} — ${e?.message}. A leg that cannot run is not a pass.`)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }
}

// ── (a) THE LABEL MUST FOLLOW THE SOURCE THAT WON ───────────────────────────────────────────────────────
if (mod && typeof mod[FN] === 'function') {
  const store = mod[FN]('store', 'shopify')
  if (!store || !/shopify/i.test(store)) {
    findings.push(`(a) ${FN}('store','shopify') returned ${JSON.stringify(store)} — the store that supplied the numerator must be NAMED. This is the exact live case: The Escential Group's MER divides Shopify net revenue.`)
  }
  if (store && /blend/i.test(store)) {
    findings.push(`(a) ${FN}('store','shopify') still calls the revenue ${JSON.stringify(store)} — the settle NEVER sums store and GA (revenue-settle.ts:59-61), so "blended" is false however the sources line up.`)
  }
  const ga = mod[FN]('ga', null)
  if (!ga || !/analytics|\bGA\b/i.test(ga)) {
    findings.push(`(a) ${FN}('ga', null) returned ${JSON.stringify(ga)} — when the store capture is absent or failing the settle falls back to GA, and the card must say so rather than keep claiming a store.`)
  }
  if (ga && /shopify|woo/i.test(ga)) {
    findings.push(`(a) ${FN}('ga', null) names a STORE (${JSON.stringify(ga)}) while the GA fallback supplied the number — that is the substitution the completeness layer exists to surface, not to hide.`)
  }
  const multi = mod[FN]('store', null)
  if (multi && /shopify|woocommerce/i.test(multi)) {
    findings.push(`(a) ${FN}('store', null) named a specific store (${JSON.stringify(multi)}) with no store identified — a multi-store client sums BOTH into the numerator, so naming one of them is a false attribution.`)
  }
  for (const none of ['none', null, undefined]) {
    if (mod[FN](none, null) !== null) {
      findings.push(`(a) ${FN}(${JSON.stringify(none)}, null) returned ${JSON.stringify(mod[FN](none, null))} — with no revenue source there is no basis to state; it must return null so the caller falls back rather than invent one.`)
    }
  }
}

// ── (b) THE HOOK MUST CARRY THE SOURCE THE ROUTE ALREADY RETURNS ────────────────────────────────────────
// client-metrics/route.ts:154 has returned revenueSource all along; the hook dropped it on the floor, which is
// why the card had nothing truthful to say. Text-based and stated as such.
if (hook !== null) {
  const body = hook.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  if (!/revenueSource/.test(body)) {
    findings.push(`(b) ${HOOK} never mentions revenueSource — the route returns it (client-metrics/route.ts:154) and the hook discards it, so the card cannot name its own numerator.`)
  }
}

// ── (c) THE CARD MUST RENDER THE DERIVED BASIS, AND THE STATIC ONE MUST STOP CLAIMING "BLENDED" ─────────
if (viz !== null) {
  const body = viz.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  if (!body.includes(`${FN}(`)) {
    findings.push(`(c) ${VIZ} never calls ${FN}( — whatever leg (a) proves about that rule, the card does not run it.`)
  }
}
// Comments are stripped first: the fix's own comment EXPLAINS why "blended revenue" was wrong, and a guard that
// cannot tell a quotation from an assertion punishes the explanation — a banked hazard in this repo.
const typesCode = types === null ? '' : types.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
if (types !== null && /blended revenue/i.test(typesCode)) {
  findings.push(`(c) ${TYPES} still carries the subtitle "blended revenue" — it is the FALLBACK the card shows when no source is known, so it must not assert a blend the settle cannot produce.`)
}

if (findings.length) {
  console.error(`\n✗ MER-BASIS-TRUTHFUL FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  console.error(`  LIMIT: this asserts the BASIS LINE only. The MER VALUE is out of scope on purpose — store-first with a GA fallback is settled law (revenue-settle.ts header) and this guard must never be read as blessing or challenging the arithmetic.`)
  process.exit(1)
}
console.log(`[mer-basis-truthful] PASS — the REAL ${FN} was lifted from ${SRC} and driven: a store numerator names its store, the GA fallback names GA and never a store, an unidentified store stays generic, and no source returns null so the card falls back. ${HOOK} carries revenueSource and ${VIZ} renders the derived basis. LIMIT: the label only — the arithmetic is settled law and is not asserted here.`)
