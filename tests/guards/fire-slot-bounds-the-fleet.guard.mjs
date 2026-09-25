#!/usr/bin/env node
// LORAMER_FIRE_CEILING_600_V1 — legs (b), (c), (h), (i): THE FLEET'S CONCURRENT FIRES ARE BOUNDED, ROTATION
// CANNOT TAKE THE LAST SLOT, THE COUNT-AND-GRAB IS ATOMIC, AND A REFUSED FIRE IS A HOLD, NOT NO-PROGRESS.
//
// ⛔ WHY A BOUND AT ALL. At a 600 s ceiling the `*/5` rotation starts a second and third fire before the first
// ends. The per-(client,vendor) lease (migrations/085) already makes two fires on ONE client impossible; nothing
// bounded how many DIFFERENT clients fire at once. Measured 2026-09-25 over 24 h / 844 fires: concurrent FIRES
// max 9 · median 2 · p95 3, and concurrent UNITS (6 h, 6,197 finished, median 815 ms each) median 9 · p95 15 ·
// max 73. MAX_CONCURRENT_FIRES = 3 is that p95, at 3 × UNIT_CONCURRENCY 12 = 36 units against a peak of 73 the
// database has already carried.
//
// ⛔ WHY A COUNT AND NOT A MUTEX. A TTL lease "guarantees mutual exclusion only as long as the client holding
// the lock terminates its work within the lock validity time", and without fencing tokens a paused holder can
// overrun it (Kleppmann, 2016-02-08). An over-count admits ONE EXTRA FIRE; it cannot corrupt a row, because
// per-client safety is still the 085 lease's. That asymmetry is what makes a count safe here and a mutex not.
//
// LEGS
//  (b) the contract declares MAX_CONCURRENT_FIRES and both execution hosts acquire and release a slot
//  (c) ROTATION CANNOT TAKE THE LAST SLOT — a named fire (?clientId=) may take any free slot; an unnamed
//      rotation fire passes a leave-free of 1, so a pressed Backfill always finds one
//  (h) COUNT AND GRAB UNDER ONE LOCK — the acquire function locks every slot row FOR UPDATE before counting
//  (i) A REFUSED SLOT IS A HOLD — it must not count toward the run's no-progress stop rule
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' } }
const exists = (rel) => { try { readFileSync(resolve(ROOT, rel), 'utf8'); return true } catch { return false } }

const CONTRACT = 'src/lib/backfill/universe-v2-contract.ts'
const RESUME = 'src/app/api/cron/universe-resume/route.ts'
const DRIVE = 'src/app/api/backfill/universe-drive/route.ts'
const SLOT = 'src/lib/backfill/universe-fire-slot.ts'
const MIG = 'migrations/107_universe_fire_slot_and_witness.sql'
const CHAIN = 'src/lib/backfill/continuous-run.ts'

const contract = read(CONTRACT)
const num = (src, name) => { const m = src.match(new RegExp(`export const ${name} = (\\d+)`)); return m ? Number(m[1]) : null }

// ── (b) the bound is declared and wired ────────────────────────────────────────────────────────────────
const maxFires = num(contract, 'MAX_CONCURRENT_FIRES')
check(maxFires !== null, `(b) ${CONTRACT} does not export MAX_CONCURRENT_FIRES. The fleet's concurrent-fire bound must be declared beside the ceiling it exists because of, not implied by a seed count in SQL.`)
const rotCeil = contract.match(/export const ROTATION_SLOT_CEILING = MAX_CONCURRENT_FIRES - 1/)
check(!!rotCeil, `(b) ${CONTRACT}: ROTATION_SLOT_CEILING must be derived as MAX_CONCURRENT_FIRES - 1 — the reserved slot is a subtraction from the bound, never a second number that can drift from it.`)
check(exists(SLOT), `(b) ${SLOT} is missing — the slot acquire/release has no single owner, so each host would grow its own copy.`)

for (const host of [RESUME, DRIVE]) {
  const src = read(host)
  check(/acquireFireSlot\s*\(/.test(src), `(b) ${host} does not acquire a fire slot. Both execution hosts must, or the bound is enforced on one path and not the other.`)
  check(/releaseFireSlot\s*\(/.test(src), `(b) ${host} does not release a fire slot.`)
  check(/finally\s*\{[\s\S]{0,1200}releaseFireSlot/.test(src), `(b) ${host} does not release the slot in a finally block — a throw would leak a slot until its TTL, shrinking the fleet's bound silently.`)
}

// ── (c) rotation cannot take the last slot ────────────────────────────────────────────────────────────
const resume = read(RESUME)
check(/ROTATION_SLOT_CEILING|leaveFree/.test(resume), `(c) ${RESUME} does not distinguish a rotation fire from a named one when acquiring. A pressed Backfill is a NAMED fire (?clientId=, read at requestedClientId); an unnamed rotation fire must leave one slot free or a customer's press waits behind routine work.`)
const mig = read(MIG)
check(/p_leave_free/.test(mig), `(c) ${MIG}: the acquire function takes no p_leave_free — the reserved slot cannot be expressed.`)
check(/if v_free <= p_leave_free then[\s\S]{0,200}return query select false/.test(mig), `(c) ${MIG}: the acquire function does not refuse when taking a slot would leave fewer than p_leave_free free.`)

// ── (h) count and grab under one lock ─────────────────────────────────────────────────────────────────
const lockIdx = mig.indexOf('for update')
const countIdx = mig.indexOf('select count(*) into v_free')
check(lockIdx > 0 && countIdx > lockIdx,
  `(h) ${MIG}: the acquire function must lock EVERY slot row for this vendor FOR UPDATE *before* it counts free slots. Counting first and taking after lets two concurrent rotation fires both read "2 free" and both take, leaving zero — the last-slot reservation would then be a comment rather than a guarantee.`)
check(/perform 1 from public\.universe_fire_slot s where s\.vendor = p_vendor order by s\.slot_no for update/.test(mig),
  `(h) ${MIG}: the FOR UPDATE must cover the whole vendor's slots in a deterministic order (order by slot_no) — a partial or unordered lock reintroduces the race it exists to remove.`)

// ── (i) a refused slot is a HOLD, not a no-progress step ──────────────────────────────────────────────
// THE RULE, quoted from the chain (continuous-run.ts):
//   :187  if (out.held) return { chain: true, reason: `held: ${out.held} — a hold clears on its own; not counted as no progress` }
//   :200  if (out.requestsOpened <= 0) return { chain: true, reason: 'nothing asked this step (no requests opened) — not counted as no progress' }
//   :214  const counted = out.daysNoLongerOwed <= 0 && !out.held && out.requestsOpened > 0
const chain = read(CHAIN)
check(/if \(out\.held\) return \{ chain: true/.test(chain), `(i) ${CHAIN} no longer treats a held step as chaining without counting — the rule this leg depends on has moved; re-point the guard rather than deleting it.`)
check(/const counted = out\.daysNoLongerOwed <= 0 && !out\.held && out\.requestsOpened > 0/.test(chain), `(i) ${CHAIN}: applyStep's "counted" rule has changed shape.`)
check(/slot/i.test(resume.slice(resume.indexOf('FIRE LEASE HELD') - 2000, resume.indexOf('FIRE LEASE HELD') + 2000)) || /held:\s*`?FIRE SLOT/i.test(resume),
  `(i) ${RESUME}: a slot refusal must return through the same \`held\` channel the lease refusal uses, so continuous-run.ts:187 chains without counting it. A refusal reported as an ordinary empty step would count toward the no-progress stop and end a customer's run for being busy.`)

if (findings.length) {
  console.error(`✗ fire-slot-bounds-the-fleet FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`✓ fire-slot-bounds-the-fleet OK — MAX_CONCURRENT_FIRES=${maxFires} declared with ROTATION_SLOT_CEILING derived from it, both hosts acquire and release in finally, rotation leaves one slot for a named fire, the count and the grab happen under one FOR UPDATE, and a refused slot rides the held channel so it never counts as no progress.`)
