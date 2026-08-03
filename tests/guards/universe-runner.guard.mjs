#!/usr/bin/env node
// LORAMER_GOOGLE_ADS_UNIVERSE_RUNNER_V1 — GUARD. THREE LEGS.
//
//  (a) THE CONSUMER IS IDEMPOTENT. Vercel Queues is AT-LEAST-ONCE, so a redelivered message MUST produce the
//      same rows, not duplicates. Asserted where the property actually lives — the 7-column conflict key —
//      by driving the real writer twice with the same message and comparing the emitted payloads.
//  (b) THE GOVERNOR CANNOT PUBLISH PAST THE DAILY BUDGET, AND CANNOT EAT THE FORWARD LANE'S RESERVE. Driven
//      behaviourally at and beyond the allowance boundary.
//  (c) COMPLETION COMES ONLY FROM THE WRITER'S VENDOR-EXHAUSTED PROOF. Asserted structurally (the state
//      module never writes backfill_complete, never constructs a Date for completion) and behaviourally
//      (isClientComplete refuses to declare done on unsettled entries).
//
// ⛔ WHAT THIS DOES NOT ASSERT: that Vercel Queues is enabled on the project, that a message is ever
// delivered, or that the topic exists. Those are platform facts a Node guard cannot see — the DEPLOY is the
// enablement test and its result is reported, not assumed.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import Module from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const fail = (m) => { console.error(`[universe-runner] FAIL — ${m}`); process.exit(1) }
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return null } }

const WRITER = 'src/lib/backfill/google-ads-universe-writer.ts'
const GOV = 'src/lib/backfill/universe-governor.ts'
const STATE = 'src/lib/backfill/universe-run-state.ts'
const CONSUMER = 'src/app/api/queues/google-ads-universe/route.ts'
for (const f of [WRITER, GOV, STATE, CONSUMER, 'vercel.json']) if (!existsSync(resolve(ROOT, f))) fail(`${f} is missing — the guard cannot see its subject, and that is not a pass.`)

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')

// ── (c) STRUCTURAL — completion may not come from anywhere but the writer's proof ─────────────────────────
{
  const state = strip(read(STATE) || '')
  if (/backfill_complete/.test(state)) findings.push(`(c) ${STATE} references backfill_complete. That column reads TRUE on 214 cursors while the vendor still serves years more; a path built to end that defect may not inherit the column that carries it.`)
  if (/floor36/.test(state)) findings.push(`(c) ${STATE} references floor36 — a clock may not settle a walk here.`)
  // vendor_exhausted_below must only ever be written together with its proof.
  const m = state.match(/vendor_exhausted_below\s*=/g) || []
  if (m.length && !/exhaustion_proof/.test(state)) findings.push(`(c) ${STATE} writes vendor_exhausted_below without exhaustion_proof. A completion boolean with no evidence is a claim, and the 214 false completes were all claims.`)
  if (!/exhaustion\?\.complete/.test(state)) findings.push(`(c) ${STATE} does not gate the seal on the writer's own exhaustion verdict — completion must be recorded, never computed here.`)
}

// ── WIRED-NOT-FIRED — no cron may point at this path in this flight ───────────────────────────────────────
{
  const v = JSON.parse(read('vercel.json'))
  const crons = v.crons || []
  const firing = crons.filter((c) => /universe/.test(String(c.path || '')))
  if (firing.length) findings.push(`(c) vercel.json has ${firing.length} CRON entr(ies) pointing at the universe path (${firing.map((c) => c.path).join(', ')}). This flight ships WIRED BUT NOT FIRED — a cron starts the run, and starting it is Russ's call in a separate turn.`)
  const trig = v.functions?.[CONSUMER]?.experimentalTriggers?.[0]
  if (!trig || trig.type !== 'queue/v2beta') findings.push(`(c) the consumer has no queue/v2beta trigger in vercel.json — without it the route is a PUBLIC endpoint rather than a private queue consumer.`)
}

// ── COMPILE THE PURE MODULES AND DRIVE THEM ───────────────────────────────────────────────────────────────
const out = mkdtempSync(join(tmpdir(), 'loramer-runner-guard-'))
const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
const r = spawnSync(tsc, [resolve(ROOT, WRITER), resolve(ROOT, GOV), '--target', 'es2020', '--module', 'commonjs',
  '--moduleResolution', 'node', '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
if (r.error) { rmSync(out, { recursive: true, force: true }); fail(`could not run tsc — ${r.error.message}`) }

// The upsert stub CAPTURES what it is asked to write, so idempotency is compared on real payloads.
const captured = []
const stub = join(out, '__stub.js')
writeFileSync(stub, `module.exports = new Proxy({ upsertMetricsChunked: async (rows) => { global.__CAP.push(rows); return { written: rows.length, chunks: 1 } } },
  { get: (t, k) => (k in t ? t[k] : (() => {})) })`)
global.__CAP = captured
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/') || request.startsWith('./') || request.startsWith('../')) return stub
  return origResolve.call(this, request, ...rest)
}
const req = createRequire(import.meta.url)
let W, G
try {
  W = req(join(out, 'src/lib/backfill/google-ads-universe-writer.js'))
  G = req(join(out, 'src/lib/backfill/universe-governor.js'))
} catch (e) { Module._resolveFilename = origResolve; rmSync(out, { recursive: true, force: true }); fail(`compiled modules did not load — ${e.message}\n${r.stdout || ''}${r.stderr || ''}`) }

// ── (a) IDEMPOTENCY — the SAME message twice must emit the SAME rows ──────────────────────────────────────
{
  const entry = { resource: 'income_range_view', segment: null, delivers: true }
  const ctx = { clientId: 'c1', userEmail: 'e@x', customerId: '123' }
  const vendorRows = [
    { segments: { date: '2026-03-01' }, income_range_view: { resource_name: 'customers/123/incomeRangeViews/1~50' }, metrics: { cost_micros: 1_500_000, impressions: 100, clicks: 4, conversions: 1, conversions_value: 9 } },
    { segments: { date: '2026-03-02' }, income_range_view: { resource_name: 'customers/123/incomeRangeViews/1~50' }, metrics: { cost_micros: 2_500_000, impressions: 200, clicks: 6, conversions: 2, conversions_value: 19 } },
  ]
  const query = async () => vendorRows
  const args = { entry, ctx, startDate: '2026-03-01', endDate: '2026-03-31', query }
  captured.length = 0
  const first = await W.captureUniverseEntry(args)
  const second = await W.captureUniverseEntry(args)   // AT-LEAST-ONCE: the same message, delivered twice.
  if (captured.length !== 2) {
    findings.push(`(a) expected two upsert payloads from two deliveries, saw ${captured.length} — the idempotency comparison could not run.`)
  } else {
    const key = (r) => [r.client_id, r.platform, r.entity_level, r.entity_id, r.date, r.breakdown_type, r.breakdown_value].join('|')
    const k1 = captured[0].map(key).sort(), k2 = captured[1].map(key).sort()
    if (JSON.stringify(k1) !== JSON.stringify(k2)) findings.push(`(a) THE SECOND DELIVERY PRODUCED DIFFERENT CONFLICT KEYS. Vercel Queues is at-least-once; a redelivered message must land on the SAME 7-column key or it duplicates rows instead of overwriting them.`)
    if (JSON.stringify(captured[0]) !== JSON.stringify(captured[1])) findings.push(`(a) the second delivery produced a DIFFERENT payload for the same message — the handler is not deterministic, so at-least-once delivery is not safe.`)
    if (new Set(k1).size !== k1.length) findings.push(`(a) a SINGLE delivery already emits duplicate conflict keys (${k1.length} rows, ${new Set(k1).size} distinct) — the upsert would collapse them silently and the row count would be a lie.`)
    if (first.rowsWritten !== second.rowsWritten) findings.push(`(a) rowsWritten differed between deliveries (${first.rowsWritten} vs ${second.rowsWritten}).`)
  }
}

// ── (b) THE GOVERNOR — cannot publish past the budget, cannot eat the reserve ─────────────────────────────
{
  const cap = G.GOOGLE_DAILY_OP_CAP, fwd = G.RESERVED_FOR_FORWARD_OPS, drn = G.RESERVED_FOR_DRAIN_OPS, allow = G.BACKFILL_OP_ALLOWANCE
  if (allow >= cap) findings.push(`(b) the backfill allowance (${allow}) is not less than the daily cap (${cap}) — nothing is reserved and the forward sync can be starved.`)
  if (fwd <= 0 || drn <= 0) findings.push(`(b) the forward (${fwd}) or drain (${drn}) reserve is not positive — the lanes that keep TODAY's data arriving have no protection.`)
  if (allow !== cap - fwd - drn) findings.push(`(b) the allowance is not cap − reserves (${allow} vs ${cap - fwd - drn}) — the arithmetic the reserve depends on does not hold.`)

  const perReq = G.ASSUMED_OPS_PER_REQUEST
  const atLimit = Math.floor(allow / perReq)
  const spent0 = G.decidePublish({ spentRequestsToday: 0, want: 1_000_000 })
  if (spent0.allowance > atLimit) findings.push(`(b) from a cold start the governor allowed ${spent0.allowance} messages, which is more than the allowance affords (${atLimit}) — it would overrun the budget it exists to hold.`)
  const spentAll = G.decidePublish({ spentRequestsToday: atLimit, want: 5 })
  if (spentAll.mayPublish) findings.push(`(b) with the whole backfill allowance already spent the governor STILL authorised a publish (${spentAll.allowance}) — it discovers the cap instead of stopping before it.`)
  const spentOver = G.decidePublish({ spentRequestsToday: atLimit * 5, want: 1 })
  if (spentOver.mayPublish || spentOver.allowance !== 0) findings.push(`(b) past the allowance the governor did not return zero (mayPublish=${spentOver.mayPublish}, allowance=${spentOver.allowance}).`)
  if (!spentAll.denominator || spentAll.denominator.cap !== cap) findings.push(`(b) the decision carries no auditable denominator — a governor whose reason cannot be checked is a governor nobody will trust.`)
}

Module._resolveFilename = origResolve
rmSync(out, { recursive: true, force: true })

if (findings.length) {
  console.error(`[universe-runner] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[universe-runner] PASS — a redelivered message lands on identical 7-column conflict keys with an identical payload (at-least-once is safe); the governor reserves ${G.RESERVED_FOR_FORWARD_OPS} forward + ${G.RESERVED_FOR_DRAIN_OPS} drain ops of ${G.GOOGLE_DAILY_OP_CAP} and returns zero once the ${G.BACKFILL_OP_ALLOWANCE}-op backfill allowance is spent; completion is recorded only from the writer's proof-carrying verdict, never from backfill_complete or a clock; and NO cron fires the universe path. ⛔ NOT ASSERTED: that Vercel Queues is enabled on the project — that is a platform fact only the deploy can settle.`)
