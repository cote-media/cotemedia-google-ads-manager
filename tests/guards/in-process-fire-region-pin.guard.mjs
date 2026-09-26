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
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
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
const pinned = Object.entries(fns).filter(([, v]) => Array.isArray(v?.regions) && v.regions.includes(REGION)).map(([k]) => k)
if (!pinned.length) findings.push(`(b3) vercel.json pins nothing to ${REGION}.`)
for (const k of pinned) if (!existsSync(resolve(ROOT, k))) findings.push(`(b3) vercel.json pins ${k}, which does not exist — a pin on a moved file protects nothing.`)

if (findings.length) {
  console.error(`✗ in-process-fire-region-pin FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`✓ in-process-fire-region-pin OK — ${must.size} route(s) host the fire, the drive or the delete job and every one is pinned to ${REGION}: ${[...must].map((r) => r.replace(/^src\/app\//, '').replace(/\/route\.tsx?$/, '')).join(', ')}.`)
