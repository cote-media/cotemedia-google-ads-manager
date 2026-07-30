#!/usr/bin/env node
// LORAMER_TOKEN_FRESH_READ_V1 + LORAMER_TOKEN_VALIDATE_BEFORE_PERSIST_V1 — guard the loop that ate a re-auth.
//
// WHAT HAPPENED, 2026-07-30. Foam OH's GA credential was re-authorized at 18:29:23Z and verified working.
// Two minutes later /api/backfill/ga-dimensional-recover wrote a DEAD access token over it and stamped a
// fresh one-hour expires_at on the corpse, so every later caller saw a healthy-looking row and the outage
// could not self-heal. Google was proven NOT to be the variable: three refreshes seven seconds apart
// returned three DIFFERENT working tokens. Two dead writes came from the one route lacking cache
// directives; five live mints came from a route declaring force-no-store.
//
// THREE ASSERTIONS:
//  (a) FRESH READ — every API route whose transitive import closure touches a *_tokens table must declare
//      dynamic='force-dynamic' AND fetchCache='force-no-store'. Baselined, because the 2026-07-30 audit
//      found this missing on many routes and fixing them was deliberately NOT in that commit. NEW offenders
//      fail. STALE baseline entries fail too — the ledger may not outlive the debt.
//  (b) NO IDENTICAL-TOKEN WRITE — a refresh returning the byte-identical stored token must NOT persist.
//  (c) NO UNVALIDATED WRITE — a token that Google's tokeninfo does not accept must NOT persist, and must
//      surface as reconnect_required rather than a retryable failure.
//
// (b) and (c) DRIVE the real transpiled getValidGaToken against a stubbed fetch and a supabase stub that
// COUNTS writes. Not a grep — a write attempt is observed, not inferred.
//
// ⚠ HONEST LIMIT: (a) proves a declaration exists, not that Next.js would otherwise have served a stale
// read. The mechanism behind the 2026-07-30 writes was never established (Next 14 does not cache POST by
// default, which argues against the simplest reading). This guard locks in the known-correct posture for
// routes whose correctness depends on reading the primary fresh; it does not claim to have found the bug.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import Module, { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const fail = (m) => { console.error(`[token-freshness] FAIL — ${m}`); process.exit(1) }
const findings = []

// ── (a) FRESH READ, over the transitive import closure ──────────────────────────────────────────────────
const TOKEN_TABLE = /\.from\(\s*['"](?:ga|meta|google|shopify|woocommerce)_tokens['"]\s*\)/
const readSafe = (p) => { try { return readFileSync(p, 'utf8') } catch { return '' } }

function resolveImport(spec, fromFile) {
  let base
  if (spec.startsWith('@/')) base = resolve(ROOT, 'src', spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec)
  else return null
  for (const c of [base + '.ts', base + '.tsx', join(base, 'index.ts'), base + '.js']) {
    if (existsSync(c) && statSync(c).isFile()) return c
  }
  return null
}

function touchesTokens(entry) {
  const seen = new Set()
  const stack = [entry]
  while (stack.length) {
    const f = stack.pop()
    if (seen.has(f)) continue
    seen.add(f)
    const src = readSafe(f)
    if (TOKEN_TABLE.test(src)) return true
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const r = resolveImport(m[1], f)
      if (r && !seen.has(r)) stack.push(r)
    }
  }
  return false
}

function walkRoutes(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walkRoutes(p, out)
    else if (e === 'route.ts' || e === 'route.tsx') out.push(p)
  }
  return out
}

const BASELINE_PATH = resolve(ROOT, 'tests/guards/token-freshness.baseline.json')
if (!existsSync(BASELINE_PATH)) fail(`missing baseline ${BASELINE_PATH}`)
const baselineDoc = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
const baseline = new Set(baselineDoc.missingDirectives)
const EMIT = process.argv.includes('--emit-baseline')

const routes = walkRoutes(resolve(ROOT, 'src/app/api')).sort()
const offenders = []
for (const r of routes) {
  if (!touchesTokens(r)) continue
  const src = readSafe(r)
  const hasDyn = /export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/.test(src)
  const hasFc = /export\s+const\s+fetchCache\s*=\s*['"]force-no-store['"]/.test(src)
  if (!hasDyn || !hasFc) offenders.push(r.slice(ROOT.length + 1))
}
const offenderSet = new Set(offenders)
if (EMIT) {
  // Regenerate the ledger from the SAME walker that enforces it, so the two can never disagree.
  const RECOVER_ = 'src/app/api/backfill/ga-dimensional-recover/route.ts'
  baselineDoc.missingDirectives = offenders.filter((o) => o !== RECOVER_)
  writeFileSync(BASELINE_PATH, JSON.stringify(baselineDoc, null, 2) + '\n')
  console.log(`[token-freshness] --emit-baseline wrote ${baselineDoc.missingDirectives.length} entries`)
  process.exit(0)
}
const NEW = offenders.filter((o) => !baseline.has(o))
const STALE = [...baseline].filter((b) => !offenderSet.has(b))
if (NEW.length) {
  findings.push(`(a) ${NEW.length} NEW route(s) read a *_tokens table without force-dynamic + force-no-store:\n      ${NEW.join('\n      ')}`)
}
if (STALE.length) {
  findings.push(`(a) ${STALE.length} STALE baseline entry(ies) — these now declare the directives; drop them from the baseline. The ledger may not outlive the debt:\n      ${STALE.join('\n      ')}`)
}
const RECOVER = 'src/app/api/backfill/ga-dimensional-recover/route.ts'
if (offenderSet.has(RECOVER)) findings.push(`(a) ${RECOVER} is THE route that ate the 2026-07-30 re-auth and it still lacks the directives.`)
if (baseline.has(RECOVER)) findings.push(`(a) ${RECOVER} must never be baselined — it is the known offender this guard exists for.`)

// ── (b) + (c) DRIVE the real getValidGaToken ────────────────────────────────────────────────────────────
const TOK = 'src/lib/ga-token.ts'
if (!existsSync(resolve(ROOT, TOK))) fail(`${TOK} is missing.`)
const out = mkdtempSync(join(tmpdir(), 'loramer-tokguard-'))
const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
const r = spawnSync(tsc, [resolve(ROOT, TOK), '--target', 'es2020', '--module', 'commonjs', '--moduleResolution',
  'node', '--skipLibCheck', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
if (r.error) { rmSync(out, { recursive: true, force: true }); fail(`could not run tsc — ${r.error.message}`) }

let writes = 0
let lastWrite = null
const ROW = {
  access_token: 'STORED-TOKEN', refresh_token: 'RT',
  expires_at: new Date(Date.now() - 60_000).toISOString(), // EXPIRED, so the refresh path always runs
  ga_property_id: 'properties/1', ga_property_name: 'P',
}
globalThis.__SB__ = {
  from: () => {
    const q = {
      select: () => q, eq: () => q,
      update: (p) => { writes += 1; lastWrite = p; return q },
      single: async () => ({ data: ROW, error: null }),
      maybeSingle: async () => ({ data: ROW, error: null }),
      then: (res) => res({ data: ROW, error: null }),
    }
    return q
  },
}
const stub = join(out, '__stub.js')
writeFileSync(stub, 'module.exports = { supabaseAdmin: globalThis.__SB__ }\n')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (req, ...rest) { return req.startsWith('@/lib/') ? stub : origResolve.call(this, req, ...rest) }
const tokmod = require(join(out, 'src/lib/ga-token.js'))
Module._resolveFilename = origResolve

process.env.GOOGLE_ANALYTICS_CLIENT_ID = 'cid'
process.env.GOOGLE_ANALYTICS_CLIENT_SECRET = 'sec'
const realFetch = globalThis.fetch
const quiet = console.error; console.error = () => {}

const scenario = async ({ minted, tokeninfoStatus }) => {
  writes = 0; lastWrite = null
  globalThis.fetch = async (u) => {
    const url = String(u)
    if (url.includes('oauth2.googleapis.com/token?') || url.includes('/tokeninfo')) {
      return { ok: tokeninfoStatus === 200, status: tokeninfoStatus, json: async () => ({ error: 'invalid_token', error_description: 'Invalid Value' }) }
    }
    if (url.includes('oauth2.googleapis.com/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: minted, expires_in: 3599, scope: 's' }) }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  }
  const res = await tokmod.getValidGaToken('c', 'e')
  return { res, writes, lastWrite }
}

// (b) identical token returned -> must NOT write, must NOT report ok
{
  const { res, writes: w } = await scenario({ minted: 'STORED-TOKEN', tokeninfoStatus: 200 })
  if (w !== 0) findings.push(`(b) a refresh that returned the BYTE-IDENTICAL stored token PERSISTED it (${w} write(s)). This is the write that stamped a fresh expires_at on a corpse.`)
  if (res.ok) findings.push(`(b) an identical-token refresh reported ok:true — it must be treated as a FAILED refresh.`)
}

// (c) new token, tokeninfo REJECTS it -> must NOT write, must be reconnect_required
{
  const { res, writes: w } = await scenario({ minted: 'FRESH-BUT-DEAD', tokeninfoStatus: 400 })
  if (w !== 0) findings.push(`(c) an UNVALIDATED token was persisted (${w} write(s)) after Google's tokeninfo rejected it. A refresh must never downgrade a working credential.`)
  if (res.ok) findings.push(`(c) a token Google rejects reported ok:true.`)
  else if (res.reason !== 'reconnect_required') findings.push(`(c) a rejected token surfaced reason='${res.reason}', expected 'reconnect_required' — a retryable code sends the operator round a loop that cannot succeed.`)
}

// (c2) unprovable (tokeninfo 5xx) -> must NOT write either
{
  const { res, writes: w } = await scenario({ minted: 'FRESH-UNPROVABLE', tokeninfoStatus: 503 })
  if (w !== 0) findings.push(`(c2) a token that could NOT be validated (tokeninfo 503) was persisted (${w} write(s)). Unprovable must mean do-not-write.`)
  if (res.ok) findings.push(`(c2) an unprovable token reported ok:true.`)
}

// POSITIVE CONTROL — a genuinely new, validated token MUST still persist, or this guard would pass by
// making refresh impossible.
{
  const { res, writes: w, lastWrite } = await scenario({ minted: 'FRESH-AND-GOOD', tokeninfoStatus: 200 })
  if (w !== 1) findings.push(`POSITIVE CONTROL: a new, validated token was NOT persisted (${w} write(s)) — the fix has made refresh impossible.`)
  if (!res.ok) findings.push(`POSITIVE CONTROL: a new, validated token reported ok:false (${res.reason}).`)
  if (lastWrite && lastWrite.access_token !== 'FRESH-AND-GOOD') findings.push(`POSITIVE CONTROL: wrote the wrong token.`)
}

console.error = quiet
globalThis.fetch = realFetch
rmSync(out, { recursive: true, force: true })

console.log(`[token-freshness] scanned ${routes.length} api routes · ${offenders.length} token-reading route(s) missing directives (${baseline.size} baselined) · drove getValidGaToken over 4 scenarios`)
if (findings.length) {
  console.error(`[token-freshness] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  · ${f}`)
  process.exit(1)
}
console.log('[token-freshness] PASS — the recover route reads fresh, identical-token refreshes do not write, unvalidated tokens do not write, and a real refresh still persists.')
