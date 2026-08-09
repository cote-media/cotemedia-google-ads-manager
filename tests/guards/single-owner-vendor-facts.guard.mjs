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
    what: 'how many vendor OPERATIONS one request costs — settled at 1 from Google\'s own rate sheet 2026-08-03',
    owner: 'src/lib/backfill/universe-governor.ts',
    detect: [/\bexport const ASSUMED_OPS_PER_REQUEST\s*=/, /\bexport const SAFETY_MULTIPLIER\s*=/],
  },
  {
    id: 'GOOGLE_LANE_ALLOCATIONS',
    what: 'how the daily cap is divided between the forward / drain / catchup / backfill lanes',
    // ⚠ PROVISIONAL OWNER, AND IT DOES NOT PRE-EMPT RUSS'S DECISION. Which model survives is
    // ★TWO-LIVE-GOOGLE-ALLOCATION-MODELS-DISAGREE-BY-5500, still open. google-op-budget is named owner here
    // only because it is the file the live capture lanes actually call; the governor's model is EXCEPTED, not
    // deleted, and this line moves when the queue item closes.
    owner: 'src/lib/backfill/google-op-budget.ts',
    detect: [
      /\bexport const CATCHUP_SHARE\s*=/, /\bexport const CATCHUP_ALLOCATION\s*=/, /\bexport const RANKED_RESERVE\s*=/,
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
  // ── the cap and its derived allowance, in files that do not import them (sweep W1) ──
  { fact: 'GOOGLE_DAILY_OP_CAP', file: 'src/lib/backfill/universe-governor.ts', line: 25,
    match: 'export const GOOGLE_DAILY_OP_CAP = 15_000', date: '2026-08-09',
    queue: '★GOOGLE-DAILY-OP-CAP-DECLARED-IN-THREE-FILES' },
  { fact: 'GOOGLE_LANE_ALLOCATIONS', file: 'src/lib/backfill/capture-adapters/google-ads.adapter.ts', line: 59,
    match: 'cap: 6_000,', date: '2026-08-09',
    queue: '★GOOGLE-DAILY-OP-CAP-DECLARED-IN-THREE-FILES' },

  // ── the second, incompatible allocation model (sweep W2) — 5,500 ops apart from the first ──
  { fact: 'GOOGLE_LANE_ALLOCATIONS', file: 'src/lib/backfill/universe-governor.ts', line: 40,
    match: 'export const RESERVED_FOR_FORWARD_OPS = 4_000', date: '2026-08-09',
    queue: '★TWO-LIVE-GOOGLE-ALLOCATION-MODELS-DISAGREE-BY-5500' },
  { fact: 'GOOGLE_LANE_ALLOCATIONS', file: 'src/lib/backfill/universe-governor.ts', line: 41,
    match: 'export const RESERVED_FOR_DRAIN_OPS = 5_000', date: '2026-08-09',
    queue: '★TWO-LIVE-GOOGLE-ALLOCATION-MODELS-DISAGREE-BY-5500' },
  { fact: 'GOOGLE_LANE_ALLOCATIONS', file: 'src/lib/backfill/universe-governor.ts', line: 42,
    match: 'export const BACKFILL_OP_ALLOWANCE = GOOGLE_DAILY_OP_CAP - RESERVED_FOR_FORWARD_OPS - RESERVED_FOR_DRAIN_OPS',
    date: '2026-08-09', queue: '★TWO-LIVE-GOOGLE-ALLOCATION-MODELS-DISAGREE-BY-5500' },
  { fact: 'GOOGLE_LANE_ALLOCATIONS', file: 'src/lib/backfill/universe-governor.ts', line: 66,
    match: 'export const PRODUCT_RESERVE_OPS = RESERVED_FOR_FORWARD_OPS + RESERVED_FOR_DRAIN_OPS',
    date: '2026-08-09', queue: '★TWO-LIVE-GOOGLE-ALLOCATION-MODELS-DISAGREE-BY-5500' },

  // ── the ratio settled at 1 in one file while 1.5 stays live in another (sweep W3) ──
  { fact: 'OPS_PER_REQUEST_RATIO', file: 'src/lib/backfill/google-op-budget.ts', line: 64,
    match: 'export const SAFETY_MULTIPLIER = 1.5', date: '2026-08-09',
    queue: '★OPS-PER-REQUEST-1.5-VS-1-FIXED-IN-ONE-FILE-ONLY' },

  // ── retention floors re-derived rather than imported. ⚠ FOUND BY THIS GUARD ON ITS FIRST RED RUN, not by
  //    the 2026-08-09 sweep — which is the argument for the guard, since seven hand-rolled copies of a vendor
  //    wall had been read past for months. ──
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
        if (re.test(code[i])) {
          violations.push({ fact: fact.id, file: rel, line: i + 1, text: code[i].trim(), owner: fact.owner, what: fact.what })
          break
        }
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
