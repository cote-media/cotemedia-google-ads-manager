#!/usr/bin/env node
// LORAMER_PLAN_PHASE_REGION_INDEX_V1 — leg (b): EVERY ROUTE THAT HOSTS A FIRE OR THE DELETE JOB RUNS BESIDE THE DATABASE.
//
// ⛔ WHAT THIS COST, measured 2026-09-26 (rounds 352–353): the scheduled fire (/api/cron/universe-resume) was pinned to
// pdx1 on 2026-08-22 (LORAMER_WALK_REGION_PIN_PDX1_V1 — scan 118.5 s → 47.5 s), but a pressed Backfill does not run
// there. It runs IN-PROCESS inside /api/cron/universe-run-pump and /api/backfill/universe-run (universe-run-fire.ts
// imports the resume handler), and the Google delete job runs inside /api/cron/google-delete-pump and
// /api/clients/google/delete-data. All four deployed to iad1 (the project default) while the database is
// aws-1-us-west-2 — so every one of a Tri-Copy fire's ~10–14 serial plan reads per surface crossed the continent.
// The pin followed the FILE the fire lived in, not the CODE; a second host of the same code inherited nothing.
//
// ⛔ SO THE RULE IS STATED ON THE IMPORT, NOT ON A LIST OF ROUTES. Any route that imports the in-process fire, the
// resume handler or the delete job must carry `"regions": ["pdx1"]` in vercel.json — a fifth host added tomorrow is
// caught by what it imports.
//
// LEGS
//  (b1) every src/app route importing universe-run-fire, the universe-resume route module, or google-delete/job is
//       pinned to ["pdx1"] in vercel.json `functions`
//  (b2) universe-resume and universe-drive themselves stay pinned (the fire and the drive)
//  (b3) the pinned set is non-empty and each pinned key names a file that exists
//  (b4) every fire host has a next.config outputFileTracingIncludes entry for the catalog
//  (b5) --traces (run by `postbuild`): every fire host's BUILT trace (.next/server/app/<route>/route.js.nft.json) contains
//       every file the fire reads at runtime. The file list is DERIVED — every `readFileSync(resolve(<root>, '<path>'))`
//       literal in the fire's import closure — never retyped. LORAMER_IN_PROCESS_FIRE_BUNDLES_CATALOG_V1: config says
//       what we asked for; only the trace says what the function will hold.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { resolve, join, relative, dirname } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const TRACES_MODE = process.argv.includes('--traces')
const findings = []
const REGION = 'pdx1' // the database's own AWS region (us-west-2) — LORAMER_WALK_REGION_PIN_PDX1_V1

let vercel = null
try { vercel = JSON.parse(readFileSync(resolve(ROOT, 'vercel.json'), 'utf8')) } catch (e) { findings.push(`UNREADABLE vercel.json — ${e.message}. A guard that cannot read its evidence FAILS.`) }
const fns = (vercel && vercel.functions) || {}

const walk = (dir) => {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (name === 'route.ts' || name === 'route.tsx') out.push(p)
  }
  return out
}
const HOST_IMPORT = /from\s+['"]@\/(lib\/backfill\/universe-run-fire|app\/api\/cron\/universe-resume\/route|lib\/google-delete\/job)['"]/
const must = new Set(['src/app/api/cron/universe-resume/route.ts', 'src/app/api/backfill/universe-drive/route.ts'])
for (const abs of walk(resolve(ROOT, 'src/app'))) {
  const rel = relative(ROOT, abs)
  const m = readFileSync(abs, 'utf8').match(HOST_IMPORT)
  if (m) must.add(rel)
}
for (const rel of must) {
  const cfg = fns[rel]
  const regions = cfg && Array.isArray(cfg.regions) ? cfg.regions : null
  if (!regions || regions.length !== 1 || regions[0] !== REGION) {
    findings.push(`(b1/b2) ${rel} hosts the fire or the delete job but vercel.json functions["${rel}"].regions is ${JSON.stringify(regions)} — must be ["${REGION}"]. Unpinned, it deploys to the project default (iad1) and every serial read crosses to us-west-2.`)
  }
}
// (b4) LORAMER_IN_PROCESS_FIRE_BUNDLES_CATALOG_V1 — every host of the FIRE (not the delete job, which reads no catalog)
// traces the catalog file itself. MEASURED 2026-09-26 03:55:35Z: the pump and the press had no entry and worked only
// because Vercel grouped them into forward-driver's function; the region pin split the group and every pump fire
// ENOENTed on /var/task/docs/google-ads-capture-universe.json. A borrowed file is not a bundled file.
const FIRE_IMPORT = /from\s+['"]@\/(lib\/backfill\/universe-run-fire|app\/api\/cron\/universe-resume\/route)['"]/
let nextCfg = ''
try { nextCfg = readFileSync(resolve(ROOT, 'next.config.js'), 'utf8') } catch (e) { findings.push(`(b4) UNREADABLE next.config.js — ${e.message}.`) }
const fireHosts = new Set(['src/app/api/cron/universe-resume/route.ts', 'src/app/api/backfill/universe-drive/route.ts'])
for (const abs of walk(resolve(ROOT, 'src/app'))) {
  const rel = relative(ROOT, abs)
  if (FIRE_IMPORT.test(readFileSync(abs, 'utf8'))) fireHosts.add(rel)
}
for (const rel of fireHosts) {
  const key = '/' + rel.replace(/^src\/app\//, '').replace(/\/route\.tsx?$/, '')
  const esc = key.replace(/[/.-]/g, (c) => '\\' + c)
  if (!new RegExp(`'${esc}':\\s*\\[[^\\]]*'\\./docs/google-ads-capture-universe\\.json'`).test(nextCfg)) {
    findings.push(`(b4) next.config.js outputFileTracingIncludes has no '${key}': ['./docs/google-ads-capture-universe.json'] — ${rel} runs the fire, the fire calls loadUniverse(), and the tracer cannot see its computed path. Without the entry the file is present only while Vercel happens to group this route with one that has it.`)
  }
}

// (b5) --traces — the BUILT trace of every fire host carries every file the fire reads at runtime.
let runtimeFiles = []
if (TRACES_MODE) {
  // The fire's import closure, from the resume handler and the in-process fire (the code every fire host runs).
  const resolveSpec = (from, spec) => {
    let base
    if (spec.startsWith('@/')) base = resolve(ROOT, 'src', spec.slice(2))
    else if (spec.startsWith('.')) base = resolve(dirname(from), spec)
    else return null
    for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}/index.ts`]) {
      try { if (statSync(c).isFile()) return c } catch {}
    }
    return null
  }
  const seen = new Set()
  const queue = ['src/app/api/cron/universe-resume/route.ts', 'src/lib/backfill/universe-run-fire.ts'].map((p) => resolve(ROOT, p))
  while (queue.length) {
    const f = queue.pop()
    if (seen.has(f)) continue
    seen.add(f)
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const r = resolveSpec(f, m[1] || m[2])
      if (r && !seen.has(r)) queue.push(r)
    }
  }
  const files = new Set()
  for (const f of seen) {
    for (const m of readFileSync(f, 'utf8').matchAll(/readFileSync\(\s*resolve\(\s*\w+\s*,\s*'([^']+)'\s*\)/g)) files.add(m[1])
  }
  runtimeFiles = [...files].sort()
  if (!runtimeFiles.length) findings.push(`(b5) derived NO runtime file reads from the fire's import closure (${seen.size} files) — the derivation broke; a guard that finds nothing to check proves nothing.`)
  for (const rel of fireHosts) {
    const trace = resolve(ROOT, '.next/server/app', rel.replace(/^src\/app\//, '').replace(/\.tsx?$/, '.js.nft.json'))
    let traced = null
    try { traced = JSON.parse(readFileSync(trace, 'utf8')).files } catch (e) { findings.push(`(b5) UNREADABLE ${relative(ROOT, trace)} — ${e.message}. Run after \`next build\`; without the trace this leg proves nothing and FAILS.`); continue }
    for (const need of runtimeFiles) {
      if (!traced.some((t) => t.endsWith(need))) findings.push(`(b5) ${relative(ROOT, trace)} does not trace ${need}. ${rel} runs the fire and the fire reads it at runtime — deployed, it ENOENTs (measured 2026-09-26 03:55:35Z on universe-run-pump).`)
    }
  }
}

const pinned = Object.entries(fns).filter(([, v]) => Array.isArray(v?.regions) && v.regions.includes(REGION)).map(([k]) => k)
if (!pinned.length) findings.push(`(b3) vercel.json pins nothing to ${REGION}.`)
for (const k of pinned) if (!existsSync(resolve(ROOT, k))) findings.push(`(b3) vercel.json pins ${k}, which does not exist — a pin on a moved file protects nothing.`)

if (findings.length) {
  console.error(`✗ in-process-fire-region-pin FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
if (TRACES_MODE) console.log(`✓ in-process-fire-region-pin OK (traces leg) — ${fireHosts.size} fire host(s) trace every runtime file the fire reads: ${runtimeFiles.join(', ')}.`)
console.log(`✓ in-process-fire-region-pin OK — ${must.size} route(s) host the fire, the drive or the delete job and every one is pinned to ${REGION}: ${[...must].map((r) => r.replace(/^src\/app\//, '').replace(/\/route\.tsx?$/, '')).join(', ')}.`)
