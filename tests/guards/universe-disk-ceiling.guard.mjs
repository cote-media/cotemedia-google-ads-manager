#!/usr/bin/env node
// LORAMER_UNIVERSE_DISK_CEILING_V1 — the walk's disk governor must exist IN THE REPO, must carry an
// ABSOLUTE ceiling, and must not be able to answer permissively at or above it.
//
// ═══ WHY THIS GUARD EXISTS ══════════════════════════════════════════════════════════════════════════════
// `universe_disk_headroom()` is the only thing between an unattended multi-day walk and a full disk, and
// until 2026-08-07 its body lived ONLY in the live database — created out-of-band, overwritten by a halt,
// and asserted (falsely) to have been captured verbatim. A safety function that exists in exactly one place
// and that place is not version control is one `create or replace` away from being gone with no diff.
// ★UNIVERSE-HEADROOM-BODY-NEVER-COMMITTED is what leg (a) prevents from recurring.
//
// ⛔ AND THE SECOND FAILURE THIS PINS IS THE ONE THAT ALREADY HAPPENED ONCE: a limit that CANNOT TRIP reads
// green forever. On 2026-08-05 a page-capped spend read authorised ~10,800 consecutive publishes while
// presenting itself as a governor. A ceiling expressed as a PERCENTAGE would be the same defect in a new
// place — provisioned disk is NOT readable from Postgres, so a percentage here is computed against a number
// the function cannot see. Absolute bytes, or it is not a ceiling.
//
// ═══ THE FOUR LEGS ══════════════════════════════════════════════════════════════════════════════════════
//   (a) the function body is PRESENT in migrations/ — not only in the database
//   (b) the absolute ceiling literal 536870912000 (500 GiB) is present
//   (c) the ceiling is NOT expressed as a percentage of anything
//   (d) the returned free_bytes is bounded BY the ceiling — a `least(...)` carrying both the provisioned
//       term and the ceiling term, so the function cannot answer permissively at or above 500 GiB
//
// ⚠ THE HONEST LIMIT, STATED RATHER THAN IMPLIED: (d) IS A SOURCE ASSERTION, NOT AN EXECUTION PROOF. A
// guard runs in `npm run guard`, which runs on Vercel with no database (settled split: DB work lives in
// `npm run check:data`, DECISIONS LORAMER_ACCOUNT_ROW_INVARIANT_V1). Proving the function's ARITHMETIC
// requires calling it, so that proof was executed by hand against the live database at ship time with
// synthetic provisioned_bytes values and recorded in the ship report. This guard pins the SHAPE that makes
// the arithmetic correct; it cannot pin the arithmetic itself, and it says so rather than implying it did.
//
// ⛔ LORAMER_GUARD_ROOT — HANDLED, AND HANDLED THE SAFE WAY, because ★GUARD-IGNORES-LORAMER-GUARD-ROOT is
// OPEN. That defect is a guard whose paths resolve to the REAL tree under a throwaway proof, so it reports
// a FALSE PASS about a tree it never read. This guard: (1) HONOURS LORAMER_GUARD_ROOT when set, so a
// scratch-worktree proof reads the SCRATCH tree; (2) falls back to a MODULE-RELATIVE root, never
// `process.cwd()`, so it cannot silently follow whatever directory it was invoked from; (3) FAILS CLOSED —
// if migrations/ is unreadable or holds no matching file, that is a FAILURE, never a pass.
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const CEILING_BYTES = '536870912000' // 500 * 1024**3 — absolute, never a percentage
const findings = []

// ── (a) THE BODY IS IN THE REPO ─────────────────────────────────────────────────────────────────────────
let sql = null
let sqlFile = null
try {
  const dir = join(ROOT, 'migrations')
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith('.sql')) continue
    const text = readFileSync(join(dir, f), 'utf8')
    // The DEFINITION, not a mention: `create ... function ... universe_disk_headroom`.
    if (/create\s+(or\s+replace\s+)?function\s+public\.universe_disk_headroom/i.test(text)) {
      sql = text
      sqlFile = `migrations/${f}`
    }
  }
} catch (e) {
  findings.push(`(a) migrations/ UNREADABLE under ROOT ${ROOT} — ${e.message}. A guard that cannot read its evidence FAILS; it does not pass.`)
}
if (!findings.length && !sql) {
  findings.push(
    '(a) NO migration defines public.universe_disk_headroom(). The walk\'s disk governor would exist only in ' +
    'the live database again — one `create or replace` from vanishing with no diff (★UNIVERSE-HEADROOM-BODY-NEVER-COMMITTED).'
  )
}

if (sql) {
  // Comments quote the defective forms to TEACH them; stripping them first is required or the guard fails
  // on its own documentation. "QUOTATION IS NOT ASSERTION" — banked twice on 2026-07-29 for exactly this.
  const code = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n')

  // ── (b) THE ABSOLUTE CEILING IS PRESENT ───────────────────────────────────────────────────────────────
  if (!code.includes(CEILING_BYTES)) {
    findings.push(`(b) ${sqlFile} does not contain the absolute ceiling literal ${CEILING_BYTES} (500 GiB). A ceiling that is not written down is not a ceiling.`)
  }

  // ── (c) IT IS NOT A PERCENTAGE ────────────────────────────────────────────────────────────────────────
  // Provisioned disk is not readable from Postgres, so a percentage is computed against an invisible
  // number. Reject the shapes: `* 0.xx`, `/ 100`, `percent`, or a `%` operator in the returned expression.
  const pctShapes = [/\*\s*0\.\d+/, /\/\s*100\b/, /\bpercent\b/i, /\bpct\b/i]
  for (const re of pctShapes) {
    if (re.test(code)) {
      findings.push(`(c) ${sqlFile} expresses a limit as a PERCENTAGE (${re}). Provisioned disk is not readable from Postgres — a percentage here is computed against a number this function cannot see. Absolute bytes only.`)
      break
    }
  }

  // ── (d) THE CEILING CAN ACTUALLY BIND ─────────────────────────────────────────────────────────────────
  // free_bytes must be the SMALLER of (provisioned − used) and (ceiling − used). Without the least(), the
  // ceiling is decoration and the function answers permissively above 500 GiB.
  const leastCall = code.match(/least\s*\([^;]*?\)/is)
  if (!leastCall) {
    findings.push(`(d) ${sqlFile} has no least(...) bounding free_bytes. Without it the ${CEILING_BYTES} constant is decoration and the function can return PERMISSIVE at or above 500 GiB.`)
  } else {
    const inner = leastCall[0]
    if (!inner.includes('provisioned_bytes')) {
      findings.push(`(d) the least(...) does not carry the provisioned term — the caller's own floor would stop binding. Found: ${inner.replace(/\s+/g, ' ').slice(0, 160)}`)
    }
    // The ceiling term may be the literal or a constant declared from it; require the declaration to exist.
    const viaConst = /constant\s+bigint\s*:=\s*536870912000/i.test(code) && /v_ceiling_bytes/.test(inner)
    if (!inner.includes(CEILING_BYTES) && !viaConst) {
      findings.push(`(d) the least(...) does not carry the ${CEILING_BYTES} ceiling term. Found: ${inner.replace(/\s+/g, ' ').slice(0, 160)}`)
    }
  }

  // ── SIGNATURE — the caller's contract is not negotiable ───────────────────────────────────────────────
  if (!/returns\s+table\s*\(\s*used_bytes\s+bigint\s*,\s*free_bytes\s+bigint\s*\)/i.test(code)) {
    findings.push(`(e) ${sqlFile} does not return TABLE(used_bytes bigint, free_bytes bigint) — readHeadroom() reads those exact column names and throws REFUSING TO WALK BLIND on anything else.`)
  }
  // ⛔ A RAISE WOULD ROLL BACK ITS OWN ANNOUNCEMENT. The stop must come from the returned value.
  if (/raise\s+exception/i.test(code)) {
    findings.push(`(f) ${sqlFile} contains a RAISE EXCEPTION. A raise aborts the transaction, so any row written to announce the halt is rolled back by the raise that announced it — the stop must be a RETURNED VALUE below the caller's floor, which makes checkDiskFloor() write a durable floor_stop row.`)
  }
}

if (findings.length) {
  console.error(`[universe-disk-ceiling] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[universe-disk-ceiling] PASS — ${sqlFile} defines universe_disk_headroom with an ABSOLUTE ${CEILING_BYTES}-byte (500 GiB) ceiling inside a least(), the caller's signature intact, and no raise. (Source assertion; the arithmetic proof needs a DB and is not run here.)`)
