#!/usr/bin/env node
// LORAMER_CHAT_TURN_PAIR_WRITE_V1 — ★CHAT-USER-TURN-ORPHAN fork (a2): the SERVER owns BOTH turns, written
// as ONE atomic pair, user first — and the client never writes a user turn before the answer exists.
//
// THE DEFECT THIS GUARDS AGAINST, measured 2026-08-12: 66 orphaned user turns (18.3% of all user turns)
// in client_conversations, rendered into Lora's PREVIOUS-CONVERSATIONS block as questions she apparently
// ignored — plus 34 INVERSE orphans (assistant rows whose fire-and-forget client user-write silently died).
//
// THE CONTRACT (settled in the 2026-08-12 ADVERSARY round, attacks driven on the real compiled modules):
//   · makeAssistantTurnWriter gains `userMessage` and its injectable `insert` receives an ARRAY of rows in
//     EXACTLY ONE call — [userRow, assistantRow] when userMessage is present, [assistantRow] when absent
//     (the stale-tab compat flag: an old client that still writes its own user turn declares nothing and
//     gets today's assistant-only behavior, byte-identical).
//   · USER ROW FIRST. Driven 2026-08-12: for equal created_at the recap renders INPUT order (stable sort,
//     id tiebreakers at both readers) — the render order is carried ENTIRELY by insert order, so a
//     reversed pair renders Lora answering before she was asked. bigserial assigns ids in VALUES order.
//   · An EMPTY answer writes NOTHING — letting the user row through alone is the orphan class reborn
//     server-side.
//   · The one-shot latch survives: both route call sites (:342 streaming close, :458 blocking) share one
//     writer; second call = 'skipped-duplicate', zero new inserts, including under a concurrent race.
//   · use-lora-chat.ts carries NO pre-fetch user-turn write (the old :558 shape) — that write is the
//     orphan generator and the inverse-orphan generator at once.
//
// ⛔ RED-FIRST BY DESIGN: legs (1) and (2) are RED against the tree until the (a2) executor ships — this
// guard lands in the SAME commit as that code, exactly the inception-executor pattern.
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
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
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const HOOK = 'src/lib/next/use-lora-chat.ts'
const WRITER = 'src/lib/chat/persist-assistant-turn.ts'

// ── (1) THE CLIENT NEVER WRITES A USER TURN BEFORE THE ANSWER EXISTS ──────────────────────────────────
// Invocation-matching, not name-matching (the (p)/(q) lesson): the import may stay; the CALL with
// role:'user' is what generates orphans.
{
  const code = stripComments(read(HOOK))
  if (/logNextConversationTurn\s*\(\s*\{[\s\S]*?role:\s*['"]user['"][\s\S]*?\}\s*\)/.test(code)) {
    findings.push(`(1) ${HOOK} still fires logNextConversationTurn({role:'user'}) before the fetch — the pre-answer user write is the orphan generator (66 measured) AND the inverse-orphan generator (34 measured: the fire-and-forget POST dies silently while the answer succeeds). The server owns both turns.`)
  }
}

// ── (2)-(5) DRIVE THE REAL WRITER — transpile from ROOT, stub only the leaves, inject a capturing insert ─
{
  const out = mkdtempSync(join(tmpdir(), 'loramer-pairwrite-'))
  const origResolve = Module._resolveFilename
  try {
    const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
    const r = spawnSync(tsc, [resolve(ROOT, WRITER), '--target', 'es2020', '--module', 'commonjs',
      '--moduleResolution', 'node', '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
    if (r.error) findings.push(`could not run tsc — ${r.error.message}`)
    const stub = join(out, '__stub.js')
    writeFileSync(stub, `module.exports = new Proxy({}, { get: () => (() => {}) })`)
    Module._resolveFilename = function (request, ...rest) {
      if (request.startsWith('@/') || request.startsWith('./') || request.startsWith('../')) return stub
      return origResolve.call(this, request, ...rest)
    }
    const mod = createRequire(import.meta.url)(join(out, 'src/lib/chat/persist-assistant-turn.js'))
    const ARGS = { clientId: 'c-1', userEmail: 'viewer@x.com', target: { surface: 'next-ask-lora', scope: 'drill' } }
    // Normalize: today's writer hands insert a single row OBJECT; the (a2) writer hands an ARRAY. The
    // drive accepts both shapes so the red is "the pair is missing", never a harness crash.
    const capture = () => { const calls = []; return { calls, insert: async (arg) => { calls.push(Array.isArray(arg) ? arg : [arg]); return { error: null } } } }

    // (2) THE PAIR: one insert call, two rows, user FIRST, field fidelity on both rows.
    {
      const { calls, insert } = capture()
      const persist = mod.makeAssistantTurnWriter({ ...ARGS, userMessage: 'QQ_USER_MSG', insert })
      await persist('AA_ANSWER')
      if (calls.length !== 1) {
        findings.push(`(2) the turn landed in ${calls.length} insert call(s) — the pair must land in EXACTLY ONE insert (one statement = atomic; two statements re-opens the half-written turn this design exists to end).`)
      } else {
        const rows = calls[0]
        if (rows.length !== 2 || !rows.some((x) => x.role === 'user')) {
          findings.push(`(2) the USER turn is missing from the pair (insert received ${rows.length} row(s): ${rows.map((x) => x.role).join(', ') || 'none'}) — with userMessage declared, the server must write [user, assistant]. This is the orphan class reborn server-side, one writer later.`)
        } else if (rows[0].role !== 'user' || rows[1].role !== 'assistant') {
          findings.push(`(2) the pair is REVERSED (${rows.map((x) => x.role).join(' → ')}) — driven 2026-08-12: equal-created_at render order is INPUT order (stable sort + id tiebreakers), so this renders Lora answering before she was asked. User row FIRST.`)
        } else {
          if (rows[0].content !== 'QQ_USER_MSG') findings.push(`(2) the user row does not carry the user's message verbatim (got ${JSON.stringify(rows[0].content)}).`)
          for (const [i, row] of rows.entries()) {
            if (row.client_id !== 'c-1' || row.user_email !== 'viewer@x.com' || row.surface !== 'next-ask-lora' || row.scope !== 'drill') {
              findings.push(`(2) row ${i} (${row.role}) drops or mangles its keying — client_id/user_email/surface/scope must match the request exactly (viewer-keyed, ADVERSARY attack 6 pinned today's behavior).`)
            }
          }
        }
      }
    }

    // (3) AN EMPTY ANSWER WRITES NOTHING — the user row may not go through alone.
    {
      const { calls, insert } = capture()
      const persist = mod.makeAssistantTurnWriter({ ...ARGS, userMessage: 'QQ_USER_MSG', insert })
      const outc = await persist('   ')
      if (calls.length !== 0) {
        findings.push(`(3) an EMPTY answer still reached insert (${calls.length} call(s), rows: ${JSON.stringify(calls[0])}) — a failed turn must leave NO trace; a lone user row here is the exact defect (outcome was '${outc}').`)
      }
    }

    // (4) STALE-TAB COMPAT: no userMessage ⇒ assistant-only, byte-identical to today.
    {
      const { calls, insert } = capture()
      const persist = mod.makeAssistantTurnWriter({ ...ARGS, insert })
      await persist('AA_ANSWER')
      const rows = calls.flat()
      if (rows.length !== 1 || rows[0].role !== 'assistant') {
        findings.push(`(4) a FLAGLESS caller (no userMessage) got ${rows.length} row(s) (${rows.map((x) => x.role).join(', ')}) — an old open tab still writes its own user turn client-side, so a server pair here DUPLICATES the user turn for the life of every stale tab. Flagless = assistant-only, exactly today.`)
      }
    }

    // (5) THE LATCH: the second call skips and reaches insert ZERO more times — measured as a DELTA against
    // the writer's own single-persist insert count, so a non-atomic writer (leg 2's finding) cannot
    // double-fire this leg: one injected defect, one leg red.
    let baselineInsertCalls = 1
    {
      const { calls, insert } = capture()
      const persist = mod.makeAssistantTurnWriter({ ...ARGS, userMessage: 'QQ_USER_MSG', insert })
      const r1 = await persist('AA_ANSWER')
      baselineInsertCalls = calls.length
      const r2 = await persist('AA_ANSWER')
      if (r2 !== 'skipped-duplicate' || calls.length > baselineInsertCalls) {
        findings.push(`(5) the one-shot latch is broken sequentially (first='${r1}', second='${r2}', inserts ${baselineInsertCalls}→${calls.length}) — both route call sites (:342 close path, :458 blocking) share one writer and the second must skip with zero new inserts.`)
      }
    }
    {
      const { calls, insert } = capture()
      const slow = async (arg) => { await new Promise((res) => setTimeout(res, 15)); return insert(arg) }
      const persist = mod.makeAssistantTurnWriter({ ...ARGS, userMessage: 'QQ_USER_MSG', insert: slow })
      const [a, b] = await Promise.all([persist('AA_ANSWER'), persist('AA_ANSWER')])
      const wins = [a, b].filter((x) => x === 'written').length
      if (wins !== 1 || calls.length > baselineInsertCalls) {
        findings.push(`(5) the latch loses a RACE (outcomes ${a}/${b}, inserts=${calls.length} vs single-persist baseline ${baselineInsertCalls}) — the claim must flip synchronously BEFORE the await (persist-assistant-turn's own rule) so two racing callers cannot both pass.`)
      }
    }
  } catch (e) {
    findings.push(`could not DRIVE the writer — ${e.message}. A guard that cannot run its subject FAILS rather than passing.`)
  } finally {
    Module._resolveFilename = origResolve
  }
}

if (findings.length) {
  console.error(`[chat-turn-pair-write] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`[chat-turn-pair-write] PASS — (1) the client fires no pre-answer user-turn write · DRIVEN on the real writer: (2) the pair lands in ONE insert, user first, both rows fully keyed · (3) an empty answer writes nothing (no lone user row) · (4) a flagless caller gets assistant-only (stale-tab compat) · (5) the latch holds sequentially and under a race. LIMIT, named: leg (1) is a source scan; the runtime path from /api/chat to the writer is exercised by the route's own call sites, not re-driven here.`)
