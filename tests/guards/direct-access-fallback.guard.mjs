#!/usr/bin/env node
// LORAMER_DIRECT_ACCESS_CUSTOMER_V1 — AN ACCOUNT THE CUSTOMER'S OWN LOGIN REACHES IS READABLE,
// AND NO EXISTING CONNECTION'S PATH MOVES BY ONE REQUEST.
//
// ⛔ THE MEASUREMENT THIS ENCODES, taken through google-ads-api 23.0.0 on 2026-09-16, and the two halves
// point in OPPOSITE directions — which is the entire reason the change is a FALLBACK and not a switch:
//     FIVE live accounts OUTSIDE the env manager, reached directly by the stored token
//        manager header → USER_PERMISSION_DENIED (5/5)   ·   header omitted → OK (5/5)
//     EXISTING CONNECTIONS (3 of 18 sampled)
//        manager header → OK (3/3)                       ·   header omitted → USER_PERMISSION_DENIED (3/3)
// ⇒ "ALWAYS OMIT" WOULD HAVE TAKEN THE LIVE FLEET DOWN. 6 of the 18 connections are reachable ONLY through
//   the manager. That is why the order below is a safety property and not an optimisation.
//
// LEGS
//  (a) the choke point still constructs with the manager id by default — every existing caller is untouched
//  (b) BEHAVIOURAL: manager-first. A customer that succeeds through the manager makes exactly ONE attempt,
//      never enters the fallback, and is never memoised. This is the existing fleet's whole guarantee.
//  (c) BEHAVIOURAL: a PERMISSION refusal falls back headerless and succeeds; any OTHER error does not,
//      because retrying a quota or network failure headerless doubles the spend and hides the cause
//  (d) BEHAVIOURAL: the stream twin falls back only BEFORE the first row, never after one has been yielded
//  (e) the memo is per-process and is written only after the headerless attempt SUCCEEDS
//  (f) both walk vendor entry points go through the wrappers, not through a bare construction
//  (g) the picker asks the vendor what the token reaches, and does not send login-customer-id when doing so
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

const CLIENT = 'src/lib/google-ads-client.ts'
const ADS = 'src/lib/google-ads.ts'
const VCLIENT = 'src/lib/backfill/universe-vendor-client.ts'
const VSTREAM = 'src/lib/backfill/universe-vendor-stream.ts'

const clientSrc = read(CLIENT)

// ── (a) THE DEFAULT CONSTRUCTION IS UNCHANGED ────────────────────────────────────────────────────────
if (!/export function googleAdsCustomerFor\([\s\S]{0,400}?GOOGLE_ADS_MANAGER_ACCOUNT_ID/.test(clientSrc)) {
  findings.push(`(a) ${CLIENT}: googleAdsCustomerFor no longer defaults to GOOGLE_ADS_MANAGER_ACCOUNT_ID. Every caller that has not opted in must keep the exact construction it has today — that is the only thing making this change safe for the live fleet.`)
}

// ── (b)(c)(d)(e) BEHAVIOURAL ─────────────────────────────────────────────────────────────────────────
const out = mkdtempSync(join(tmpdir(), 'loramer-direct-access-'))
const origResolve = Module._resolveFilename
try {
  const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
  const r = spawnSync(tsc, [resolve(ROOT, CLIENT), '--target', 'es2020', '--module', 'commonjs',
    '--moduleResolution', 'node', '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
  if (r.error) findings.push(`could not run tsc — ${r.error.message}`)

  // The vendor library is STUBBED: the guard proves OUR branching, and must never make a network call.
  const seen = []
  const stub = join(out, '__gads.js')
  writeFileSync(stub, `
    class GoogleAdsApi {
      constructor() {}
      Customer(opts) {
        const login = opts.login_customer_id
        return {
          query: async (q) => {
            globalThis.__seen.push({ customer: opts.customer_id, login: login ?? null, mode: 'query' })
            const verdict = globalThis.__verdict(opts.customer_id, login)
            if (verdict !== 'ok') { const e = new Error('x'); e.errors = [{ message: verdict, error_code: { authorization_error: 'USER_PERMISSION_DENIED' } }]; if (verdict === 'QUOTA') { e.errors = [{ message: 'quota', error_code: { quota_error: 'RESOURCE_EXHAUSTED' } }] } throw e }
            return [{ ok: true }]
          },
          queryStream: async function* (q) {
            globalThis.__seen.push({ customer: opts.customer_id, login: login ?? null, mode: 'stream' })
            const verdict = globalThis.__verdict(opts.customer_id, login)
            if (globalThis.__yieldBeforeThrow && verdict !== 'ok') { yield { row: 1 } }
            if (verdict !== 'ok') { const e = new Error('x'); e.errors = [{ message: verdict, error_code: { authorization_error: 'USER_PERMISSION_DENIED' } }]; throw e }
            yield { row: 1 }; yield { row: 2 }
          },
        }
      }
    }
    module.exports = { GoogleAdsApi }
  `)
  globalThis.__seen = seen
  Module._resolveFilename = function (request, ...rest) {
    if (request === 'google-ads-api') return stub
    if (request.startsWith('@/') || request.startsWith('./') || request.startsWith('../')) return stub
    return origResolve.call(this, request, ...rest)
  }
  process.env.GOOGLE_CLIENT_ID ||= 'x'; process.env.GOOGLE_CLIENT_SECRET ||= 'x'
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN ||= 'x'; process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID ||= 'MGR'
  const MGR = process.env.GOOGLE_ADS_MANAGER_ACCOUNT_ID
  const C = createRequire(import.meta.url)(join(out, 'src/lib/google-ads-client.js'))

  // INSIDE = an existing connection: works through the manager, refused without it (the measured shape).
  // OUTSIDE = a customer's own account: refused through the manager, works without it.
  globalThis.__verdict = (cust, login) => {
    if (cust === 'INSIDE') return login === MGR ? 'ok' : "User doesn't have permission to access customer"
    if (cust === 'OUTSIDE') return login === MGR ? "User doesn't have permission to access customer" : 'ok'
    if (cust === 'QUOTAFAIL') return 'QUOTA'
    return 'ok'
  }
  globalThis.__yieldBeforeThrow = false
  const k = (customerId) => ({ refreshToken: 'rt', customerId })

  // (b) an existing connection makes exactly ONE attempt and is never memoised
  seen.length = 0
  C.__resetDirectAccessMemo()
  let insideRes = null, insideErr = null
  try { insideRes = await C.withGoogleAdsCustomer(k('INSIDE'), (c) => c.query('q')) } catch (e) { insideErr = e }
  if (insideErr) {
    findings.push(`(b) ⛔ AN EXISTING CONNECTION'S READ NOW FAILS: "${insideErr?.errors?.[0]?.message ?? insideErr?.message}". Measured on the live fleet, an existing connection succeeds ONLY with the manager header (3/3) and is refused without it (3/3), and 6 of 18 connections are reachable through the manager alone. Whatever reaches a customer's own account must not move this path.`)
  } else if (!insideRes || !insideRes[0]?.ok) {
    findings.push(`(b) an existing-connection read did not succeed through the manager.`)
  }
  if (seen.length !== 1) {
    findings.push(`(b) AN EXISTING CONNECTION MADE ${seen.length} VENDOR ATTEMPT(S), NOT 1 (${JSON.stringify(seen)}). Every current caller must spend exactly what it spends today; an extra attempt is real quota and a real behaviour change for the live fleet.`)
  }
  if (seen[0] && seen[0].login !== MGR) findings.push(`(b) the first attempt did not carry the manager id (${JSON.stringify(seen[0])}). Manager-first is what keeps the existing fleet on its current path.`)
  if (C.isKnownDirectAccess('INSIDE')) findings.push(`(b) an account that succeeded through the manager was memoised as direct-access. The memo must only ever record a proven headerless success.`)

  // (c) a permission refusal falls back; a quota error does NOT
  seen.length = 0
  const outsideRes = await C.withGoogleAdsCustomer(k('OUTSIDE'), (c) => c.query('q'))
  if (!outsideRes || !outsideRes[0]?.ok) findings.push(`(c) a directly-reached account was NOT readable after the fallback — the whole point of this change.`)
  if (seen.length !== 2 || seen[0].login !== MGR || seen[1].login !== null) {
    findings.push(`(c) the fallback did not go manager-then-headerless: ${JSON.stringify(seen)}.`)
  }
  if (!C.isKnownDirectAccess('OUTSIDE')) findings.push(`(e) a proven direct-access account was not memoised, so every later call pays the refusal again.`)
  seen.length = 0
  await C.withGoogleAdsCustomer(k('OUTSIDE'), (c) => c.query('q'))
  if (seen.length !== 1 || seen[0].login !== null) findings.push(`(e) the memo did not short-circuit a known direct-access account: ${JSON.stringify(seen)}.`)

  seen.length = 0
  let quotaThrew = false
  try { await C.withGoogleAdsCustomer(k('QUOTAFAIL'), (c) => c.query('q')) } catch { quotaThrew = true }
  if (!quotaThrew) findings.push(`(c) a QUOTA error did not propagate — it was swallowed by the permission fallback.`)
  if (seen.length !== 1) {
    findings.push(`(c) A QUOTA ERROR WAS RETRIED HEADERLESS (${seen.length} attempts). Only a PERMISSION refusal may fall back; retrying a quota refusal doubles the spend against a limit we are already at and hides the cause.`)
  }

  // (d) the stream twin: falls back before the first row, NEVER after one has been yielded
  C.__resetDirectAccessMemo(); seen.length = 0
  const rows = []
  for await (const row of C.withGoogleAdsStream(k('OUTSIDE'), (c) => c.queryStream('q'))) rows.push(row)
  if (rows.length !== 2) findings.push(`(d) the stream fallback did not deliver the rows (got ${rows.length}).`)
  if (seen.length !== 2 || seen[0].login !== MGR || seen[1].login !== null) findings.push(`(d) the stream did not go manager-then-headerless: ${JSON.stringify(seen)}.`)

  C.__resetDirectAccessMemo(); seen.length = 0
  globalThis.__yieldBeforeThrow = true
  let midStreamThrew = false
  const partial = []
  try { for await (const row of C.withGoogleAdsStream(k('OUTSIDE'), (c) => c.queryStream('q'))) partial.push(row) }
  catch { midStreamThrew = true }
  if (!midStreamThrew) {
    findings.push(`(d) A STREAM THAT HAD ALREADY YIELDED A ROW WAS RE-OPENED ON THE FALLBACK. The walk writes as it reads, so replaying a stream replays rows the caller has already committed — the fallback is only ever legal before the first row.`)
  }
  globalThis.__yieldBeforeThrow = false

  C.__resetDirectAccessMemo(); seen.length = 0
  const insideRows = []
  for await (const row of C.withGoogleAdsStream(k('INSIDE'), (c) => c.queryStream('q'))) insideRows.push(row)
  if (seen.length !== 1) findings.push(`(b) AN EXISTING CONNECTION'S STREAM MADE ${seen.length} ATTEMPT(S), NOT 1 (${JSON.stringify(seen)}).`)
  if (insideRows.length !== 2) findings.push(`(b) an existing connection's stream did not deliver its rows unchanged.`)

  // ── THE COUNTERFACTUAL, and it is what makes every PASS above mean something ──────────────────────
  // ⛔ THE LOSING POSITION, ENCODED SO IT CAN NEVER BE RE-ARGUED FROM MEMORY: "omit the header for
  // everyone, since Round 5's REST probe returned 200 inside the hierarchy too." Measured through the
  // real library, that breaks the live fleet — 3 of 3 sampled existing connections were refused without
  // the header. This leg reconstructs that implementation against the SAME stubbed vendor and asserts it
  // IS caught failing. If it ever stops being caught, the fixture no longer models the fleet and every
  // green above is decoration.
  {
    const alwaysOmit = async (key, use) => use({
      query: async (q) => {
        const v = globalThis.__verdict(key.customerId, null)
        if (v !== 'ok') { const e = new Error('x'); e.errors = [{ message: v }]; throw e }
        return [{ ok: true }]
      },
    })
    let brokeExisting = false
    try { await alwaysOmit(k('INSIDE'), (c) => c.query('q')) } catch { brokeExisting = true }
    if (!brokeExisting) {
      findings.push(`THE COUNTERFACTUAL WENT UNDETECTED. An "always omit the header" implementation was NOT caught failing on an existing connection, so this guard's fixture no longer reflects the measured fleet (manager header → OK 3/3, omitted → USER_PERMISSION_DENIED 3/3) and its PASS proves nothing about the live path.`)
    }
    // and the same implementation DOES serve the outside account — which is exactly why it was tempting
    let servedOutside = false
    try { await alwaysOmit(k('OUTSIDE'), (c) => c.query('q')); servedOutside = true } catch { /* no */ }
    if (!servedOutside) {
      findings.push(`THE COUNTERFACTUAL IS MIS-BUILT: "always omit" failed the OUTSIDE account too, so the fixture is not modelling the real asymmetry and the comparison above is meaningless.`)
    }
  }
} catch (e) {
  findings.push(`(b)(c)(d)(e) the behavioural legs could not run — ${e.message}. A guard that cannot execute its subject FAILS; it does not pass quietly.`)
} finally {
  Module._resolveFilename = origResolve
  rmSync(out, { recursive: true, force: true })
  delete globalThis.__seen; delete globalThis.__verdict; delete globalThis.__yieldBeforeThrow
}

// ── (f) THE WALK'S TWO VENDOR ENTRY POINTS GO THROUGH THE WRAPPERS ───────────────────────────────────
const vc = read(VCLIENT), vs = read(VSTREAM)
if (!/withGoogleAdsCustomer\(/.test(vc)) findings.push(`(f) ${VCLIENT} does not call withGoogleAdsCustomer. A bare construction there cannot reach a customer's own account.`)
if (!/withGoogleAdsStream\(/.test(vs)) findings.push(`(f) ${VSTREAM} does not call withGoogleAdsStream. The walk reads through the STREAM, so this is the path that decides whether a new customer's data lands at all.`)
if (/armingStream/.test(vs) === false) findings.push(`(f) ${VSTREAM} no longer arms the quota sentinel — boundary 5 of 5 was lost while wiring the fallback.`)

// ── (g) THE PICKER ASKS THE VENDOR WHAT THE TOKEN REACHES ────────────────────────────────────────────
const ads = read(ADS)
if (!/listAccessibleCustomers\(/.test(ads)) {
  findings.push(`(g) ${ADS} never calls listAccessibleCustomers. Listing only our manager's children asks a stranger's token for the contents of OUR account, so their own accounts can never appear.`)
}
{
  const m = /export async function listReachableCustomerIds[\s\S]*?\n}/.exec(ads)
  if (m && /login_customer_id/.test(m[0])) {
    findings.push(`(g) listReachableCustomerIds sends login_customer_id. Google documents that the header "is not required for this request type, and has no effect on the list of customers returned" — sending it adds a hierarchy assumption to the one call that must not carry one.`)
  }
}

if (findings.length) {
  console.error(`[direct-access-fallback] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[direct-access-fallback] PASS — the choke point still defaults to the manager id · an existing connection makes exactly ONE attempt and is never memoised, on both the query and the stream path · a PERMISSION refusal falls back headerless and succeeds, a QUOTA error does not · the stream fallback is refused once a row has been yielded · the memo records only a proven success · both walk vendor entry points go through the wrappers · the picker asks the vendor what the token reaches, without a hierarchy header.`)
