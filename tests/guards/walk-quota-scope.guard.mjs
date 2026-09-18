#!/usr/bin/env node
// LORAMER_WALK_QUOTA_SCOPE_V1 — THE WALK READS GOOGLE'S OWN QUOTA DETAILS AND KEYS ITS HOLD ON SCOPE, NEVER ON THE CODE.
//
// WHAT THIS GUARDS (rounds 3–5, 2026-09-18):
//   (a) PURE: `classifyWalkQuotaError` reads details.quota_error_details {rate_scope, rate_name, retry_delay} from the
//       decoded GoogleAdsFailure; BOTH quota codes (2 RESOURCE_EXHAUSTED and 4 RESOURCE_TEMPORARILY_EXHAUSTED) take the
//       same path; the code number never decides scope.
//   (b) PURE: `decideWalkHold` — ACCOUNT → a LANE hold for retry_delay; DEVELOPER → the FLEET row; message-only
//       "Retry in N seconds" → FLEET for N (scope unknown = today's behaviour); no delay anywhere → 10/20/40 s ×3,
//       lane-scoped, then a bounded lane hold. NEVER shorter than a delay Google sent.
//   (c) STORE: `applyWalkHold` with an ACCOUNT decision touches the lane record and NOT the fleet row; DEVELOPER touches
//       the fleet row and NOT the lane record.
//   (d) PLACEMENT: the walk boundary (universe-vendor-stream.ts) arms through `armWalkQuota` and no longer imports
//       `noteGoogleQuotaError`; the walk modules carry no 3600 default; both hold paths read the lane hold.
//   (e) BYTE-IDENTICAL SHARED MODULES (route R2): google-quota.ts and google-quota-store.ts hash to their e250bea
//       content — the five live/legacy importers (intelligence/route, google-intelligence, google-retry, cron/drain,
//       cron/catchup) resolve to unchanged exports. Re-pin here ONLY under a live-path confirm.
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' } }
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')

const PURE = 'src/lib/backfill/walk-quota.ts'
const STORE = 'src/lib/backfill/walk-quota-store.ts'
const STREAM = 'src/lib/backfill/universe-vendor-stream.ts'
const WORKER = 'src/lib/backfill/universe-v2-worker.ts'
const ROUTE = 'src/app/api/cron/universe-resume/route.ts'
const QUOTA = 'src/lib/backfill/google-quota.ts'
const QUOTA_STORE = 'src/lib/backfill/google-quota-store.ts'
const MIG = 'migrations/097_universe_lane_hold.sql'

// (e) the shared modules, pinned at e250bea (2026-09-18). A change here is a LIVE-PATH change and needs Russ.
const PINNED = {
  [QUOTA]: '3ba4e8dd7ed4b737c352de9becf4f99e686cc4049e9244f1f28e6f8064fbbfb3',
  [QUOTA_STORE]: '76c431e7fd3e536a5cc9c09166fbcc2b163bcc78c742722720d4b4f065ce0886',
}
for (const [rel, want] of Object.entries(PINNED)) {
  const got = createHash('sha256').update(read(rel)).digest('hex')
  check(got === want, `(e) ${rel} changed (sha256 ${got.slice(0, 12)}… ≠ pinned ${want.slice(0, 12)}…). Route R2 promised the five live/legacy importers byte-identical behaviour; editing this file is LIVE-PATH blast and needs a live-path confirm before this pin moves.`)
}

// ── (a)(b)(c) behavioural legs ──────────────────────────────────────────────────────────────────────────────
let M = null, S = null
const tmp = mkdtempSync(join(tmpdir(), 'walk-quota-'))
try {
  const pure = read(PURE)
  writeFileSync(join(tmp, 'walk-quota.ts'), pure)
  const store = read(STORE)
    .replace(/import \{[^}]*\} from '@\/lib\/supabase'\n/, 'const supabaseAdmin = null as any\n')
    .replace(/from '\.\/google-quota-store'/, "from './__fleet.js'")
    .replace(/from '\.\/walk-quota'/, "from './walk-quota.js'")
  writeFileSync(join(tmp, 'walk-quota-store.ts'), store)
  writeFileSync(join(tmp, '__fleet.ts'), `export async function writeGoogleQuotaPause(resetIso: string, detail: string) { (globalThis as any).__fleet.push({ resetIso, detail }) }\n`)
  const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsc', '--noResolve', '--skipLibCheck', '--target', 'es2022', '--module', 'es2022', '--moduleResolution', 'node', '--outDir', tmp, join(tmp, 'walk-quota.ts'), join(tmp, 'walk-quota-store.ts'), join(tmp, '__fleet.ts')], { cwd: ROOT, encoding: 'utf8' })
  if (r.error) findings.push(`could not run tsc — ${r.error.message}`)
  M = await import(pathToFileURL(join(tmp, 'walk-quota.js')).href)
  S = await import(pathToFileURL(join(tmp, 'walk-quota-store.js')).href)
  for (const fn of ['classifyWalkQuotaError', 'decideWalkHold', 'describeWalkQuota']) {
    if (typeof M[fn] !== 'function') { findings.push(`(a) ${PURE} does not export ${fn}() — the walk has no scope-aware classifier.`); M = null }
  }
  if (S && typeof S.applyWalkHold !== 'function') { findings.push(`(c) ${STORE} does not export applyWalkHold() — the walk has no scope-keyed hold.`); S = null }
} catch (e) {
  findings.push(`the behavioural legs could not run — ${e.message}. A guard that cannot execute its subject FAILS; it does not pass quietly.`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

const NOW = Date.parse('2026-09-18T03:20:30.000Z')
const failure = (code, msg, details) => ({ errors: [{ error_code: { quota_error: code }, message: msg, ...(details ? { details: { quota_error_details: details } } : {}) }] })

if (M) {
  // (a) the payload is read from details, both codes alike
  const acct2 = M.classifyWalkQuotaError(failure(2, 'Too many requests. Retry in 4 seconds.', { rate_scope: 2, rate_name: 'Requests per service per method', retry_delay: { seconds: 4, nanos: 0 } }))
  check(acct2.quota === true && acct2.rateScope === 'ACCOUNT' && acct2.rateName === 'Requests per service per method' && acct2.retryDelayS === 4 && acct2.delaySource === 'details', `(a) an ACCOUNT-scoped code-2 failure must classify quota/ACCOUNT/4 s from details — got ${JSON.stringify(acct2)}`)
  const acct4 = M.classifyWalkQuotaError(failure(4, 'Too many requests. Retry in 4 seconds.', { rate_scope: 'ACCOUNT', rate_name: 'x', retry_delay: { seconds: '4' } }))
  check(acct4.quota === true && acct4.rateScope === 'ACCOUNT' && acct4.retryDelayS === 4, `(a) code 4 (RESOURCE_TEMPORARILY_EXHAUSTED) must take the same path as code 2 — got ${JSON.stringify(acct4)}`)
  const dev = M.classifyWalkQuotaError(failure(2, 'Too many requests. Retry in 84106 seconds.', { rate_scope: 3, rate_name: 'Get requests for standard access', retry_delay: { seconds: 84106 } }))
  check(dev.rateScope === 'DEVELOPER' && dev.retryDelayS === 84106, `(a) DEVELOPER (enum 3) must classify as DEVELOPER/84106 — got ${JSON.stringify(dev)}`)
  const msgOnly = M.classifyWalkQuotaError(failure(2, 'Too many requests. Retry in 900 seconds.'))
  check(msgOnly.quota === true && msgOnly.rateScope === 'UNKNOWN' && msgOnly.retryDelayS === 900 && msgOnly.delaySource === 'message', `(a) a message-only payload must read 900 s from the message with scope UNKNOWN — got ${JSON.stringify(msgOnly)}`)
  const none = M.classifyWalkQuotaError(failure(2, 'Too many requests.'))
  check(none.quota === true && none.retryDelayS === null && none.delaySource === 'none', `(a) a quota error with no delay anywhere must report delaySource 'none' — got ${JSON.stringify(none)}`)
  const notQuota = M.classifyWalkQuotaError({ errors: [{ error_code: { request_error: 8 }, message: 'EXPIRED_PAGE_TOKEN' }] })
  check(notQuota.quota === false, `(a) a non-quota failure must not classify as quota — got ${JSON.stringify(notQuota)}`)
  check(M.describeWalkQuota(acct2).includes('"rate_scope":"ACCOUNT"') && M.describeWalkQuota(acct2).includes('"retry_delay_s":4') && M.describeWalkQuota(acct2).includes('Retry in 4 seconds'), `(a) describeWalkQuota must carry scope, name, delay and the raw message for the ledger — got ${M.describeWalkQuota(acct2)}`)

  // (b) scope decides the hold
  const dA = M.decideWalkHold({ kind: acct2, nowMs: NOW, priorBackoffTries: 0 })
  check(dA.kind === 'lane' && dA.untilMs === NOW + 4000, `(b) ACCOUNT → LANE hold until now+4 s — got ${JSON.stringify(dA)}`)
  const dD = M.decideWalkHold({ kind: dev, nowMs: NOW, priorBackoffTries: 0 })
  check(dD.kind === 'fleet' && dD.untilMs === NOW + 84106000, `(b) DEVELOPER → FLEET hold for the sent delay — got ${JSON.stringify(dD)}`)
  const dM = M.decideWalkHold({ kind: msgOnly, nowMs: NOW, priorBackoffTries: 0 })
  check(dM.kind === 'fleet' && dM.untilMs === NOW + 900000, `(b) message-only "Retry in 900" → FLEET for 900 s (scope unknown = today's behaviour) — got ${JSON.stringify(dM)}`)
  const b1 = M.decideWalkHold({ kind: none, nowMs: NOW, priorBackoffTries: 0 })
  const b2 = M.decideWalkHold({ kind: none, nowMs: NOW, priorBackoffTries: 1 })
  const b3 = M.decideWalkHold({ kind: none, nowMs: NOW, priorBackoffTries: 2 })
  const b4 = M.decideWalkHold({ kind: none, nowMs: NOW, priorBackoffTries: 3 })
  check(b1.kind === 'lane' && b1.untilMs === NOW + 10000 && b1.backoffTries === 1, `(b) no delay, try 1 → LANE 10 s — got ${JSON.stringify(b1)}`)
  check(b2.kind === 'lane' && b2.untilMs === NOW + 20000 && b2.backoffTries === 2, `(b) no delay, try 2 → LANE 20 s — got ${JSON.stringify(b2)}`)
  check(b3.kind === 'lane' && b3.untilMs === NOW + 40000 && b3.backoffTries === 3, `(b) no delay, try 3 → LANE 40 s — got ${JSON.stringify(b3)}`)
  check(b4.kind === 'lane' && b4.untilMs >= NOW + 40000 && /exhausted|bounded/i.test(b4.reason), `(b) after three tries the fallback must not loop: a bounded lane hold ≥ the last step — got ${JSON.stringify(b4)}`)
  const dN = M.decideWalkHold({ kind: notQuota, nowMs: NOW, priorBackoffTries: 0 })
  check(dN.kind === 'none', `(b) a non-quota failure decides nothing — got ${JSON.stringify(dN)}`)
  // never shorter than a sent delay: an ACCOUNT delay of 1 s is honoured as 1 s, not rounded to the fallback
  const short = M.decideWalkHold({ kind: M.classifyWalkQuotaError(failure(2, 'x', { rate_scope: 2, retry_delay: { seconds: 1 } })), nowMs: NOW, priorBackoffTries: 5 })
  check(short.kind === 'lane' && short.untilMs === NOW + 1000, `(b) a sent delay is honoured exactly, whatever the backoff history — got ${JSON.stringify(short)}`)
  check(Array.isArray(M.WALK_QUOTA_FALLBACK_BACKOFF_S) && M.WALK_QUOTA_FALLBACK_BACKOFF_S.join(',') === '10,20,40', `(b) WALK_QUOTA_FALLBACK_BACKOFF_S must be exactly 10,20,40 (Google's handle-rate-exceeded sample) — got ${JSON.stringify(M.WALK_QUOTA_FALLBACK_BACKOFF_S)}`)
}

if (M && S) {
  // (c) the store touches ONE record per scope
  const LANE_CLIENT = '11111111-1111-1111-1111-111111111111' // fixture: a made-up lane id — this leg proves WHICH record is written (lane vs fleet), never anything about a real client
  globalThis.__fleet = []
  const laneRows = []
  const deps = {
    writeFleet: async (resetIso, detail) => { globalThis.__fleet.push({ resetIso, detail }) },
    upsertLane: async (row) => { laneRows.push(row) },
    readLane: async () => null,
  }
  const kA = M.classifyWalkQuotaError(failure(2, 'Too many requests. Retry in 4 seconds.', { rate_scope: 2, rate_name: 'Requests per service per method', retry_delay: { seconds: 4 } }))
  await S.applyWalkHold({ kind: kA, lane: { clientId: LANE_CLIENT, vendor: 'google' }, site: 'guard', nowMs: NOW }, deps)
  check(globalThis.__fleet.length === 0 && laneRows.length === 1 && laneRows[0].client_id === LANE_CLIENT && laneRows[0].rate_scope === 'ACCOUNT', `(c) an ACCOUNT hold must write the lane record and leave the fleet row untouched — fleet=${globalThis.__fleet.length} lane=${laneRows.length}`)
  const kD = M.classifyWalkQuotaError(failure(2, 'Too many requests. Retry in 900 seconds.', { rate_scope: 3, rate_name: 'Get requests for standard access', retry_delay: { seconds: 900 } }))
  await S.applyWalkHold({ kind: kD, lane: { clientId: LANE_CLIENT, vendor: 'google' }, site: 'guard', nowMs: NOW }, deps)
  check(globalThis.__fleet.length === 1 && laneRows.length === 1 && /"rate_scope":"DEVELOPER"/.test(globalThis.__fleet[0].detail), `(c) a DEVELOPER hold must arm the fleet row (with the scope in its reason) and write no lane record — fleet=${globalThis.__fleet.length} lane=${laneRows.length}`)
  // an ACCOUNT answer with NO lane context (a caller that did not say which lane) falls back to the fleet — today's behaviour, never a dropped hold
  await S.applyWalkHold({ kind: kA, lane: null, site: 'guard', nowMs: NOW }, deps)
  check(globalThis.__fleet.length === 2, `(c) an ACCOUNT hold with no lane context must fall back to the fleet row rather than drop the hold — fleet=${globalThis.__fleet.length}`)
}

// ── (d) placement ───────────────────────────────────────────────────────────────────────────────────────────
{
  const stream = strip(read(STREAM))
  check(!/noteGoogleQuotaError/.test(stream), `(d) ${STREAM} still imports/calls noteGoogleQuotaError — the walk boundary must arm through armWalkQuota so an ACCOUNT-scoped refusal holds one lane, not the fleet.`)
  check(/armWalkQuota\(/.test(stream) && /from '\.\/walk-quota-store'/.test(stream), `(d) ${STREAM} must call armWalkQuota from ./walk-quota-store at the boundary.`)
  check(/googleAdsStreamFor\(\s*userEmail: string,\s*customerId: string,\s*lane\?/.test(read(STREAM)), `(d) ${STREAM}: googleAdsStreamFor must accept the lane ({ clientId, vendor }) so the boundary can hold one lane.`)
  for (const rel of [PURE, STORE]) {
    const s = strip(read(rel))
    check(!/3600/.test(s), `(d) ${rel} carries a 3600 — the invented 1 h default must not exist on the walk path (Google's fallback is 10/20/40 s).`)
  }
  const worker = strip(read(WORKER))
  check(/readWalkLaneHold\(/.test(worker) && /googleAdsStreamFor\(userEmail, customerId, \{ clientId, vendor: VENDOR \}\)/.test(worker), `(d) ${WORKER}: the consumer must read the lane hold beside the fleet sentinel and pass its lane to googleAdsStreamFor.`)
  const route = strip(read(ROUTE))
  check(/readWalkLaneHold\(/.test(route), `(d) ${ROUTE}: the resumer's hold path must read the lane hold beside the fleet sentinel.`)
  const mig = read(MIG)
  check(/create table if not exists public\.universe_lane_hold/i.test(mig) && /primary key \(client_id, vendor\)/i.test(mig) && /held_until/.test(mig), `(d) ${MIG} must create universe_lane_hold keyed (client_id, vendor) with held_until.`)
}

if (findings.length) {
  console.error(`[walk-quota-scope] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error('  • ' + f)
  process.exit(1)
}
console.log('[walk-quota-scope] PASS — the walk reads quota_error_details and keys its hold on scope (ACCOUNT → one lane, DEVELOPER/message-only → the fleet, no delay → 10/20/40 s lane backoff, never shorter than a sent delay); the shared quota modules are byte-identical to e250bea.')
