#!/usr/bin/env node
// LORAMER_SEARCH_TERM_UNCAPPED_V1 — A CAPTURE WRITER MAY NOT DISCARD DATA IT CANNOT COUNT.
//
// THE DEFECT THIS CLOSES. google-dimensional's forward queries carried `LIMIT 300` / `LIMIT 200` with
// `ORDER BY metrics.cost_micros DESC`. The tail was never FETCHED — not stored-then-trimmed, never
// retrieved — and Google's search-term retention is ~90 days, so each night's discarded tail became
// permanently unrecoverable three months later. MEASURED 2026-07-30: Bath Fitter returned exactly 300 on
// 30 of 30 days. Every day truncated, on the largest Google account on the fleet, for two months, and the
// only signal was a boolean nobody read. The long tail of wasted spend is the product's whole point.
//
// ⛔ THE RULE, and it is deliberately weaker than "never cap" because a cap is sometimes legitimate:
// IF a capture writer applies a row LIMIT, it MUST record the true total so the truncation is MEASURABLE.
// A cap you can measure is a trade-off. A cap you cannot measure is data loss wearing a round number —
// "300 every day" and "300 is all there was" are indistinguishable without the count, which is exactly how
// this hid.
//
// WHAT IT ASSERTS
//  (a) The FORWARD day path (fetchGoogleDimensional) applies NO GAQL LIMIT to search_term_view or
//      keyword_view. This is the regression that would silently re-lose the tail.
//  (b) Every capture writer that DOES apply a cap records the true pre-clip total. Baselined, because two
//      legitimate capped writers exist today (impression_share, conversion_action — both inherit a live
//      query's LIMIT 200 and both document it as a deliberate noise cap).
//  (c) The GoogleDimensional contract still carries the fetched counts, so a caller can always ask "how
//      much was there" rather than only "was it clipped".
//
// ⚠ HONEST LIMIT: this reasons over SOURCE TEXT — GAQL lives in template literals, so there is no way to
// evaluate it without a live API call, and the guard must run hermetically in `npm run build`. It proves a
// LIMIT is absent from the query string and that counts are recorded; it cannot prove Google returned
// everything. That needs a live pull, which is quota-gated.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (p) => { try { return readFileSync(p, 'utf8') } catch { return '' } }

// ── the capture-writer set: fetchers + backfill writers, NOT the live dashboard fetch ──────────────────
// google-intelligence.ts is EXCLUDED on purpose: it is the 15-min-cached dashboard/prompt fetch, where a
// LIMIT is a display choice and nothing is persisted from it as history.
const DIRS = ['src/lib/intelligence', 'src/lib/backfill']
const files = []
for (const d of DIRS) {
  const abs = resolve(ROOT, d)
  if (!existsSync(abs)) continue
  for (const f of readdirSync(abs)) {
    if (!f.endsWith('.ts')) continue
    if (f === 'google-intelligence.ts') continue
    const p = join(abs, f)
    if (statSync(p).isFile()) files.push([d + '/' + f, read(p)])
  }
}
if (!files.length) { console.error('[capture-limit-is-measured] FAIL — no capture writers found; the scan is broken.'); process.exit(1) }

// A file "records the total" if it exposes a fetched/total count alongside its truncation signal.
const RECORDS_TOTAL = /Fetched\s*:|Fetched\s*=|fetchedCount|rowsFetched|totalBeforeCap|\.length,\s*$/m
const BASELINE = new Set([
  // Both inherit the live query's LIMIT 200 and say so in their headers ("a logged, deliberate noise cap").
  // They ride an existing payload rather than issuing their own query, so the cap is not theirs to remove.
  'src/lib/intelligence/google-impression-share.ts',
  'src/lib/intelligence/google-conversion-action.ts',
])

const LIMIT_RE = /LIMIT\s+(\$\{[^}]+\}|\d+)/g
const capped = []
for (const [rel, src] of files) {
  const hits = [...src.matchAll(LIMIT_RE)].map((m) => m[1])
  if (!hits.length) continue
  capped.push([rel, hits])
  if (BASELINE.has(rel)) continue
  check(RECORDS_TOTAL.test(src),
    `(b) ${rel} applies a GAQL LIMIT (${hits.join(', ')}) but records NO true total — the truncation is invisible. Either drop the cap or record the pre-clip count.`)
}
// Anti-rot: a baselined file that no longer caps must leave the ledger.
for (const b of BASELINE) {
  const hit = capped.find(([rel]) => rel === b)
  check(!!hit, `(b) STALE BASELINE ${b} no longer applies a LIMIT — drop it from BASELINE. The ledger may not outlive the debt.`)
}

// ── (a) the forward day path must be UNCAPPED ──────────────────────────────────────────────────────────
const DIM = 'src/lib/intelligence/google-dimensional.ts'
const dim = read(resolve(ROOT, DIM))
check(!!dim, `${DIM} is missing.`)
if (dim) {
  // Isolate fetchGoogleDimensional (the per-day forward fetcher) from fetchGoogleDimensionalWindow.
  const startDay = dim.indexOf('export async function fetchGoogleDimensional(')
  const startWin = dim.indexOf('export async function fetchGoogleDimensionalWindow(')
  check(startDay >= 0, `(a) fetchGoogleDimensional not found — the forward writer was renamed or removed.`)
  if (startDay >= 0) {
    const end = startWin > startDay ? startWin : dim.length
    const body = dim.slice(startDay, end)
    const lim = [...body.matchAll(LIMIT_RE)].map((m) => m[1])
    check(lim.length === 0,
      `(a) fetchGoogleDimensional applies ${lim.length} GAQL LIMIT(s) [${lim.join(', ')}] — the forward search_term/keyword tail is being discarded again. Bath Fitter lost it on 30 of 30 days this way, permanently, because Google's search-term retention is ~90 days.`)
    check(/searchTermsFetched\s*:\s*searchTermRows\.length/.test(body) && /keywordsFetched\s*:\s*keywordRows\.length/.test(body),
      `(a) fetchGoogleDimensional does not report the TRUE fetched counts — without them "300 every day" and "300 is all there was" stay indistinguishable.`)
    check(/SEARCH_TERMS_CAP|KEYWORDS_CAP/.test(body) === false,
      `(a) the retired forward caps are referenced inside fetchGoogleDimensional again.`)
  }
  // ── (c) the contract keeps the counts ───────────────────────────────────────────────────────────────
  check(/searchTermsFetched:\s*number/.test(dim) && /keywordsFetched:\s*number/.test(dim),
    `(c) GoogleDimensional no longer declares searchTermsFetched/keywordsFetched — callers lose the ability to ask how much there was.`)
  // The WINDOW path may still cap, but it must record its pre-clip totals.
  if (startWin >= 0) {
    const win = dim.slice(startWin)
    if (/WINDOW_DAY_ST_CAP|WINDOW_DAY_KW_CAP|slice\(0,/.test(win)) {
      check(/searchTermsFetched:\s*st\.length/.test(win) && /keywordsFetched:\s*kw\.length/.test(win),
        `(b) the window path clips per day but does not record the pre-clip totals.`)
    }
  }
}

console.log(`[capture-limit-is-measured] scanned ${files.length} capture writer(s) · ${capped.length} apply a LIMIT (${BASELINE.size} baselined)`)
if (findings.length) {
  console.error(`[capture-limit-is-measured] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  · ${f}`)
  process.exit(1)
}
console.log('[capture-limit-is-measured] PASS — the forward search_term/keyword path is uncapped and reports true counts; every remaining cap records what it clipped.')
