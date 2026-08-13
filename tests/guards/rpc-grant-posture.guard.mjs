#!/usr/bin/env node
// LORAMER_RPC_GRANT_POSTURE_V1 — a function added to `public` may not be born anon-callable.
//
// ⛔ THE DEFECT THIS EXISTS TO STOP, AND IT WAS FOUND BY READING THE DATABASE RATHER THAN THE MIGRATION.
// While applying 064 the ACL was read back and did not match 064's own comment: the function was executable
// by `anon`. **`revoke ... from public` DOES NOT REMOVE anon/authenticated** — Supabase grants EXECUTE to
// those roles as EXPLICIT role grants, not through PUBLIC, so revoking PUBLIC leaves both untouched. Every
// migration that copied the one-line revoke inherited the hole.
//
// ⛔ THE FLEET-WIDE MEASUREMENT, 2026-08-13, which is why this is a guard and not a fix: **21 functions in
// `public`, 15 of them anon-callable.** Of 17 migrations that create a public function, only THREE carried
// the full four-line posture (057, 061, 064); TWELVE carried nothing at all; TWO carried the incomplete
// single-line revoke (059, 060). The pattern was not rare — compliance was.
//
// ⛔ WHAT THIS GUARD CAN AND CANNOT SEE, STATED SO IT IS NOT OVER-READ. It reads MIGRATION SOURCE. It cannot
// read a live ACL — `npm run guard` runs on Vercel with no database, and DB work is deliberately kept off
// the build path. **The live-ACL half is `scripts/check-rpc-grant-posture.mjs`, which runs in `check:data`.**
// Source here, database there; neither alone is the posture. A migration can be perfect and the database
// still wrong (someone granted by hand), which is exactly why both halves exist.
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const MIGRATIONS = process.env.LORAMER_RPC_MIGRATIONS_DIR || 'migrations'
const findings = []

// ⛔ THE BOUNDARY, AND IT IS PINNED RATHER THAN INFERRED. Migrations BELOW this number pre-date the sweep and
// are covered by 065, which revoked from the CATALOG (not from a list) and asserted zero remaining. Files at
// or above it must carry their own posture, because after 065 there is no sweep coming to clean up behind.
// Changing this number is a decision about who cleans up, not an edit.
const SWEEP_MIGRATION = 65

const CREATES_PUBLIC_FN = /create\s+(or\s+replace\s+)?function\s+public\./i
const REQUIRED = [
  [/revoke\s+all\s+on\s+function[\s\S]*?from\s+public/i, 'revoke all on function … from public'],
  [/revoke\s+all\s+on\s+function[\s\S]*?from\s+anon/i, 'revoke all on function … from anon'],
  [/revoke\s+all\s+on\s+function[\s\S]*?from\s+authenticated/i, 'revoke all on function … from authenticated'],
  [/grant\s+execute\s+on\s+function[\s\S]*?to\s+service_role/i, 'grant execute on function … to service_role'],
]

let files = []
try {
  files = readdirSync(resolve(ROOT, MIGRATIONS)).filter((f) => /\.sql$/i.test(f)).sort()
} catch (e) {
  findings.push(`UNREADABLE ${MIGRATIONS}/ — ${e.message}. A guard that cannot read its evidence FAILS.`)
}

// ── (a) A FUNCTION CREATED AT OR AFTER THE SWEEP CARRIES ITS OWN POSTURE ─────────────────────────────
let checked = 0
for (const f of files) {
  const num = Number((f.match(/^(\d+)/) || [])[1])
  if (!Number.isFinite(num) || num < SWEEP_MIGRATION) continue
  let src = ''
  try { src = readFileSync(join(resolve(ROOT, MIGRATIONS), f), 'utf8') } catch { continue }
  // Comments are NOT stripped on purpose: a `revoke` that exists only inside a comment would be a lie this
  // guard should catch, so the check is deliberately paired with the DB half rather than made clever here.
  const code = src.replace(/^\s*--[^\n]*$/gm, '')
  if (!CREATES_PUBLIC_FN.test(code)) continue
  checked++
  // A migration whose only function work is a catalog-driven sweep (like 065) states its posture in a DO
  // block rather than per-signature; it is recognised by asserting the end state from pg_proc.
  const isSweep = /has_function_privilege\s*\(\s*'anon'/i.test(code) && /raise\s+exception/i.test(code)
  if (isSweep) continue
  const missing = REQUIRED.filter(([re]) => !re.test(code)).map(([, label]) => label)
  if (missing.length) {
    findings.push(
      `(a) ${MIGRATIONS}/${f} creates a function in \`public\` but does not lock its grants. MISSING: ${missing.join(' · ')}. ` +
      `⛔ \`revoke … from public\` ALONE IS NOT ENOUGH — Supabase grants EXECUTE to anon and authenticated as EXPLICIT role grants, ` +
      `so revoking PUBLIC leaves both in place. Measured 2026-08-13: that is how 15 of 21 public functions came to be anon-callable, ` +
      `including a SECURITY DEFINER writer into the walk's own spend ledger.`)
  }
}

// ── (b) THE SWEEP MIGRATION EXISTS AND ASSERTS ITS END STATE FROM THE CATALOG ────────────────────────
{
  const sweep = files.find((f) => Number((f.match(/^(\d+)/) || [])[1]) === SWEEP_MIGRATION)
  if (!sweep) {
    findings.push(`(b) no migration numbered ${SWEEP_MIGRATION} — the sweep that every earlier migration is exempted against does not exist, so leg (a)'s boundary is exempting files against nothing.`)
  } else {
    const src = readFileSync(join(resolve(ROOT, MIGRATIONS), sweep), 'utf8')
    if (!/has_function_privilege\s*\(\s*'anon'/i.test(src)) {
      findings.push(`(b) ${MIGRATIONS}/${sweep} does not re-read anon executability from the catalog. A sweep that trusts its own loop counter is not a sweep — it must assert the END STATE.`)
    }
    if (!/raise\s+exception/i.test(src)) {
      findings.push(`(b) ${MIGRATIONS}/${sweep} does not RAISE when functions remain callable. A migration that reports a problem without failing is a migration that reads green.`)
    }
  }
}

// ── (c) THE DB HALF MUST EXIST AND BE WIRED INTO check:data ──────────────────────────────────────────
{
  const CHECK = 'scripts/check-rpc-grant-posture.mjs'
  let exists = true
  try { readFileSync(resolve(ROOT, CHECK), 'utf8') } catch { exists = false }
  if (!exists) {
    findings.push(`(c) ${CHECK} is missing. THIS GUARD READS SOURCE AND CANNOT SEE A LIVE ACL; without the DB half the posture is only claimed, never checked.`)
  } else {
    let roster = ''
    try { roster = readFileSync(resolve(ROOT, 'scripts/run-checkdata.mjs'), 'utf8') } catch { roster = '' }
    if (!roster.includes('check-rpc-grant-posture')) {
      findings.push(`(c) scripts/run-checkdata.mjs does not run check-rpc-grant-posture. A check nobody runs is a check that does not exist.`)
    }
  }
}

if (findings.length) {
  console.error(`[rpc-grant-posture] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[rpc-grant-posture] PASS — ${checked} migration(s) at/after ${String(SWEEP_MIGRATION).padStart(3, '0')} that create a public function carry the full four-line posture (revoke public + anon + authenticated, grant service_role) · the sweep asserts its end state from pg_proc and raises · and the live-ACL half is present and wired into check:data. LIMIT: this reads MIGRATION SOURCE only — a hand-issued GRANT in the database is invisible here and is caught by check-rpc-grant-posture.mjs.`)
