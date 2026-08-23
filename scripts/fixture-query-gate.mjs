#!/usr/bin/env node
// LORAMER_FIXTURE_QUERY_GATE_V1 — a PreToolUse hook on the Supabase MCP tools. It reads the SQL about to run and
// says, at the moment of the call, whether that query is about a FIXTURE row or an AMBIGUOUS client name.
//
// ⛔ WHY THIS EXISTS AND WHY IT IS NOT A BUILD GUARD. On 2026-08-23 an ad-hoc cross-check queried client
// 2617b163 — the demo@loramer.com fixture — for SHOPIFY data three times and reported "Influential Drones has
// zero captured rows for 2024 and none for 2025" as a real finding. The cohort client of that name (5bb9b2ff)
// holds 366 day rows in 2024 alone, and the cross-check the finding called impossible passes exactly. It was
// the THIRD instance of one class; src/lib/clients/canonical.ts's header carries all three.
// THE FIRST TWO WERE MADE IN COMMITTED FILES, WHERE A BUILD GUARD CAN SEE THEM. THIS ONE WAS MADE IN A DATABASE
// QUERY THAT NEVER TOUCHED THE FILESYSTEM — no commit, no build, nothing for a guard to read. `resolveClientById`
// sat in the tree unused because nothing calls it from a query typed at the point of use. So the enforcer has to
// live where the query is ISSUED, and on this repo that is exactly one place: a PreToolUse hook.
//
// ⛔ ITS HONEST LIMIT, FIRST, SO NOBODY MISTAKES IT FOR A SOLUTION. It INFORMS; it does not prevent. It knows the
// EIGHT ids registered in canonical.ts and nothing about any other row, so a wrong UUID for an unregistered
// client is invisible to it. It cannot tell a deliberate fixture query (auditing the fixture, which is
// legitimate and happened repeatedly the same day) from an accidental one — only a human can. What it removes is
// the specific failure that actually occurred: reading a fixture's numbers WITHOUT KNOWING they were a fixture's.
//
// ── THE TWO SIGNALS, AND WHY THEY GET DIFFERENT TREATMENT ────────────────────────────────────────────────────
//  (a) A FIXTURE / NON-PRODUCTION UUID appears in the SQL → `systemMessage` only. NO permission decision, so the
//      normal permission flow is untouched and Russ is never prompted. Querying a fixture on purpose is common
//      and legitimate; the defect was not knowing. Naming it costs nothing and is the whole fix.
//  (b) An AMBIGUOUS CLIENT NAME appears as a string literal with NO canonical id anywhere in the query → `ask`.
//      This one is a defect on its face: canonical.ts's own resolveClientByName THROWS on these names rather
//      than picking, because two different clients answer to each. A query that resolves by such a name has
//      already lost, and it is rare enough that one prompt is proportionate.
//
// ── THE SAFETY RULES, COPIED FROM protocol-gate.mjs BECAUSE THEY WERE EARNED THERE ───────────────────────────
//  ⛔ NEVER EXIT NON-ZERO. On PreToolUse exit 2 BLOCKS the tool call. This gate must never be able to cut off
//     database access on its own mistake — a false positive here would be far worse than the defect it guards.
//  ⛔ TOTAL FUNCTION. Every path returns; any internal error falls through to a silent exit 0 (fail-open).
//  ⛔ NEVER LOG THE QUERY. Query text can carry customer data. Only ids and names already public in canonical.ts.
//
// Wired in .claude/settings.json (project-scoped and committed, so it travels to both machines).
// tests/guards/fixture-query-gate.guard.mjs asserts the wiring and drives the fixtures below.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GATE_ROOT || process.cwd()

/** Read the registry from canonical.ts by PARSING IT, never by duplicating it. A second copy of these ids is the
 *  same defect this file exists to catch, one level up. Returns [] on any failure — fail-open, by design. */
function loadRegistry() {
  try {
    const src = readFileSync(resolve(ROOT, 'src/lib/clients/canonical.ts'), 'utf8')
    const body = src.slice(src.indexOf('CANONICAL_CLIENTS'))
    const out = []
    // Each entry is `{ id: '…', name: '…', owner: '…', role: '…', … reason: '…' }` across several lines.
    const re = /id:\s*'([0-9a-f-]{36})',\s*\n\s*name:\s*'([^']*)',\s*\n\s*owner:\s*'([^']*)',\s*\n\s*role:\s*'([a-z-]+)'/g
    for (const m of body.matchAll(re)) out.push({ id: m[1], name: m[2], owner: m[3], role: m[4] })
    return out
  } catch {
    return []
  }
}

/** canonical.ts's normalizeClientName, re-implemented here rather than imported: this file is plain .mjs run by a
 *  hook with no build step, and it must not depend on TypeScript being compiled. Kept byte-identical in behaviour
 *  and asserted against the real implementation by the guard. */
const normalizeName = (n) => n.trim().replace(/\s+/g, ' ').replace(/^(the|a|an)\s+/i, '').toLowerCase()

function ambiguousNames(reg) {
  const seen = new Map()
  for (const c of reg) seen.set(normalizeName(c.name), (seen.get(normalizeName(c.name)) ?? 0) + 1)
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k)
}

/** THE VERDICT. Pure, exported for the guard so the fixtures drive the real logic and not a copy of it. */
export function verdict(sql, reg) {
  const text = String(sql || '')
  if (!text.trim() || !reg.length) return null

  // (a) fixture / non-production ids present in the query text.
  const hits = reg.filter((c) => c.role !== 'cohort' && text.includes(c.id))
  // Which cohort client shares each hit's name — that is the row the reader almost certainly meant.
  const lines = hits.map((c) => {
    const twin = reg.find((o) => o.role === 'cohort' && normalizeName(o.name) === normalizeName(c.name))
    return `  ${c.id}  "${c.name}"  role=${c.role}  owner=${c.owner}` +
      (twin ? `\n    ⇒ THE COHORT CLIENT OF THAT NAME IS ${twin.id} (owner ${twin.owner}). If you meant the real one, this is the wrong id.` : '')
  })

  // (b) an ambiguous NAME as a string literal, with no canonical id anywhere in the query.
  const anyId = reg.some((c) => text.includes(c.id))
  const nameHits = anyId ? [] : ambiguousNames(reg).filter((k) => {
    for (const m of text.matchAll(/'([^']{2,80})'/g)) if (normalizeName(m[1]) === k) return true
    return false
  })

  if (nameHits.length) {
    const cands = reg.filter((c) => nameHits.includes(normalizeName(c.name)))
      .map((c) => `  ${c.id}  ${c.owner.padEnd(42)} role=${c.role}`).join('\n')
    return {
      kind: 'ask',
      reason:
        `LORAMER_FIXTURE_QUERY_GATE_V1 — this query resolves a client by an AMBIGUOUS NAME (${nameHits.join(', ')}) ` +
        `and carries no canonical id. More than one client answers to that name:\n${cands}\n` +
        `canonical.ts's resolveClientByName THROWS on these rather than picking one. Re-issue the query keyed on the id you mean.`,
    }
  }
  if (hits.length) {
    return {
      kind: 'note',
      reason:
        `⛔ LORAMER_FIXTURE_QUERY_GATE_V1 — THIS QUERY NAMES A NON-COHORT CLIENT. Whatever it returns is a ` +
        `FIXTURE's answer, including an empty result:\n${lines.join('\n')}\n` +
        `Querying a fixture on purpose is fine. Reporting its numbers as a real client's is the 2026-08-23 ` +
        `defect (DECISIONS LORAMER_FIXTURE_ROW_MEASURED_AS_REAL_V1). Say which you are doing before you read the rows.`,
    }
  }
  return null
}

// ── THE HOOK ITSELF. Reads stdin, writes at most one JSON object, ALWAYS exits 0. ────────────────────────────
function emit(obj) {
  try { process.stdout.write(JSON.stringify(obj)) } catch { /* fail-open */ }
}

async function main() {
  let raw = ''
  try {
    for await (const chunk of process.stdin) raw += chunk
  } catch {
    return // fail-open: no stdin, no opinion
  }
  let input
  try { input = JSON.parse(raw) } catch { return }

  // Only the Supabase SQL surfaces carry a query. Anything else is not this gate's business.
  const tool = String(input?.tool_name || '')
  if (!/^mcp__supabase__(execute_sql|apply_migration)$/.test(tool)) return
  const sql = input?.tool_input?.query ?? ''

  const v = verdict(sql, loadRegistry())
  if (!v) return // silent on every ordinary query — this gate costs nothing when it has nothing to say

  if (v.kind === 'ask') {
    emit({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: v.reason,
      },
    })
    return
  }
  // A NOTE, NOT A DECISION. `systemMessage` alone leaves the normal permission flow completely untouched — no
  // prompt, no approval spent — while putting the fact in front of the reader at the moment it matters.
  emit({ systemMessage: v.reason })
}

// ⛔ THE OUTERMOST CATCH IS THE POINT: this hook sits in front of every database call in the session, and it must
// never be the reason one fails. Any error at all → exit 0, no output, normal flow.
main().then(() => process.exit(0)).catch(() => process.exit(0))
