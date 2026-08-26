#!/usr/bin/env node
// LORAMER_GOOGLE_CAMPAIGN_ANCHOR_MISSING_V1 — AN ABSENT ACCOUNT ANCHOR MUST NOT REPORT WITHIN.
//
// ⛔ THE SEAM THIS PINS, measured live 2026-08-26: google-campaign-backfill's per-day reconcile — the ONLY
// posture:'block' in the fleet — read its account anchor as `fin(acctRow?.spend)`, which maps BOTH "no row"
// and "$0.00" to 0. So on exactly the days the anchor was missing (9 of 18 connections on 2026-08-25), the
// block gate compared 0-vs-0, reported within, and wrote campaign rows against an anchor that did not exist.
// The gate could never fire on the days it could not see. Meanwhile every campaign-anchored Google caller
// (adgroup-ad :187, device :95, demographic :121, hour :95) carries `within = anchorMissing === 0 &&
// tolWithin` — the account-anchored caller was the one WITHOUT the rule, and the one whose posture refuses.
//
// THE RULE APPLIED IS THE GUARDED-FOUR'S OWN, not an invention: count absent anchor units, AND the count
// into within. For a single account row the count is 0 or 1: `anchorMissing = anchorRow == null ? 1 : 0`.
// It lives as ONE exported primitive (reconcileDayAgainstAnchorRow, reconcile-day.ts) per FIX-WITH-GUARD's
// collapse-to-one-source clause — we fix files, we do not enforce conventions.
//
// TWO LEGS:
//  (A) BEHAVIOUR — compile reconcile-day.ts in isolation (it imports nothing) and drive the export with the
//      EXACT row shapes the caller's maybeSingle() read produces (proven live this session: a missing day
//      returns null; a dormant day returns {spend:0,...}). Absent → not within, action 'skip' under block.
//      Present-zero vs zero → within (a dormant day with its zero anchor WRITES — that is ff2140a's point).
//      Tolerance and posture are reconcileDay's own, untouched — a drive proves they still bite.
//  (B) WIRED — the caller actually uses the primitive: google-campaign-backfill.ts calls
//      reconcileDayAgainstAnchorRow with posture 'block', and the bare `reconcileDay(bucket.spend,
//      acctSpend` form (the absent-collapses-to-zero shape) is GONE. Comments stripped before matching —
//      a guard that reads comments is not reading the code.
import { mkdtempSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const out = mkdtempSync(join(tmpdir(), 'loramer-anchor-missing-'))

// ── (A) THE BEHAVIOUR DRIVE ───────────────────────────────────────────────────────────────────────────────
try {
  const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'tsc'), [
    resolve(ROOT, 'src/lib/backfill/reconcile-day.ts'),
    '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out,
  ], { encoding: 'utf8' })
  if (r.error) throw new Error(`tsc did not run: ${r.error.message}`)
  const R = createRequire(import.meta.url)(join(out, 'src/lib/backfill/reconcile-day.js'))
  if (typeof R.reconcileDayAgainstAnchorRow !== 'function') {
    throw new Error('reconcileDayAgainstAnchorRow is not exported from reconcile-day.ts — the account-anchored rule does not exist as code.')
  }
  const drive = R.reconcileDayAgainstAnchorRow

  // Absent anchor (the caller's maybeSingle() → null on a missing day) — the defect case, both directions.
  const absZero = drive(0, null, { posture: 'block' })
  if (absZero.within || absZero.action !== 'skip' || absZero.anchorMissing !== 1) {
    findings.push(`(A) absent anchor + grain 0 reported within=${absZero.within} action=${absZero.action} anchorMissing=${absZero.anchorMissing} — 0-vs-0 against a MISSING row must refuse, or the block gate stays disarmed on exactly the days it cannot see.`)
  }
  const absSpend = drive(123.45, null, { posture: 'block' })
  if (absSpend.within || absSpend.action !== 'skip') {
    findings.push(`(A) absent anchor + grain 123.45 reported within=${absSpend.within} action=${absSpend.action} — real spend against no anchor must refuse.`)
  }
  // Present ZERO row (a dormant day with its zero-filled anchor) — MUST write. Absent ≠ $0.00 is the point.
  const zeroRow = drive(0, { spend: 0 }, { posture: 'block' })
  if (!zeroRow.within || zeroRow.action !== 'write' || zeroRow.anchorMissing !== 0) {
    findings.push(`(A) present zero anchor + grain 0 reported within=${zeroRow.within} action=${zeroRow.action} — a dormant day with its real zero anchor must WRITE; refusing it would re-hole what ff2140a filled.`)
  }
  // The tolerance still bites exactly as before (byte-identical defaults: $0.01 abs OR 0.1% rel).
  const match = drive(100.0, { spend: 100.0 }, { posture: 'block' })
  if (!match.within || match.action !== 'write') findings.push(`(A) matching spend reported within=${match.within} — the tolerance path regressed.`)
  const diverge = drive(150.0, { spend: 100.0 }, { posture: 'block' })
  if (diverge.within || diverge.action !== 'skip') findings.push(`(A) $50 divergence on a $100 anchor reported within=${diverge.within} action=${diverge.action} — the block tolerance no longer bites.`)
  // Numeric-string spend (PostgREST serves numerics as strings) must coerce, not read as missing or NaN.
  const strRow = drive(100.0, { spend: '100.00' }, { posture: 'block' })
  if (!strRow.within || strRow.anchorMissing !== 0) findings.push(`(A) a string-numeric anchor spend ("100.00") reported within=${strRow.within} anchorMissing=${strRow.anchorMissing} — PostgREST serves numerics as strings and the caller's real rows carry them.`)
} catch (e) {
  findings.push(`(A) behaviour drive failed: ${e.message}`)
}

// ── (B) THE CALLER IS WIRED ───────────────────────────────────────────────────────────────────────────────
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
try {
  const src = stripComments(readFileSync(resolve(ROOT, 'src/lib/backfill/google-campaign-backfill.ts'), 'utf8'))
  if (!/reconcileDayAgainstAnchorRow\s*\(/.test(src)) {
    findings.push(`(B) google-campaign-backfill.ts never calls reconcileDayAgainstAnchorRow — the account-anchored caller is not wired to the rule.`)
  }
  if (!/reconcileDayAgainstAnchorRow\s*\([^)]*posture:\s*'block'/.test(src)) {
    findings.push(`(B) the reconcileDayAgainstAnchorRow call does not carry posture:'block' — the posture may not change.`)
  }
  if (/reconcileDay\s*\(\s*bucket\.spend\s*,\s*acctSpend/.test(src)) {
    findings.push(`(B) the bare reconcileDay(bucket.spend, acctSpend, …) form is still present — that is the absent-collapses-to-$0.00 shape this guard exists to ban.`)
  }
} catch (e) {
  findings.push(`(B) source read failed: ${e.message}`)
}

if (findings.length) {
  console.error(`✗ GOOGLE-CAMPAIGN-ANCHOR-MISSING FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('[google-campaign-anchor-missing] PASS — absent anchor refuses (skip, anchorMissing=1), a present zero anchor writes, the block tolerance still bites, string numerics coerce, and the caller is wired to the one primitive with posture unchanged. LIMIT: the DB half (maybeSingle → null on a missing day) is a measured fact, not driven here — the leg drives the decision with that measured row shape.')
