#!/usr/bin/env node
// LORAMER_BANNED_EXPRESSIONS_V1 — A BANNED EXPRESSION AND A FALSIFIED MECHANISM STAY DEAD, INCLUDING IN COMMENTS.
//
// ⛔ THE PRECEDENT, AND IT IS WHY THIS SCANS COMMENTS RATHER THAN CODE. On 2026-08-09 the sweep found the
// API-Center-UI mechanism — banked as FALSIFIED at `universe-governor.ts:18-24`, "THAT SCREEN DOES NOT EXIST" —
// alive and verbatim in `capture-adapters/google-ads.adapter.ts`, a file written AFTER the falsification, in a
// COMMENT. A code-only scan sees nothing. **A falsified mechanism in a comment is worse than one in code: it
// reads as research already done, and the next executor builds on it instead of checking it.** That is the
// fifth LORAMER_ESSENCE_LAW_9_V1 precedent.
//
// ⛔ THE SECOND SEED IS SHARPER STILL, because the ban and the violation are in the SAME FILE.
// `google-op-budget.ts:20-23` says, in its own header: "⛔ NO `Math.max(conns, days)` ANYWHERE. That expression
// was v1's hedge against under-counting … A hedge that picks the larger of two units is not conservative, it is
// wrong in a direction nobody can audit." `google-op-budget.ts:330` executes `Math.max(conns, days)`. The rule
// was removed from the three named lanes and retained one branch over, and nothing could see it.
//
// ⛔ HOW A BAN'S OWN RECORD IS TOLD APART FROM A USE, stated because it is the only judgment in this file.
// Each ban carries `recordMarkers` — EXACT strings that identify the entry banking the ban. A match within
// ±3 lines of one of those markers is the RECORD, not a use. The markers are exact, not fuzzy: a heuristic
// here would either flag the falsification record forever or silently forgive a real regression.
//
// ⛔ SCOPE, AND THE LIMIT SAID PLAINLY. Code files only (.ts/.tsx/.mjs/.js under src/, scripts/, tests/).
// It does NOT scan .md — every doc that RECORDS a ban would match, and a guard that flags its own law is a
// guard that gets deleted. So a falsified mechanism re-entering a DESIGN DOC is not caught here; that is
// ★DOC-OWNERSHIP-GUARD's territory and it is not built. Named, not implied away.
//
// ⛔ NEW BANS ARE APPENDED WHEN BANKED AND NEVER RE-LITIGATED. The EXCEPTIONS list below is REMOVE-ONLY: it
// freezes today's known violations so this can land green, and a dead exception fails the build so a fix
// cannot leave cover behind. It is a baseline freeze, NOT absolution.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const SELF = 'tests/guards/banned-expressions.guard.mjs'

// ── THE REGISTRY. APPEND WHEN A BAN OR A FALSIFICATION IS BANKED. NEVER RE-LITIGATE AN ENTRY. ─────────────
const BANS = [
  {
    id: 'MATH-MAX-CONNS-DAYS',
    what: 'picking the larger of two INCOMPARABLE units (connection-days vs gap-days) as a hedge',
    bannedOn: '2026-07-31',
    bannedBy: 'LORAMER_GOOGLE_OP_BUDGET_LANE_ACCOUNTING_V2 — google-op-budget.ts:20-23',
    why: 'it made catchup\'s 421 connection-units outrank its real 207 gap-days. A hedge that picks the larger of two units is not conservative, it is wrong in a direction nobody can audit.',
    pattern: /Math\.max\(\s*conns\s*,\s*days\s*\)/,
    recordMarkers: ['⛔ NO `Math.max(conns, days)` ANYWHERE'],
    // ⛔ A DETECTOR IS NOT A USE, and this allow-list is EXPLICIT rather than a rule about paths. A guard that
    // names a banned pattern in order to fail on it is the ban working; a NEW file naming it trips this guard
    // until someone deliberately adds it here, which is the correct cost.
    detectorFiles: ['tests/guards/google-op-budget.guard.mjs'],
  },
  {
    id: 'API-CENTER-IS-THE-OP-METER',
    what: 'the claim that the Google Ads API Center UI is where remaining daily operations can be read',
    bannedOn: '2026-08-03',
    bannedBy: 'LORAMER_ESSENCE_LAW_9_V1 fourth precedent — universe-governor.ts:18-24',
    why: 'THAT SCREEN DOES NOT EXIST. The API Center shows the developer token, the access level and the API contact email; Google\'s own support states remaining daily operations cannot be read and must be tracked client-side. The ratio was settled from the published rate sheet instead.',
    pattern: /API Center[^\n]{0,160}?(human read|only source|source for the true number)|(?:only source|source for the true number)[^\n]{0,160}?API Center/i,
    recordMarkers: [
      'THAT SCREEN DOES NOT EXIST',
      'ASSERTED A MECHANISM THAT DOES NOT EXIST',
      'banked as FALSIFIED at',
    ],
  },
  {
    // LORAMER_GOOGLE_ACCESS_STANDARD_V1 (2026-09-21) — A STALE ACCESS-LEVEL CLAIM IS A FALSIFIED MECHANISM, and this
    // is the first ban that scans DOCS as well as code. Standard Access was GRANTED 2026-09-15; the daily cap is null.
    // On 2026-09-21 the repo still said "pending" / "the 15k/day Basic cap binds" in the two governing lines the digest
    // prints every resume (ESSENCE pre-action gate, DECISIONS operating rules), in HANDOFF, RESUME_INSTRUCTIONS, a
    // QUEUE line, a runtime log string and a dozen comments. A session read those as current and a fix paste was
    // written against a cap that did not exist.
    // ⛔ THE ONE RULE THAT TELLS HISTORY FROM A CLAIM: a matching line must NAME THE OWNER MARKER. The owner line
    // names it, every pointer names it, and every dated history line is STAMPED with it. A line that mentions the old
    // status and does not name the owner is a present-tense claim, wherever it sits.
    id: 'STALE-GOOGLE-ACCESS-CLAIM',
    what: 'a present-tense claim that Google Ads Standard Access is pending / not granted, that the 15,000 ops/day Basic cap binds, or that legacy is frozen for the Standard Access review',
    bannedOn: '2026-09-21',
    bannedBy: 'LORAMER_GOOGLE_ACCESS_STANDARD_V1 — LORAMER_DECISIONS.md (the one owner line; Russ 2026-09-21: every place the repo says Standard is not done gets fixed)',
    why: 'Standard Access was granted 2026-09-15 and GOOGLE_DAILY_OP_CAP is null; a doc or comment that still says pending or 15k/day reads as current at resume and routes work against a constraint that is gone.',
    pattern: /standard access[^.\n]{0,40}\b(pending|not granted|not yet granted|not done)\b|\b(pending|until it clears|parked on|while)[^.\n]{0,30}standard access|basic cap binds|15k ?(ops )?\/ ?day|15,000 ?(ops|operations)? ?(\/|per) ?day|15,000 daily cap|15,?000-op|15k-op|basic[- ]access (limits|= ?15|is 15|\(15)|basic (= ?15|is 15)|frozen for (google )?(the )?standard access|standard access (rmf )?review|standard access (application|is) (deferred|not requested)|apply for standard|waiting to hear back/i,
    recordMarkers: [],
    detectorFiles: [],
    // Docs are scanned for THIS ban only (root *.md and docs/**/*.md; never the generated digest — its sources are).
    scanDocs: true,
    // The owner marker: a line that carries it is the owner, a pointer, or a stamped history line — never a claim.
    exemptIfLineIncludes: ['LORAMER_GOOGLE_ACCESS_STANDARD_V1'],
  },
]

// ── THE BASELINE FREEZE — REMOVE-ONLY ─────────────────────────────────────────────────────────────────────
const EXCEPTIONS = [
  { ban: 'MATH-MAX-CONNS-DAYS', file: 'src/lib/backfill/google-op-budget.ts', line: 330,
    match: 'unattributedUnits += Math.max(conns, days)', date: '2026-08-09',
    queue: '★MATH-MAX-CONNS-DAYS-BANNED-BY-ITS-OWN-FILE-STILL-USED' },
  { ban: 'API-CENTER-IS-THE-OP-METER', file: 'src/lib/backfill/capture-adapters/google-ads.adapter.ts', line: 55,
    match: 'The only source for the true number is the API Center UI, which is a human read.', date: '2026-08-09',
    queue: '★API-CENTER-MECHANISM-CAME-BACK-FIFTH-LAW-9-PRECEDENT' },
  // ⚠ FOUND BY THIS GUARD ON ITS FIRST RED RUN, NOT BY THE 2026-08-09 SWEEP — which had this file on its
  // NOT-READ list. The falsified mechanism is in THREE places, not two, and the third is the module that is
  // "the one place the vendor is touched". That is the argument for scanning comments, made by the scan.
  { ban: 'API-CENTER-IS-THE-OP-METER', file: 'src/lib/backfill/universe-vendor-client.ts', line: 10,
    match: 'The only source is the API Center in the Google Ads UI, which is a human', date: '2026-08-09',
    queue: '★API-CENTER-MECHANISM-CAME-BACK-FIFTH-LAW-9-PRECEDENT' },
  // ⚠ RUNTIME STRINGS AND A HASH-PINNED FILE, found by the STALE-GOOGLE-ACCESS-CLAIM ban's first red run (2026-09-21).
  // The docs-and-guard flight that added the ban may not touch runtime code, and universe-resume/route.ts is sha-pinned
  // by walk-quota-scope.guard.mjs. Frozen here, remove-only, under one queue item.
  { ban: 'STALE-GOOGLE-ACCESS-CLAIM', file: 'src/lib/backfill/forward-driver.ts', line: 176,
    match: 'EXCLUDED (frozen for the Standard Access review, DECISIONS:2461)', date: '2026-09-21',
    queue: '★STALE-ACCESS-CLAIMS-IN-RUNTIME-STRINGS' },
  { ban: 'STALE-GOOGLE-ACCESS-CLAIM', file: 'scripts/rmf-adapter-gate.mjs', line: 115,
    match: '3 vendor requests (Basic cap 15,000/day)', date: '2026-09-21',
    queue: '★STALE-ACCESS-CLAIMS-IN-RUNTIME-STRINGS' },
  { ban: 'STALE-GOOGLE-ACCESS-CLAIM', file: 'scripts/rmf-adapter-gate.mjs', line: 157,
    match: '~5 vendor requests (Basic cap 15,000/day)', date: '2026-09-21',
    queue: '★STALE-ACCESS-CLAIMS-IN-RUNTIME-STRINGS' },
  { ban: 'STALE-GOOGLE-ACCESS-CLAIM', file: 'scripts/rmf-adapter-gate.mjs', line: 226,
    match: '2 vendor requests will be spent (1 op each, Basic cap 15,000/day)', date: '2026-09-21',
    queue: '★STALE-ACCESS-CLAIMS-IN-RUNTIME-STRINGS' },
  { ban: 'STALE-GOOGLE-ACCESS-CLAIM', file: 'src/app/api/cron/universe-resume/route.ts', line: 913,
    match: '15,000 daily cap MINUS 4,000 forward and 5,000 drain', date: '2026-09-21',
    queue: '★STALE-ACCESS-CLAIMS-IN-RUNTIME-STRINGS' },
]

// ── SCAN ──────────────────────────────────────────────────────────────────────────────────────────────────
const files = []
for (const top of ['src', 'scripts', 'tests']) {
  ;(function walk(dir) {
    let ents
    try { ents = readdirSync(resolve(ROOT, dir)) } catch { return }
    for (const e of ents) {
      const p = join(dir, e)
      let st
      try { st = statSync(resolve(ROOT, p)) } catch { continue }
      if (st.isDirectory()) { if (e !== 'node_modules' && e !== '.next') walk(p); continue }
      if (/\.(ts|tsx|mjs|js)$/.test(e) && p !== SELF) files.push(p)
    }
  })(top)
}

// Docs, for the bans that opt in (scanDocs): root-level *.md and docs/**/*.md. The generated digest is not scanned —
// it is rebuilt from the docs that are, and a hit in it would be a hit in a source with the same fix.
const docFiles = []
try { for (const e of readdirSync(ROOT)) if (/\.md$/.test(e) && e !== 'LORAMER_RESUME_DIGEST.md') docFiles.push(e) } catch { /* none */ }
;(function walkDocs(dir) {
  let ents
  try { ents = readdirSync(resolve(ROOT, dir)) } catch { return }
  for (const e of ents) {
    const p = join(dir, e)
    let st
    try { st = statSync(resolve(ROOT, p)) } catch { continue }
    if (st.isDirectory()) { walkDocs(p); continue }
    if (/\.md$/.test(e)) docFiles.push(p)
  }
})('docs')

const violations = []
const cache = new Map()
const linesOf = (rel) => { if (!cache.has(rel)) { try { cache.set(rel, readFileSync(resolve(ROOT, rel), 'utf8').split('\n')) } catch { cache.set(rel, null) } } return cache.get(rel) }
for (const ban of BANS) {
  for (const rel of ban.scanDocs ? [...files, ...docFiles] : files) {
    const lines = linesOf(rel)
    if (!lines) continue
    for (let i = 0; i < lines.length; i++) {
      if (!ban.pattern.test(lines[i])) continue
      if ((ban.exemptIfLineIncludes ?? []).some((m) => lines[i].includes(m))) continue
      // ±3 lines: is this the entry that BANKS the ban rather than a use of it?
      const win = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 4)).join('\n')
      if (ban.recordMarkers.some((m) => win.includes(m))) continue
      if ((ban.detectorFiles ?? []).includes(rel)) continue
      violations.push({ ban: ban.id, file: rel, line: i + 1, text: lines[i].trim(), meta: ban })
    }
  }
}

// ── EXCEPTION RECONCILIATION ──────────────────────────────────────────────────────────────────────────────
const findings = []
const used = new Set()

for (const ex of EXCEPTIONS) {
  let src = null
  try { src = readFileSync(resolve(ROOT, ex.file), 'utf8') } catch { /* gone */ }
  if (src === null || !src.includes(ex.match)) {
    findings.push(`DEAD EXCEPTION — ${ex.ban} @ ${ex.file}: the excepted text is no longer in the tree (${ex.queue}). Delete this entry; cover left behind is how the NEXT regression lands green.`)
    continue
  }
  const hit = violations.find((v) => v.ban === ex.ban && v.file === ex.file && !used.has(v))
  if (!hit) {
    findings.push(`DEAD EXCEPTION — ${ex.ban} @ ${ex.file}: the text is present but the ban no longer matches it. Re-check by hand, then delete this entry.`)
    continue
  }
  used.add(hit)
}

for (const v of violations) {
  if (used.has(v)) continue
  findings.push(
    `BANNED ${v.ban} — ${v.file}:${v.line}\n` +
    `      ${v.text.slice(0, 160)}\n` +
    `      WHAT: ${v.meta.what}\n` +
    `      BANNED ${v.meta.bannedOn} BY ${v.meta.bannedBy}\n` +
    `      WHY: ${v.meta.why}`
  )
}

if (findings.length) {
  console.error(`\n❌ LORAMER_BANNED_EXPRESSIONS_V1 FAILED — ${findings.length} finding(s)\n`)
  findings.forEach((f) => console.error('  • ' + f + '\n'))
  console.error('  ⛔ A ban is not re-litigated here. If the ban itself is wrong, that is a decision for Russ and')
  console.error('     it changes the REGISTRY, in a commit that says so. Until then the expression stays dead.\n')
  process.exit(1)
}
console.log(
  `banned-expressions.guard: PASS — ${BANS.length} ban(s) scanned across ${files.length} code file(s) INCLUDING COMMENTS, ` +
  `${BANS.filter((b) => b.scanDocs).length} of them also across ${docFiles.length} doc file(s); ` +
  `${EXCEPTIONS.length} frozen baseline violation(s), all still matching the tree. LIMIT: the generated digest is not scanned.`
)
