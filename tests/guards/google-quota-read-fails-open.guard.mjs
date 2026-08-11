#!/usr/bin/env node
// LORAMER_QUOTA_READ_FAILS_OPEN_GUARD_V1 (extended by LORAMER_QUOTA_READ_SPLIT_STATE_V1)
//
// FAILS if a NON-SUCCESSFUL read of the __google_quota sentinel is indistinguishable from a healthy one,
// OR if an unreadable sentinel is allowed to render as a platform outage in Lora's prompt.
//
// THE BUG IT GUARDS (diagnosed 2026-07-28): google-quota-store.ts read the sentinel with
//   const { data } = await supabaseAdmin...maybeSingle()
// The `error` field was DESTRUCTURED AWAY AND NEVER INSPECTED. supabase-js never throws — it returns
// { data, error } — so ANY read failure yielded data === null, fell into `if (!data?.backfill_blocked)`,
// and returned paused:false. A failed read read as a healthy unblocked sentinel, silently, with no log.
// MEASURED COST: the sentinel was armed 2026-07-28 11:28:45Z with a window to 07-29T08:03:57Z, and google
// catchup runs starting 11:29:11 / 11:39:11 / 11:49:11 / 11:59:11 still reported accounts_with_gaps=9 and
// days_filled=3/7/6/1 — counters that increment ONLY downstream of the `fillDays = googleQuotaPaused ? []`
// gate. ~178 gap-days of Google fan-out went out against an exhausted quota, and nothing logged why.
//
// IT GUARDS BOTH DIRECTIONS, WHICH IS THE WHOLE POINT OF THE THREE-STATE SPLIT:
//   · CAPTURE lanes must HOLD on an unknown read (a false hold costs one lap, retried in ~10 min);
//   · THE ANSWER PATH must attach NOTHING on an unknown read (a false outage claim tells a user their
//     Google data is gone when it is not — the incident VERIFICATION LAW 1 was written from, and a
//     violation of FAIL-PARTIAL READ-PATH LAW, both do-not-relitigate).
// A future rewrite that collapses those back into one boolean fails here in one direction or the other.
//
// IT GUARDS THE CLASS, NOT THE INSTANCE: the assertion is "a read that did not succeed must not read as
// healthy, and must not speak to the user." Any new silent non-success path — a fresh destructure dropping
// `error`, a catch returning a default, a swallowed maybeSingle ambiguity — fails without anyone
// remembering this file exists.
//
// HERMETIC: no network, no DB, no vendor API, no writes. @/lib/supabase is stubbed at require time; the REAL
// readGoogleQuotaPause, the REAL buildGoogleQuotaLines and the REAL buildClaudeContextCacheable are compiled
// from source and EXECUTED (a text scan cannot prove behaviour, and a stubbed renderer proves nothing).
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import Module from 'node:module'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fail = (msg) => { console.error(`✗ google-quota-read-fails-open guard: ${msg}`); process.exit(2) }

// ── 1. compile the REAL modules (tsconfig so @/* resolves the way Next resolves it) ─────────────────────
const out = mkdtempSync(join(tmpdir(), 'loramer-quota-read-guard-'))
const cfgDir = mkdtempSync(join(tmpdir(), 'loramer-quota-read-cfg-'))
const cfg = join(cfgDir, 'tsconfig.json')
writeFileSync(cfg, JSON.stringify({
  compilerOptions: {
    target: 'es2020', module: 'commonjs', moduleResolution: 'node', skipLibCheck: true,
    resolveJsonModule: true, baseUrl: ROOT, paths: { '@/*': ['./src/*'] },
    rootDir: ROOT, outDir: out, noEmitOnError: false, noImplicitAny: false,
  },
  files: [
    join(ROOT, 'src/lib/backfill/google-quota-store.ts'),
    join(ROOT, 'src/lib/intelligence/build-claude-context.ts'),
  ],
}))
const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
const r = spawnSync(tsc, ['-p', cfg], { encoding: 'utf8' })
const cleanup = () => { rmSync(out, { recursive: true, force: true }); rmSync(cfgDir, { recursive: true, force: true }) }
if (r.error) { cleanup(); fail(`could not run tsc — ${r.error.message}`) }

// ── 2. stub the Supabase module; map @/* + server-only the way the runtime would ────────────────────────
let STUB = { data: null, error: null }          // one mutable cell drives every case
const chain = { maybeSingle: async () => STUB }
const stubSupabase = { supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ eq: () => chain }) }) }) } }
const origLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === '@/lib/supabase') return stubSupabase
  if (request === 'server-only') return {}
  if (request.startsWith('@/')) return origLoad.call(this, join(out, 'src', request.slice(2) + '.js'), ...rest)
  return origLoad.call(this, request, ...rest)
}
const req = createRequire(import.meta.url)
let STORE, CTX
try {
  STORE = req(join(out, 'src/lib/backfill/google-quota-store.js'))
  CTX = req(join(out, 'src/lib/intelligence/build-claude-context.js'))
} catch (e) { Module._load = origLoad; cleanup(); fail(`compiled modules did not load — ${e.message}\n${r.stdout || ''}${r.stderr || ''}`) }
for (const [n, f] of [['readGoogleQuotaPause', STORE?.readGoogleQuotaPause], ['holdGoogleWork', STORE?.holdGoogleWork],
                      ['buildGoogleQuotaLines', CTX?.buildGoogleQuotaLines], ['buildClaudeContextCacheable', CTX?.buildClaudeContextCacheable]]) {
  if (typeof f !== 'function') { Module._load = origLoad; cleanup(); fail(`${n} not exported — contract moved`) }
}

// THE ANSWER-PATH ATTACH RULE, mirrored from src/app/api/intelligence/route.ts:221
//   `if (qp.paused) googleQuota = qp`
// Mirrored rather than executed because running that route needs auth + DB + live fetchers. The mirror is
// pinned by a SOURCE assertion below (§5) so it cannot drift from the route without failing this guard.
const attachForAnswerPath = (qp) => (qp.paused ? qp : undefined)

// The two ladder strings, verbatim from build-claude-context.ts:1339-1341.
const LADDER_QUOTA = 'UNAVAILABLE PLATFORM-WIDE'
const LADDER_LEGACY = 'data fetch FAILED this turn (temporarily unavailable'
const ladderFor = (googleQuota) => {
  const ctx = CTX.buildClaudeContextCacheable({ profile: {}, google: { connected: true, fetchFailed: true }, googleQuota })
  const blob = `${ctx.prefix}\n${ctx.suffix}`
  return { quota: blob.includes(LADDER_QUOTA), legacy: blob.includes(LADDER_LEGACY) }
}

// ── 3. cases ────────────────────────────────────────────────────────────────────────────────────────────
const FUTURE = new Date(Date.now() + 6 * 3600_000).toISOString()
const PAST = new Date(Date.now() - 6 * 3600_000).toISOString()
const row = (blocked, until) => ({
  backfill_blocked: blocked, backfill_block_window: until,
  backfill_block_reason: 'google_quota: developer-scope quota exhausted', backfill_block_at: PAST,
})

// expect: { state, paused, hold, caveatLines, ladderQuota }
const CASES = [
  { name: 'READ FAILURE (PostgREST error) → UNKNOWN · capture HOLDS · Lora silent',
    stub: { data: null, error: { message: 'connection terminated unexpectedly', code: '57P01' } },
    expect: { state: 'unknown', paused: false, hold: true, caveatLines: 0, ladderQuota: false }, core: true },
  { name: 'READ FAILURE (maybeSingle ambiguity) → UNKNOWN · capture HOLDS · Lora silent',
    stub: { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } },
    expect: { state: 'unknown', paused: false, hold: true, caveatLines: 0, ladderQuota: false }, core: true },
  { name: 'clean read, sentinel NOT blocked → NOT-BLOCKED · capture runs · Lora silent',
    stub: { data: row(false, null), error: null },
    expect: { state: 'not_blocked', paused: false, hold: false, caveatLines: 0, ladderQuota: false } },
  { name: 'clean read, blocked FUTURE window → BLOCKED · capture holds · Lora SPEAKS',
    stub: { data: row(true, FUTURE), error: null },
    expect: { state: 'blocked', paused: true, hold: true, caveatLines: 5, ladderQuota: true } },
  { name: '0b32f9f RE-PROVE: blocked + ELAPSED window → NOT-BLOCKED · capture runs · caveat GONE from the prompt',
    stub: { data: row(true, PAST), error: null },
    expect: { state: 'not_blocked', paused: false, hold: false, caveatLines: 0, ladderQuota: false }, core: true },
  { name: 'clean read, no sentinel row at all → NOT-BLOCKED · capture runs · Lora silent',
    stub: { data: null, error: null },
    expect: { state: 'not_blocked', paused: false, hold: false, caveatLines: 0, ladderQuota: false } },
]

const results = []
for (const c of CASES) {
  STUB = c.stub
  let got = null, threw = null
  try {
    const qp = await STORE.readGoogleQuotaPause()
    const attached = attachForAnswerPath(qp)
    const lad = ladderFor(attached)
    got = {
      state: qp.state, paused: qp.paused, hold: STORE.holdGoogleWork(qp),
      caveatLines: CTX.buildGoogleQuotaLines(attached).length, ladderQuota: lad.quota, ladderLegacy: lad.legacy,
    }
  } catch (e) { threw = e }
  const mismatches = threw ? ['THREW ' + threw.message]
    : Object.entries(c.expect).filter(([k, v]) => got[k] !== v).map(([k, v]) => `${k}: expected ${v}, got ${got[k]}`)
  // A prompt that shows NEITHER ladder string means the fixture stopped reaching the renderer — that would make
  // every ladderQuota:false assertion pass vacuously. Treat it as a guard failure, not a pass.
  if (!threw && !got.ladderQuota && !got.ladderLegacy) mismatches.push('ladder rendered NEITHER string — fixture no longer reaches the status ladder (vacuous pass)')
  results.push({ ...c, got, mismatches })
}

// ── 4. report behaviour ─────────────────────────────────────────────────────────────────────────────────
for (const t of results) {
  console.log(`  ${t.mismatches.length ? '✗' : '✓'} ${t.name}`)
  if (t.mismatches.length) t.mismatches.forEach((m) => console.log(`      ${m}`))
  else console.log(`      state=${t.got.state} paused=${t.got.paused} hold=${t.got.hold} caveatLines=${t.got.caveatLines} ladder=${t.got.ladderQuota ? 'QUOTA' : 'legacy'}`)
}

// ── 5. source pins — the mirror above, and the rule that capture never hand-rolls the disjunction ────────
const srcPins = []
const readSrc = (p) => readFileSync(resolve(ROOT, p), 'utf8')
for (const [file, line] of [['src/app/api/cron/drain/route.ts', 77], ['src/app/api/cron/catchup/route.ts', 266]]) {
  if (!/holdGoogleWork\s*\(/.test(readSrc(file))) srcPins.push(`${file} (~:${line}) must gate on holdGoogleWork(), not .paused — a capture lane reading .paused re-opens the 2026-07-28 hole`)
}
const intel = readSrc('src/app/api/intelligence/route.ts')
if (/holdGoogleWork/.test(intel)) srcPins.push('src/app/api/intelligence/route.ts must NOT use holdGoogleWork — the answer path must stay on .paused so an unknown read never speaks to the user')
if (!/if\s*\(\s*qp\.paused\s*\)\s*googleQuota\s*=\s*qp/.test(intel)) srcPins.push('src/app/api/intelligence/route.ts attach rule moved — the mirror in this guard (attachForAnswerPath) is now unpinned and must be re-derived')
// ── 5b. LORAMER_WALK_TAKES_THE_LANE_V1 — A LANE SILENCED BY DECISION MUST REACH THE USER ────────────────
// ⛔ THIS LEG IS THE OTHER HALF OF THE QUOTA CAVEAT, AND THE REALLOCATION FLIGHT IS WHY IT EXISTS. The quota
// block above fires on a VENDOR pause. Setting a lane's allocation to 0 is not a vendor pause, so before this
// leg the drain and catchup lanes could be turned off entirely and NOTHING in Lora's prompt would say so — she
// would see interior days that never fill and depth that stops advancing, with no line explaining why. That is
// ESSENCE judgment law 6 (a confident answer over an uncaptured window) introduced by the change that promised
// to report it. The decision's own condition is "Lora reports the gap honestly, never hides it"; this is that
// condition made mechanical.
// ⛔ BEHAVIOURAL, AGAINST THE REAL COMPILED FUNCTION AND THE REAL TABLE — not a source grep, because a string
// present in a file proves nothing about whether it renders.
{
  const fn = CTX?.buildPausedLaneLines
  if (typeof fn !== 'function') {
    srcPins.push('build-claude-context exports no buildPausedLaneLines() — a lane can be zeroed with no disclosure path to the user at all')
  } else {
    const BUD = req(join(out, 'src/lib/backfill/google-op-budget.js'))
    const live = fn(BUD.LANE_ALLOCATIONS, 'Google')
    const zeroed = ['drain', 'catchup'].filter((l) => Number(BUD.LANE_ALLOCATIONS?.[l] ?? -1) === 0)
    if (zeroed.length && !live.length) {
      srcPins.push(`lane(s) [${zeroed.join(', ')}] are at 0 in LANE_ALLOCATIONS and the prompt renders NOTHING — the pause is invisible to the user, which is the one thing the decision forbade`)
    }
    if (zeroed.length) {
      const blob = live.join(' ')
      // ⛔ EACH REQUIRED CLAUSE IS A SEPARATE FAILURE MODE THAT ACTUALLY HAPPENED TO THIS PROJECT.
      if (!/NOT a platform outage|NOT a quota exhaustion/i.test(blob)) srcPins.push('the paused-lane disclosure does not deny a vendor outage — a purchased silence that reads as a Google failure is the exact misattribution ★LORA-OVER-WARNS-READ-FAILURES-AS-CAPTURE-FAILURE records')
      if (!/FORWARD capture still runs/i.test(blob)) srcPins.push('the disclosure does not say FORWARD is unaffected — without it Lora will over-warn and call current figures stale')
      if (!/NOT a ZERO|never sum across it/i.test(blob)) srcPins.push('the disclosure does not forbid treating a missing interior day as zero — silently summing across a known gap is the false-total class')
      if (!/Do NOT offer to trigger a backfill|neither can succeed/i.test(blob)) srcPins.push('the disclosure does not forbid offering a retry/backfill — an offer that cannot succeed is a false promise, the same defect the quota block already fixed')
    }
    // ⛔ AND IT MUST VANISH WITH THE POLICY. A disclosure that outlives the pause becomes a permanent lie in the
    // other direction, and the reversal must not have to remember to delete a prompt block.
    if (fn({ forward: 2_000, drain: 3_000, catchup: 4_000, backfill: 6_000 }, 'Google').length !== 0) {
      srcPins.push('buildPausedLaneLines renders on a FULLY-ALLOCATED table — the disclosure must disappear with the policy, or the reversal ships a prompt that contradicts the running system')
    }
  }
}
srcPins.forEach((p) => console.log(`  ✗ SOURCE PIN — ${p}`))
if (!srcPins.length) console.log('  ✓ source pins — capture lanes gate on holdGoogleWork; the answer path stays on .paused; the attach mirror matches the route; and a lane zeroed by decision discloses itself to the user')

Module._load = origLoad
cleanup()

const bad = results.filter((t) => t.mismatches.length)
if (bad.length || srcPins.length) {
  const core = bad.filter((t) => t.core).length
  console.error(`\n✗ google-quota-read-fails-open guard: ${bad.length}/${results.length} case(s) + ${srcPins.length} source pin(s) failed` +
    (core ? ` — ${core} of them the fail-open / auto-resume assertions this guard exists for.` : ''))
  process.exit(2)
}
console.log(`\n✓ google-quota-read-fails-open guard: ${results.length}/${results.length} cases + ${3 - srcPins.length}/3 source pins — an unreadable sentinel HOLDS capture and stays SILENT to Lora.`)
