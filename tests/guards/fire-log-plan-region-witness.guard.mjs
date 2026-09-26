#!/usr/bin/env node
// LORAMER_PLAN_PHASE_REGION_INDEX_V1 — leg (d): THE FIRE ROW SAYS WHERE IT RAN AND HOW LONG IT PLANNED.
//
// ⛔ WHY: rounds 352–353 of 2026-09-26 had to reconstruct a fire's plan time from attempt-row timestamps and infer its
// region from a deployment manifest, because neither was durable. The scan time lived only in the FIRE console line
// (`scanMs`, expired in an hour) and the region nowhere. The region is the fact that separated "slow reads" from
// "reads across the country"; plan time is the number the whole plan-phase change is graded on.
//
// LEGS
//  (d1) migrations/109 adds plan_ms integer and region text to universe_fire_log, nullable (NULL = "this exit never
//       reached planning" / a pre-witness row — never 0 or '')
//  (d2) fireHeartbeat's insert writes region from process.env.VERCEL_REGION (the runtime's own answer) and plan_ms
//  (d3) the completed heartbeat passes planMs measured from the fire's start to the end of planning (captureStartedAt)
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' } }

const MIG = 'migrations/109_universe_fire_log_plan_and_region.sql'
const RESUME = 'src/app/api/cron/universe-resume/route.ts'

const mig = read(MIG).replace(/--.*$/gm, '')
check(/alter table public\.universe_fire_log add column if not exists plan_ms integer\s*;/.test(mig), `(d1) ${MIG}: must add \`plan_ms integer\` to universe_fire_log, nullable.`)
check(/alter table public\.universe_fire_log add column if not exists region text\s*;/.test(mig), `(d1) ${MIG}: must add \`region text\` to universe_fire_log, nullable.`)
check(!/not null|default/i.test(mig), `(d1) ${MIG}: the witness columns must be nullable with no default — NULL is how a reader tells "never measured" from a value.`)

const resume = read(RESUME)
const i = resume.indexOf('const fireHeartbeat')
const hb = i === -1 ? '' : resume.slice(i, i + 4000)
check(/region:\s*process\.env\.VERCEL_REGION\s*\?\?\s*null/.test(hb), `(d2) ${RESUME}: fireHeartbeat's insert must write \`region: process.env.VERCEL_REGION ?? null\` — the runtime's own region, on every exit.`)
check(/plan_ms:\s*h\.planMs\s*\?\?\s*null/.test(hb), `(d2) ${RESUME}: fireHeartbeat's insert must write \`plan_ms: h.planMs ?? null\`.`)
const j = resume.lastIndexOf("fireOutcome: 'completed'")
const done = j === -1 ? '' : resume.slice(j, j + 2500)
check(/planMs:\s*captureStartedAt\s*-\s*startedAt/.test(done), `(d3) ${RESUME}: the completed heartbeat must pass \`planMs: captureStartedAt - startedAt\` — the same clock the instrument reports as scanMs.`)

if (findings.length) {
  console.error(`✗ fire-log-plan-region-witness FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('✓ fire-log-plan-region-witness OK — migration 109 adds plan_ms and region nullable, the heartbeat writes the runtime region on every exit, and the completed fire records its plan time.')
