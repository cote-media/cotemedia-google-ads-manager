#!/usr/bin/env node
// LORAMER_DRAIN_EXTENDED_DURATION_V1 — GUARD THE >800s BETA CONDITIONS THAT ARE ACTUALLY CHECKABLE,
// AND SAY OUT LOUD WHICH ONES ARE NOT.
//
// ── WHY ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// /api/cron/drain runs at maxDuration 1800, which is Vercel's EXTENDED MAX DURATION and is in BETA. Quoted from
// https://vercel.com/docs/functions/configuring-functions/duration (read 2026-08-01):
//   "Pro and Enterprise teams can set individual Vercel Functions using supported Node.js and Python runtime
//    versions to run for up to 30 minutes."
//   "During the beta, durations above 800 seconds must be configured for each function in code or in vercel.json.
//    Project-level defaults above 800 seconds are not supported yet."
//   "Secure Compute and Static IPs do not support durations above 800 seconds during the beta."
// Supported runtimes during the beta: nodejs20.x, nodejs22.x, nodejs24.x, python3.12, python3.13, python3.14.
//
// ── WHAT WAS VERIFIED LIVE, 2026-08-01, BEFORE THE VALUE WAS RAISED ─────────────────────────────────────────────
//   · nodeVersion "24.x"                                    → in the supported set
//   · resourceConfig.fluid = true, defaultResourceConfig.fluid = true → fluid compute ON
//   · GET /v1/connect/networks?teamId=…  → []                → no Secure Compute
//   · GET /v1/projects/<id>/shared-connect-links → 404       → no Static IPs
//   · project connectConfigurations / passiveConnectConfigurations → null
//
// ── ⛔ THE HONEST LIMIT, STATED RATHER THAN IMPLIED AWAY ─────────────────────────────────────────────────────────
// TWO OF THE FOUR ELIGIBILITY CONDITIONS ARE NOT MECHANICALLY CHECKABLE FROM THIS REPO, AND THIS GUARD DOES NOT
// PRETEND OTHERWISE. The Node runtime version and the Secure-Compute / Static-IP status are VERCEL PROJECT
// SETTINGS. They live in the dashboard and the Vercel API, not in any committed file: package.json has no
// `engines` block and there is no .nvmrc, so nothing in the repo declares the runtime. A guard that claimed to
// verify them would be manufacturing false confidence, which FIX-WITH-GUARD explicitly forbids ("If a mechanical
// guard is genuinely not achievable for a rule, SAY SO plainly rather than shipping a check that manufactures
// false confidence"). Also note this guard is HERMETIC by requirement — it runs inside `npm run build` on Vercel,
// where there is no Vercel API token and no network budget, so it could not perform those reads even in principle.
// WHAT WOULD CLOSE THE GAP: pinning `engines.node` in package.json would make the runtime condition checkable
// in-repo. That is a PROJECT-WIDE runtime declaration and therefore wider than this flight's stated blast radius
// (one route's config), so it is NOT done here — QUEUE ★DRAIN-DURATION-ELIGIBILITY-PIN.
// RE-CHECK COMMAND for the two uncheckable conditions (needs a Vercel token; run by hand, not in CI):
//   curl -H "Authorization: Bearer $TOKEN" "https://api.vercel.com/v9/projects/<prj>?teamId=<team>"
//   curl -H "Authorization: Bearer $TOKEN" "https://api.vercel.com/v1/connect/networks?teamId=<team>"
//
// ── WHAT THIS GUARD DOES ASSERT ─────────────────────────────────────────────────────────────────────────────────
// Only when the drain route's maxDuration EXCEEDS 800 (at or below it, there is nothing to assert):
//   A. it must not exceed 1800 — the Pro/Enterprise extended maximum
//   B. no OTHER route may exceed 800 — extended duration stays scoped to the one function that was cleared for it
//   C. vercel.json must declare no `functions` maxDuration above 800 — project/glob defaults above 800 are
//      unsupported during the beta, and a glob is how one would silently become a default
//   D. the route must still carry the eligibility marker, so the four live-verified conditions and the date they
//      were read cannot quietly vanish from the file that depends on them
//   E. BUDGET_MS must leave the route actually able to use the ceiling. A 1800s ceiling under a 680s internal
//      budget is a no-op that LOOKS like a change — the exact trap this flight nearly shipped.
//
// USAGE: node tests/guards/drain-extended-duration.guard.mjs [--inject-overscope]
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const read = (rel) => { try { return readFileSync(path.resolve(ROOT, rel), 'utf8') } catch { return null } }

export const GA_MAX = 800
export const EXTENDED_MAX = 1800
const DRAIN_ROUTE = 'src/app/api/cron/drain/route.ts'
const MARKER = 'LORAMER_DRAIN_EXTENDED_DURATION_V1'

// --inject-overscope : mutation proof. Injects a SECOND route above the GA max into the check's INPUT (in memory,
//                      no file written), which is the state assertion B must go RED on.
const INJECT_OVERSCOPE = process.argv.includes('--inject-overscope')

// ── PURE CORE — the decision, so the mutation proof drives the real logic and not a copy of it ───────────────────
export function decideExtendedDuration({ drainMax, otherRoutesOverGa, vercelGlobsOverGa, hasMarker, budgetMs }) {
  const findings = []
  if (drainMax === null) {
    return { checked: false, findings: [`could not parse "export const maxDuration" from ${DRAIN_ROUTE} — BROKEN INSTRUMENT`], broken: true }
  }
  if (drainMax <= GA_MAX) return { checked: true, findings: [], broken: false } // nothing to assert
  if (drainMax > EXTENDED_MAX) findings.push(`A: ${DRAIN_ROUTE} maxDuration=${drainMax} exceeds the Pro/Enterprise extended maximum of ${EXTENDED_MAX}s.`)
  for (const r of otherRoutesOverGa) findings.push(`B: ${r.file} maxDuration=${r.value} exceeds ${GA_MAX}s. Extended duration is cleared for the drain route ONLY.`)
  for (const g of vercelGlobsOverGa) findings.push(`C: vercel.json functions["${g.pattern}"].maxDuration=${g.value} exceeds ${GA_MAX}s. Project-level defaults above 800s are unsupported during the beta.`)
  if (!hasMarker) findings.push(`D: ${DRAIN_ROUTE} runs above ${GA_MAX}s but no longer carries the ${MARKER} eligibility marker. The verified beta conditions must stay attached to the value that depends on them.`)
  if (budgetMs !== null && budgetMs <= GA_MAX * 1000) findings.push(`E: BUDGET_MS=${budgetMs} caps work below the ${GA_MAX}s GA ceiling while maxDuration=${drainMax}. The raised ceiling would be a NO-OP that looks like a change.`)
  return { checked: true, findings, broken: false }
}

// ── INPUTS ──────────────────────────────────────────────────────────────────────────────────────────────────────
const drainSrc = read(DRAIN_ROUTE)
if (!drainSrc) { console.error(`✗ ${DRAIN_ROUTE} unreadable — BROKEN INSTRUMENT, not a pass.`); process.exit(2) }
const mdMatch = drainSrc.match(/^export const maxDuration = (\d+)/m)
const drainMax = mdMatch ? Number(mdMatch[1]) : null
const budgetMatch = drainSrc.match(/^const BUDGET_MS = ([\d_]+)/m)
const budgetMs = budgetMatch ? Number(budgetMatch[1].replace(/_/g, '')) : null
const hasMarker = drainSrc.includes(MARKER)

// Every OTHER route's maxDuration, derived from the source tree — never a hardcoded list, so a new route above
// the GA max is caught the day it lands (FIX-WITH-GUARD: guard the class, not today's instance).
import { execFileSync } from 'node:child_process'
let routeLines = ''
try {
  routeLines = execFileSync('grep', ['-rn', '--include=route.ts', '-E', '^export const maxDuration = [0-9]+', 'src'], { cwd: ROOT, encoding: 'utf8' })
} catch { routeLines = '' } // grep exits 1 on no matches
const otherRoutesOverGa = []
for (const line of routeLines.split('\n')) {
  const m = line.match(/^([^:]+):\d+:export const maxDuration = (\d+)/)
  if (!m) continue
  const [, file, val] = m
  if (file.replace(/\\/g, '/') === DRAIN_ROUTE) continue
  if (Number(val) > GA_MAX) otherRoutesOverGa.push({ file, value: Number(val) })
}
if (INJECT_OVERSCOPE) {
  otherRoutesOverGa.push({ file: 'src/app/api/SYNTHETIC/route.ts', value: 1800 })
  console.log('  [--inject-overscope] injected ONE synthetic route at 1800s into the input (no file written) — assertion B must go RED.')
}

const vercelRaw = read('vercel.json')
const vercelGlobsOverGa = []
if (vercelRaw) {
  try {
    const fns = JSON.parse(vercelRaw).functions || {}
    for (const [pattern, cfg] of Object.entries(fns)) {
      if (cfg && typeof cfg.maxDuration === 'number' && cfg.maxDuration > GA_MAX) vercelGlobsOverGa.push({ pattern, value: cfg.maxDuration })
    }
  } catch (e) {
    console.error(`✗ vercel.json is not valid JSON (${e.message}) — BROKEN INSTRUMENT, not a pass.`); process.exit(2)
  }
}

// ── REPORT, ALWAYS WITH ITS DENOMINATOR ─────────────────────────────────────────────────────────────────────────
const verdict = decideExtendedDuration({ drainMax, otherRoutesOverGa, vercelGlobsOverGa, hasMarker, budgetMs })
const routeCount = routeLines.split('\n').filter((l) => /export const maxDuration/.test(l)).length
console.log(`[drain-extended-duration] ${DRAIN_ROUTE} maxDuration=${drainMax} · BUDGET_MS=${budgetMs} · marker ${hasMarker ? 'present' : 'MISSING'}`)
console.log(`[drain-extended-duration] examined ${routeCount} route(s) declaring maxDuration and ${vercelGlobsOverGa.length + (vercelRaw ? Object.keys(JSON.parse(vercelRaw).functions || {}).length : 0)} vercel.json functions entr(ies)`)
console.log(`[drain-extended-duration] NOT CHECKABLE HERE (project settings, verified live 2026-08-01 by hand): Node runtime version · Secure Compute · Static IPs. See this file's header for the re-check commands.`)
if (verdict.broken) { console.error(`✗ ${verdict.findings.join(' ')}`); process.exit(2) }
if (verdict.findings.length) {
  console.error(`✗ drain-extended-duration FAIL — ${verdict.findings.length} finding(s):`)
  for (const f of verdict.findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(drainMax > GA_MAX
  ? `✓ drain-extended-duration OK — ${drainMax}s is within the extended max, scoped to this route alone, no project default above ${GA_MAX}s, marker present, budget consistent.`
  : `✓ drain-extended-duration OK — ${drainMax}s is at or below the GA max; nothing to assert.`)
process.exit(0)
