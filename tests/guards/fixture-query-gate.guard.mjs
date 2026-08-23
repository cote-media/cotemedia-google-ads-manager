#!/usr/bin/env node
// LORAMER_FIXTURE_QUERY_GATE_V1 — GUARD. The mechanical half of an enforcer whose main effect is NOT mechanical.
//
// ⛔ WHAT THIS CAN AND CANNOT DO, ON ITS FACE. scripts/fixture-query-gate.mjs fires on a PreToolUse hook, which
// no build check can observe — the same shape as the ONE-BLOCK OUTPUT law's honest limit. So this guard does not
// verify that the gate FIRED, or that anyone read it. It verifies the two things that ARE mechanical:
//   (1) THE WIRING EXISTS — the hook is registered in the committed .claude/settings.json with a matcher that
//       actually matches the Supabase SQL tools. An unwired hook is an enforcer that has silently stopped.
//   (2) THE VERDICT LOGIC STILL REFUSES ITS FIXTURES — driven through the REAL exported `verdict()`, not a copy,
//       against the REAL registry parsed out of canonical.ts. If someone widens the gate until it says nothing,
//       these go red.
// Per LORAMER_A_LAW_IS_NOT_BANKED_UNTIL_IT_CAN_FAIL_A_BUILD_V1, this file is the half that can fail a build.

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }

const GATE = 'scripts/fixture-query-gate.mjs'
const SETTINGS = '.claude/settings.json'

// ── (a) THE SCRIPT EXISTS AND CANNOT BLOCK ────────────────────────────────────────────────────────────────────
const gateSrc = read(GATE)
if (!gateSrc) findings.push(`(a) ${GATE} is missing — the fixture gate has no body.`)
else {
  // ⛔ NEVER EXIT NON-ZERO. On PreToolUse, exit 2 BLOCKS the tool call. This gate sits in front of every database
  // call in the session; a false positive that cut off DB access would be worse than the defect it guards.
  for (const m of gateSrc.matchAll(/process\.exit\((\d+)\)/g)) {
    if (m[1] !== '0') findings.push(`(a) ${GATE} calls process.exit(${m[1]}). On PreToolUse a non-zero exit BLOCKS the tool call — this gate must never be able to cut off database access on its own mistake. Exit 0 always; say things with JSON, never with a status code.`)
  }
  if (!/main\(\)\.then\([\s\S]{0,80}catch\(/.test(gateSrc)) findings.push(`(a) ${GATE} does not terminate its promise chain with a catch. An unhandled rejection in a PreToolUse hook is an error in front of every query.`)
  // The registry must be PARSED, never duplicated — a second copy of the ids is this defect one level up.
  if (!/canonical\.ts/.test(gateSrc)) findings.push(`(a) ${GATE} does not read src/lib/clients/canonical.ts. A hard-coded id list here is a SECOND registry, which is the same failure this gate exists to catch.`)
  if (/['"]2617b163-f392-427e-9a29-f134acc51406['"]/.test(gateSrc)) findings.push(`(a) ${GATE} hard-codes a client UUID. It must derive every id from canonical.ts so the registry stays the single source.`)
}

// ── (b) THE HOOK IS WIRED, IN THE COMMITTED PROJECT SETTINGS ──────────────────────────────────────────────────
const rawSettings = read(SETTINGS)
if (!rawSettings) findings.push(`(b) ${SETTINGS} is missing — nothing is wired, and .claude/settings.local.json is gitignored so it would not travel to the other machine.`)
else {
  let cfg = null
  try { cfg = JSON.parse(rawSettings) } catch { findings.push(`(b) ${SETTINGS} is not valid JSON — every hook in it, including the protocol gate, is dead.`) }
  if (cfg) {
    const pre = cfg?.hooks?.PreToolUse
    if (!Array.isArray(pre) || !pre.length) findings.push(`(b) ${SETTINGS} registers no PreToolUse hook. The fixture gate only exists when it is wired.`)
    else {
      const entry = pre.find((h) => JSON.stringify(h).includes('fixture-query-gate.mjs'))
      if (!entry) findings.push(`(b) no PreToolUse entry in ${SETTINGS} invokes fixture-query-gate.mjs.`)
      else {
        // The matcher must actually match the tools that carry SQL. A matcher that misses is a silent no-op.
        const matcher = String(entry.matcher ?? '')
        const matches = (tool) => {
          if (!matcher || matcher === '*') return true
          if (/^[\w\-\s|,]+$/.test(matcher)) return matcher.split('|').map((s) => s.trim()).includes(tool)
          try { return new RegExp(matcher).test(tool) } catch { return false }
        }
        for (const tool of ['mcp__supabase__execute_sql', 'mcp__supabase__apply_migration']) {
          if (!matches(tool)) findings.push(`(b) the PreToolUse matcher ${JSON.stringify(matcher)} does not match \`${tool}\` — the gate would never fire on the surface it was built for.`)
        }
        if (!JSON.stringify(entry).includes('CLAUDE_PROJECT_DIR')) findings.push(`(b) the fixture-gate command does not use $CLAUDE_PROJECT_DIR. Claude Code changes directory during a session, so a cwd-relative path resolves to nothing and the hook silently stops firing.`)
        if (!JSON.stringify(entry).includes('LORAMER_GATE_ROOT')) findings.push(`(b) the fixture-gate command does not pass LORAMER_GATE_ROOT, so the script cannot find canonical.ts and fails open on every call — a gate that is present and permanently silent.`)
      }
    }
  }
}

// ── (c) THE VERDICT LOGIC STILL REFUSES ITS FIXTURES — through the REAL function, against the REAL registry ───
// ⛔ RED-FIRST EVIDENCE LIVES HERE. Each case below FAILED before the gate was written, because there was no gate.
if (gateSrc && existsSync(resolve(ROOT, GATE))) {
  const { verdict } = await import(resolve(ROOT, GATE) + `?t=${process.pid}`)
  const canon = read('src/lib/clients/canonical.ts')
  const reg = []
  const re = /id:\s*'([0-9a-f-]{36})',\s*\n\s*name:\s*'([^']*)',\s*\n\s*owner:\s*'([^']*)',\s*\n\s*role:\s*'([a-z-]+)'/g
  for (const m of canon.slice(canon.indexOf('CANONICAL_CLIENTS')).matchAll(re)) reg.push({ id: m[1], name: m[2], owner: m[3], role: m[4] })

  if (reg.length < 8) findings.push(`(c) only ${reg.length} registry entries parsed out of canonical.ts (expected at least 8). The gate reads the registry the same way, so it is running near-blind.`)

  const FIXTURES = [
    // THE ACTUAL 2026-08-23 QUERY, near enough verbatim. It must produce a note.
    ["the real defect — a fixture id in a Shopify revenue query",
     `select round(sum(revenue)::numeric,2) from metrics_daily where client_id = '2617b163-f392-427e-9a29-f134acc51406' and platform = 'shopify' and date between '2024-01-01' and '2024-12-31';`,
     'note'],
    // The one dressed as a careful two-client comparison — the shape that read as rigorous and was not.
    ["the two-client comparison that hid it",
     `select c.name from metrics_daily md join clients c on c.id=md.client_id where md.client_id in ('957d484e-d0c4-4dd0-b382-d8499d556252','2617b163-f392-427e-9a29-f134acc51406');`,
     'note'],
    // Resolving by an ambiguous name is a defect on its face — canonical.ts THROWS on exactly this.
    ["an ambiguous client name with no id",
     `select * from clients where name = 'Influential Drones';`, 'ask'],
    ["the article-only collision is ambiguous too",
     `select id from clients where name = 'The Escential Group';`, 'ask'],
    // A name that is ambiguous but accompanied by an explicit id is NOT a defect — the id settles it.
    ["an ambiguous name WITH a canonical id is fine",
     `select * from clients where name='Influential Drones' and id='5bb9b2ff-a1df-4d46-ac6b-0471ef543e15';`, null],
    // ⛔ THE HEALTHY BASELINE. A gate that fires when nothing is wrong is a new defect, and it would fire on
    // nearly every query in a session — the fastest way to make an enforcer worth ignoring.
    ["the cohort client alone is silent",
     `select sum(revenue) from metrics_daily where client_id='5bb9b2ff-a1df-4d46-ac6b-0471ef543e15' and platform='shopify';`, null],
    ["an ordinary walk query is silent",
     `select count(*) from universe_run_state where cursor_date <= '2022-03-05';`, null],
    ["an unregistered client id is silent — the gate knows only what is registered, and says so rather than guessing",
     `select * from metrics_daily where client_id='212dcb43-5f9b-4bcf-bafb-8c2f6af3ed4a';`, null],
    ["empty sql is silent", ``, null],
  ]
  for (const [label, sql, want] of FIXTURES) {
    let got = null
    try { got = verdict(sql, reg)?.kind ?? null } catch (e) { got = `THREW: ${e?.message}` }
    if (got !== want) findings.push(`(c) fixture "${label}" → expected ${want === null ? 'SILENCE' : want.toUpperCase()}, got ${got === null ? 'SILENCE' : String(got).toUpperCase()}.`)
  }

  // The note must NAME the cohort twin — "this is a fixture" without "here is the one you meant" is half a fix.
  const note = verdict(`where client_id = '2617b163-f392-427e-9a29-f134acc51406'`, reg)
  if (note && !note.reason.includes('5bb9b2ff-a1df-4d46-ac6b-0471ef543e15')) {
    findings.push(`(c) the fixture note does not name the COHORT client of the same name. Telling a reader they hit a fixture without pointing at the row they meant leaves them exactly where the defect started.`)
  }
  // ⛔ NEVER LOG THE QUERY: reason text must not echo the SQL back — query text can carry customer data.
  if (note && /select |from metrics_daily/i.test(note.reason)) {
    findings.push(`(c) the gate's reason text echoes the SQL. Query text can carry customer data and this string is written to the transcript — name ids, never the query.`)
  }
}

if (findings.length) {
  console.error(`✗ FIXTURE-QUERY-GATE FAILED — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[fixture-query-gate] PASS — the hook is wired in the committed ${SETTINGS} with a matcher that reaches both Supabase SQL tools; the script cannot exit non-zero and derives every id from canonical.ts; and the real verdict() still notes both fixture-id shapes, escalates both ambiguous-name shapes, and stays SILENT on the cohort client, on an ordinary query and on an unregistered id.`)
console.log(`[fixture-query-gate] LIMIT: this guard proves the WIRING and the LOGIC. It cannot prove the hook fired, that anyone read it, or that a wrong id for an UNREGISTERED client was caught — the gate is blind to those by construction. It informs at the point of use; it does not prevent.`)
