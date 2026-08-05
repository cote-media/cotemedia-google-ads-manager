#!/usr/bin/env node
// LORAMER_BACKFILL_YIELDS_TO_PRODUCT_V1 — THE FIX-WITH-GUARD HALF.
//
// ⛔ WHAT THIS PROTECTS. The backfill governor used to read ONLY its own spend, which guaranteed the
// backfill never exceeded 6,000 ops and guaranteed NOTHING about the other 9,000. A heavy drain day
// reaches 4,000 forward + 8,000 drain + 6,000 backfill = 18,000 against a 15,000 cap, and the walk
// spends its full allowance regardless because it cannot see the overrun. THE LANE THAT HITS THE WALL
// IS THE DRAIN AND FORWARD — live product data — while a backfill of 2022 runs undisturbed.
//
// ⛔ THE GOVERNING LAW DECIDES DIRECTION: stale data presented as current is worse than a false zero.
// THE WALK YIELDS; THE PRODUCT NEVER DOES. A guard that only checked "does it back off" would pass on
// an implementation that made the DRAIN back off instead — so the direction is asserted explicitly.
//
// ⛔ EVERY LEG DRIVES THE COMPILED FUNCTION. Text-search guards passed over broken behaviour three
// times in the 24 hours before this file was written (★CODE-HYGIENE-SWEEP-KNOWN-HAZARDS item 3).
import { readFileSync, mkdtempSync, writeFileSync, symlinkSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const findings = []
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')
const CONSUMER = 'src/app/api/queues/google-ads-universe/route.ts'
const STARTER = 'src/app/api/backfill/universe-start/route.ts'

let G = null
try {
  const out = mkdtempSync(join(tmpdir(), 'loramer-byp-'))
  const cfg = join(out, 'tsconfig.json')
  writeFileSync(cfg, JSON.stringify({
    extends: join(ROOT, 'tsconfig.json'),
    compilerOptions: {
      module: 'commonjs', moduleResolution: 'node', noEmit: false, declaration: false,
      incremental: false, composite: false, rootDir: ROOT, baseUrl: ROOT,
      paths: { '@/*': ['src/*'] }, outDir: out,
      typeRoots: [join(ROOT, 'node_modules/@types')], types: ['node'],
    },
    files: [join(ROOT, 'src/lib/backfill/universe-governor.ts')], include: [], exclude: [],
  }))
  execFileSync(join(ROOT, 'node_modules/.bin/tsc'), ['-p', cfg], { stdio: 'pipe' })
  try { symlinkSync(join(ROOT, 'node_modules'), join(out, 'node_modules')) } catch {}
  G = createRequire(import.meta.url)(join(out, 'src/lib/backfill/universe-governor.js'))
} catch (e) {
  findings.push(`could not drive universe-governor: ${String(e.stdout || '').trim() || e.message}`)
}

if (G) {
  const CAP = G.GOOGLE_DAILY_OP_CAP        // 15,000
  const RESERVE = G.PRODUCT_RESERVE_OPS    // 9,000
  const fleet = (fwd, ctu, drn, un = 0) => ({ byLane: { forward: fwd, catchup: ctu, drain: drn }, unattributedRaw: un })

  if (typeof G.decidePublishFleetAware !== 'function') {
    findings.push('(a) decidePublishFleetAware() is gone — the governor is back to reading only its own lane, which is the defect itself.')
  } else {
    // ── (a) IT MUST NOT PUBLISH WHEN THE FLEET WOULD BREACH THE CAP ──────────────────────────────
    // The heavy-drain day from the queue entry: forward 4,000 + drain 8,000 = 12,000 spent. Only
    // 3,000 remain under the cap and the product reserve is fully consumed, so the walk gets nothing.
    const heavy = G.decidePublishFleetAware({ spentRequestsToday: 0, fleet: fleet(4000, 0, 8000), want: 346 })
    if (heavy.mayPublish || heavy.allowance !== 0) {
      findings.push(`(a) HEAVY DRAIN DAY: fleet has spent 12,000 of ${CAP} and the governor still allowed ${heavy.allowance} message(s). The walk must stand down — this is the exact 18,000-against-15,000 overrun the fix exists to prevent, and the lane that pays for it is the DRAIN.`)
    }
    // Cap already blown outright.
    const over = G.decidePublishFleetAware({ spentRequestsToday: 0, fleet: fleet(9000, 3000, 4000), want: 10 })
    if (over.mayPublish) findings.push('(a) the governor published with the fleet already OVER the daily cap.')

    // ── THE RESERVE IS NOT LENT OUT JUST BECAUSE THE PRODUCT HAS NOT NEEDED IT YET ────────────────
    // Quiet day: product spent ~0, so its 9,000 reserve is intact and the walk may use only what is
    // left beyond it. It must NOT be able to consume the untouched reserve.
    const quiet = G.decidePublishFleetAware({ spentRequestsToday: 0, fleet: fleet(100, 100, 100), want: 100000 })
    const maxAllowed = CAP - 300 - RESERVE
    if (quiet.allowance > maxAllowed) {
      findings.push(`(a) on a quiet day the governor allowed ${quiet.allowance} messages; the product reserve (${RESERVE}) is untouched so at most ${maxAllowed} may be published. The reserve exists to be there when forward/drain need it, not to be lent out because they have not needed it yet today.`)
    }

    // ── FAIL CLOSED ON AN UNREADABLE FLEET ───────────────────────────────────────────────────────
    const blind = G.decidePublishFleetAware({ spentRequestsToday: 0, fleet: null, want: 10 })
    if (blind.mayPublish) {
      findings.push('(a) an UNREADABLE fleet reading was treated as headroom. "I do not know" is not "go ahead" — a governor that fails open is worse than none, because it looks like one.')
    }

    // ── THE WALK YIELDS, NOT THE PRODUCT ─────────────────────────────────────────────────────────
    // Direction check: the backfill's OWN spend must never make the decision more permissive, and a
    // busy product must make it less permissive. If a change ever inverted the direction — making the
    // walk publish MORE as the product gets busier — every case above could still pass.
    const idle = G.decidePublishFleetAware({ spentRequestsToday: 0, fleet: fleet(500, 500, 500), want: 100000 })
    const busy = G.decidePublishFleetAware({ spentRequestsToday: 0, fleet: fleet(3000, 1000, 3000), want: 100000 })
    if (busy.allowance > idle.allowance) {
      findings.push(`(a) DIRECTION INVERTED: a BUSIER product yielded a LARGER backfill allowance (${busy.allowance} > ${idle.allowance}). The walk must yield to the product, never the reverse.`)
    }

    // ── (c) IT MUST NOT SILENTLY REVERT TO OWN-LANE-ONLY ─────────────────────────────────────────
    // Own-lane-only would ignore the fleet entirely: same own spend, wildly different fleet, same answer.
    const a = G.decidePublishFleetAware({ spentRequestsToday: 10, fleet: fleet(0, 0, 0), want: 50 })
    const b = G.decidePublishFleetAware({ spentRequestsToday: 10, fleet: fleet(4000, 2000, 6000), want: 50 })
    if (a.allowance === b.allowance) {
      findings.push(`(c) the fleet reading CHANGED NOTHING (${a.allowance} both times) — the governor is reading only its own lane again, which is the original defect restored.`)
    }
    // And its own allowance must still bind first.
    const spentOut = G.decidePublishFleetAware({ spentRequestsToday: 999999, fleet: fleet(0, 0, 0), want: 1 })
    if (spentOut.mayPublish) findings.push('(c) the backfill published after exhausting its OWN allowance — the fleet check must not relax the lane check.')
  }
}

// ── (b) A STAND-DOWN IS RECORDED, AND NOT AS SUCCESS ──────────────────────────────────────────────
{
  const src = read(CONSUMER)
  if (!/quota_stop/.test(src)) {
    findings.push("(b) the consumer never records a 'quota_stop'. A walk that stood down all day would be indistinguishable from one that was never asked to run — the silent-skip failure this vocabulary exists to prevent.")
  }
  if (!/closeWindow\([\s\S]{0,400}quota_stop/.test(src)) {
    findings.push("(b) 'quota_stop' is mentioned but not written through closeWindow — a stand-down must land in the window log with the governor's arithmetic, not only in a console line that expires.")
  }
  const mig = read('migrations/054_universe_window_log.sql')
  if (!/quota_stop/.test(mig)) {
    findings.push("(b) the outcome CHECK constraint does not admit 'quota_stop' — the write would fail at runtime, turning a stand-down into an error.")
  }
  // ⛔ IT MUST NOT SETTLE THE ENTRY. isClientComplete settles on vendor_exhausted_below or
  // skipped_reason only; if quota_stop ever counted as settled, a walk that yielded all day would
  // report as COMPLETE. That is the "no silent success" requirement, asserted rather than assumed.
  const runState = read('src/lib/backfill/universe-run-state.ts')
  const settleLine = (runState.match(/const settled = states\.filter\([^\n]*/) || [''])[0]
  if (/quota_stop/.test(settleLine)) {
    findings.push('(b) quota_stop counts toward isClientComplete() — a walk that stood down all day would report as FINISHED. A yield is not a completion.')
  }
  if (!/decidePublishFleetAware/.test(src) || !/decidePublishFleetAware/.test(read(STARTER))) {
    findings.push('(c) a publish site still calls the own-lane-only decidePublish — every publish point must consult the fleet, or the one that does not becomes the hole.')
  }
}

const label = 'LORAMER_BACKFILL_YIELDS_TO_PRODUCT_V1'
if (findings.length) {
  console.error(`✗ ${label} GUARD FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`✓ ${label} GUARD PASSED — the walk yields to the product, fails closed when blind, records the stand-down, and a yield never reads as completion.`)
