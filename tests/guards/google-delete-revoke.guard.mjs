#!/usr/bin/env node
// LORAMER_GOOGLE_DELETE_MY_DATA_V1 — THE REVOKE BRANCH, PROVEN WITH A STUB, NEVER AGAINST GOOGLE.
//
// The refresh token in google_tokens is user-scoped and shared by every google client the user owns, so revoking it
// is right ONLY when this deletion removed the user's LAST google client. Tri-Copy cannot exercise the branch (Russ
// has other google clients), so it is proven here: src/lib/google-delete/revoke.ts is compiled standalone (tsc,
// --noResolve — it has no imports by design) and driven with an INJECTED fetch:
//   (a) decideRevoke: 0 other connections → revoke; 1 or more → never;
//   (b) revokeGoogleRefreshToken posts to https://oauth2.googleapis.com/revoke, form-encoded, token=<the token>, and
//       reports the vendor's status — the stub returns 200 and a 400, nothing leaves the machine.
// STUBBED, named: the fetch. Not stubbed: the decision, the endpoint, the body encoding, the status mapping.
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const SRC = 'src/lib/google-delete/revoke.ts'
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
let src = ''
try { src = readFileSync(resolve(ROOT, SRC), 'utf8') } catch { findings.push(`UNREADABLE ${SRC}`) }
if (src) {
  check(!/^\s*import\s/m.test(src), `${SRC} must have no imports (compiled standalone here)`)
  const out = mkdtempSync(join(tmpdir(), 'loramer-google-revoke-'))
  try {
    const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [resolve(ROOT, SRC), '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node', '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
    if (r.error) throw new Error(`tsc did not run: ${r.error.message}`)
    const M = createRequire(import.meta.url)(join(out, 'src/lib/google-delete/revoke.js'))
    check(M.decideRevoke({ otherGoogleConnections: 0 }) === true, '(a) with no other google connection the branch must revoke')
    check(M.decideRevoke({ otherGoogleConnections: 1 }) === false, '(a) with one other google connection the branch must NOT revoke (the token is shared)')
    check(M.decideRevoke({ otherGoogleConnections: 7 }) === false, '(a) with seven other google connections the branch must NOT revoke')
    const calls = []
    const stub = async (url, init) => { calls.push({ url, init }); return { ok: calls.length === 1, status: calls.length === 1 ? 200 : 400 } }
    const r1 = await M.revokeGoogleRefreshToken('refresh-token-fixture', stub)
    const r2 = await M.revokeGoogleRefreshToken('refresh-token-fixture', stub)
    check(calls.length === 2, `(b) the stub fetch must be called once per revoke (called ${calls.length})`)
    check(calls[0]?.url === 'https://oauth2.googleapis.com/revoke', `(b) revoke must POST to https://oauth2.googleapis.com/revoke (got ${calls[0]?.url})`)
    check(calls[0]?.init?.method === 'POST', '(b) revoke must be a POST')
    check(calls[0]?.init?.headers?.['Content-Type'] === 'application/x-www-form-urlencoded', '(b) revoke must be form-encoded')
    check(calls[0]?.init?.body === 'token=refresh-token-fixture', `(b) the body must be token=<token> (got ${calls[0]?.init?.body})`)
    check(r1.ok === true && r1.status === 200, '(b) a 200 from the vendor must read ok')
    check(r2.ok === false && r2.status === 400, '(b) a 400 from the vendor must read not-ok with the status kept')
  } catch (e) { findings.push(`compile/drive failed: ${e.message}`) } finally { rmSync(out, { recursive: true, force: true }) }
}
if (findings.length) { console.error(`\n❌ LORAMER_GOOGLE_DELETE_REVOKE_V1 FAILED — ${findings.length} finding(s)\n`); findings.forEach((f) => console.error('  • ' + f)); process.exit(1) }
console.log('google-delete-revoke.guard: PASS — decideRevoke revokes only on the last google client; revokeGoogleRefreshToken posts token=<token> form-encoded to oauth2.googleapis.com/revoke and keeps the vendor status (fetch STUBBED; nothing left the machine).')
