#!/usr/bin/env node
// LORAMER_CONN_DEGRADED_STATE_V1 — FIX-WITH-GUARD for the 'degraded' health state (SLICE 2).
//
// THE CLASS IT GUARDS: a new health value ('degraded' = login alive, capture failing >24h) is worthless if a
// READER silently treats it as healthy/green/connected. Every reader that branches on platform_connections.health
// must ACCOUNT for 'degraded' — either by routing through the one-source semantics module
// (src/lib/connection-health-view.ts) or by an explicit 'degraded' branch. A reader that references the health
// enum but neither → SILENT and FAILS here.
//
// Reach (stated honestly): the reader set is the enumerated §1 consumer list below — a NEW health-reader must be
// added here (or the whole set auto-discovered) or the guard cannot see it. It proves each listed reader mentions
// 'degraded'/the view; it does NOT prove the rendered UX is correct (that is Gate-B on device).
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const VIEW = 'src/lib/connection-health-view.ts'
const VIEW_IMPORT = /from ['"]@\/lib\/connection-health-view['"]/ // collision-free evidence a reader routes through the one source
// NB: do NOT sniff bare helper NAMES — 'blocksGreen' collides with a pre-existing Task field in readiness.ts.

// The health READERS (files that decide connected/green/badge/dead from health). A new one must join this list.
const READERS = [
  'src/lib/completeness/readiness.ts',
  'src/lib/next/coverage.ts',
  'src/components/redesign/ClientPage.tsx',
  'src/app/api/intelligence/route.ts',
  'src/lib/intelligence/build-claude-context.ts',
  'src/app/dashboard/page.tsx',
  'src/app/clients/page.tsx',
]

const findings = []
const read = (p) => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8') } catch { return null } }

// 1) The one source must exist and export the semantics.
const view = read(VIEW)
if (!view) findings.push(`${VIEW} is MISSING — the one-source health semantics module must exist.`)
else {
  if (!/'degraded'/.test(view)) findings.push(`${VIEW} does not define the 'degraded' value.`)
  for (const h of ['blocksGreen', 'isConnectedForCoverage', 'badgeFor', 'degradedTask']) {
    if (!new RegExp(`export function ${h}\\b`).test(view)) findings.push(`${VIEW} does not export ${h}().`)
  }
}

// 2) Every reader that branches on health must account for 'degraded' (explicit branch OR a view helper).
const mentionsDegraded = (src) => /['"]degraded['"]/.test(src) // the quoted state value (not a bare word in a comment)
for (const r of READERS) {
  const src = read(r)
  if (src == null) { findings.push(`reader ${r} not found — the reader list is stale.`); continue }
  // referencesHealth: it decides on health (quoted 'reconnect', reads .health, or the connectionHealth signal)
  const referencesHealth = /['"]reconnect['"]/.test(src) || /\.health\b/.test(src) || /connectionHealth/.test(src)
  if (!referencesHealth) continue // not a health-branching reader anymore → nothing to guard
  if (!mentionsDegraded(src) && !VIEW_IMPORT.test(src)) {
    findings.push(`reader ${r} branches on health but does NOT account for 'degraded' (no 'degraded' branch, no connection-health-view helper) → a degraded connection reads as healthy/green here.`)
  }
}

if (findings.length) {
  console.error("✗ GATE FAILED — a persistent-failure ('degraded') connection is invisible to at least one reader:")
  for (const f of findings) console.error('  · ' + f)
  console.error(`\n${findings.length} finding(s). Teach every reader (via connection-health-view or an explicit 'degraded' branch). (Reach: the enumerated reader set; NOT a UX-correctness proof.)`)
  process.exit(1)
}
console.log("✓ GATE PASSED — every listed health-reader accounts for 'degraded' (via connection-health-view or an explicit branch).")
console.log('  (LORAMER_CONN_DEGRADED_STATE_V1 — one-source semantics + reader coverage; UX correctness is Gate-B on device.)')
process.exit(0)
