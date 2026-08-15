#!/usr/bin/env node
// LORAMER_BREAKDOWN_MONEY_BINDING_V1 + LORAMER_UNATTESTED_ABSENCE_V1 — GUARD.
//
// TWO LAWS, ONE FILE, because they ship in one commit and fail together:
//  (1) NO RESOLVER BRANCH MAY MAP ZERO-ROWS-WITHOUT-ATTESTATION TO AN INACTIVITY VERDICT. The E7-meta
//      baseline failure was Lora repeating next/coverage.ts's own words: connected+everCaptured+empty was
//      classified 'no_activity_in_window' — "a fact about the account" — while Foam OH meta sat token-dead
//      with 0/90 captured days. Only vendor attestation ("asked, and the vendor named nothing") may license
//      inactivity (★ATTESTED-EMPTY-UNREACHABLE-FROM-LORA — this flight wired it in).
//  (2) EVERY TOOL THAT RETURNS TOTALS OR RANKINGS ROUTES THROUGH DENSITY + BINDING — structure, not advice.
//      A13 QUOTED the coverage note while contradicting it; the binding exists because a key that no longer
//      exists cannot be quoted. A new tool dispatched without a classification here fails the build.
//
// Behavioural legs DRIVE the real transpiled resolvers (the binding was moved to its own import-free file
// precisely so a guard can run it — coverage-binding.ts header). Wiring legs pin source, stated as such.
// HERMETIC: no DB, no network. LORAMER_GUARD_ROOT overrides the tree.
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (ok, msg) => { if (!ok) findings.push(msg) }
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch { return null } }
const codeOnly = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
const require_ = createRequire(resolve(ROOT, 'package.json'))

const TOOLS = 'src/lib/claude-tools.ts'
const BINDING = 'src/lib/lora/coverage-binding.ts'
const COVERAGE = 'src/lib/next/coverage.ts'
const toolsSrc = read(TOOLS), bindingSrc = read(BINDING), coverageSrc = read(COVERAGE)
if (!toolsSrc || !bindingSrc || !coverageSrc) {
  console.error('[breakdown-money-binding] FAIL — cannot read the subject files. A guard that cannot read its subject is not a pass.')
  process.exit(1)
}

// ── TRANSPILE the pure deciders and DRIVE them ────────────────────────────────────────────────────────
const out = mkdtempSync(join(tmpdir(), 'loramer-bmb-'))
const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
const r = spawnSync(tsc, [resolve(ROOT, BINDING), '--target', 'es2020', '--module', 'commonjs', '--outDir', out, '--skipLibCheck'], { encoding: 'utf8' })
let bind
try { bind = require_(join(out, 'coverage-binding.js')) } catch (e) {
  rmSync(out, { recursive: true, force: true })
  console.error(`[breakdown-money-binding] FAIL — could not load the compiled binding (${e.message}; tsc: ${String(r.stdout || '').slice(0, 160)}). BROKEN INSTRUMENT, not a pass.`)
  process.exit(2)
}
for (const fn of ['combineRankingVerdict', 'bindRanking', 'bindMoney']) {
  check(typeof bind[fn] === 'function', `(shape) coverage-binding.ts does not export ${fn} — the structural half of the fix does not exist.`)
}
if (findings.length) { rmSync(out, { recursive: true, force: true }); fail() }

// ── (a) THE ATTESTATION DOOR, driven on the real resolver (via coverage-breakdown-grain's own transpile
//        pattern would repeat work — the resolver legs live THERE; this file drives the COMBINER'S doors). ──
{
  // unattested absence → UNKNOWN, withheld, and mustSay forbids the inactivity claim.
  const d = bind.combineRankingVerdict({ grainVerdict: 'UNKNOWN', grainUnknownReason: 'unattested_absence', grainDetail: 'zero base rows, no attestation', densityVerdict: 'COMPLETE' })
  check(d.verdict === 'UNKNOWN', `(a) unattested absence combined to ${d.verdict}, expected UNKNOWN — an unattributable emptiness must never bind as answerable.`)
  check(/NOT CAPTURED|cannot be confirmed/i.test(d.mustSay) && /NEVER assert the account was inactive|never assert/i.test(d.mustSay),
    `(a) the unattested mustSay does not forbid the inactivity claim — E7's "a real zero, not a capture hole" walks straight back through: ${JSON.stringify(d.mustSay).slice(0, 140)}`)
  check(!/real zero(?!,? and)/i.test(d.mustSay) || /NEVER report a real zero|never.*real zero/i.test(d.mustSay),
    `(a) the unattested mustSay speaks of a real zero without forbidding it.`)
  // attested emptiness → COMPLETE + attestedEmpty — the ONE door, and it must still open (over-refusal is a defect too).
  const a = bind.combineRankingVerdict({ grainVerdict: 'UNKNOWN', grainUnknownReason: 'no_activity_in_window', grainDetail: 'vendor attested', densityVerdict: 'PARTIAL' })
  check(a.verdict === 'COMPLETE' && a.attestedEmpty === true,
    `(a) a VENDOR-ATTESTED empty window combined to ${a.verdict}/attestedEmpty=${a.attestedEmpty}, expected COMPLETE+attestedEmpty — withholding an attested real zero is the over-refusal defect zeroIsReal exists to prevent.`)
}

// ── (b) THE STRUCTURAL MOVE — rows/components leave under a name that carries their standing ───────────
{
  const ranking = { rows: [{ value: 'US-PA', spend: 1 }], window: { startDate: '2026-01-01', endDate: '2026-03-31' } }
  const partial = bind.bindRanking(ranking, { verdict: 'PARTIAL', reason: 'r', mustSay: 'm' })
  check(!('rows' in partial) && Array.isArray(partial.partialRows) && partial.withheld?.mustSay === 'm' && partial.answerable === false,
    `(b) PARTIAL binding did not move rows → partialRows + withheld. Advice is what A13 quoted while contradicting; the key must not exist.`)
  const unknown = bind.bindRanking(ranking, { verdict: 'UNKNOWN', reason: 'r', mustSay: 'm' })
  check(!('rows' in unknown) && Array.isArray(unknown.unverifiedRows) && unknown.answerable === false,
    `(b) UNKNOWN binding did not move rows → unverifiedRows.`)
  const complete = bind.bindRanking(ranking, { verdict: 'COMPLETE', reason: '', mustSay: '' })
  check(Array.isArray(complete.rows) && complete.rows.length === 1 && complete.answerable === true && !('withheld' in complete && complete.withheld),
    `(b) COMPLETE binding damaged the payload — rows must stay byte-identical and answerable. Over-withholding is its own failure.`)
  const attested = bind.bindRanking({ rows: [] }, { verdict: 'COMPLETE', attestedEmpty: true, reason: 'r', mustSay: 'm' })
  check(attested.attestedEmpty === true && attested.emptyIsReal === true && 'rows' in attested,
    `(b) attested-empty binding did not mark emptyIsReal — the one licensed real zero must stay statable.`)
  const money = bind.bindMoney({ components: { net_sales: { value: 5 } } }, { verdict: 'PARTIAL', reason: 'r', mustSay: 'm' })
  check(!('components' in money) && money.partialComponents && money.withheld,
    `(b) PARTIAL money binding did not move components → partialComponents + withheld — query_money stays the unbound door ★HONESTY-ENFORCERS-MISS-GRAIN-ABSENCE named on 2026-08-01.`)
  // The calibrated-threshold pledge: the combiner takes VERDICTS, never day counts — it CANNOT invent a
  // stricter breakdown-only threshold because it has no days to threshold. Pin that shape.
  check(!/DENSITY_HOLE|daysPresent|longestMissingRun/.test(codeOnly(bindingSrc).slice(codeOnly(bindingSrc).indexOf('combineRankingVerdict'))),
    `(b) combineRankingVerdict reads day counts — the calibrated density resolver is the ONLY thresholder; a second threshold here is exactly the re-derivation DENSITY_HOLE_RUN_DAYS's placement exists to prevent.`)
}

// ── (c) THE ROSTER — every dispatched tool that returns totals/rankings is classified ──────────────────
// ⛔ The classification map is the leg (c) pattern from fleet-meter-sees-the-walk: an entry states WHY, and an
// unclassified dispatch fails the build. This is what makes the fix outlive the flight.
{
  const dispatch = [...toolsSrc.matchAll(/tu\.name === '([a-z_]+)'/g)].map((m) => m[1])
  check(dispatch.length >= 4, `(c) could not read the executeToolUses dispatch list (found ${dispatch.length}) — the roster leg is asserting nothing.`)
  const CLASSIFIED = new Map([
    // query_metrics routes through the bindCoverage helper; the helper's own calls are pinned just below.
    ['query_metrics', { fn: 'runQueryMetricsTool', mustCall: ['bindCoverage'] }],
    ['query_breakdown', { fn: 'runQueryBreakdownTool', mustCall: ['bindRanking', 'combineRankingVerdict', 'getDensityForWindow', 'getBreakdownCoverage'] }],
    ['query_money', { fn: 'runQueryMoneyTool', mustCall: ['bindMoney', 'combineRankingVerdict', 'getDensityForWindow'] }],
    // ⛔ CLASSIFIED EXCEPTION, NOT AN EXEMPTION: query_entities returns per-entity metrics — a ranking surface —
    // and is NOT yet bound. Its empty-state language is honest ("an empty result means no entity of that level
    // was captured in that window — say that, never infer a zero") so it does not commit the E7 attribution
    // defect, but an unbound ranking door is a known gap: QUEUE ★ENTITY-RANKING-UNBOUND owns it. Deleting that
    // QUEUE entry without binding the tool re-fails here via the pin below.
    ['query_entities', { fn: 'runQueryEntitiesTool', exception: '★ENTITY-RANKING-UNBOUND' }],
  ])
  for (const name of new Set(dispatch)) {
    const cls = CLASSIFIED.get(name)
    check(!!cls, `(c) tool '${name}' is dispatched in executeToolUses and NOT CLASSIFIED here. Every tool returning totals or rankings must route through density + binding, or carry a classified exception naming its QUEUE item.`)
    if (!cls) continue
    if (cls.mustCall) {
      const body = (toolsSrc.match(new RegExp(`export async function ${cls.fn}[\\s\\S]*?\\n\\}`)) || [''])[0]
      for (const call of cls.mustCall) {
        check(new RegExp(`${call}\\s*\\(`).test(body), `(c) ${cls.fn} does not call ${call} — '${name}' answers without the ${/bind/.test(call) ? 'structural binding' : 'verdict'} and is the unbound door again.`)
      }
    } else if (cls.exception) {
      const queue = read('LORAMER_QUEUE_OF_RECORD.md') || ''
      check(queue.includes(cls.exception), `(c) '${name}' is classified as an exception under ${cls.exception}, but that QUEUE entry does not exist — an exception whose debt is unbanked is just a hole.`)
    }
  }
  // The metrics helper the roster delegates to must itself carry the verdict + the binding.
  const helper = (toolsSrc.match(/async function bindCoverage[\s\S]*?\n\}/) || [''])[0]
  check(/getDensityForWindow\s*\(/.test(helper) && /bindWindow\s*\(/.test(helper),
    `(c) bindCoverage no longer calls getDensityForWindow + bindWindow — query_metrics' structure has been hollowed out behind the roster's back.`)
}

// ── (d) THE RESOLVER SOURCE PIN — the inactivity branch requires the attestation flag ──────────────────
// The resolver's behaviour legs live in coverage-breakdown-grain.guard.mjs (updated with this flight); this
// pin is the cheap tripwire against a revert that also reverts that guard.
{
  const code = codeOnly(coverageSrc)
  check(/attestationCoversWindow === true/.test(code),
    `(d) ${COVERAGE} no longer gates 'no_activity_in_window' on attestationCoversWindow === true — zero-rows-without-attestation can classify as account inactivity again, which is E7-meta verbatim.`)
  check(/unattested_absence/.test(code),
    `(d) ${COVERAGE} no longer carries the 'unattested_absence' reason — the unattributable-emptiness state has lost its name.`)
  check(/attestedEmptyDays\s*\(/.test(code),
    `(d) ${COVERAGE} never reads attestedEmptyDays — the attestation door has no source and can never open, so every empty window withholds forever (silent over-refusal).`)
}

// ── (e) THE TOOL PROSE — the model is told the structure exists ────────────────────────────────────────
{
  const i = toolsSrc.indexOf("name: 'query_breakdown'")
  const desc = toolsSrc.slice(i, toolsSrc.indexOf('input_schema', i))
  check(/unattested_absence/.test(desc) && /NOT CAPTURED|cannot be confirmed/i.test(desc),
    `(e) the query_breakdown description does not teach 'unattested_absence' as NOT-CAPTURED — an enum member with no prose is invisible in practice.`)
  check(/partialRows/.test(desc) && /unverifiedRows/.test(desc),
    `(e) the query_breakdown description does not name partialRows/unverifiedRows — the model cannot follow keys it was never told exist.`)
  // "an empty ranking IS real" may appear ONLY inside attestation context — check the 250 chars BEFORE each
  // occurrence, because the licence reads "…is VENDOR-ATTESTED inactivity … so an empty ranking IS real".
  for (let k = desc.indexOf('empty ranking IS real'); k !== -1; k = desc.indexOf('empty ranking IS real', k + 1)) {
    check(/attest/i.test(desc.slice(Math.max(0, k - 250), k)),
      `(e) the description licenses "an empty ranking IS real" outside attestation context (offset ${k}) — the unattested reader will take the licence.`)
  }
  const j = toolsSrc.indexOf("name: 'query_money'")
  const mdesc = toolsSrc.slice(j, toolsSrc.indexOf('input_schema', j))
  check(/partialComponents/.test(mdesc) && /unverifiedComponents/.test(mdesc),
    `(e) the query_money description does not name partialComponents/unverifiedComponents.`)
}

rmSync(out, { recursive: true, force: true })
function fail() {
  console.error('\n❌ LORAMER_BREAKDOWN_MONEY_BINDING_V1 FAILED — a ranking/money door answers without structure, or absence can still masquerade as inactivity\n')
  findings.forEach((f) => console.error('  • ' + f))
  console.error('')
  process.exit(1)
}
if (findings.length) fail()
console.log('breakdown-money-binding.guard: PASS — unattested absence combines to UNKNOWN with the inactivity claim forbidden, attested emptiness still binds as a real zero, rows/components move structurally on PARTIAL/UNKNOWN, every dispatched tool is classified (query_entities excepted under its banked QUEUE item), the resolver requires the attestation flag, and both tool descriptions teach the new keys.')
