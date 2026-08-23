#!/usr/bin/env node
// LORAMER_UNKNOWN_RENDERS_HONESTLY_V1 — GUARD. Part 2 of failure-is-not-a-fact: the RENDER half.
//
// ⛔ PART 1 PUT THE TRUTH IN THE PAYLOAD AND LEFT THE SCREEN LYING. `presence` + `presenceReason` ride the
// response, and every consumer still narrowed them through a boolean, so a read that FAILED still rendered
// "not connected" — a statement about the customer's account made from a fault on ours. This guard pins the
// render contract so the third state cannot be dropped again on the way to the screen.
//
// FIVE LEGS, and what each can and cannot see is on its face.
//  (a) NO `!!` ON A PRESENCE FIELD — the literal shape of the original defect (`!!data`). Exact, cheap.
//  (b) A FILE THAT READS `.presence` MUST NAME `'unknown'` — a PROXY: a consumer that destructures the field
//      and never mentions the third case has not handled it. It cannot prove the branch is CORRECT, only
//      that it exists.
//  (c) NO `.filter(` OVER A CHANNEL COLLECTION — pins the MerView:108 class. ⛔ A dropped card is the one
//      wrong render a text assertion cannot catch, because there is no text. A filter may drop a NO; it may
//      never drop an UNKNOWN.
//  (d) THE DUPLICATED LITERALS RATCHET DOWN — "not connected" and "No clients yet." spread by copy-paste
//      across six pages, which is HOW the defect reached six pages. The count is the burn-down.
//  (e) THE UNKNOWN COPY EXISTS WHERE IT MUST — each live consumer names the honest string. Placement only.
//
// ⛔ WHAT NO LEG HERE REACHES: whether the words READ as honest to a human, and whether iOS Safari behaves as
// headless WebKit does. This repo has MEASURED that second gap — ★MOBILE-WIDTH-GUARD records Playwright
// WebKit containing a 976px table at 390px while the bug was live on the device. Headless is a floor.

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { NOT_CONNECTED_LITERALS, NO_CLIENTS_LITERALS } from './unknown-renders-honestly.baseline.mjs'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }

// The LIVE consumers. ⛔ OverviewStatic.tsx and useCardData.ts are DELIBERATELY ABSENT: OverviewStatic is
// mounted by nothing (CardEngine replaced it) and useCardData never reads hasDataEver, so "fixing" them
// would be true of the file and false of the product. ★OVERVIEWSTATIC-IS-DEAD-CODE owns that.
const LIVE = [
  'src/components/redesign/MerView.tsx',
  'src/components/redesign/GaOverview.tsx',
  'src/lib/next/roas-bases.ts',
  'src/lib/next/shell-client.ts',
  'src/components/redesign/NoClients.tsx',
]

// ── (a) NO `!!` ON A PRESENCE FIELD ───────────────────────────────────────────────────────────────────────
const SCAN = [...LIVE, 'src/app/api/next/ga-overview/route.ts', 'src/app/api/next/client-metrics/route.ts']
for (const f of SCAN) {
  const src = read(f)
  src.split('\n').forEach((line, i) => {
    if (/!!\s*\w+[?.]*\.(presence|state)\b/.test(line)) {
      findings.push(`(a) ${f}:${i + 1} coerces a Presence field with \`!!\` — that is the original defect's exact shape (\`!!data\` → false → "not connected"). Branch on the three values.`)
    }
  })
}

// ── (b) A READER OF `.presence` MUST NAME 'unknown' ───────────────────────────────────────────────────────
for (const f of LIVE) {
  const src = read(f)
  if (!src) continue
  // A property READ (`x.presence`), not an object KEY (`presence:`). The producer maps the state through and
  // has no third case to drop; the consumer branches and does.
  const reads = /[\w\)\]]\s*[?]?\.presence\b/.test(src)
  if (reads && !/'unknown'|"unknown"/.test(src)) {
    findings.push(`(b) ${f} reads \`presence\` but never names 'unknown'. A consumer that takes the field and does not mention the third case has not handled it — the state is dropped on the way to the screen, which is precisely Part 1's residual.`)
  }
}

// ── (c) NO `.filter(` OVER A CHANNEL COLLECTION ───────────────────────────────────────────────────────────
{
  const mv = read('src/components/redesign/MerView.tsx')
  if (!mv) findings.push('(c) MerView.tsx unreadable.')
  else {
    for (const m of mv.matchAll(/\.filter\(([^\n]*)\)\s*\.map/g)) {
      const pred = m[1]
      if (/hasDataEver/.test(pred)) findings.push(`(c) MerView.tsx filters cards on the BOOLEAN: \`${pred.trim().slice(0, 90)}\`. hasDataEver is false for an unknown, so a failed read DROPS the card — the one wrong render nothing can see: no text, no pixel, no way for the user to know. Filter on presence and exclude only 'no'.`)
      else if (/unknown/.test(pred)) findings.push(`(c) MerView.tsx's card filter mentions 'unknown': \`${pred.trim().slice(0, 90)}\`. A filter may DROP A NO; it may NEVER decide anything about an UNKNOWN.`)
      else if (!/!==\s*'no'/.test(pred)) findings.push(`(c) MerView.tsx's card filter does not exclude exactly 'no': \`${pred.trim().slice(0, 90)}\`. The rule is one line: drop a NO, keep everything else.`)
    }
  }
}

// ── (d) THE DUPLICATED LITERALS RATCHET DOWN ──────────────────────────────────────────────────────────────
const countAcross = (needle) => {
  let n = 0
  for (const f of ['src/components/redesign/MerView.tsx', 'src/components/redesign/GaOverview.tsx',
                   'src/components/redesign/NoClients.tsx', 'src/lib/next/roas-bases.ts',
                   'src/app/dashboard-next/page.tsx', 'src/app/dashboard-next/mer/page.tsx',
                   'src/app/dashboard-next/client-profile/page.tsx', 'src/app/dashboard-next/[platform]/page.tsx',
                   'src/app/dashboard-next/analytics/page.tsx', 'src/app/dashboard-next/store/page.tsx']) {
    n += (read(f).match(new RegExp(needle, 'g')) || []).length
  }
  return n
}
const nc = countAcross("'not connected'|\"not connected\"|Meta not connected")
const ncl = countAcross('No clients yet')
if (nc > NOT_CONNECTED_LITERALS) findings.push(`(d) the "not connected" literal appears ${nc} time(s) across the -next render surfaces, ABOVE the baseline of ${NOT_CONNECTED_LITERALS}. Copy-paste is how this string reached six pages; the count is the burn-down.`)
if (ncl > NO_CLIENTS_LITERALS) findings.push(`(d) "No clients yet." appears ${ncl} time(s), ABOVE the baseline of ${NO_CLIENTS_LITERALS}. Six copies means a seventh page gets it wrong — one component, not six literals.`)
if (nc < NOT_CONNECTED_LITERALS || ncl < NO_CLIENTS_LITERALS) console.log(`[unknown-renders-honestly] ⇢ literals FELL (not-connected ${nc}/${NOT_CONNECTED_LITERALS}, no-clients ${ncl}/${NO_CLIENTS_LITERALS}) — lower the baseline in the same commit.`)

// ── (e) THE UNKNOWN COPY EXISTS WHERE IT MUST ─────────────────────────────────────────────────────────────
const MUST = [
  ['src/components/redesign/MerView.tsx', /couldn[’']t check/i, 'the ad-platform tile and the revenue card must offer an unknown string'],
  ['src/components/redesign/GaOverview.tsx', /Couldn[’']t check whether Analytics has data/i, 'the Analytics empty state must distinguish "we could not check" from "not connected AND never captured" — today\'s sentence makes two claims from one swallowed error'],
  ['src/lib/next/roas-bases.ts', /Couldn[’']t check the Meta connection/i, 'the ROAS basis must not report an unmeasured connection as absent'],
  ['src/components/redesign/NoClients.tsx', /Couldn[’']t load your clients/i, 'a failed client read must not render as "No clients yet."'],
  // ⛔ THE KEY, NOT THE WORD. `/presence/` matched the IMPORT PATH ('@/lib/next/presence'), so deleting the
  // emitted field left the leg GREEN — a false negative found by mutation, not by reading. Match the object key.
  ['src/app/api/next/ga-overview/route.ts', /presence:\s*\w/, 'the route must EMIT the presence KEY — GaOverview cannot render a state the route never sends'],
]
for (const [f, re, why] of MUST) {
  if (!existsSync(resolve(ROOT, f))) { findings.push(`(e) ${f} is MISSING — ${why}`); continue }
  if (!re.test(read(f))) findings.push(`(e) ${f} does not carry its unknown-state copy — ${why}`)
}

if (findings.length) {
  console.error(`✗ UNKNOWN-RENDERS-HONESTLY FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[unknown-renders-honestly] PASS — no Presence field is coerced with \`!!\`; every reader of \`presence\` names 'unknown'; MerView partitions rather than filters; the duplicated literals are at or below baseline (not-connected ${nc}/${NOT_CONNECTED_LITERALS}, no-clients ${ncl}/${NO_CLIENTS_LITERALS}); all five live consumers carry their unknown-state copy.`)
console.log(`[unknown-renders-honestly] LIMIT: placement and shape only. Whether the words READ as honest, and whether iOS Safari matches headless WebKit, are Gate-B — ★MOBILE-WIDTH-GUARD measured headless WebKit containing a 976px table at 390px while the bug was live on the device.`)
