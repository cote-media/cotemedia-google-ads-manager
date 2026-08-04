#!/usr/bin/env node
// LORAMER_UNIVERSE_WINDOW_LOG_V1 — THE FIX-WITH-GUARD HALF.
//
// ⛔ WHAT THIS PROTECTS. The universe walk is the only lane in this repo that runs UNATTENDED FOR DAYS
// while writing to the live table. Three properties make that safe, and all three are the kind that
// look fine in review and fail silently in production:
//
//   (a) THE DISK FLOOR IS CHECKED BEFORE THE VENDOR IS CALLED — not after, not once at startup.
//       Measured: 4.53 GB per window, 49 GB of headroom, so the floor is REACHED around window 11 of
//       50. A missing or late check does not degrade the walk; it fills the volume.
//   (b) OUTCOME IS EXPLICIT. The drain taught this (★DRAIN-CRON-RUNS-ORPHANED — a column NULL on
//       success and populated on failure) and 2026-08-04 taught it again (finished_at written with
//       now() = transaction start, so a 158-second job logged zero duration). An outcome inferred
//       from a timestamp or from rows>0 cannot tell 'zero' (the vendor answered, named nothing) from
//       'skipped' (we never asked), and those are different facts.
//   (c) THE GOVERNOR READS A NON-CUMULATIVE SPEND. universe_run_state.requests_spent accumulates per
//       entry; summing it for rows touched today bills day 2 for day 1 and halts the walk reporting
//       "allowance EXHAUSTED" having spent nothing. That read must never come back to these routes.
//
// ⛔ THIS GUARD DRIVES THE COMPILED MODULE FOR EVERYTHING THAT CAN BE DRIVEN. The 2026-08-03 lesson
// stands: a guard leg that regex-matched a constant name went GREEN while the behaviour was broken,
// because the name survived in a function body. Source-shape assertions are used ONLY for ORDERING,
// which is genuinely a property of the text, and each one says why.
import { readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const findings = []
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

const CONSUMER = 'src/app/api/queues/google-ads-universe/route.ts'
const STARTER = 'src/app/api/backfill/universe-start/route.ts'
const MODULE = 'src/lib/backfill/universe-window-log.ts'
const MIGRATION = 'migrations/054_universe_window_log.sql'

// ── (a) THE FLOOR IS CHECKED, AND IT IS CHECKED FIRST ─────────────────────────────────────────────
// ⛔ ORDERING IS A TEXT PROPERTY AND THIS IS THE HONEST WAY TO ASSERT IT: compare source offsets.
// Driving the module cannot prove "before" without a live DB and a real vendor call.
{
  const src = read(CONSUMER)
  const floorAt = src.indexOf('checkDiskFloor(')
  const captureAt = src.indexOf('captureUniverseEntry({')
  const openAt = src.indexOf('openWindow(')
  if (floorAt === -1) {
    findings.push(`(a) ${CONSUMER} never calls checkDiskFloor(). The walk would run until the volume is full — a full disk on Postgres is an outage, not a slow query.`)
  } else if (captureAt === -1) {
    findings.push(`(a) ${CONSUMER} no longer calls captureUniverseEntry({ — this guard is pointed at the wrong file or the consumer was rewritten.`)
  } else if (floorAt > captureAt) {
    findings.push(`(a) the disk floor is checked AFTER captureUniverseEntry (offset ${floorAt} vs ${captureAt}). Checking after the write is checking too late — the point of the floor is to refuse BEFORE spending the request and the rows.`)
  }
  if (openAt !== -1 && captureAt !== -1 && openAt > captureAt) {
    findings.push(`(b) openWindow() is called AFTER the capture. The row must be opened as 'running' BEFORE the vendor call, or a process killed mid-request leaves NO row at all — indistinguishable from never having started.`)
  }
}

// ── (c) THE DEFECTIVE CUMULATIVE COUNTER MUST NOT COME BACK ───────────────────────────────────────
for (const f of [CONSUMER, STARTER]) {
  if (/readBackfillRequestsToday/.test(read(f))) {
    findings.push(`(c) ${f} imports/uses readBackfillRequestsToday — the CUMULATIVE per-entry counter. It sums each entry's LIFETIME spend for every entry touched today, so from day 2 the governor bills the walk for day 1 and stops publishing while reporting "allowance EXHAUSTED". Use readLaneSpendToday() from universe-window-log.`)
  }
  if (!/readLaneSpendToday/.test(read(f))) {
    findings.push(`(c) ${f} does not use readLaneSpendToday() — the governor has no honest spend input.`)
  }
}

// ── (d) OUTCOME IS EXPLICIT IN THE SCHEMA, AND 'running' IS THE DEFAULT ───────────────────────────
{
  const sql = read(MIGRATION)
  if (!/outcome\s+text\s+not null\s+default\s+'running'/i.test(sql)) {
    findings.push(`(d) ${MIGRATION}: outcome must be NOT NULL DEFAULT 'running'. A window that opens and never returns has to READ as the failure it is; any other default lets a dead process look like an absence.`)
  }
  for (const state of ['running', 'ok', 'zero', 'skipped', 'error', 'floor_stop']) {
    if (!new RegExp(`'${state}'`).test(sql)) {
      findings.push(`(d) ${MIGRATION}: the outcome CHECK constraint no longer admits '${state}'. The six states partition reality — 'zero' (vendor answered, named nothing) and 'skipped' (never asked) especially are DIFFERENT FACTS and collapsing them is the defect this whole arc exists to end.`)
    }
  }
  if (/finished_at[^\n]*default\s+now\(\)/i.test(sql)) {
    findings.push(`(d) ${MIGRATION}: finished_at defaults to now(), which in PL/pgSQL is TRANSACTION START — the exact 2026-08-04 bug where a 158-second job logged finished_at identical to started_at. Use clock_timestamp().`)
  }
}

// ── (e) THE CONSUMER CHOOSES THE OUTCOME, IT DOES NOT DERIVE IT FROM A ROW COUNT ──────────────────
{
  const src = read(CONSUMER)
  if (!/result\.observedZero \? 'zero'/.test(src) || !/result\.skipped \? 'skipped'/.test(src)) {
    findings.push(`(e) ${CONSUMER} no longer distinguishes 'zero' from 'skipped' when choosing the outcome. Both produce zero rows and NO later inspection of the row count can tell them apart — the distinction exists only at this moment, so losing it here loses it permanently.`)
  }
}

// ── (f) ONE DISK, ONE FLOOR — DRIVEN FROM THE COMPILED MODULE ─────────────────────────────────────
// ⛔ COMPILED, NOT GREPPED. The whole point of the 2026-08-03 lesson: assert the VALUE the code will
// actually use, not the presence of a constant's name.
{
  const out = mkdtempSync(join(tmpdir(), 'loramer-uwl-'))
  const cfg = join(out, 'tsconfig.json')
  writeFileSync(cfg, JSON.stringify({
    compilerOptions: {
      module: 'commonjs', target: 'es2020', moduleResolution: 'node', skipLibCheck: true,
      esModuleInterop: true, rootDir: ROOT, baseUrl: ROOT, paths: { '@/*': ['src/*'] }, outDir: out,
      typeRoots: [join(ROOT, 'node_modules/@types')], types: ['node'],
    },
    files: [join(ROOT, MODULE)],
  }))
  try {
    execFileSync(join(ROOT, 'node_modules/.bin/tsc'), ['-p', cfg], { stdio: 'pipe' })
    try { symlinkSync(join(ROOT, 'node_modules'), join(out, 'node_modules')) } catch {}
    // ⛔ THE SUPABASE CLIENT IS STUBBED, NOT CONFIGURED. `npm run guard` must stay HERMETIC and run on
    // Vercel — it may not require credentials and may not touch the network. Importing the real
    // '@/lib/supabase' throws "supabaseUrl is required" without env, which would make this guard pass
    // or fail on whether a .env file happened to exist rather than on the code. The constants and the
    // pure logic under test do not need a client; only the module's import graph does.
    const stub = join(out, 'supabase-stub.js')
    writeFileSync(stub, 'exports.supabaseAdmin = { from: () => { throw new Error("guard stub: no DB in a hermetic guard") }, rpc: () => { throw new Error("guard stub: no DB in a hermetic guard") } };\n')
    const require_ = createRequire(import.meta.url)
    const Module = require_('module')
    const orig = Module._resolveFilename
    Module._resolveFilename = function (req, ...a) {
      if (req === '@/lib/supabase') return stub
      if (req.startsWith('@/')) return join(out, 'src', req.slice(2) + '.js')
      return orig.call(this, req, ...a)
    }
    const mod = require_(join(out, 'src/lib/backfill/universe-window-log.js'))
    Module._resolveFilename = orig

    const GB = 1024 ** 3
    const expectedFloor = Math.max(15 * GB, Math.floor(200 * GB * 0.2))
    if (mod.FLOOR_BYTES !== expectedFloor) {
      findings.push(`(f) FLOOR_BYTES compiles to ${(mod.FLOOR_BYTES / GB).toFixed(2)} GB but scripts/partition-backfill.mjs enforces ${(expectedFloor / GB).toFixed(2)} GB on the SAME volume. Two different floors for one disk is how one of them gets forgotten.`)
    }
    if (mod.PROVISIONED_BYTES !== 200 * GB) {
      findings.push(`(f) PROVISIONED_BYTES compiles to ${(mod.PROVISIONED_BYTES / GB).toFixed(2)} GB, not the 200 GB the volume is provisioned at. Postgres CANNOT see the volume size — a stale value here silently authorises a walk against headroom that does not exist.`)
    }
    if (mod.VENDOR !== 'google_ads') {
      findings.push(`(f) VENDOR compiles to '${mod.VENDOR}' — must be 'google_ads', never 'google' (LORAMER_CAPTURE_UNIVERSE_NAMED_FOR_THE_API_V1: GA4 must not inherit Google Ads' list).`)
    }
  } catch (e) {
    findings.push(`(f) could not compile ${MODULE}: ${String(e.stdout || '').trim() || e.message}`)
  }
}

const label = 'LORAMER_UNIVERSE_WINDOW_LOG_V1'
if (findings.length) {
  console.error(`✗ ${label} GUARD FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`✓ ${label} GUARD PASSED — floor checked before the vendor call, window opened before it, outcome explicit, spend non-cumulative, one floor for one disk.`)
