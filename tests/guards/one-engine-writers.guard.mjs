#!/usr/bin/env node
// LORAMER_ONE_ENGINE_V1 (2026-09-22) — EVERY OLD-ENGINE GOOGLE WRITER ASKS legacyEngineServes(conn) BEFORE ITS FIRST CLAIM OR WRITE.
//
// The marker (platform_connections.engine) must never lie: a row may say walk only when the old engine cannot write for it.
// This guard pins the SOURCE ORDER in every writer — no line numbers, indices inside the file's own text — so a refactor
// that moves a filter below a claim fails the build. The runtime detector is check-engine-marker.mjs (check:data).
//
// LEGS
//  (a) sync + catchup: inside the google block, `legacyEngineServes(` precedes `pendingForwardClients(`/`pendingCatchupClients(`
//      which precedes `claimForward('google'`/`claimCatchup('google'` — and the helper's own connection predicate carries it
//  (b) drain: the enumeration select carries `engine`; `legacyEngineServes(` precedes the first `claim_backfill_cursor`
//  (c) run-backfill + google-dimensional: `legacyEngineServes(` after `platform_connections` and before `google_tokens`/token load
//  (d) kickoff.ts: the google-walk early return precedes `waitUntil(`
//  (e) the three kick callers select or read `engine`
//  (f) the two cursor-reading instruments carry the engine clause
//  (g) migrations/102 exists and sets the default to walk
//  (h) registered in scripts/run-guards.mjs
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')
const idx = (src, needle, from = 0) => src.indexOf(needle, from)

// (a)
for (const [file, helper, claim] of [
  ['src/app/api/cron/sync/route.ts', 'pendingForwardClients(', "claimForward('google'"],
  ['src/app/api/cron/catchup/route.ts', 'pendingCatchupClients(', "claimCatchup('google'"],
]) {
  const src = strip(read(file))
  if (!src) { findings.push(`(a) ${file} does not exist`); continue }
  const helperDef = idx(src, `async function ${helper.replace('(', '')}`)
  const helperBody = helperDef === -1 ? '' : src.slice(helperDef, idx(src, '\n}', helperDef))
  if (!/pc\.platform === platform && legacyEngineServes\(pc\)/.test(helperBody)) findings.push(`(a) ${file} ${helper.replace('(', '')}'s connection predicate does not carry legacyEngineServes — a walk client would be listed pending and claimed`)
  const block = idx(src, "platform === 'google'")
  if (block === -1) { findings.push(`(a) ${file} has no google block`); continue }
  const iPred = idx(src, 'legacyEngineServes(', block), iHelper = idx(src, helper, block), iClaim = idx(src, claim, block)
  if (iPred === -1 || iHelper === -1 || iClaim === -1) findings.push(`(a) ${file} google block lacks one of: legacyEngineServes( (${iPred}), ${helper} (${iHelper}), ${claim} (${iClaim})`)
  else if (!(iHelper < iClaim)) findings.push(`(a) ${file}: ${helper} must precede ${claim} in the google block`)
  const loopFilter = /filter\(c => c\.platform === 'google' && legacyEngineServes\(c\)\)/.test(src)
  if (!loopFilter) findings.push(`(a) ${file}: the google loop's own connection filter does not carry legacyEngineServes(c)`)
}

// (b)
{
  const file = 'src/app/api/cron/drain/route.ts', src = strip(read(file))
  const sel = src.replace(/\/\/[^\n]*/g, '').match(/\.from\('platform_connections'\)\s*\.select\('([^']*)'\)\s*\.eq\('platform', platform\)/)
  if (!sel) findings.push(`(b) ${file}: the enumeration select could not be read`)
  else if (!sel[1].split(',').map((s) => s.trim()).includes('engine')) findings.push(`(b) ${file}: the enumeration select does not carry engine — a walk row would be served as legacy`)
  const iPred = idx(src, 'legacyEngineServes(r)'), iClaim = idx(src, "'claim_backfill_cursor'")
  if (iPred === -1) findings.push(`(b) ${file}: the pending filter does not test legacyEngineServes(r)`)
  else if (iClaim !== -1 && !(iPred < iClaim)) findings.push(`(b) ${file}: legacyEngineServes(r) must precede the first claim_backfill_cursor`)
  if (!/engineSkipped/.test(src)) findings.push(`(b) ${file}: the response does not carry engineSkipped — a walk-only scoped call would not say why it did nothing`)
}

// (c)
for (const [file, before] of [['src/lib/backfill/run-backfill.ts', 'let token'], ['src/lib/backfill/google-dimensional-backfill.ts', "from('google_tokens')"]]) {
  const src = strip(read(file))
  const iConn = idx(src, 'platform_connections'), iPred = idx(src, 'legacyEngineServes('), iTok = idx(src, before)
  if (iPred === -1) findings.push(`(c) ${file}: does not refuse a walk connection (no legacyEngineServes)`)
  else if (!(iConn !== -1 && iConn < iPred && iTok !== -1 && iPred < iTok)) findings.push(`(c) ${file}: legacyEngineServes must sit after the platform_connections read and before the token load (conn ${iConn}, pred ${iPred}, token ${iTok})`)
}

// (d)
{
  const src = strip(read('src/lib/backfill/kickoff.ts'))
  const iRet = idx(src, "platform === 'google' && engine === 'walk'"), iWait = idx(src, 'waitUntil(')
  if (iRet === -1) findings.push(`(d) kickoff.ts: kickoffBackfill has no google-walk early return`)
  else if (!(iWait !== -1 && iRet < iWait)) findings.push(`(d) kickoff.ts: the google-walk early return must precede waitUntil(`)
  if (!/kickoffBackfill\(origin: string, clientId: string, platform: string, engine\?: string \| null\)/.test(src)) findings.push(`(d) kickoff.ts: kickoffBackfill does not take the engine`)
}

// (e)
for (const [file, needle] of [
  ['src/app/api/clients/connections/route.ts', /kickoffBackfill\([\s\S]{0,240}?\)\?\.engine/],
  ['src/app/api/clients/backfill/route.ts', /select\('platform, engine'\)[\s\S]*kickoffBackfill\([^)]*engine/],
  ['src/app/api/clients/route.ts', /select\('platform, engine'\)[\s\S]*kickoffBackfill\([^)]*engineOf/],
]) { if (!needle.test(strip(read(file)))) findings.push(`(e) ${file} does not pass the connection's engine to kickoffBackfill`) }

// (f)
if (!/and p\.engine = 'legacy'\)\s+as "hasConn"/.test(read('scripts/check-frozen-cursors.mjs'))) findings.push(`(f) check-frozen-cursors.mjs: hasConn does not require engine = 'legacy' — a walk client's cursors would read frozen`)
if (!/\.eq\('engine', 'legacy'\)/.test(strip(read('src/lib/backfill/google-forward-reserve.ts')))) findings.push(`(f) google-forward-reserve.ts: googleForwardProgress counts walk connections as active`)

// (g)
{
  const m = read('migrations/102_engine_default_walk.sql')
  if (!m) findings.push('(g) migrations/102_engine_default_walk.sql does not exist')
  else if (!/alter column engine set default 'walk'/.test(m)) findings.push(`(g) migration 102 does not set the engine default to walk`)
}

// (h)
const roster = read('scripts/run-guards.mjs')
if (roster && !roster.includes('tests/guards/one-engine-writers.guard.mjs')) findings.push('(h) this guard is not registered in scripts/run-guards.mjs')

if (findings.length) { console.error('✗ one-engine-writers FAILED:'); for (const f of findings) console.error('  ' + f); process.exit(1) }
console.log('[one-engine-writers] PASS — sync, catchup, drain (scoped and unscoped), run-backfill and google-dimensional each ask legacyEngineServes before their first claim or write; the kick helpers take the engine off the row; the two cursor instruments count legacy only; migration 102 flips the default to walk (LORAMER_ONE_ENGINE_V1).')
