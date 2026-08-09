#!/usr/bin/env node
// LORAMER_SINGLE_OWNER_VENDOR_FACTS_V1 — ONE FILE OWNS EACH VENDOR FACT. A SECOND DECLARATION FAILS THE BUILD.
//
// ⛔ WHY THIS IS A GUARD AND NOT A NOTE, and the answer is the whole of LORAMER_A_LAW_IS_NOT_BANKED_UNTIL_IT_CAN_FAIL_A_BUILD_V1:
// "read the code, do not restate a vendor fact" has been written in this repo, in prose, more than once. It is
// written RIGHT NOW inside `google-op-budget.ts` itself. And on 2026-08-09 the sweep measured the result:
//   · `GOOGLE_DAILY_OP_CAP = 15_000` is declared in TWO files with ZERO cross-imports, and a THIRD file
//     restates its derived allowance as a bare `cap: 6_000`.
//   · the ops-per-request ratio is SETTLED AT 1 in one file while 1.5 stays live in another.
//   · the same 15,000 cap is divided by TWO INCOMPATIBLE ALLOCATION MODELS that disagree by 5,500 ops.
// Every one of those is a comment away from being obvious and none of them was caught by reading.
//
// ⛔ WHAT IT CHECKS, AND WHAT IT CANNOT — STATED, NOT IMPLIED AWAY.
// CHECKS: a DECLARATION of an owned fact outside its owner file. That is mechanical and unarguable.
// CANNOT CHECK: that a file which USES a fact imports it rather than inlining an unrelated literal of the same
// shape. Proving "this 15000 means the Google cap" is comprehension, and this guard declines it for the same
// reason doc-ownership.guard.mjs declines to detect a restated decision. It catches the DECLARATION, which is
// the shape every violation the sweep found actually took.
// COMMENTS ARE STRIPPED BEFORE MATCHING, deliberately: a comment that restates a vendor number is a different
// (and real) problem, and it is `banned-expressions.guard.mjs`'s job, not this one's. Overlapping two guards on
// one line is how both get baselined.
//
// ⛔ THE EXCEPTIONS LIST IS A BASELINE FREEZE, NOT ABSOLUTION. Every entry below is a KNOWN LIVE VIOLATION as
// of 2026-08-09, carrying its file, the text that must still be there, the line it sat on that day, and its
// queue entry. AN EXCEPTION MAY ONLY BE REMOVED, NEVER ADDED — a new violation is a RED build, which is the
// entire point. And a DEAD exception (one whose text is no longer in the tree) also fails, so a fix cannot
// leave cover behind for the next one.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, relative, join } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()

// ── THE OWNED FACTS ───────────────────────────────────────────────────────────────────────────────────────
// `owner` is the ONE file allowed to declare the fact. `detect` matches a DECLARATION, never a use.
const FACTS = [
  {
    id: 'GOOGLE_DAILY_OP_CAP',
    what: 'the Google Ads Basic-Access developer-scope daily operation cap (15,000)',
    owner: 'src/lib/backfill/google-op-budget.ts',
    detect: [/\bexport const GOOGLE_DAILY_OP_CAP\s*=/, /\bcap:\s*15[_,]?000\b/],
  },
  {
    id: 'OPS_PER_REQUEST_RATIO',
    what: 'how many vendor OPERATIONS one request costs — VENDOR-SETTLED at 1 (re-verified at Google 2026-08-09)',
    // OWNER MOVED 2026-08-09 with LORAMER_GOOGLE_LANE_ALLOCATION_V1: the ratio now lives beside the cap and the
    // allocations, in the file the live capture lanes call. universe-governor re-exports it.
    owner: 'src/lib/backfill/google-op-budget.ts',
    detect: [/\bexport const ASSUMED_OPS_PER_REQUEST\s*=/, /\bexport const SAFETY_MULTIPLIER\s*=/, /\bexport const OPS_PER_REQUEST\s*=/],
  },
  {
    id: 'GOOGLE_LANE_ALLOCATIONS',
    what: 'how the daily cap is divided between the forward / drain / catchup / backfill lanes',
    // ⛔ NO LONGER PROVISIONAL. Russ decided the lane fork on 2026-08-09 (LORAMER_GOOGLE_LANE_ALLOCATION_V1):
    // ONE table in google-op-budget.ts — forward 2,000 · drain 3,000 · catchup 4,000 · walk 6,000 — and
    // universe-governor.ts became a thin re-export. The six exceptions this fact carried are RETIRED.
    owner: 'src/lib/backfill/google-op-budget.ts',
    detect: [
      /\bexport const CATCHUP_SHARE\s*=/, /\bexport const LANE_ALLOCATIONS\s*[:=]/,
      /\bexport const RESERVED_FOR_FORWARD_OPS\s*=/, /\bexport const RESERVED_FOR_DRAIN_OPS\s*=/,
      /\bexport const BACKFILL_OP_ALLOWANCE\s*=/, /\bexport const PRODUCT_RESERVE_OPS\s*=/,
      /\bcap:\s*6[_,]?000\b/,
    ],
  },
  {
    id: 'GOOGLE_META_36MO_GRANULAR_FLOOR',
    what: 'the 36-month granular retention floor under the ~37-month Google/Meta wall',
    owner: 'src/lib/backfill/drain-registry.ts',
    detect: [/getUTCMonth\(\)\s*-\s*36\s*\)/],
  },
  {
    id: 'GA4_RETENTION_FLOOR',
    what: 'the GA4 data floor 2015-08-14',
    owner: 'src/lib/backfill/adapters.ts',
    detect: [/['"`]2015-08-14['"`]/],
  },
  {
    id: 'GOOGLE_ACCOUNT_VENDOR_FLOOR',
    what: 'the MEASURED per-account Google vendor floor 2022-03-05',
    owner: 'src/lib/backfill/google-ads-universe-writer.ts',
    detect: [/['"`]2022-03-05['"`]/],
  },
  {
    id: 'GOOGLE_QUOTA_RESET_UTC',
    what: 'the ~08:03:57 UTC developer-scope quota reset and its reserve window',
    owner: 'src/lib/backfill/google-forward-reserve.ts',
    detect: [/\bh:\s*8\s*,\s*m:\s*3\s*,\s*s:\s*57\b/, /\bexport const RESET_WINDOW_MINUTES\s*=/],
  },
]

// ── THE BASELINE FREEZE ───────────────────────────────────────────────────────────────────────────────────
// ⛔ REMOVE-ONLY. Adding a line here is banned by LORAMER_A_LAW_IS_NOT_BANKED_UNTIL_IT_CAN_FAIL_A_BUILD_V1.
const EXCEPTIONS = [
  // ⛔ SEVEN ENTRIES RETIRED 2026-08-09 BY LORAMER_GOOGLE_LANE_ALLOCATION_V1 — 14 → 7. This list is
  // REMOVE-ONLY and this is what removal looks like: the cap and the four allocations stopped being declared
  // in universe-governor.ts and became derivations of the one table; the adapter's hand-typed `cap: 6_000`
  // became an import; SAFETY_MULTIPLIER was deleted outright because the vendor settles the ratio at 1.
  // The seven that remain are the retention floors, untouched by that flight.
  { fact: 'GA4_RETENTION_FLOOR', file: 'src/lib/backfill/ga-dimensional-backfill.ts', line: 51,
    match: "const HARD_FLOOR = '2015-08-14'", date: '2026-08-09',
    queue: '★RETENTION-FLOORS-RE-DERIVED-IN-SEVEN-PLACES' },
  { fact: 'GOOGLE_META_36MO_GRANULAR_FLOOR', file: 'src/app/api/backfill/google-adgroup-ad/route.ts', line: 32,
    match: 'd.setUTCMonth(d.getUTCMonth() - 36)', date: '2026-08-09',
    queue: '★RETENTION-FLOORS-RE-DERIVED-IN-SEVEN-PLACES' },
  { fact: 'GOOGLE_META_36MO_GRANULAR_FLOOR', file: 'src/app/api/backfill/google-campaign/route.ts', line: 33,
    match: 'd.setUTCMonth(d.getUTCMonth() - 36)', date: '2026-08-09',
    queue: '★RETENTION-FLOORS-RE-DERIVED-IN-SEVEN-PLACES' },
  { fact: 'GOOGLE_META_36MO_GRANULAR_FLOOR', file: 'src/app/api/backfill/meta-adset-ad/route.ts', line: 31,
    match: 'd.setUTCMonth(d.getUTCMonth() - 36)', date: '2026-08-09',
    queue: '★RETENTION-FLOORS-RE-DERIVED-IN-SEVEN-PLACES' },
  { fact: 'GOOGLE_META_36MO_GRANULAR_FLOOR', file: 'src/app/api/backfill/meta-asset/route.ts', line: 73,
    match: 'd.setUTCMonth(d.getUTCMonth() - 36)', date: '2026-08-09',
    queue: '★RETENTION-FLOORS-RE-DERIVED-IN-SEVEN-PLACES' },
  { fact: 'GOOGLE_META_36MO_GRANULAR_FLOOR', file: 'src/app/api/backfill/meta-campaign/route.ts', line: 34,
    match: 'd.setUTCMonth(d.getUTCMonth() - 36)', date: '2026-08-09',
    queue: '★RETENTION-FLOORS-RE-DERIVED-IN-SEVEN-PLACES' },
  { fact: 'GOOGLE_META_36MO_GRANULAR_FLOOR', file: 'src/app/api/backfill/meta-product-id/route.ts', line: 65,
    match: 'd.setUTCMonth(d.getUTCMonth() - 36)', date: '2026-08-09',
    queue: '★RETENTION-FLOORS-RE-DERIVED-IN-SEVEN-PLACES' },
]

// ── SCAN ──────────────────────────────────────────────────────────────────────────────────────────────────
const files = []
;(function walk(dir) {
  let ents
  try { ents = readdirSync(resolve(ROOT, dir)) } catch { return }
  for (const e of ents) {
    const p = join(dir, e)
    let st
    try { st = statSync(resolve(ROOT, p)) } catch { continue }
    if (st.isDirectory()) { if (e !== 'node_modules' && e !== '.next') walk(p); continue }
    if (/\.(ts|tsx)$/.test(e)) files.push(p)
  }
})('src')

// Strip block and line comments so a COMMENT restating a number is not this guard's finding. Conservative: a
// `//` inside a string literal is also stripped, which can only ever produce a FALSE NEGATIVE, never a false
// positive — the safe direction for a guard whose red must always be real.
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
     .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')

const violations = []
for (const rel of files) {
  let raw
  try { raw = readFileSync(resolve(ROOT, rel), 'utf8') } catch { continue }
  const code = stripComments(raw).split('\n')
  for (const fact of FACTS) {
    if (rel === fact.owner) continue
    for (let i = 0; i < code.length; i++) {
      for (const re of fact.detect) {
        if (!re.test(code[i])) continue
        // ⛔ A DERIVATION IS NOT A DECLARATION, AND THE DIFFERENCE IS MECHANICAL — added 2026-08-09 when the
        // first burn-down landed. `export const RESERVED_FOR_DRAIN_OPS = 5_000` is a SECOND SOURCE OF TRUTH;
        // `export const RESERVED_FOR_DRAIN_OPS = LANE_ALLOCATIONS.drain` is an ALIAS that cannot drift, because
        // it has no value of its own. The test is whether the right-hand side carries a LITERAL: a number or a
        // quoted string means someone typed the fact again; an identifier means they pointed at its owner.
        // ⚠ THE LIMIT: it cannot tell WHICH owner is pointed at. A derivation from the wrong module still
        // passes. It catches retyping, which is the shape every violation this guard found actually took.
        const rhs = code[i].slice(code[i].indexOf('=') + 1)
        const isLiteral = /\d/.test(rhs) || /['"`]/.test(rhs)
        if (!isLiteral) continue
        violations.push({ fact: fact.id, file: rel, line: i + 1, text: code[i].trim(), owner: fact.owner, what: fact.what })
        break
      }
    }
  }
}

// ── EXCEPTION RECONCILIATION ──────────────────────────────────────────────────────────────────────────────
const findings = []
const used = new Set()

for (const ex of EXCEPTIONS) {
  let src = null
  try { src = readFileSync(resolve(ROOT, ex.file), 'utf8') } catch { /* missing file */ }
  if (src === null) {
    findings.push(`DEAD EXCEPTION — ${ex.fact} @ ${ex.file}: the file no longer exists. An exception that covers nothing is cover left behind for the NEXT violation. Delete this entry.`)
    continue
  }
  if (!src.includes(ex.match)) {
    findings.push(`DEAD EXCEPTION — ${ex.fact} @ ${ex.file}: the excepted text is GONE from the tree (${ex.queue}). That is good news and it is not free: delete this entry so the freeze cannot silently widen.`)
    continue
  }
  const hit = violations.find((v) => v.fact === ex.fact && v.file === ex.file && !used.has(v))
  if (!hit) {
    findings.push(`DEAD EXCEPTION — ${ex.fact} @ ${ex.file}: the text is still present but no longer reads as a DECLARATION (the detector no longer fires). Re-check it by hand, then delete this entry.`)
    continue
  }
  used.add(hit)
}

for (const v of violations) {
  if (used.has(v)) continue
  findings.push(
    `SECOND DECLARATION of ${v.fact} — ${v.file}:${v.line}\n` +
    `      ${v.text.slice(0, 140)}\n` +
    `      ${v.what}\n` +
    `      OWNER: ${v.owner}. Import it from there. One fact, one home — a value declared twice drifts, and on ` +
    `2026-08-09 three of them already had.`
  )
}

if (findings.length) {
  console.error(`\n❌ LORAMER_SINGLE_OWNER_VENDOR_FACTS_V1 FAILED — ${findings.length} finding(s)\n`)
  findings.forEach((f) => console.error('  • ' + f + '\n'))
  console.error(`  ⛔ THE EXCEPTIONS LIST IS REMOVE-ONLY. Do not add to it. Fix the declaration, or bring the`)
  console.error(`     decision to Russ as a live-path change — that is the burn-down, one fix at a time.\n`)
  process.exit(1)
}
console.log(
  `single-owner-vendor-facts.guard: PASS — ${FACTS.length} owned vendor fact(s) scanned across ${files.length} file(s); ` +
  `${EXCEPTIONS.length} frozen baseline violation(s), all still matching the tree. ` +
  `LIMIT: declarations only — a file that USES a fact without importing it is not detectable here.`
)
