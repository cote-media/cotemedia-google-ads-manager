#!/usr/bin/env node
// LORAMER_UNIVERSE_CONSUMER_V2_V1 — THE FOUR PROPERTIES THE STREAMING CONSUMER EXISTS TO HOLD.
//
// ⛔ EACH LEG GUARDS A DEFECT THAT ALREADY HAPPENED, NOT A HYPOTHETICAL:
//   (a) a vendor call with no `attempt_started` before it is an UNCOUNTED REQUEST. v1 wrote spend only on
//       close, so three 300-second poison loops burned quota invisibly to the rate governor.
//   (b) "has rows ⇒ covered" counts a PARTIALLY-WRITTEN DAY as complete. Streaming CREATES that day; without
//       the strict rule it would make the system less safe than buffering.
//   (c) the coverage module reaching the attempt log is how a spend-and-failure record becomes a coverage
//       authority — the exact inversion that made the owed list wrong in both directions on 2026-08-08.
//   (d) a bound counted at ANY span calls MIS-SIZED "broken", and tells a customer their data is broken when
//       the truth is that we asked for too much at once.
//   (e) the blast-radius claim ("nothing publishes to this topic") is a FACT about the repo, so it is checked
//       rather than asserted in a comment.
import { readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import Module from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (rel) => {
  try { return readFileSync(resolve(ROOT, rel), 'utf8') }
  catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' }
}
const walk = (dir, out = []) => {
  for (const e of readdirSync(resolve(ROOT, dir))) {
    const p = join(dir, e), s = statSync(resolve(ROOT, p))
    if (s.isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(e)) out.push(p)
  }
  return out
}

// ⛔ THE ROUTE UNDER TEST IS A PARAMETER so leg (d) can be pointed at the DEPLOYED v1 consumer and seen to
// fail there. A bound-check that has only ever been run against code written to satisfy it has not been shown
// to detect anything.
const ROUTE = process.env.LORAMER_V2_ROUTE || 'src/app/api/queues/google-ads-universe-v2/route.ts'
const CAPTURE = 'src/lib/backfill/universe-stream-capture.ts'
const COVERAGE = 'src/lib/backfill/universe-coverage.ts'
const ATTEMPT = 'src/lib/backfill/universe-attempt-log.ts'
const SIZING = 'src/lib/backfill/universe-sizing.ts'

const route = read(ROUTE)
const capture = read(CAPTURE)
const coverage = read(COVERAGE)

// ── (a) EVERY VENDOR CALL IS PRECEDED BY AN attempt_started APPEND, IN THE SAME PATH ──────────────────
if (route && capture) {
  // The capture function is the ONLY vendor entry point, and it must not build a client itself — that is
  // what keeps it drivable with no network, which is what makes leg (b) provable without spending quota.
  if (/new GoogleAdsApi|api\.Customer\(/.test(capture)) {
    findings.push(`(a) ${CAPTURE} constructs a Google client. The stream is INJECTED so the capture path stays drivable with no network; building it here would make the commit boundary unprovable.`)
  }
  const iStart = route.indexOf('appendAttemptStarted(')
  const iCall = route.indexOf('captureSurfaceStreaming(')
  if (iStart < 0) findings.push(`(a) ${ROUTE} never calls appendAttemptStarted. THE REQUEST WOULD BE UNCOUNTED — v1's exact defect, and how three poison loops stayed invisible to the rate governor.`)
  else if (iCall < 0) findings.push(`(a) ${ROUTE} never calls captureEntryStreaming — this is not the streaming consumer.`)
  else if (iStart > iCall) findings.push(`(a) ${ROUTE} calls captureEntryStreaming at ${iCall} BEFORE appendAttemptStarted at ${iStart}. Spend must be charged BEFORE the vendor call, or a hard kill leaves the request unbilled.`)
  // and the charge must be non-zero on that path
  // ⛔ PATTERN WIDENED 2026-08-18, DELIBERATELY, AND THE PROPERTY IS UNCHANGED: the call now carries a THIRD
  // argument (the parent window — LORAMER_PARENT_WINDOW_IS_THE_UNIT_V1), so `(key, 1)` no longer ends the
  // call. What this leg guards is the CHARGE — a literal 1 in the requests position — and that is exactly
  // what the widened pattern still requires. It does NOT accept a computed or defaulted charge.
  if (route && !/appendAttemptStarted\([^,]*,\s*1\s*[,)]/.test(route)) {
    findings.push(`(a) ${ROUTE} opens the attempt without charging a request (expected \`appendAttemptStarted(key, 1)\`). An attempt that bills 0 is invisible to the governor exactly like v1's.`)
  }
  // and the vendor must not be reachable any other way from this route
  if (/customer\.query\(|googleAdsQueryFor/.test(route)) {
    findings.push(`(a) ${ROUTE} reaches the vendor through the BUFFERING v1 client. \`query()\` returns Promise<T[]> and holds the whole window before a row is written — a kill loses everything, having already spent the request.`)
  }
}

// ── (c) THE COVERAGE MODULE MAY NOT IMPORT THE ATTEMPT-LOG MODULE ────────────────────────────────────
// ⛔ THE MODULE BOUNDARY IS THE THING BEING GUARDED, not the table. universe-coverage.ts legitimately reads
// the attempt log's terminal-zero records — negative coverage is unavoidable, because absence of rows means
// *never asked* OR *asked and told nothing*, and only an attempt record separates those. What must never
// happen is the SPEND-AND-FAILURE API becoming reachable from a coverage decision.
if (coverage) {
  if (new RegExp(`from\\s+['"]@/lib/backfill/universe-attempt-log['"]`).test(coverage)) {
    findings.push(`(c) ${COVERAGE} imports the attempt-log MODULE. Coverage decisions may never reach the spend-and-failure API (plan §3). Read the negative-coverage rows directly instead.`)
  }
  if (/universe_window_log|universe_run_state/.test(coverage.replace(/^\s*(\/\/|\*).*$/gm, ''))) {
    findings.push(`(c) ${COVERAGE} reads the OLD bookkeeping tables. On 2026-08-08 they were measured wrong in BOTH directions on the very range they were consulted about — the warehouse is the authority.`)
  }
  if (!/from\s+'@\/lib\/supabase'/.test(coverage) || !/metrics_daily/.test(coverage)) {
    findings.push(`(c) ${COVERAGE} does not read metrics_daily. Coverage that is not derived from captured data is the thing this module replaces.`)
  }
}
// and the walk decision path takes its owed-set ONLY from the coverage module
if (route) {
  if (!/from\s+'@\/lib\/backfill\/universe-coverage'/.test(route)) {
    findings.push(`(c) ${ROUTE} does not import the coverage module — its walk decision comes from somewhere else.`)
  }
  const code = route.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')
  if (/universe_window_log|readEntryState|windowResumeVerdict|universe_run_state/.test(code)) {
    findings.push(`(c) ${ROUTE} consults the old bookkeeping state to decide what to walk. THE DECISION PATH READS ONLY THE COVERAGE MODULE.`)
  }
}

// ── (d) THE BOUND IS EVALUATED AT THE MINIMUM SPAN ───────────────────────────────────────────────────
if (route) {
  const code = route.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')
  const hasMinSpanGate = /spanDays\s*<=\s*MIN_WINDOW_DAYS[\s\S]{0,120}?attempts/i.test(code)
  if (!hasMinSpanGate) {
    findings.push(`(d) ${ROUTE} does not gate its terminal bound on the MINIMUM span. Three failures at 30 days is MIS-SIZED — narrow and retry. Three at 1 day is BROKEN — escalate. A bound counted at ANY span tells a customer their data is broken when the truth is that we asked for too much at once, which is what MAX_OPEN_ATTEMPTS=3 does as deployed.`)
  }
  if (/MAX_OPEN_ATTEMPTS/.test(code)) {
    findings.push(`(d) ${ROUTE} uses MAX_OPEN_ATTEMPTS — the span-blind bound this consumer exists to correct.`)
  }
  if (!/abandoned_owed/.test(code)) {
    findings.push(`(d) ${ROUTE} never records 'abandoned_owed'. A broken range must leave a terminal record, or its days are simply forgotten.`)
  }
}

// ── (e) BLAST RADIUS: NOTHING PUBLISHES TO THE v2 TOPIC ──────────────────────────────────────────────
// ⛔ THE SAFETY OF TWO CONSUMERS EXISTING AT ONCE RESTS ENTIRELY ON THIS. Vercel Queues delivers by TOPIC;
// if any publisher outside the v2 route itself sends to it, the two engines can interleave on the same entry.
{
  const TOPIC_LIT = 'google-ads-universe-v2'
  const CONTRACT = 'src/lib/backfill/universe-v2-contract.ts'
  // ⛔ TWO FILES MAY LEGITIMATELY NAME THE TOPIC: the route that CONSUMES it, and the contract module that
  // DECLARES it. Naming is not publishing. Anything else touching either the literal or the contract module
  // is a candidate publisher, and the blast-radius claim rests entirely on there being none.
  // (Refined after leg (e) fired on the contract module itself — a guard that reads a declaration as a
  // wiring is a broken instrument, and a broken instrument looks like evidence.)
  // ⛔ THE INVARIANT TIGHTENED WHEN THE RESUMER LANDED, RATHER THAN LOOSENING. It used to be "nothing
  // publishes to this topic". It is now "the ONLY publisher is the resumer, AND the resumer is not
  // scheduled" — a narrower claim with two clauses instead of one, both checked here. The old leg failed the
  // build the moment the resumer imported the topic, which is what forced the v2 header to be restated in
  // the same commit; that is the guard working.
  const RESUMER = 'src/app/api/cron/universe-resume/route.ts'
  // ⛔ WIDENED 2026-08-17 — LORAMER_SINGLE_SURFACE_DRIVE_V1, AND THE INVARIANT IT CHANGES IS NAMED RATHER
  // THAN QUIETLY RELAXED. The rule was ONE PUBLISHER, and its stated reason was that two consumers coexist
  // safely only while exactly one receives anything. THE DRIVE DOES NOT THREATEN THAT: it publishes to the
  // SAME v2 topic the resumer does, so the v1 consumer still receives nothing, which is the property the
  // reason protects. What the rule ALSO carried implicitly is the UNATTENDED-SPEND argument — exactly one
  // cron entry, pinned byte-for-byte below — and the drive does not touch that either: it has NO cron entry,
  // it is CRON_SECRET-gated, it publishes EXACTLY ONE message per call, and its default is dryRun.
  // ⛔ WHAT THE SET STILL MEANS: no file may reach this topic WITHOUT being named here. The list is the
  // decision. A third publisher is a third decision, not an edit.
  const DRIVE = 'src/app/api/backfill/universe-drive/route.ts'
  const ALLOWED = new Set([ROUTE, CONTRACT, RESUMER, DRIVE])
  // ⛔ QUOTATION IS NOT ASSERTION — banked THREE times now (canonical-client-identity, ga-dim, and here on
  // 2026-08-11). This leg matched the topic literal ANYWHERE in a file, so `capture-adapter.ts` became a
  // "candidate publisher" by NAMING the v2 route in a doc comment explaining why its own charge model exists.
  // ⛔ AND THIS IS NOT A LOOSENING (the standing rule at the head of google-op-budget.guard.mjs): A COMMENT
  // CANNOT PUBLISH. Stripping comments removes FALSE positives only — the leg still fires on any real
  // reference in code, which is proven by red-proof rather than asserted here.
  const nocomment = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  const suspects = []
  for (const f of walk('src')) {
    if (ALLOWED.has(f)) continue
    const src = nocomment(readFileSync(resolve(ROOT, f), 'utf8'))
    if (src.includes(TOPIC_LIT) || /universe-v2-contract/.test(src)) suspects.push(f)
  }
  if (suspects.length) {
    findings.push(`(e) ${suspects.length} file(s) beyond the v2 route, its contract module and the RESUMER reach the topic '${TOPIC_LIT}': ${suspects.join(', ')}. THE ONLY PUBLISHER IS THE RESUMER. Two consumers can coexist safely only while exactly one of them receives anything, and every additional publisher is another way for that to stop being true.`)
  }
  // ⛔ THE SECOND CLAUSE OPENED DELIBERATELY ON 2026-08-11 — LORAMER_WALK_SCHEDULED_V1, RUSS'S EXPLICIT GO,
  // after all three pre-scheduling gates closed (meter · lane · cleanup; LORAMER_PRESCHEDULING_GATE_V1) and
  // the Foam OH dormancy eyeball. It used to read "the sole publisher must not be on a schedule"; the lock
  // was SEEN RED refusing this exact entry before it was rewritten, which is what a lock is for.
  // ⛔ WHAT IT PINS NOW IS NARROWER, NOT WEAKER: the schedule that exists must be EXACTLY the decided one.
  // The unattended-spend arithmetic rests on every clause of this string — 96 fires/day (*/15, DEPLOY 2
  // 2026-08-17) × MAX_REQUESTS_PER_RUN(40, raised from 20 by LORAMER_WALK_BITE_40_V1 on 2026-08-12) = 3,840
  // requests/day = 28.4% of the 13,500 lane, up from 960/day = 7.1% at the hourly cadence —
  // so a second entry, a faster cadence, a different client, or a dropped dryRun=0 each change the spend
  // without a decision and each goes RED here. The BITE itself is pinned two blocks below, WITH its header
  // arithmetic, so the constant and its derivation cannot move apart.
  //   · ONE entry (a second one doubles unattended spend silently)
  //   · client pinned to Foam OH — the ONLY account the engine has ever been proven on (both wet runs).
  //     Fleet rollout is a SEPARATE decision after unattended operation is proven; roster: LORAMER_WALK_ROSTER_V1.
  //   · dryRun=0 explicit — without it the route's safe-by-default dry-run makes the cron a daily no-op
  //     that LOOKS scheduled (the exact false-comfort ★V2-CONSUMER-HAS-NO-TRIGGER-REGISTRATION described)
  //   · cadence */15 — DEPLOY 2's rate, with the resumer's bound arithmetic re-derived from 96 runs/day in
  //     the same commit. ⛔ IT IS PAIRED WITH maxConcurrency 8 AND THE PAIR IS THE SAFETY PROPERTY: the
  //     consumer's worst-case drain is 40 × WALK_BUDGET_MS(180s) ÷ concurrency, which is 900s at 8 — exactly
  //     the new fire interval, as 3,600s at 2 was exactly the old one. A faster cadence WITHOUT the
  //     concurrency raise backs the queue into the next fire.
  // ── THE BITE AND ITS DERIVATION MOVE TOGETHER — LORAMER_WALK_BITE_40_V1, 2026-08-12 ──────────────────
  // ⛔ MAX_REQUESTS_PER_RUN is the whole unattended-spend rate (bite × 24 fires), and its header carries the
  // derivation (lane share, queue-drain worst case). A constant changed without its arithmetic is exactly how
  // the header spent three days citing the RETIRED 6,000 allowance. This leg requires BOTH: the decided
  // value, and the derived daily figure present in the same file. SEEN RED against the bite-20 tree first.
  {
    const resumerSrc = read('src/lib/backfill/universe-resumer.ts') || ''
    const m = resumerSrc.match(/export const MAX_REQUESTS_PER_RUN\s*=\s*(\d+)/)
    const DECIDED_BITE = 40
    // ⛔ DEPLOY 2, 2026-08-17 (DECISIONS:812) — the cadence moved */15, so the fires-per-day multiplier moves
    // WITH it: 24 → 96. The BITE did not change. This factor is the cadence expressed as arithmetic, and it
    // must track the schedule pinned below or the two halves of the same decision drift apart — the exact
    // failure this leg exists to prevent.
    const DERIVED_DAILY = DECIDED_BITE * 96 // 3840
    if (!m) {
      findings.push('(e) MAX_REQUESTS_PER_RUN not found in universe-resumer.ts — the bite bound this whole schedule is sized on has moved or vanished; re-derive the pin.')
    } else if (Number(m[1]) !== DECIDED_BITE) {
      findings.push(`(e) MAX_REQUESTS_PER_RUN is ${m[1]}, decided ${DECIDED_BITE} (LORAMER_WALK_BITE_40_V1). The bite is the unattended spend rate — ${m[1]}×24=${Number(m[1]) * 24}/day vs the decided ${DERIVED_DAILY}/day. Changing it is a scheduling decision with its own derivation (lane share + queue-drain worst case), not an edit.`)
    } else if (!resumerSrc.includes(String(DERIVED_DAILY) + '/day')) {
      findings.push(`(e) universe-resumer.ts carries bite ${DECIDED_BITE} but its header no longer derives ${DERIVED_DAILY}/day beside it — the constant and its arithmetic have moved apart, which is how the header cited a retired allowance for three days.`)
    }
  }
  const vercelJson = read('vercel.json')
  // ⛔ DEPLOY 2, 2026-08-17 — schedule moved '30 * * * *' → '*/15 * * * *' on Russ's explicit GO, after the
  // gate it was always waiting on (a fire with rows_written > 0) was MET at 88,140 rows/24h. The client,
  // dryRun=0 and the ONE-entry rule are untouched: this raised the RATE on one proven account, nothing else.
  const DECIDED_ENTRY = { path: '/api/cron/universe-resume?clientId=957d484e-d0c4-4dd0-b382-d8499d556252&dryRun=0', schedule: '*/15 * * * *' }
  if (vercelJson) {
    const crons = (JSON.parse(vercelJson).crons || []).filter((c) => /universe-resume/.test(String(c.path || '')))
    if (crons.length !== 1) {
      findings.push(`(e) vercel.json holds ${crons.length} universe-resume cron entr(ies); the 2026-08-11 decision authorises EXACTLY ONE. Zero means the walk was silently un-scheduled; more than one multiplies unattended spend without a decision.`)
    } else if (crons[0].path !== DECIDED_ENTRY.path || crons[0].schedule !== DECIDED_ENTRY.schedule) {
      findings.push(`(e) the universe-resume cron entry drifted from the decided shape.\n      decided: ${JSON.stringify(DECIDED_ENTRY)}\n      found:   ${JSON.stringify(crons[0])}\n      Client, dryRun=0 and cadence are each load-bearing for the unattended-spend arithmetic (480/day of 13,500); changing any of them is a NEW scheduling decision, not an edit.`)
    }
  }
  // and the contract module must declare, not send
  const contract = read(CONTRACT)
  if (contract && /\bsend\s*\(/.test(contract)) {
    findings.push(`(e) ${CONTRACT} calls send(). The contract DECLARES the topic; publishing from it would wire the v2 walk without anyone deciding to.`)
  }
}

// ── (b) BEHAVIOURAL — DRIVE THE REAL COMPILED MODULES ────────────────────────────────────────────────
// The commit boundary and the strict-coverage predicate are the two things that cannot be checked by reading.
const out = mkdtempSync(join(tmpdir(), 'loramer-stream-guard-'))
let restored = false
const origResolve = Module._resolveFilename
const cleanup = () => { if (!restored) { Module._resolveFilename = origResolve; restored = true } rmSync(out, { recursive: true, force: true }) }
try {
  const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
  const r = spawnSync(tsc, [
    resolve(ROOT, CAPTURE), resolve(ROOT, COVERAGE), resolve(ROOT, 'src/lib/backfill/google-ads-universe-writer.ts'),
    resolve(ROOT, 'src/lib/backfill/capture-adapter.ts'),
    // universe-surfaces is import-free data; compiled so leg (b1a) can hand windowCoverage the REAL alias
    // map + segment mapping instead of a no-op stub (a stubbed mapping filters the zero row out and the
    // leg measures its own stub — the exact failure the resolver comment below documents).
    resolve(ROOT, 'src/lib/backfill/universe-surfaces.ts'),
    '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out,
  ], { encoding: 'utf8' })
  if (r.error) { findings.push(`(b) could not run tsc — ${r.error.message}`) }

  const stub = join(out, '__stub.js')
  writeFileSync(stub, `module.exports = new Proxy({
    upsertMetricsChunked: async (rows) => ({ written: rows.length, chunks: 1 }),
    supabaseAdmin: new Proxy({}, { get: () => () => { throw new Error('GUARD: no DB in the pure legs') } }),
  }, { get: (t, k) => (k in t ? t[k] : (() => {})) })`)
  const writerJs = join(out, 'src/lib/backfill/google-ads-universe-writer.js')
  const contractJs = join(out, 'src/lib/backfill/capture-adapter.js')
  Module._resolveFilename = function (request, ...rest) {
    // ⛔ THE CONTRACT MUST RESOLVE TO THE REAL COMPILED MODULE, NOT THE STUB. Stubbing it made
    // `mayInferClosureFromOrder` return undefined, which the capture path correctly read as "not entitled"
    // and flagged a perfectly ordered stream as a violation. The guard was measuring its own stub — a broken
    // instrument that looks like evidence (plan §24), caught by a leg that had no business failing.
    if (/capture-adapter$/.test(request)) return contractJs
    if (/google-ads-universe-writer/.test(request)) return writerJs
    if (request.startsWith('@/') || request.startsWith('./') || request.startsWith('../')) return stub
    return origResolve.call(this, request, ...rest)
  }
  const req = createRequire(import.meta.url)
  const cov = req(join(out, 'src/lib/backfill/universe-coverage.js'))
  const cap = req(join(out, 'src/lib/backfill/universe-stream-capture.js'))
  const writer = req(writerJs)

  // ── (b1) THE PURE PREDICATE, WITH A SYNTHETIC MID-DAY KILL ───────────────────────────────────────────
  {
    const days = ['2025-12-01', '2025-12-02', '2025-12-03', '2025-12-04', '2025-12-05']
    const strict = cov.coveredDaysStrict(days)
    if (strict.includes('2025-12-05')) {
      findings.push(`(b1) coveredDaysStrict counted the NEWEST day with rows as covered. That is the mid-day kill: the stream died partway through 12-05, so its rows exist and are INCOMPLETE. A later day is what proves closure, and there is none.`)
    }
    if (strict.length !== 4 || !strict.includes('2025-12-04')) {
      findings.push(`(b1) coveredDaysStrict returned ${JSON.stringify(strict)} — expected the four days closed by a later one.`)
    }
    const withCommit = cov.coveredDaysStrict(days, { dayCommitted: ['2025-12-05'] })
    if (!withCommit.includes('2025-12-05')) {
      findings.push(`(b1) an explicit day_committed record did NOT make the newest day covered. The reporting path must be able to sharpen the answer even though the walk never needs to.`)
    }
    if (cov.coveredDaysStrict([]).length !== 0) findings.push(`(b1) coveredDaysStrict invented coverage from an empty input.`)

    // ── (b1a) COVERED AND ATTESTED-EMPTY ARE DISJOINT — LORAMER_COVERAGE_SETS_PARTITION_V1, 2026-08-12 ──
    // ⛔ THE DEFECT RAN IN PRODUCTION ON THE FIRST FIRE THE BASE ALIASES WERE LIVE FOR: ad_group base days
    // were COVERED via forward's '' rows (the new alias) AND attested by the previous night's paid-for zeros.
    // The plausibility gate summed covered 28 + attested 30 + uncovered 0 = 58 over a 30-day window and
    // REFUSED both surfaces — durably, for zero requests, exactly as fail-closed should, but FOREVER. Before
    // the aliases the sets were disjoint BY ACCIDENT and nothing enforced it. This leg drives the REAL
    // compiled windowCoverage through a chainable supabase stub where every day holds rows AND a zero
    // attestation spans the window: the sets must PARTITION (disjoint, union = window), a day with rows
    // reporting as covered and never double-counted as attested.
    {
      const stub2 = join(out, '__supabase_chain_stub.js')
      writeFileSync(stub2, `
        // Chainable stub: metrics_daily probes return a row for EVERY day; universe_attempt_log returns one
        // zero attempt spanning the whole window at segment '' (the base surface).
        function chain(table) {
          const self = { _table: table, _day: null }
          const h = new Proxy(self, { get(t, k) {
            if (k === 'then') {
              const result = t._table === 'universe_attempt_log'
                ? { data: [{ window_start: '2025-12-01', window_end: '2025-12-04', segment: '' }], error: null }
                : { data: [{ date: t._day }], error: null }
              return (res) => res(result)
            }
            return (...args) => { if (k === 'eq' && args[0] === 'date') t._day = args[1]; return h }
          } })
          return h
        }
        module.exports = { supabaseAdmin: { from: (t) => chain(t) } }
      `)
      // ⛔ THE COPY MUST LIVE IN ITS OWN DIRECTORY. Node 20's Module._load memoises (parent.path, request)
      // in relativeResolveCache ABOVE the _resolveFilename hook — a copy sharing universe-coverage.js's
      // directory re-uses the ORIGINAL's '@/lib/supabase' → throwing-stub resolution and this leg's
      // resolver is never consulted (measured: the leg died on "GUARD: no DB in the pure legs").
      mkdirSync(join(out, '__partition'), { recursive: true })
      const covPartitionJs = join(out, '__partition/__coverage_partition.js')
      writeFileSync(covPartitionJs, readFileSync(join(out, 'src/lib/backfill/universe-coverage.js'), 'utf8'))
      const surfacesJs = join(out, 'src/lib/backfill/universe-surfaces.js')
      const prevResolve = Module._resolveFilename
      Module._resolveFilename = function (request, ...rest) {
        if (/lib\/supabase$/.test(request)) return stub2
        if (/universe-surfaces$/.test(request)) return surfacesJs
        if (request.startsWith('@/') || request.startsWith('./') || request.startsWith('../')) return stub
        return origResolve.call(this, request, ...rest)
      }
      try {
        const cov2 = req(covPartitionJs)
        const wc = await cov2.windowCoverage(
          { clientId: 'c', platform: 'google', entityLevel: 'ad_group', breakdownType: 'ad_group' },
          '2025-12-01', '2025-12-04')
        const overlap = wc.covered.filter((d) => wc.attestedEmpty.includes(d))
        const sum = wc.covered.length + wc.attestedEmpty.length + wc.uncovered.length
        if (overlap.length > 0) {
          findings.push(`(b1a) covered ∩ attestedEmpty = ${JSON.stringify(overlap)} — the sets OVERLAP. The plausibility gate sums the three sets against the window length, so an overlap refuses the surface durably and forever (production, 2026-08-12 01:30Z: ad_group + ad_group_ad base, 28+30+0=58 over 30 days). A day with rows is COVERED; the attestation is the negative half and must yield.`)
        }
        if (sum !== 4) {
          findings.push(`(b1a) covered ${wc.covered.length} + attested ${wc.attestedEmpty.length} + uncovered ${wc.uncovered.length} = ${sum} over a 4-day window — the three sets do not PARTITION the window, which is the exact arithmetic the resumer's plausibility gate refuses on.`)
        }
      } catch (e) {
        findings.push(`(b1a) could not drive windowCoverage through the chainable stub — ${e?.message}. A leg that cannot run is not a pass. ${process.env.LORAMER_GUARD_DEBUG ? e?.stack : ''}`)
      } finally {
        Module._resolveFilename = prevResolve
      }
    }
    const gapped = cov.coveredDaysStrict(['2025-12-01', '2025-12-03', '2025-12-09'])
    if (gapped.includes('2025-12-09')) findings.push(`(b1) the newest day was counted as covered even across a gap.`)
    // and the owed set must come back as CONTIGUOUS RANGES, because BETWEEN is one operation at any span
    const ranges = cov.toRanges(['2025-12-02', '2025-12-03', '2025-12-04', '2025-12-09'])
    if (ranges.length !== 2 || ranges[0].start !== '2025-12-02' || ranges[0].end !== '2025-12-04' || ranges[1].start !== '2025-12-09') {
      findings.push(`(b1) toRanges produced ${JSON.stringify(ranges)} — expected two contiguous runs. Asking day-by-day costs one operation PER DAY where a BETWEEN costs one for the span.`)
    }
  }

  // ── (b2) THE COMMIT BOUNDARY, DRIVEN AGAINST A STUB STREAM THAT DIES MID-DAY ─────────────────────────
  {
    // ⛔ RETROFITTED TO THE ADAPTER CONTRACT. The commit boundary is now driven through a STUB ADAPTER,
    // which is itself evidence the seam is real: this leg proves the day-commit property with a vendor that
    // does not exist, using the same core the Google adapter uses.
    const entry = { resource: 'campaign', segment: null, delivers: true, servesMetrics: ['metrics.impressions'] }
    const ctx = { clientId: 'c', userEmail: 'e', accountId: '1' }
    const surface = { entityLevel: 'campaign', breakdownType: '', resource: 'campaign', segment: '' }
    const mkAdapter = (stream, closure) => ({
      platform: 'stub', fetchShape: 'stream',
      retention: { floorDate: '2022-03-05', source: 'vendor-measured', citation: 'stub' },
      dayClosure: closure ?? { rule: 'later-day-closes', mechanism: 'stub orders by date', runtimeChecked: true },
      meter: { unit: 'ops', cap: 1e9, costDirection: 'flat-per-request', costOf: () => 1, spentSoFar: async () => 0 },
      sizing: { rowBudget: 300000, coldStartDays: 7, minDays: 1, maxDays: 30 },
      stream, dateOf: (r) => (r?.segments?.date ? String(r.segments.date) : null),
      buildRows: (_s, c, rows) => writer.buildUniverseRowsAtGrain(entry, { clientId: c.clientId, userEmail: c.userEmail, customerId: c.accountId }, rows),
      serializeError: (e) => String(e?.message ?? e),
    })
    const mk = (date, imp) => ({ segments: { date }, campaign: { resource_name: `customers/1/campaigns/${imp}` }, metrics: { impressions: imp, cost_micros: 0, clicks: 0, conversions: 0, conversions_value: 0 } })

    // dies partway through 12-03, AFTER 12-01 and 12-02 completed
    const committed = []
    async function* dying() {
      yield mk('2025-12-01', 5); yield mk('2025-12-02', 6); yield mk('2025-12-03', 7)
      throw new Error('SIMULATED HARD KILL mid-day')
    }
    const res = await cap.captureSurfaceStreaming({
      adapter: mkAdapter(() => dying()), surface, ctx, startDate: '2025-12-01', endDate: '2025-12-05',
      upsert: async (rows) => ({ written: rows.length }),
      onDayCommitted: async (d) => { committed.push(d) },
    })
    if (!res.error) findings.push(`(b2) a stream that threw did not surface an error — the failure would be invisible.`)
    if (!committed.includes('2025-12-01') || !committed.includes('2025-12-02')) {
      findings.push(`(b2) days completed BEFORE the kill were not committed (got ${JSON.stringify(committed)}). THAT IS THE ENTIRE POINT OF STREAMING: a failure at day 3 must keep days 1 and 2.`)
    }
    if (committed.includes('2025-12-03')) {
      findings.push(`(b2) the day the stream DIED IN was committed. A day_committed record for a partial day is a false claim of closure — partial-coverage-reads-as-complete, one grain below the defect that started the teardown.`)
    }
    if (res.rowsWritten < 2) findings.push(`(b2) rows from the completed days were not written (rowsWritten=${res.rowsWritten}).`)

    // ── ORDER: the vendor ignoring ORDER BY must be DETECTED, not silently trusted ──────────────────────
    const committed2 = []
    async function* unordered() { yield mk('2025-12-03', 1); yield mk('2025-12-01', 2); yield mk('2025-12-04', 3) }
    const res2 = await cap.captureSurfaceStreaming({
      adapter: mkAdapter(() => unordered()), surface, ctx, startDate: '2025-12-01', endDate: '2025-12-05',
      upsert: async (rows) => ({ written: rows.length }),
      onDayCommitted: async (d) => { committed2.push(d) },
    })
    if (!res2.orderViolation) {
      findings.push(`(b2) an OUT-OF-ORDER stream was accepted silently. The commit boundary is "a later day arrived, so the previous one is finished" — an ORDER BY the vendor ignores turns every commit into a false claim, and a claim that is wrong only sometimes is worse than one that is always wrong.`)
    }
    // ⛔ THE ORDER CLAUSE MOVED TO THE ADAPTER (LORAMER_CAPTURE_ADAPTER_CONTRACT_V1) and is asserted there by
    // `capture-adapter-seam.guard.mjs` leg (e). What is checked HERE is the property that survived the
    // retrofit: an adapter that may not infer closure from ordering never reports ordering as verified.

    // clean run: every day but the last is committed as its successor arrives, and the last on stream end
    const committed3 = []
    async function* clean() { yield mk('2025-12-01', 1); yield mk('2025-12-02', 2); yield mk('2025-12-03', 3) }
    const res3 = await cap.captureSurfaceStreaming({
      adapter: mkAdapter(() => clean()), surface, ctx, startDate: '2025-12-01', endDate: '2025-12-03',
      upsert: async (rows) => ({ written: rows.length }),
      onDayCommitted: async (d) => { committed3.push(d) },
    })
    // ⛔ NEW LEG, AND IT IS THE SEAM PAYING FOR ITSELF ALREADY: an adapter NOT entitled to rule (a) must
    // never report ordering as verified, even on a perfectly ordered stream. Shopify is that adapter — an
    // opaque order cursor with no ordering guarantee — and this is checked before Shopify exists.
    const committed4 = []
    async function* clean2() { yield mk('2025-12-01', 1); yield mk('2025-12-02', 2) }
    const res4 = await cap.captureSurfaceStreaming({
      adapter: mkAdapter(() => clean2(), { rule: 'explicit-commit-only', why: 'opaque cursor, no ordering guarantee' }),
      surface, ctx, startDate: '2025-12-01', endDate: '2025-12-02',
      upsert: async (rows) => ({ written: rows.length }),
      onDayCommitted: async (d) => { committed4.push(d) },
    })
    if (!res4.orderViolation) {
      findings.push(`(b2) an adapter with NO ordering entitlement reported orderViolation=false on an ordered stream. That reads as "ordering verified" to the next caller, which is a claim it was never entitled to make.`)
    }
    if (committed4.length !== 2) {
      findings.push(`(b2) an unentitled adapter did not still write its explicit day_committed records (got ${JSON.stringify(committed4)}) — rule (b) is the ONLY closure it has.`)
    }
    if (committed3.join(',') !== '2025-12-01,2025-12-02,2025-12-03') {
      findings.push(`(b2) a clean stream committed ${JSON.stringify(committed3)} — expected every day, in order.`)
    }
    if (res3.orderViolation) findings.push(`(b2) a correctly ordered stream was flagged as an order violation.`)
    if (res3.error) findings.push(`(b2) a clean stream reported an error: ${res3.error}`)
  }
} catch (e) {
  findings.push(`(b) behavioural legs could not run — ${e.message}. A guard that cannot execute its subject FAILS; it does not pass quietly.`)
} finally {
  cleanup()
}

if (findings.length) {
  console.error(`[universe-stream-consumer] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[universe-stream-consumer] PASS — every vendor call is preceded by a charged attempt_started · a day is covered only when a later day closes it or an explicit commit says so (proven with a synthetic mid-day kill) · covered and attested-empty PARTITION the window — a day with rows yields the attestation, so an aliased row can never double-count into an implausible-coverage refusal (driven through the real compiled windowCoverage) · an out-of-order stream is detected · the coverage module never imports the attempt-log module and the walk decision reads only coverage · the terminal bound is evaluated at the MINIMUM span · the ONLY publisher to the v2 topic is the resumer, and the resumer's schedule is EXACTLY the decided one (ONE entry · Foam OH · dryRun=0 · every 15 minutes — LORAMER_WALK_SCHEDULED_V1 as raised by DEPLOY 2, 2026-08-17).`)
