#!/usr/bin/env node
// LORAMER_WRAP_STAMP_ROLLBACK_V1 — A WRAP THAT FAILED MUST NOT LEAVE ITS STAMP BEHIND.
//
// ⛔ THE DEFECT, DEMONSTRATED BEFORE IT WAS FIXED (2026-08-17). `wrap-docs.mjs` re-stamps the manifest —
// content_hash, line_count, last_reconciled_date and last_reconciled_head — and WRITES IT TO DISK at the end
// of STEP 1, before steps 2/3/4 have established a single thing the stamp claims. Force a step-2 refusal and
// the stamp advances anyway:
//     BEFORE — DECISIONS stamp: 08f8018
//     wrap exit: 1
//     AFTER  — DECISIONS stamp: 2ae716e     ← advanced on a wrap that FAILED
// `last_reconciled_head` is a PROMISE recorded before it is kept.
//
// ⛔ WHY IT MATTERS BEYOND TIDINESS: that field is the natural key for "commits since the docs were last
// reconciled". Any future mechanism keyed on it inherits a range that can silently skip the work a failed
// wrap already looked at. ★LAST-RECONCILED-HEAD-IS-VALIDATED-BY-NOTHING carries the standing half — the
// freshness gate asserts content_hash only and never reads the head at all.
//
// ⛔ WHY THIS IS NOT IN `npm run guard`, STATED SO NOBODY "FIXES" IT BY MOVING IT: it needs the `git` binary
// (wrap-docs shells `git rev-parse HEAD`) and a writable throwaway copy of the tree. NO GUARD IN THE SUITE
// SHELLS GIT — checked, 2026-08-17 — and the suite runs inside the Vercel build, where neither a .git dir nor
// a writable scratch is guaranteed. A guard that cannot run is not a pass, so this stays a script that is RUN,
// in the same posture as check-walk-liveness.mjs. Registering it in check:data is queued deliberately: that
// runner's verdict line is quoted in every push report, and changing its denominator deserves its own moment.
//
// USAGE: node scripts/check-wrap-rollback.mjs
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = 'docs/HANDOFF_MANIFEST.json'
const PROBE = 'LORAMER_DECISIONS.md'
const stampOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8'))[PROBE].last_reconciled_head

let tmp = null
try {
  // A THROWAWAY COPY OF THE TRACKED WORKING TREE — the real tree is never written to.
  // ⛔ THE WORKING TREE, NOT `git archive HEAD`, AND THE FIRST DRAFT GOT THIS WRONG. Copying HEAD sounds safer
  // ("an uncommitted tree cannot affect the result") and it makes the check USELESS for the only moment that
  // matters: verifying a fix BEFORE it is committed. Measured — with the rollback fix uncommitted, the HEAD
  // copy kept failing on the old code and would have been read as the fix not working. A pre-commit check must
  // test what is about to ship.
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loramer-wrap-rollback-'))
  execFileSync('sh', ['-c', `git ls-files -z | tar --null -T - -cf - | tar -x -C ${JSON.stringify(tmp)}`], { cwd: ROOT })
  // wrap-docs asks git for HEAD, so the copy needs a history of its own. One commit is enough.
  execFileSync('git', ['init', '-q'], { cwd: tmp })
  execFileSync('git', ['add', '-A'], { cwd: tmp })
  execFileSync('git', ['-c', 'user.email=check@loramer', '-c', 'user.name=check', 'commit', '-qm', 'scratch base'], { cwd: tmp })

  const before = stampOf(tmp)

  // ⛔ TWO EDITS, AND BOTH ARE LOAD-BEARING.
  // (1) DECISIONS must actually CHANGE, or step 1 skips it (`if (h === entry.content_hash) continue`) and the
  //     stamp would hold still for a reason that has nothing to do with the fix — a false green.
  // (2) A SECOND `▶▶ NEXT STEP` opener makes the digest builder refuse, which is a REAL step-2 failure this
  //     repo has actually hit, not a synthetic exception.
  fs.appendFileSync(path.join(tmp, PROBE), '\n- [MEASURED 2026-08-17 — scratch probe] forces a content-hash change.\n')
  const ch = path.join(tmp, 'CONTINUE_HERE.md')
  const src = fs.readFileSync(ch, 'utf8')
  const fence = '═══ NEXT STEP ═══\n'
  const at = src.indexOf(fence)
  if (at < 0) {
    console.error('✗ wrap-rollback CANNOT RUN — CONTINUE_HERE.md has no ═══ NEXT STEP ═══ fence, so a step-2 refusal cannot be provoked. A check that cannot provoke its own failure is a broken instrument, never a pass.')
    process.exitCode = 2
  } else {
    fs.writeFileSync(ch, src.slice(0, at + fence.length) + '\n▶▶ NEXT STEP — SCRATCH DUPLICATE OPENER (probe): two openers inside the fence must make the digest refuse.\n' + src.slice(at + fence.length))

    const run = spawnSync(process.execPath, [path.join(tmp, 'scripts/wrap-docs.mjs')], { cwd: tmp, encoding: 'utf8' })
    const after = stampOf(tmp)

    if (run.status === 0) {
      console.error(`✗ WRAP-ROLLBACK CANNOT RUN — the wrap SUCCEEDED (exit 0) on a tree with two ▶▶ NEXT STEP openers. The probe no longer provokes a failure, so this check proves nothing about rollback. Fix the probe before trusting a green.`)
      process.exitCode = 2
    } else if (after !== before) {
      console.error(`\n✗ WRAP-ROLLBACK FAILED — the manifest stamp ADVANCED on a wrap that exited ${run.status}.`)
      console.error(`  ${PROBE}.last_reconciled_head   BEFORE: ${before}   AFTER: ${after}`)
      console.error(`  wrap-docs.mjs writes the manifest at the END OF STEP 1, before steps 2/3/4 establish anything the stamp claims — so a wrap that dies afterwards records a reconciliation that never happened.`)
      console.error(`  CONSEQUENCE: "commits since the docs were last reconciled" (last_reconciled_head..HEAD) silently skips whatever the failed wrap had already moved past.`)
      console.error(`  LIMIT: this proves the stamp survives a FAILED wrap. It does not prove the stamp ADVANCES on a successful one — run a real wrap for that — and it cannot cover a hard kill between the write and the rollback.`)
      process.exitCode = 1
    } else {
      console.log(`[wrap-rollback] PASS — a real step-2 refusal (two ▶▶ NEXT STEP openers) exited ${run.status} and ${PROBE}.last_reconciled_head is UNCHANGED at ${before}. The stamp is recorded only by a wrap that completed all four steps.`)
      console.log(`  LIMIT: proves the stamp survives a FAILED wrap, driven through the REAL wrap-docs.mjs on a throwaway copy of HEAD. It does NOT prove the stamp advances on a SUCCESSFUL wrap (that is the happy path, proven by running one), and it cannot cover a hard kill between the write and the rollback — see the comment in wrap-docs.mjs.`)
    }
  }
} catch (e) {
  console.error(`✗ wrap-rollback CANNOT RUN — ${e?.message}. Needs the git binary and a writable temp dir; a check that cannot execute its subject FAILS, it does not pass quietly.`)
  process.exitCode = 2
} finally {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
}
