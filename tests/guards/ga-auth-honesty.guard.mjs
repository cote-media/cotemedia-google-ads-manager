#!/usr/bin/env node
// LORAMER_GA_AUTH_IS_AN_ERROR_V1 + LORAMER_GA_TOKEN_LIVENESS_V1 — guard the two lies of 2026-07-30.
//
// WHAT WENT WRONG, so the guard cannot be weakened without reading it. Foam OH's stored GA access_token was DEAD
// (tokeninfo `invalid_token`, Data API 401 UNAUTHENTICATED) while `expires_at` read an hour in the FUTURE. Two
// independent defects then combined:
//   1. getValidGaToken treated `expires_at > now` as proof of validity, so it returned the corpse forever and
//      never refreshed. Self-perpetuating, not self-healing.
//   2. The per-family catch recorded each 401 as `skipped`, so twelve credential failures returned HTTP 200 with
//      `errors: []` and zero rows. A total outage wearing a success code, indistinguishable from an empty window.
// Six chained probes, 72 failed GA calls, 25 minutes, nothing written, nothing red.
//
// WHAT THIS PROVES — it DRIVES the real transpiled functions against a stubbed global.fetch. Not a grep.
//   (i)   401 with NO retry hook          -> THROWS GaAuthError. Never returns a clean "skipped" list.
//   (ii)  401 WITH a working retry hook   -> refreshes, retries ONCE, SUCCEEDS. The fix must not make GA
//                                            unreachable — a guard that only proves failure would be useless.
//   (iii) 401 with a retry that also 401s -> THROWS, family is in `errored`, and errored is DISJOINT from skipped.
//   (iv)  quota throw                     -> carries partial.notAttempted for the families never asked (FIX 3).
//   (v)   getValidGaToken forceRefresh    -> a FUTURE expires_at does NOT short-circuit; the token endpoint IS
//                                            called. This is assertion (b): no validity-free return path.
//   (vi)  getValidGaToken default         -> still short-circuits on a future expires_at (the cheap pre-filter is
//                                            intentional and must stay, or every call pays a round trip).
//
// ⚠ HONEST LIMIT. This proves the LIBRARY's behaviour. It does NOT prove the HTTP route maps a thrown GaAuthError
// onto a non-200 — that is asserted structurally at the end, by reading the recover function's source for the
// errors.push on the auth branch, because driving the route needs a DB and a live token. And it cannot prove WHY
// the stored token dies; that is banked as two open contradictions in the QUEUE, deliberately not chased here.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Module, { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const fail = (m) => { console.error(`[ga-auth-honesty] FAIL — ${m}`); process.exit(1) }

const SRC = 'src/lib/backfill/ga-dimensional-backfill.ts'
const TOK = 'src/lib/ga-token.ts'
for (const f of [SRC, TOK]) if (!existsSync(resolve(ROOT, f))) fail(`${f} is missing.`)

const out = mkdtempSync(join(tmpdir(), 'loramer-gaauth-guard-'))
const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
const r = spawnSync(tsc, [resolve(ROOT, SRC), resolve(ROOT, TOK), '--target', 'es2020', '--module', 'commonjs',
  '--moduleResolution', 'node', '--skipLibCheck', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
if (r.error) { rmSync(out, { recursive: true, force: true }); fail(`could not run tsc — ${r.error.message}`) }

// ── Supabase + module stubs. The DB is stubbed; the DECISIONS under test are the real code. ────────────────────
const tokenRow = {
  access_token: 'STORED-DEAD-TOKEN', refresh_token: 'RT', expires_at: new Date(Date.now() + 3600_000).toISOString(),
  ga_property_id: 'properties/1', ga_property_name: 'P',
}
let tokenUpdates = 0
const supabaseStub = {
  from: () => {
    const q = {
      select: () => q, eq: () => q, update: () => { tokenUpdates += 1; return q },
      single: async () => ({ data: tokenRow, error: null }),
      maybeSingle: async () => ({ data: tokenRow, error: null }),
      then: (res) => res({ data: tokenRow, error: null }),
    }
    return q
  },
}
const stub = join(out, '__stub.js')
writeFileSync(stub, `module.exports = {
  supabaseAdmin: globalThis.__SB__,
  normalizeMetricsRows: (r) => r,
  upsertMetricsChunked: async (r) => ({ written: r.length, chunks: 1 }),
  getValidGaToken: async () => ({ ok: false }),
  shouldStartAnotherLap: () => true,
  FIRST_LAP_MS: 1,
  mergeConflictKeyDupes: (r) => r,
}\n`)
globalThis.__SB__ = supabaseStub
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === '@/lib/ga-token') return join(out, 'src/lib/ga-token.js')
  if (request.startsWith('@/lib/backfill/lap-budget')) return stub
  if (request.startsWith('@/lib/')) return stub
  return origResolve.call(this, request, ...rest)
}

const mod = require(join(out, 'src/lib/backfill/ga-dimensional-backfill.js'))
const tokmod = require(join(out, 'src/lib/ga-token.js'))
Module._resolveFilename = origResolve

for (const n of ['fetchGaDimensionalRows', 'GaAuthError', 'GaQuotaExhaustedError', 'GA_FAMILY_COUNT']) {
  if (!mod[n]) fail(`${SRC} does not export ${n} — the auth-error category is missing entirely.`)
}
if (typeof tokmod.getValidGaToken !== 'function') fail(`${TOK} does not export getValidGaToken.`)

const { fetchGaDimensionalRows, GaAuthError, GaQuotaExhaustedError, GA_FAMILY_COUNT } = mod
const realFetch = globalThis.fetch
const ok = (rows = []) => ({ ok: true, status: 200, json: async () => ({ rows }) })
const err401 = () => ({ ok: false, status: 401, json: async () => ({ error: { code: 401, status: 'UNAUTHENTICATED', message: 'Request had invalid authentication credentials.' } }) })
const err429 = () => ({ ok: false, status: 429, json: async () => ({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Exhausted potentially thresholded requests quota.' } }) })
const BASE = { clientId: 'c', userEmail: 'e', accessToken: 'DEAD', propertyId: 'properties/1', propertyName: 'P', startDate: '2025-02-10', endDate: '2025-02-10' }

const quiet = { warn: console.warn, error: console.error }
console.warn = () => {}; console.error = () => {}
const loud = () => { console.warn = quiet.warn; console.error = quiet.error }

let failures = []
const check = (cond, msg) => { if (!cond) failures.push(msg) }

// ── (i) 401, no retry hook -> THROWS. It must NOT come back as a tidy list of skips. ───────────────────────────
globalThis.fetch = async () => err401()
let threw = null, ret = null
try { ret = await fetchGaDimensionalRows({ ...BASE }) } catch (e) { threw = e }
check(threw instanceof GaAuthError,
  `(i) a 401 did NOT throw GaAuthError. ${ret ? `It RETURNED skipped=[${ret.skipped}] errored=[${ret.errored ?? 'undefined'}] — this is the false success: twelve credential failures reported as a clean result.` : `Threw ${threw && threw.name}.`}`)

// ── (ii) 401 then a working refresh -> retried ONCE and SUCCEEDS. ──────────────────────────────────────────────
let calls = 0
globalThis.fetch = async (_u, init) => {
  calls += 1
  const auth = String(init?.headers?.Authorization || '')
  return auth.includes('GOOD') ? ok([]) : err401()
}
let retries = 0
threw = null; ret = null
try {
  ret = await fetchGaDimensionalRows({ ...BASE, onAuthRetry: async () => { retries += 1; return 'GOOD-TOKEN' } })
} catch (e) { threw = e }
check(!threw, `(ii) a 401 followed by a WORKING refresh still threw (${threw && threw.name}: ${threw && threw.message}). The retry path does not recover.`)
check(retries === 1, `(ii) expected exactly ONE forced refresh, saw ${retries}. One retry, not a loop.`)
check(ret && ret.skipped.length === 0 && (ret.errored || []).length === 0,
  `(ii) after a successful retry the family was still recorded as failed: skipped=[${ret && ret.skipped}] errored=[${ret && ret.errored}].`)

// ── (iii) 401, refresh, 401 again -> THROWS, errored populated, DISJOINT from skipped. ─────────────────────────
globalThis.fetch = async () => err401()
threw = null; ret = null
try { ret = await fetchGaDimensionalRows({ ...BASE, onAuthRetry: async () => 'STILL-BAD' }) } catch (e) { threw = e }
check(threw instanceof GaAuthError, `(iii) a persistent 401 did not throw GaAuthError; it ${ret ? 'RETURNED a value' : `threw ${threw && threw.name}`}.`)
if (threw instanceof GaAuthError) {
  const p = threw.partial || {}
  check(Array.isArray(p.errored) && p.errored.length === 1,
    `(iii) partial.errored should name the one family that failed auth, got ${JSON.stringify(p.errored)}.`)
  check((p.skipped || []).length === 0,
    `(iii) an auth failure leaked into skipped=${JSON.stringify(p.skipped)} — the categories must stay disjoint.`)
  check((p.notAttempted || []).length === GA_FAMILY_COUNT - 1,
    `(iii) the ${GA_FAMILY_COUNT - 1} families after the failure should be notAttempted, got ${(p.notAttempted || []).length}.`)
}

// ── (iv) FIX 3 — a quota throw carries the families it never asked for. ────────────────────────────────────────
globalThis.fetch = async () => err429()
threw = null
try { await fetchGaDimensionalRows({ ...BASE }) } catch (e) { threw = e }
check(threw instanceof GaQuotaExhaustedError, `(iv) a 429 did not throw GaQuotaExhaustedError.`)
if (threw instanceof GaQuotaExhaustedError) {
  const na = (threw.partial || {}).notAttempted
  check(Array.isArray(na) && na.length === GA_FAMILY_COUNT - 1,
    `(iv) a quota stop reported notAttempted=${JSON.stringify(na)} — run 1 shipped "[]" here while four families went unasked. Expected ${GA_FAMILY_COUNT - 1}.`)
}

// ── (v)+(vi) the token liveness path. ──────────────────────────────────────────────────────────────────────────
let tokenEndpointHits = 0
globalThis.fetch = async (u) => {
  // ⚠ /tokeninfo is a SUBSTRING of /token. LORAMER_TOKEN_VALIDATE_BEFORE_PERSIST_V1 added a tokeninfo call
  // to the refresh path, and a naive `.includes('/token')` counted it as a second refresh — a FALSE RED that
  // named the wrong defect entirely. Match the refresh endpoint exactly, and answer tokeninfo separately so
  // the validated-refresh path can complete.
  if (String(u).includes('/tokeninfo')) {
    return { ok: true, status: 200, json: async () => ({ scope: 'x', expires_in: '3599' }) }
  }
  if (/oauth2\.googleapis\.com\/token(\?|$)/.test(String(u))) {
    tokenEndpointHits += 1
    return { ok: true, status: 200, json: async () => ({ access_token: 'FRESH', expires_in: 3599, scope: 'x' }) }
  }
  return ok([])
}
process.env.GOOGLE_ANALYTICS_CLIENT_ID = 'cid'
process.env.GOOGLE_ANALYTICS_CLIENT_SECRET = 'sec'

tokenEndpointHits = 0
const plain = await tokmod.getValidGaToken('c', 'e')
check(plain.ok && plain.accessToken === 'STORED-DEAD-TOKEN' && tokenEndpointHits === 0,
  `(vi) the cheap pre-filter regressed: a future expires_at should still short-circuit without a round trip (hits=${tokenEndpointHits}).`)

tokenEndpointHits = 0
const forced = await tokmod.getValidGaToken('c', 'e', { forceRefresh: true })
check(tokenEndpointHits === 1,
  `(v) forceRefresh did NOT reach the token endpoint (hits=${tokenEndpointHits}) — a stored token with a future expires_at is still returned with NO validity path. This is the 2026-07-30 defect.`)
check(forced.ok && forced.accessToken === 'FRESH',
  `(v) forceRefresh did not return the refreshed token (got ${forced.ok ? forced.accessToken : forced.reason}).`)

// ── structural: the route contract. A thrown GaAuthError must land in errors[], which is what makes it non-200. ─
const src = readFileSync(resolve(ROOT, SRC), 'utf8')
const recoverBody = src.slice(src.indexOf('export async function recoverGaDimensionalForward'))
check(/instanceof GaAuthError[\s\S]{0,700}?errors\.push/.test(recoverBody),
  `(vii) recoverGaDimensionalForward does not push a GaAuthError into errors[] — status stays 200 and the HTTP contract keeps lying.`)
check(/skipped\.length === GA_FAMILY_COUNT[\s\S]{0,400}?errors\.push/.test(recoverBody),
  `(vii) an all-${GA_FAMILY_COUNT}-families-failed slice does not push an error — a total slice failure still answers 200.`)
check(/erroredFamilies/.test(recoverBody),
  `(vii) erroredFamilies is not reported — the third category is missing from the response body.`)
check(/forceRefresh: true/.test(recoverBody),
  `(vii) recoverGaDimensionalForward never forces a refresh — the liveness path is defined but not wired.`)

loud()
globalThis.fetch = realFetch
rmSync(out, { recursive: true, force: true })

if (failures.length) {
  console.error(`[ga-auth-honesty] FAIL — ${failures.length} finding(s):`)
  for (const f of failures) console.error(`  · ${f}`)
  process.exit(1)
}
console.log(`[ga-auth-honesty] PASS — 401 throws (never a skip), one forced retry recovers, errored is disjoint from skipped/notAttempted, quota throws carry notAttempted, and forceRefresh defeats a future expires_at. ${GA_FAMILY_COUNT} families.`)
