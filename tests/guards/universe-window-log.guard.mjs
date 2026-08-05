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

let boundMod = null   // set by leg (f)'s compile; leg (h) drives shouldRepublish() from it
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
    boundMod = mod
    Module._resolveFilename = orig

    // ⛔ THE PROVISIONED FIGURE IS READ FROM partition-backfill.mjs RATHER THAN HARDCODED TWICE HERE.
    // A guard that carried its own copy of the number would go green on a resize that updated the
    // guard and one of the two call sites — which is the very drift it exists to catch. The volume
    // was raised 200 → 280 GB on 2026-08-04, and this leg is what makes the two move together.
    const GB = 1024 ** 3
    const pbSrc = read('scripts/partition-backfill.mjs')
    const pbMatch = /const PROVISIONED_BYTES = (\d+) \* 1024 \*\* 3/.exec(pbSrc)
    if (!pbMatch) {
      findings.push('(f) could not read PROVISIONED_BYTES from scripts/partition-backfill.mjs — the two writers on this volume can no longer be compared, which is exactly the state this leg exists to prevent.')
    } else {
      const pbProvisioned = Number(pbMatch[1]) * GB
      if (mod.PROVISIONED_BYTES !== pbProvisioned) {
        findings.push(`(f) PROVISIONED_BYTES DISAGREE ON ONE DISK: universe-window-log.ts says ${(mod.PROVISIONED_BYTES / GB).toFixed(0)} GB, partition-backfill.mjs says ${(pbProvisioned / GB).toFixed(0)} GB. Postgres cannot see the volume size, so whichever is stale silently authorises work against headroom that does not exist.`)
      }
      const expectedFloor = Math.max(15 * GB, Math.floor(pbProvisioned * 0.2))
      if (mod.FLOOR_BYTES !== expectedFloor) {
        findings.push(`(f) FLOOR_BYTES compiles to ${(mod.FLOOR_BYTES / GB).toFixed(2)} GB but the max(15 GB, 20%) rule on a ${(pbProvisioned / GB).toFixed(0)} GB volume gives ${(expectedFloor / GB).toFixed(2)} GB. Two different floors for one disk is how one of them gets forgotten.`)
      }
    }
    if (mod.VENDOR !== 'google_ads') {
      findings.push(`(f) VENDOR compiles to '${mod.VENDOR}' — must be 'google_ads', never 'google' (LORAMER_CAPTURE_UNIVERSE_NAMED_FOR_THE_API_V1: GA4 must not inherit Google Ads' list).`)
    }
  } catch (e) {
    findings.push(`(f) could not compile ${MODULE}: ${String(e.stdout || '').trim() || e.message}`)
  }
}

// ── (g) THE NARROWED SET — A DEFERRAL MAY NEVER BECOME A SILENT ABSENCE ───────────────────────────
// ⛔ LORAMER_UNIVERSE_NARROWED_SET_V1. 12 entries are deferred under a disk constraint, not dropped.
// The failure this prevents is not "someone deletes the list" — it is the quieter one: a deferred
// entry losing its REASON, or dropping out of the DECLARED set, at which point six months from now
// nobody can tell a deliberate deferral from a slot that was never thought of. ALL-MEANS-ALL is not
// repealed, and this leg is the mechanical half of saying so.
// ⛔ THIS LEG IS DRIVEN FROM THE COMPILED WRITER, NOT GREPPED, AND THE FIRST VERSION PROVED WHY.
// Written as text checks, it went GREEN against two deliberate breaks: counting `loraLoses:` caught
// the interface declaration as a 13th match so deleting a real one still totalled 12, and testing
// /declarableEntries/ matched `declarableEntriesOLD` after the function was renamed away. That is
// ★CODE-HYGIENE-SWEEP-KNOWN-HAZARDS item (3) — a guard proves a STRING EXISTS, never that CODE
// BEHAVES — reproduced inside a guard written hours after banking it. The module is the only thing
// that can answer these questions.
{
  const W = 'src/lib/backfill/google-ads-universe-writer.ts'
  try {
    const out2 = mkdtempSync(join(tmpdir(), 'loramer-uns-'))
    const cfg2 = join(out2, 'tsconfig.json')
    // ⛔ EXTENDS THE REPO'S OWN tsconfig RATHER THAN INVENTING ONE. An ad-hoc compilerOptions block
    // here type-checked the file under DIFFERENT strictness than the app does, and failed on a
    // narrowing the repo config accepts — so the guard reported "could not drive the module" on
    // perfectly good source. A guard must compile the code the way the code is actually compiled.
    writeFileSync(cfg2, JSON.stringify({
      extends: join(ROOT, 'tsconfig.json'),
      compilerOptions: {
        module: 'commonjs', moduleResolution: 'node', noEmit: false, declaration: false,
        // ⛔ `incremental` OFF. The repo config enables it, and the inherited tsBuildInfoFile path
        // resolved outside the temp dir and failed with EACCES — a guard must not depend on where
        // its scratch config happens to sit.
        incremental: false, composite: false,
        rootDir: ROOT, baseUrl: ROOT, paths: { '@/*': ['src/*'] }, outDir: out2,
        typeRoots: [join(ROOT, 'node_modules/@types')], types: ['node'],
      },
      // ⛔ `include`/`exclude` MUST be blanked explicitly. `extends` MERGES the base config's
      // `include`, and `files` does not override it — so inheriting the repo tsconfig silently
      // pulled the entire src tree into this compile and failed on unrelated Stripe typings.
      files: [join(ROOT, W)], include: [], exclude: [],
    }))
    execFileSync(join(ROOT, 'node_modules/.bin/tsc'), ['-p', cfg2], { stdio: 'pipe' })
    try { symlinkSync(join(ROOT, 'node_modules'), join(out2, 'node_modules')) } catch {}
    const stub2 = join(out2, 'supabase-stub.js')
    writeFileSync(stub2, 'exports.supabaseAdmin = { from: () => { throw new Error("guard stub") } };\n')
    const require2 = createRequire(import.meta.url)
    const Module2 = require2('module')
    const orig2 = Module2._resolveFilename
    Module2._resolveFilename = function (req, ...a) {
      if (req === '@/lib/supabase') return stub2
      if (req.startsWith('@/')) return join(out2, 'src', req.slice(2) + '.js')
      return orig2.call(this, req, ...a)
    }
    const w = require2(join(out2, 'src/lib/backfill/google-ads-universe-writer.js'))
    Module2._resolveFilename = orig2

    const notes = w.DEFERRED_ENTRIES || {}
    const keys = Object.keys(notes)
    if (keys.length !== 12) {
      findings.push(`(g) DEFERRED_ENTRIES holds ${keys.length} entries, expected 12 (LORAMER_UNIVERSE_NARROWED_SET_V1). A deferral list that drifts from its own record in ★UNIVERSE-NARROW-ON-MEASURED-YIELD is how "deferred" quietly becomes "dropped".`)
    }
    for (const k of keys) {
      const n = notes[k] || {}
      for (const f of ['reason', 'loraLoses']) {
        if (typeof n[f] !== 'string' || n[f].trim().length < 10) {
          findings.push(`(g) deferred entry "${k}" has no usable \`${f}\`. A deferral without its reason and its NAMED cost to Lora is indistinguishable from a slot nobody thought of — the exact confusion this arc exists to end.`)
        }
      }
      for (const f of ['measuredRowsPerRequest', 'measuredGBPerWalk']) {
        if (!Number.isFinite(n[f]) || n[f] <= 0) {
          findings.push(`(g) deferred entry "${k}" has no measured \`${f}\`. Deferral is a decision made ON EVIDENCE; without the number it is just a cut.`)
        }
      }
    }
    // THE BEHAVIOURAL ASSERTIONS — run the real selection over the real artifact.
    const doc = w.loadUniverse(ROOT)
    const sel = w.selectableEntries(doc)
    const dec = w.declarableEntries(doc)
    const def = w.deferredEntries(doc)
    const leaked = sel.filter((e) => w.deferralFor(e))
    if (leaked.length) {
      findings.push(`(g) ${leaked.length} DEFERRED entries are still in the REQUEST set returned by selectableEntries(). The narrowing is not in effect and the walk would spend the disk it was narrowed to save.`)
    }
    if (def.length !== 12) {
      findings.push(`(g) deferredEntries() returns ${def.length}, expected 12 — the deferred set is not reportable, so a narrowed walk cannot state what it narrowed.`)
    }
    // ⛔ STILL DECLARED. Deferral touches the REQUEST list only. Dropping a deferred entry from the
    // DECLARED set would make its already-landed rows unreachable to Lora — turning a storage
    // decision into data loss, which is a different and much worse thing.
    const missingFromDeclared = def.filter(({ entry }) =>
      !dec.some((d) => d.resource === entry.resource && d.segment === entry.segment))
    if (missingFromDeclared.length) {
      findings.push(`(g) ${missingFromDeclared.length} deferred entries are ABSENT from declarableEntries(). Deferral must never touch what is DECLARED: the registry is what makes already-landed rows reachable, so dropping them there converts a storage decision into DATA LOSS.`)
    }
  } catch (e) {
    findings.push(`(g) could not drive ${W}: ${String(e.stdout || '').trim() || e.message}`)
  }
  if (!/deferredEntries/.test(read('src/app/api/backfill/universe-start/route.ts'))) {
    findings.push('(g) the starter route no longer reports deferredEntries(). A narrowed walk that does not state what it narrowed reads, from the outside, exactly like a walk that silently lost 12 slots.')
  }
}

// ── (h) THE BOUND — "ONE WINDOW IS A PROOF; FIFTY IS A COMMITMENT" MUST BE EXPRESSIBLE ────────────
// ⛔ LORAMER_UNIVERSE_BOUNDED_RUN_V1. The consumer SELF-RE-PUBLISHES, so without a bound that travels
// on the message, firing the starter releases the ENTIRE walk — 346 messages, each publishing its own
// next window, until the governor or the disk floor stops it. A proof run that quietly became a
// 50-window commitment would be discovered only by watching the disk fall.
// ⛔ DRIVEN, NOT GREPPED — and the first version of THIS leg is why the rule is absolute now. Written
// as `src.indexOf('boundExhausted')` it went GREEN against a break that replaced the entire expression
// with `false`, because the variable NAME survived. Third occurrence in one day.
{
  const S = boundMod?.shouldRepublish
  if (typeof S !== 'function') {
    findings.push('(h) shouldRepublish() is gone from universe-window-log. Without it the re-publish bound is inline in a route again, where it can only be text-checked — and a text check on this exact decision already passed over a break today.')
  } else {
    const cases = [
      { in: { stillGoing: true, windowsRemaining: 1 }, want: false, why: 'windowsRemaining=1 is the LAST window — it must not re-publish. This is the "one window is a proof" case; getting it wrong turns a proof into a 50-window commitment.' },
      { in: { stillGoing: true, windowsRemaining: 2 }, want: true,  why: 'windowsRemaining=2 has one more window owed' },
      { in: { stillGoing: true, windowsRemaining: 0 }, want: false, why: 'a bound of 0 must never re-publish' },
      { in: { stillGoing: true },                      want: true,  why: 'undefined = unbounded, the original behaviour and the default' },
      { in: { stillGoing: false, windowsRemaining: 9 }, want: false, why: 'vendor exhausted / skipped / errored — the bound is irrelevant, there is nothing to continue' },
    ]
    for (const c of cases) {
      const got = S(c.in)
      if (got.republish !== c.want) {
        findings.push(`(h) shouldRepublish(${JSON.stringify(c.in)}) returned republish=${got.republish}, expected ${c.want}. ${c.why}`)
      }
    }
    // ⛔ THE DECREMENT. A bounded run that re-publishes at a CONSTANT count is worse than no bound at
    // all, because it looks bounded while running forever.
    const two = S({ stillGoing: true, windowsRemaining: 2 })
    if (two.nextWindowsRemaining !== 1) {
      findings.push(`(h) shouldRepublish does not DECREMENT: from windowsRemaining=2 it passed on ${two.nextWindowsRemaining}, expected 1. A bound that never decreases looks bounded and runs forever.`)
    }
    const unbounded = S({ stillGoing: true })
    if (unbounded.nextWindowsRemaining !== undefined) {
      findings.push('(h) an UNBOUNDED run was given a numeric windowsRemaining — that silently converts every existing unbounded walk into a bounded one.')
    }
  }
  // ORDERING is still a text property: the bound must be decided before the governor is consulted.
  const src = read(CONSUMER)
  const boundAt = src.indexOf('shouldRepublish(')
  const govAt = src.indexOf('decidePublish(')
  if (boundAt !== -1 && govAt !== -1 && boundAt > govAt) {
    findings.push('(h) the bound is decided AFTER the governor. The governor answers "may we AFFORD another window"; the bound answers "were we ASKED for one at all". A run asked for exactly one window must stop even when quota and disk would allow more.')
  }
  if (boundAt === -1) {
    findings.push('(h) the consumer does not call shouldRepublish(). Firing the starter would release the ENTIRE walk — 346 messages each publishing their own next window.')
  }
}

// ── (i) A RESUME MUST ADVANCE, NEVER STOP ────────────────────────────────────────────────────────
// ⛔ THIS KILLED A REAL RELEASE. The already-finished branch was a bare `return`, so releasing the
// full walk published 346 messages at the most recent window — already walked as the proof run —
// and ALL 346 returned early without re-publishing. The starter reported "started: true,
// published: 346" and the chain was already dead. A resume that does not advance is
// indistinguishable from one that worked, right up until nothing happens.
{
  const src = read(CONSUMER)
  const at = src.indexOf('windowAlreadyFinished(wk)')
  if (at === -1) {
    findings.push('(i) the consumer no longer checks windowAlreadyFinished — every redelivery re-walks ground already covered and re-spends the quota.')
  } else {
    // The branch body, up to the closing of the if-block.
    const body = src.slice(at, at + 1400)
    if (!/advanceToNextWindow/.test(body)) {
      findings.push('(i) the already-finished branch does NOT call advanceToNextWindow. A resume that skips the work must still ADVANCE THE WALK — a bare `return` here stops the chain on the first already-walked window while the starter reports success.')
    }
  }
  // ONE advance implementation, not two. The resume path originally had none precisely because the
  // logic lived inline in the other branch.
  const sends = (src.match(/await send\(TOPIC,/g) || []).length
  if (sends > 1) {
    findings.push(`(i) ${sends} separate send(TOPIC, ...) call sites — the advance logic has been duplicated. Two copies is how one of them loses the governor, the bound or the stand-down record.`)
  }
}

// ── (j) ZERO ROWS IS NOT EXHAUSTION ──────────────────────────────────────────────────────────────
// ⛔ THIS SEALED 344 OF 346 ENTRIES WITH FOUR YEARS OF DATA BENEATH THEM. The old rule was
// `rowsReturned === 0 -> complete`, so ONE empty window meant "the vendor has no history below this
// date". Foam OH went dormant in April 2026, the walk's first window sat in that dead period, Google
// correctly returned zero, and the walk concluded it was finished. Because isClientComplete settles
// on vendor_exhausted_below, it then read as COMPLETE rather than stalled — a false seal walks
// through every no-silent-success check we have, which is why leg (c) below exists.
{
  const W = boundMod && null // placeholder to keep shape; the writer is compiled separately below
  try {
    const out3 = mkdtempSync(join(tmpdir(), 'loramer-zre-'))
    const cfg3 = join(out3, 'tsconfig.json')
    writeFileSync(cfg3, JSON.stringify({
      extends: join(ROOT, 'tsconfig.json'),
      compilerOptions: {
        module: 'commonjs', moduleResolution: 'node', noEmit: false, declaration: false,
        incremental: false, composite: false, rootDir: ROOT, baseUrl: ROOT,
        paths: { '@/*': ['src/*'] }, outDir: out3,
        typeRoots: [join(ROOT, 'node_modules/@types')], types: ['node'],
      },
      files: [join(ROOT, 'src/lib/backfill/google-ads-universe-writer.ts')], include: [], exclude: [],
    }))
    execFileSync(join(ROOT, 'node_modules/.bin/tsc'), ['-p', cfg3], { stdio: 'pipe' })
    try { symlinkSync(join(ROOT, 'node_modules'), join(out3, 'node_modules')) } catch {}
    const stub3 = join(out3, 'supabase-stub.js')
    writeFileSync(stub3, 'exports.supabaseAdmin = { from: () => { throw new Error("guard stub") } };\n')
    const req3 = createRequire(import.meta.url)
    const M3 = req3('module'); const o3 = M3._resolveFilename
    M3._resolveFilename = function (r, ...a) {
      if (r === '@/lib/supabase') return stub3
      if (r.startsWith('@/')) return join(out3, 'src', r.slice(2) + '.js')
      return o3.call(this, r, ...a)
    }
    const wr = req3(join(out3, 'src/lib/backfill/google-ads-universe-writer.js'))
    M3._resolveFilename = o3

    const FLOOR = wr.VENDOR_FLOOR_DATE
    if (!FLOOR) findings.push('(j) VENDOR_FLOOR_DATE is not exported from the writer — the seal has no floor to check against and any empty window can end a walk.')
    const call = (windowStart, rowsReturned) =>
      wr.decideVendorExhaustion({ windowStart, rowsReturned, gaql: 'SELECT x FROM y', floorDate: FLOOR })

    // (a) A SINGLE ZERO-ROW WINDOW ABOVE THE FLOOR MUST NOT SEAL.
    const dormant = call('2026-07-05', 0)
    if (dormant.complete || dormant.exhaustedBelow !== null) {
      findings.push('(j)(a) a single zero-row window ABOVE the floor sealed the entry as vendor-exhausted. That is the 2026-08-05 defect exactly: dormancy read as exhaustion, 344 of 346 entries sealed with four years of data beneath them.')
    }
    // (b) SEALING ABOVE THE FLOOR IS NEVER JUSTIFIED, at any date above it.
    for (const d of ['2025-03-02', '2023-01-01', '2022-03-06']) {
      if (call(d, 0).complete) {
        findings.push(`(j)(b) an empty window at ${d} sealed the entry, but that is ABOVE the measured floor ${FLOOR}. Exhaustion above the floor requires evidence a single empty window cannot provide.`)
      }
    }
    // AT/BELOW the floor an empty window IS exhaustion — the floor was measured, so it corroborates.
    const atFloor = call(FLOOR, 0)
    if (!atFloor.complete || atFloor.exhaustedBelow !== FLOOR) {
      findings.push(`(j) an empty window AT the measured floor ${FLOOR} did NOT seal. The walk would never terminate — the floor is the one place a zero is corroborated.`)
    }
    // Rows always continue the walk.
    if (call('2024-01-01', 5).complete) findings.push('(j) a window that RETURNED ROWS was sealed as exhausted.')
  } catch (e) {
    findings.push(`(j) could not drive the writer: ${String(e.stdout || '').trim() || e.message}`)
  }

  // (c) ⛔ THE SILENT-SUCCESS HALF — a seal must be the ONLY thing that settles an entry, and
  // isClientComplete must not settle on anything weaker. This is what made the defect invisible.
  const rs = read('src/lib/backfill/universe-run-state.ts')
  const settle = (rs.match(/const settled = states\.filter\([^\n]*/) || [''])[0]
  if (!/vendor_exhausted_below/.test(settle)) {
    findings.push('(j)(c) isClientComplete() no longer settles on vendor_exhausted_below — completion has lost its only proof-carrying signal.')
  }
  if (/observed_zero_at|rows_written|outcome\s*===\s*.zero./.test(settle)) {
    findings.push('(j)(c) isClientComplete() settles on an OBSERVED ZERO or a row count. A zero is dormancy, not exhaustion — settling on it is the false-completion defect moved into the completion check itself.')
  }
}

const label = 'LORAMER_UNIVERSE_WINDOW_LOG_V1'
if (findings.length) {
  console.error(`✗ ${label} GUARD FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`✓ ${label} GUARD PASSED — floor checked before the vendor call, window opened before it, outcome explicit, spend non-cumulative, one floor for one disk.`)
