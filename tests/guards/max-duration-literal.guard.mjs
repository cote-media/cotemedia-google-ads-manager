#!/usr/bin/env node
// LORAMER_PLAN_PHASE_REGION_INDEX_V1 — leg (a): EVERY ROUTE'S maxDuration IS A LITERAL THE BUILD CAN READ.
//
// ⛔ WHAT THIS COST, measured 2026-09-26 (round 353): `export const maxDuration = CONSUMER_MAX_DURATION_S` in
// universe-resume and universe-drive compiled to `{}` in .next/server/functions-config-manifest.json — the build does
// not evaluate an imported constant — so Vercel applied the project default (functionDefaultTimeout 300). The live
// lambdas ran at timeout 300 while FIRE_WORK_BUDGET_MS admitted work to 582,000 ms and LEASE_TTL_S held 630 s. The
// "600 s ceiling" of LORAMER_FIRE_CEILING_600_V1 had never deployed. It was invisible for as long as the constant was
// 300, because the default happened to match. A killed fire writes no heartbeat, so universe_fire_log could not show it.
//
// ⛔ WHY TWO LEGS. The SOURCE leg (default) catches the shape before anything builds. The MANIFEST leg (`--manifest`,
// run by `postbuild`) reads what the build actually emitted, because the source guard that pinned the constant was
// green the whole time the deployed value was wrong — a source check proves the intent, only the manifest proves the
// artifact.
//
// LEGS
//  (a1) every `export const maxDuration` under src/app is a bare numeric literal
//  (a2) universe-resume and universe-drive declare exactly CONSUMER_MAX_DURATION_S (read from the contract, never retyped)
//  (a3) --manifest: every such route's entry in functions-config-manifest.json carries that same maxDuration; `{}` FAILS
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const MANIFEST_MODE = process.argv.includes('--manifest')
const findings = []
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' } }

const CONTRACT = 'src/lib/backfill/universe-v2-contract.ts'
const CEILING_ROUTES = ['src/app/api/cron/universe-resume/route.ts', 'src/app/api/backfill/universe-drive/route.ts']

const walk = (dir) => {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (name === 'route.ts' || name === 'route.tsx') out.push(p)
  }
  return out
}

const contract = read(CONTRACT)
const ceilingM = contract.match(/export const CONSUMER_MAX_DURATION_S\s*=\s*(\d+)/)
if (!ceilingM) findings.push(`(a2) ${CONTRACT}: cannot read \`export const CONSUMER_MAX_DURATION_S = <n>\` — the ceiling the two engine routes must declare.`)
const ceiling = ceilingM ? Number(ceilingM[1]) : null

const declared = new Map() // rel path → literal seconds
const nonLiteral = [] // rel paths whose maxDuration the build cannot read
for (const abs of walk(resolve(ROOT, 'src/app'))) {
  const rel = relative(ROOT, abs)
  const src = readFileSync(abs, 'utf8')
  const line = src.split('\n').find((l) => /^export const maxDuration\b/.test(l))
  if (!line) continue
  const m = line.match(/^export const maxDuration\s*=\s*(\d+)\s*(\/\/.*)?$/)
  if (!m) {
    nonLiteral.push(rel)
    findings.push(`(a1) ${rel}: \`${line.trim()}\` is not a numeric literal. The build does not evaluate expressions or imports here — it emits \`{}\` and Vercel runs the route at the project default (300 s). Write the number.`)
    continue
  }
  declared.set(rel, Number(m[1]))
}
for (const rel of CEILING_ROUTES) {
  if (!declared.has(rel)) { if (!findings.some((f) => f.includes(rel))) findings.push(`(a2) ${rel}: no literal \`export const maxDuration\` found.`); continue }
  if (ceiling !== null && declared.get(rel) !== ceiling) {
    findings.push(`(a2) ${rel}: maxDuration ${declared.get(rel)} ≠ CONSUMER_MAX_DURATION_S ${ceiling}. FIRE_WORK_BUDGET_MS and LEASE_TTL_S are derived from the contract constant; the route's ceiling must be the same number.`)
  }
}

if (MANIFEST_MODE) {
  const MANIFEST = '.next/server/functions-config-manifest.json'
  let manifest = null
  try { manifest = JSON.parse(readFileSync(resolve(ROOT, MANIFEST), 'utf8')) } catch (e) { findings.push(`(a3) UNREADABLE ${MANIFEST} — ${e.message}. Run after \`next build\`; without the artifact this leg proves nothing and FAILS.`) }
  const fns = manifest ? (manifest.functions ?? manifest) : {}
  const keyOf = (rel) => '/' + rel.replace(/^src\/app\//, '').replace(/\/route\.tsx?$/, '')
  for (const rel of nonLiteral) {
    const entry = fns[keyOf(rel)]
    if (entry && entry.maxDuration === undefined) findings.push(`(a3) ${MANIFEST}: ${keyOf(rel)} → ${JSON.stringify(entry)} — the build emitted NO maxDuration for it, so the deployed function runs at the platform default.`)
  }
  for (const [rel, secs] of declared) {
    const key = keyOf(rel)
    const entry = fns[key]
    if (!entry) { findings.push(`(a3) ${MANIFEST}: no entry for ${key} (declared ${secs} s in ${rel}).`); continue }
    if (entry.maxDuration !== secs) {
      findings.push(`(a3) ${MANIFEST}: ${key} → ${JSON.stringify(entry)} but ${rel} declares ${secs}. The deployed function runs at what the MANIFEST says, not what the source says.`)
    }
  }
}

if (findings.length) {
  console.error(`✗ max-duration-literal FAILED${MANIFEST_MODE ? ' (manifest leg)' : ''} — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`✓ max-duration-literal OK${MANIFEST_MODE ? ' (manifest leg)' : ''} — ${declared.size} route(s) declare a literal maxDuration; universe-resume and universe-drive declare ${ceiling} = CONSUMER_MAX_DURATION_S${MANIFEST_MODE ? '; the build manifest carries every one of them' : ''}.`)
