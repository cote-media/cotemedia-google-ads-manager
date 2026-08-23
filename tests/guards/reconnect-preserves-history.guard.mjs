#!/usr/bin/env node
// LORAMER_RECONNECT_STATE_MACHINE_V1 — REPAIR MAY NOT DESTROY, AND A CREDENTIAL MAY NOT PROMOTE UNPROVEN.
//
// ⛔ THE TWO DEFECT CLASSES THIS PINS, both measured live 2026-08-22:
//  (1) delete-then-insert on a REPAIR wiped health/last_ok/created_at — a SUCCESSFUL Meta repair demoted
//      the badge Healthy → neutral and the flow read as broken (the f5fbe7e5 reconnect loop). The field's
//      rule verbatim (Nango): deleting and re-creating the connection wipes its data — prefer
//      re-authorization in place.
//  (2) the Meta callback overwrote the stored token IN PLACE with an UNPROBED credential and NO identity
//      check — one wrong-user or dead re-auth killed capture for all 12 rows on the shared token,
//      unrecoverably (claude-code #29896: a failed refresh must preserve the existing valid credential).
//
// LEGS — marker/structure-anchored, never variable-anchored (the 3636a1a lesson):
//  (a) the finalize route's REPAIR branch contains NO .delete() and its UPDATE SET-list is the ALLOWLIST
//      (account_name, user_email) — health / created_at / onboard_steps_done / backfill_priority are
//      FORBIDDEN in it.
//  (b) reset code (.delete() / backfill_priority) is reachable ONLY inside the account-change branch: the
//      DISCRIMINATOR (an account_id equality test against the existing row) must exist, and every delete
//      must appear AFTER it in the POST handler (DELETE-the-endpoint is exempt: disconnect is not repair).
//  (c) the Meta callback: NO meta_tokens upsert without the LIVENESS probe (probeMeta) AND the IDENTITY
//      compare (stored fb_user_id) PRECEDING it in the same handler — positional, on the CREDENTIAL GATES
//      marker.
//  (d) red-first: run against a pre-change tree (LORAMER_GUARD_ROOT) and every leg above FAILS — proven at
//      Gate-A of the commit that introduced this file.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const FINALIZE = 'src/app/api/clients/connections/route.ts'
const CALLBACK = 'src/app/api/meta/callback/route.ts'
const findings = []
const read = (rel) => {
  try { return readFileSync(resolve(ROOT, rel), 'utf8') }
  catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS rather than passing.`); return null }
}
const nocomment = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

// ── (a)+(b) the finalize route ─────────────────────────────────────────────────────────────────────────
const fin = read(FINALIZE)
if (fin) {
  const postStart = fin.indexOf('export async function POST')
  const postEnd = fin.indexOf('export async function', postStart + 10)
  const post = nocomment(fin.slice(postStart, postEnd > 0 ? postEnd : undefined))
  const iDiscriminator = post.search(/existing[\s\S]{0,40}account_id\s*===\s*account_id|account_id\s*===\s*existing\.account_id/)
  if (iDiscriminator < 0) {
    findings.push(`(b) ${FINALIZE}: the account-change DISCRIMINATOR (account_id equality against the existing row) is missing from POST — without it repair and replacement are one branch, and that branch resets.`)
  }
  // every .delete() in POST must sit AFTER the discriminator (i.e., inside the replacement/connect branch)
  let idx = 0
  while ((idx = post.indexOf('.delete()', idx)) !== -1) {
    if (iDiscriminator < 0 || idx < iDiscriminator) {
      findings.push(`(b) ${FINALIZE}: a platform_connections .delete() in POST precedes the discriminator — the repair path can reach it. delete-then-insert is the REPLACEMENT semantics and may exist only inside the changed-account branch.`)
    }
    idx += 1
  }
  // the repair UPDATE's SET list: find .update({...}) blocks in POST; each must be allowlist-only
  const updates = [...post.matchAll(/\.update\(\{([\s\S]*?)\}\)/g)]
  if (!updates.length && iDiscriminator >= 0) {
    findings.push(`(a) ${FINALIZE}: the discriminator exists but POST has no UPDATE — repair still routes through delete-then-insert.`)
  }
  for (const m of updates) {
    const setList = m[1]
    for (const banned of ['health', 'created_at', 'onboard_steps_done', 'backfill_priority', 'last_ok_at', 'first_failure_at']) {
      if (new RegExp(`\\b${banned}\\b`).test(setList)) {
        findings.push(`(a) ${FINALIZE}: the repair UPDATE's SET list contains forbidden field '${banned}'. The allowlist is account_name + user_email; history is preserved and health is RE-PROVEN by the verify, never written here.`)
      }
    }
  }
  // the verify must exist after the write
  if (!/verifyAndHealCredential\(/.test(post)) {
    findings.push(`(a) ${FINALIZE}: POST never calls verifyAndHealCredential — the claim is unverified and the success state would be a guess.`)
  }
}

// ── (c) the callback's credential gates ────────────────────────────────────────────────────────────────
const cb = read(CALLBACK)
if (cb) {
  const marker = cb.indexOf('CREDENTIAL GATES — LORAMER_RECONNECT_STATE_MACHINE_V1')
  const code = nocomment(cb)
  const iProbe = code.indexOf('probeMeta(')
  const iIdentity = code.search(/fb_user_id[\s\S]{0,200}!==|!==[\s\S]{0,40}fbUserId/)
  const iUpsert = code.indexOf("from('meta_tokens').upsert")
  if (marker < 0) findings.push(`(c) ${CALLBACK}: the CREDENTIAL GATES marker is missing — the guard anchors on the marker, and without it the gates' placement is unpoliceable.`)
  if (iUpsert < 0) findings.push(`(c) ${CALLBACK}: no meta_tokens upsert found — the write moved and this guard must move with it.`)
  if (iUpsert >= 0 && (iProbe < 0 || iProbe > iUpsert)) {
    findings.push(`(c) ${CALLBACK}: the meta_tokens upsert is not PRECEDED by a probeMeta liveness gate — an unproven credential can overwrite the working one, unrecoverably (UNIQUE(user_email), no history).`)
  }
  if (iUpsert >= 0 && (iIdentity < 0 || iIdentity > iUpsert)) {
    findings.push(`(c) ${CALLBACK}: the meta_tokens upsert is not PRECEDED by the fb_user_id identity compare — a different human's login can silently replace the credential all connections ride.`)
  }
}

if (findings.length) {
  console.error(`[reconnect-preserves-history] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  ✗ ${f}`)
  console.error('  ⇒ SPEC: LORAMER_RECONNECT_STATE_MACHINE_V1 (stage-1 commit) + QUEUE ★RECONNECT-HAS-NO-STATE-MACHINE. Repair preserves; only the changed-account branch resets; no credential promotes unproven.')
  process.exitCode = 1
} else {
  console.log('[reconnect-preserves-history] PASS — repair path delete-free with an allowlisted UPDATE + verify; every reset sits behind the account-change discriminator; the Meta credential upsert is preceded by the liveness probe and the identity compare. ⛔ LIMIT: text order, not the call graph; and stage 2 surfaces (ga/shopify/woo callbacks) are NOT yet covered.')
}
