#!/usr/bin/env node
// LORAMER_DIGEST_MISSED_THE_SECTION_FORMAT_V1 — A DECISION THE NEXT SESSION CANNOT SEE IS A DECISION THAT
// LIVED IN CHAT, ONE FILE LATER.
//
// ⛔ THE DEFECT, MEASURED AT THE 2026-08-19 SESSION WRAP AND THE REASON THIS EXISTS. `LORAMER_DECISIONS.md`
// banks decisions in TWO formats: `- [TAG …] … | LORAMER_X_V1, date | do not relitigate.` (bullet) and
// `## LORAMER_X_V1 (date) — …` (section). `build-resume-digest.mjs` §G selected with
// `/\|\s*do not relitigate/i` — the BULLET TRAILER — and **matched ZERO section entries**. Of 20 section
// decisions, **TEN were absent from the resume digest entirely**, including two GOVERNING rules banked by
// Russ that same evening and the parameterisation decision made that same day. The ten that did appear got
// there only because some QUEUE entry happened to cite their token: **reachability by luck.**
//
// ⛔ AND THE COST IS EXACTLY THE ONE THIS REPO KEEPS PAYING. The digest is what the next session reads. A
// decision in DECISIONS but not in the digest is one re-derivation away from the failure Russ named three
// times in a day — "a decision that lived only in chat". It is not lost, it is just not FOUND, and the
// difference is invisible until somebody re-litigates something that was settled weeks ago.
//
// ⛔ SAME CLASS AS `three-source-header.guard.mjs`'s format hole ONE DAY EARLIER, one consumer over: a real,
// legitimate, pre-existing format that the reader did not know about. Both times the fix was to WIDEN THE
// READER rather than retype the decisions — retyping is the rubber stamp, and it also loses the history.
//
// THE RULE, and it is deliberately not clever: every dated `## LORAMER_*_V<n>` heading in DECISIONS must be
// findable in the digest. **No "do not relitigate" predicate** — the repo already settled that argument for
// three-source-header's subject selection: the `## ` format is ONLY ever used for a banked decision, so the
// heading IS the proof. Requiring the phrase re-created this hole at half size (it still dropped six of
// twenty, because headings legitimately read "Do not reintroduce a default" or "OPEN PROBLEM, NAMED").
//
// ⚠ LIMITS, so a green is not over-read: it proves the TOKEN is present, never that the entry's CONTENT
// survived the build; it checks DECISIONS→digest only, so a decision banked in some third file is invisible
// to it; and it cannot tell reachability-by-design from reachability-by-a-queue-citation — it only tells you
// the next session can grep it.
//
// USAGE: node tests/guards/banked-decision-reaches-the-digest.guard.mjs
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const DECISIONS = 'LORAMER_DECISIONS.md'
const DIGEST = 'LORAMER_RESUME_DIGEST.md'
const findings = []

const read = (rel) => {
  try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch (e) {
    findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS rather than passing.`)
    return ''
  }
}
const decisions = read(DECISIONS)
const digest = read(DIGEST)

const tokens = [...decisions.matchAll(/^##\s+(LORAMER_[A-Z0-9_]+_V\d+)\b/gm)].map((m) => m[1])

if (decisions && tokens.length === 0) {
  findings.push(`${DECISIONS} contains NO \`## LORAMER_*_V<n>\` section decisions. Either the format was abandoned — in which case this guard should go with it — or the locator is wrong and this guard is measuring nothing, which is worse than not having it.`)
}

const missing = tokens.filter((t) => !digest.includes(t))
for (const t of missing) {
  findings.push(`${t} is banked in ${DECISIONS} but does NOT appear anywhere in ${DIGEST}. The next session reads the digest; a decision it cannot grep is one re-derivation away from having lived only in chat. Fix the DIGEST BUILDER (\`scripts/build-resume-digest.mjs\` §G), never the decision.`)
}

if (findings.length) {
  console.error(`[banked-decision-reaches-the-digest] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  console.error(`  ⇒ Run \`node scripts/wrap-docs.mjs\` after fixing the builder. MEASURED 2026-08-19: 10 of 20 section decisions were absent, and §G's bullet-trailer filter matched none of them.`)
  process.exitCode = 1
} else {
  console.log(`[banked-decision-reaches-the-digest] PASS — all ${tokens.length} \`## \` section decision(s) in ${DECISIONS} are findable in ${DIGEST}. ⛔ LIMIT: this proves the TOKEN is present, never that the entry's content survived the build, and it says nothing about decisions banked outside ${DECISIONS}.`)
}
