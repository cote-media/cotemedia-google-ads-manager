#!/usr/bin/env node
// LORAMER_SHOPIFY_CANCELLED_EXCLUDED_V1 — GUARD. Every Shopify order aggregation excludes cancelled orders.
//
// ⛔ THE DEFECT THIS PINS, AND WHAT IT IS NOT. `/api/shopify/daily` queried orders by `created_at` with NO
// status filter and never even SELECTED `cancelledAt`, so it could not have filtered if it wanted to. It
// then counted every returned order. The captured path has filtered since LORAMER_SHOPIFY_CANCELLED_
// ACCURACY_V1 (`shopify-intelligence.ts:475`, `orderNodes.filter(o => !o.cancelledAt)`), so the same client
// read two different order counts on two surfaces.
// ⛔ WHAT IT ACTUALLY COST, IN ITS THIRD AND MEASURED STATEMENT: the order count ALWAYS, average order value
// ALWAYS, and revenue SOMETIMES. Two earlier statements of this defect were wrong in the repo — "two
// revenues" (wrong) and then "count and AOV only, because a cancelled order's subtotal is $0" (also wrong,
// and generalised from SEVEN orders over five days). MEASURED 2026-08-23 across 162 cancelled orders on two
// live stores: 160 carry $0 and TWO do not, $325.00 and $316.00. ⛔ THE REUSABLE PART IS NOT THE NUMBER, IT
// IS THAT A TENDENCY MEASURED ON SEVEN ROWS WAS WRITTEN DOWN AS A LAW AND THEN CITED AS A MEASUREMENT BY
// THREE LATER DOCUMENTS. The original reading was correct; the generalisation drawn from it was not.
// The casualty that reaches a user is `revenue / orders`: right numerator, inflated denominator, so the
// legacy chart UNDERSTATED average order value — the number an owner actually acts on.
//
// ⛔ WHY A CROSS-SITE GUARD AND NOT A ONE-LINE FIX: this is a rule that must hold at EVERY place Shopify
// orders are counted, and it already failed to hold at one of two. A third aggregation site added next
// month inherits the bug unless something refuses it. Precedent copied rather than invented:
// shopify-api-version-pin.guard.mjs pins a value across its call sites the same way.
//
// TWO LEGS PER SITE, and both are required because either alone is a false green:
//   (1) the GraphQL selection REQUESTS `cancelledAt` — without it a filter is impossible, and the field's
//       absence is the actual root cause here;
//   (2) the aggregation FILTERS on it. Requesting the field and not using it is the more dangerous state:
//       it reads as handled.
//
// ⚠ WHAT THIS CANNOT SEE: whether the filter runs BEFORE the aggregation rather than after, and whether the
// vendor's `cancelledAt` is populated as we assume. Both are Gate-A facts, and the Gate-A condition is an
// ACCOUNTING IDENTITY rather than an assertion about revenue holding still:
//     revenue_before − revenue_after == Σ(currentSubtotalPriceSet of the excluded orders), to the cent.
// The weaker "revenue must be unchanged" would have PASSED on a false premise and FAILED on the two real
// non-zero cancellations. Verified exact on three stores 2026-08-23, and the corrected chart then matched
// the captured path to the cent on a fully-fetched window (Foam OH 2025-02-01→03-31, both $46,412.30).

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { SITES_BASELINE } from './shopify-cancelled-excluded.baseline.mjs'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }

// ⛔ CODE-ONLY. FOUND BY MUTATION, NOT BY READING, AND IT IS THE SECOND TIME THIS EXACT CLASS HAS BEATEN A
// GUARD IN THIS REPO (unknown-renders-honestly leg (e) matched an IMPORT PATH and stayed green while the
// emitted field was deleted). Legs (b) and (c) below search for `cancelledAt` and for `!o.cancelledAt` — and
// THIS GUARD'S OWN FIX WROTE BOTH SPELLINGS INTO A COMMENT IN THE FILE IT GUARDS. Mutation M1: delete the
// real filter, keep the comment ⇒ the guard PASSED. A guard whose subject can satisfy it by DESCRIBING the
// rule is not a guard. Comments are stripped before those two legs run; leg (a) deliberately still reads the
// whole file, because there the question is whether the field is mentioned AT ALL.
const codeOnly = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')                       // block comments
  .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l))     // whole-line // and continuation *
  .join('\n')

// The known Shopify ORDER-AGGREGATION sites. A site is a file that pages `orders(` from the Admin GraphQL
// API and then counts or sums the nodes. Named explicitly rather than discovered, so a new site is a
// deliberate addition to this list — and leg (c) below catches one that is added without being listed.
const SITES = [
  { file: 'src/app/api/shopify/daily/route.ts', why: 'the LEGACY dashboard chart — orders, revenue and avgOrderValue per day' },
  { file: 'src/lib/intelligence/shopify-intelligence.ts', why: 'the captured path — account totals, breakdowns and the money surface' },
]

for (const { file, why } of SITES) {
  const src = read(file)
  if (!src) { findings.push(`(a) ${file} is unreadable — ${why}`); continue }
  if (!/cancelledAt/.test(src)) {
    findings.push(`(a) ${file} never mentions \`cancelledAt\` — ${why}. A site that does not REQUEST the field cannot filter on it, which is exactly how the legacy chart counted cancelled orders for months.`)
    continue
  }
  // The selection: cancelledAt must appear inside a GraphQL query block, not only in a comment or a type.
  const code = codeOnly(src)
  // ⛔ THE SELECTION, NOT MERELY THE PROXIMITY. Mutation M2 deleted `cancelledAt` from the GraphQL selection
  // and the guard STAYED GREEN: the old `orders(...{0,4000}?cancelledAt` window simply reached forward past
  // the query and matched `o.cancelledAt` in the FILTER thirty lines below — leg (b) was reading leg (c)'s
  // evidence and reporting it as its own. That is the failure this whole guard exists to prevent, committed
  // by the guard itself. Read the actual GraphQL document: the template literal that pages `orders(first:`.
  const literals = code.match(/`[^`]*`/g) || []
  const queryLiterals = literals.filter((l) => /orders\s*\(\s*first:/.test(l))
  const inQuery = queryLiterals.length > 0 && queryLiterals.some((l) => /(^|[\s{])cancelledAt(\s|$)/.test(l))
  if (!inQuery) findings.push(`(b) ${file} mentions \`cancelledAt\` but does not SELECT it in the GraphQL document that pages \`orders(first:\` — ${why}. ${queryLiterals.length ? 'The query literal is there and the field is not in it' : 'No orders(first:) query literal was found at all'}. Without the selection the vendor never sends the field, every node reads \`undefined\`, and the filter below passes 100% of orders while looking correct.`)
  // The filter: some form of `!x.cancelledAt` guarding the aggregation.
  const filters = /!\s*\w+\.cancelledAt/.test(code) || /cancelledAt\s*(===|==)\s*null/.test(code)
  if (!filters) findings.push(`(c) ${file} requests \`cancelledAt\` but never FILTERS on it — ${why}. Requesting the field and not using it is the more dangerous state: it reads as handled.`)
}

// ── (d) NO UNLISTED AGGREGATION SITE ──────────────────────────────────────────────────────────────────────
// A file that pages Shopify `orders(` and is not in SITES is a site nobody applied the rule to.
const CANDIDATES = [
  'src/app/api/shopify/daily/route.ts',
  'src/lib/intelligence/shopify-intelligence.ts',
  'src/lib/backfill/shopify-backfill.ts',
  'src/app/api/shopify/callback/route.ts',
]
const listed = new Set(SITES.map((s) => s.file))
let unlisted = 0
for (const f of CANDIDATES) {
  if (listed.has(f) || !existsSync(resolve(ROOT, f))) continue
  const src = read(f)
  if (/orders\s*\(\s*first:/.test(src) && /(\+= 1|orders\+\+|length)/.test(src)) { unlisted += 1; findings.push(`(d) ${f} pages Shopify orders and counts them but is NOT in this guard's SITES list — the cancelled rule was never applied to it, and nothing was refusing that.`) }
}
if (SITES.length !== SITES_BASELINE) {
  findings.push(`(d) the SITES list holds ${SITES.length} entries against a baseline of ${SITES_BASELINE}. A new Shopify order-aggregation site is a deliberate act: add it, prove both legs, and move the baseline in the same commit.`)
}

if (findings.length) {
  console.error(`✗ SHOPIFY-CANCELLED-EXCLUDED FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[shopify-cancelled-excluded] PASS — ${SITES.length}/${SITES_BASELINE} known order-aggregation sites both REQUEST \`cancelledAt\` and FILTER on it; no unlisted site pages and counts Shopify orders.`)
console.log(`[shopify-cancelled-excluded] LIMIT: presence and shape only. That the filter runs BEFORE the aggregation, and that the vendor populates \`cancelledAt\` as assumed, are Gate-A facts — revenue unchanged to the cent, count down by exactly the cancelled count.`)
