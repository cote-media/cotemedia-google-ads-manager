#!/usr/bin/env node
// LORAMER_CHAT_MERGE_NOT_REPLACE_V1 — guard the four properties this flight bought.
//
// THE DEFECT. `use-lora-chat` had THREE `setMessages(rows.map((m) => ({ role: m.role, content: m.content })))`
// sites — mount hydration, the visibility/focus refresh, and the recovery "ambiguous" branch. Each REPLACED
// the array wholesale and discarded the server row `id` on the way in. A replace cannot preserve a message
// the server has not written yet, so any refresh landing between "the user pressed send" and "the server
// persisted the user turn" erased the message the user was looking at.
//
// (a) NO WHOLESALE REPLACE. Every path that adopts a server thread goes through `applyServerThread`.
// (b) IDS SURVIVE INTO STATE. Without `id` there is no merge key and replace is the only move available.
//     Also: the render keys on identity, not on array position.
// (c) A NULL WATERMARK CANNOT LICENSE AN UNCONDITIONAL REPLACE. The old check read
//     `threadMaxIdRef.current != null && maxId <= threadMaxIdRef.current` — with the ref null the second
//     clause short-circuits false and the replace ran unconditionally. MEASURED as wider than "hydration
//     failed": the ref is set with `reduce(...) || null`, so reduce's 0 becomes null and every brand-new
//     conversation carries a null watermark on the HAPPY PATH.
// (d) THE MERGE IS CLIENT-SCOPED — the leg that matters most. Preserving unsent local messages is right
//     WITHIN one client and catastrophic ACROSS two: the desktop shelf stays MOUNTED through a client switch
//     while the -next page remounts, so a naive merge carries client A's optimistic turn into client B's
//     thread. That is a data-attribution bug, strictly worse than the display bug being fixed.
//
// ⛔ WHAT THIS GUARD CANNOT DO, STATED SO A GREEN RUN IS NOT OVER-READ: it cannot prove the merge produces
// the right ARRAY at runtime. It proves the wholesale replaces are gone, that the merge key reaches state,
// that the null-watermark fall-through is non-destructive, and that the client scoping exists. Whether a
// real optimistic turn survives a real refresh is a live observation, not a static property of the source.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
// QUOTATION IS NOT ASSERTION — a comment quoting the old broken shape must not read as the shape itself.
// This guard's own subject files are DENSE with such quotes, so stripping is load-bearing here, not hygiene.
const isCode = (l) => { const t = l.trim(); return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') }
const codeOf = (src) => src.split('\n').map((l, i) => ({ n: i + 1, l })).filter(({ l }) => isCode(l))

const HOOK = 'src/lib/next/use-lora-chat.ts'
const MERGE = 'src/lib/next/merge-thread.ts'
const THREAD = 'src/components/redesign/LoraThread.tsx'

for (const f of [HOOK, MERGE, THREAD]) {
  if (!existsSync(resolve(ROOT, f))) {
    console.error(`[chat-merge-not-replace] FAIL — ${f} is missing.`)
    process.exit(1)
  }
}

const hookSrc = read(HOOK)
const hook = codeOf(hookSrc)
const merge = codeOf(read(MERGE))
const thread = codeOf(read(THREAD))

// ── (a) NO WHOLESALE REPLACE ────────────────────────────────────────────────────────────────────────
{
  // The exact shape that shipped the defect: a thread read piped straight into setMessages.
  const wholesale = hook.filter(({ l }) => /setMessages\(\s*(rows|all|prior)\b/.test(l))
  check(
    wholesale.length === 0,
    `(a) WHOLESALE REPLACE — setMessages() is being handed a thread read directly at ${wholesale
      .map(({ n }) => `${HOOK}:${n}`).join(', ')}. Route it through applyServerThread(), which merges.`,
  )

  // The same defect wearing a different variable name.
  const projected = hook.filter(({ l }) => /setMessages\(\s*[A-Za-z_$][\w$]*\.map\(/.test(l))
  check(
    projected.length === 0,
    `(a) WHOLESALE REPLACE — setMessages(<ident>.map(...)) at ${projected
      .map(({ n }) => `${HOOK}:${n}`).join(', ')}. Projecting a server array into state IS the replace, ` +
      'whatever the variable is called.',
  )

  // All three read paths funnel through the one merge. Fewer than three means a path was missed or a new
  // one was added without merging; the definition itself is excluded from the count.
  const calls = hook.filter(({ l }) => /applyServerThread\(/.test(l) && !/const applyServerThread/.test(l))
  check(
    calls.length >= 3,
    `(a) EXPECTED 3 applyServerThread() call sites (hydration, refresh, recovery-ambiguous); found ${calls.length}.`,
  )

  // (e) THE ONE ALLOWED BARE REPLACE, ALLOWLISTED BY NAME. The portfolio Shell has no client, so there is
  // no thread to merge into and nothing to preserve. It must NOT be "fixed" into a merge — and it must keep
  // clearing the client ref, or the next real client would merge into the Shell's empty state as if it were
  // its own.
  check(
    hook.some(({ l }) => /setMessages\(\[\]\)/.test(l) && /messagesClientRef\.current\s*=\s*null/.test(l)),
    '(e) THE PORTFOLIO RESET IS GONE OR NO LONGER CLEARS THE CLIENT REF — ' +
      '`if (!cid) { setMessages([]); messagesClientRef.current = null; return }` is deliberate and allowlisted.',
  )
}

// ── (b) IDS SURVIVE INTO STATE, AND THE RENDER KEYS ON IDENTITY ─────────────────────────────────────
{
  check(merge.some(({ l }) => /\bid\?:\s*number/.test(l)), '(b) Msg has no `id?: number` — there is no merge key.')
  check(merge.some(({ l }) => /\blkey:\s*string/.test(l)), '(b) Msg has no required `lkey: string` — an optimistic message has no stable identity.')
  check(merge.some(({ l }) => /byId\.set\(/.test(l)) && merge.some(({ l }) => /byId\.get\(/.test(l)),
    '(b) merge-thread does not index local messages by id — it cannot be merging on the id.')
  check(merge.some(({ l }) => /\br\.id\b/.test(l)), '(b) merge-thread never reads the server row id.')

  // The hook must not re-introduce an id-stripping projection on a read path.
  const stripped = hook.filter(({ l }) => /\.map\(\s*\(?m[:)\s]/.test(l) && /role:\s*m\.role/.test(l) && /content:\s*m\.content/.test(l))
  check(
    stripped.length === 0,
    `(b) ID-STRIPPING PROJECTION at ${stripped.map(({ n }) => `${HOOK}:${n}`).join(', ')} — ` +
      'this rebuilds {role, content} and drops the id, which is what made merging impossible.',
  )

  check(
    thread.some(({ l }) => /key=\{m\.id\s*\?\?\s*m\.lkey\}/.test(l)),
    '(b) LoraThread does not key on `m.id ?? m.lkey`.',
  )
  const indexKeyed = thread.filter(({ l }) => /messages\.map\(/.test(l) && /,\s*i\)/.test(l))
  check(
    indexKeyed.length === 0,
    `(b) messages.map still carries an index at ${indexKeyed.map(({ n }) => `${THREAD}:${n}`).join(', ')} — ` +
      'index keys plus a mid-thread identity change silently rebind every bubble after it.',
  )
}

// ── (c) NULL WATERMARK CANNOT LICENSE AN UNCONDITIONAL REPLACE ──────────────────────────────────────
{
  const wm = hook.findIndex(({ l }) => /threadMaxIdRef\.current\s*!=\s*null\s*&&\s*maxId\s*<=/.test(l))
  check(wm !== -1, '(c) The refresh watermark check is gone — cannot prove what its fall-through does.')
  if (wm !== -1) {
    // Whatever the watermark decides, the code it falls through to must MERGE. That is the whole of the fix:
    // the guard is no longer load-bearing, so falling through it is harmless.
    const after = hook.slice(wm + 1, wm + 5).map(({ l }) => l).join('\n')
    check(
      /applyServerThread\(/.test(after),
      `(c) THE WATERMARK FALL-THROUGH DOES NOT MERGE (${HOOK}:${hook[wm].n}) — a null watermark reaches ` +
        'this code on the happy path of every new conversation, and it must not reach a replace.',
    )
    check(
      !/setMessages\(/.test(after),
      `(c) THE WATERMARK FALL-THROUGH CALLS setMessages DIRECTLY (${HOOK}:${hook[wm].n}).`,
    )
  }
}

// ── (d) THE MERGE IS CLIENT-SCOPED ──────────────────────────────────────────────────────────────────
{
  check(
    merge.some(({ l }) => /export function mergeThreadForClient/.test(l)),
    '(d) mergeThreadForClient is gone — there is no client-scoped entry point.',
  )
  // The drop-on-switch branch, asserted on its behaviour rather than its wording: when the client differs,
  // the local set must be discarded (merged against an EMPTY local), never merged.
  const drops = merge.filter(({ l }) => /localClientId\s*!==\s*serverClientId/.test(l) && /mergeThread\(\s*\[\]/.test(l))
  check(
    drops.length > 0,
    '(d) NO DROP-ON-CLIENT-CHANGE — `if (localClientId !== serverClientId) return mergeThread([], serverRows)` ' +
      'is what stops client A\'s optimistic turn appearing in client B\'s thread.',
  )
  // The local side must come from a REF, not from the `clientId` prop. The prop changes the instant the user
  // switches, while `messages` still holds the previous client's thread — reading the prop for both sides
  // would make the comparison always true and silently disable the scoping.
  check(
    hook.some(({ l }) => /const localClientId\s*=\s*messagesClientRef\.current/.test(l)),
    '(d) applyServerThread does not read the local client from messagesClientRef — comparing the prop ' +
      'against itself makes the client scoping a no-op.',
  )
  check(
    hook.some(({ l }) => /mergeThreadForClient\(/.test(l)),
    '(d) The hook never calls mergeThreadForClient.',
  )
}

console.log(`[chat-merge-not-replace] scanned ${hook.length} code lines in the hook, ${merge.length} in the merge, ${thread.length} in the thread view`)
if (findings.length) {
  console.error(`[chat-merge-not-replace] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  · ${f}`)
  process.exit(1)
}
console.log('[chat-merge-not-replace] PASS')
