#!/usr/bin/env node
// LORAMER_CHAT_SCREEN_TRACKS_SERVER_V1 — THE SCREEN MUST TRACK THE SERVER, NEVER NARRATE ITSELF, AND
// ALWAYS LAND ON A SENT MESSAGE.
//
// ⛔ ALL THREE LEGS COME FROM ONE NIGHT AND ONE CAUSAL CHAIN, MEASURED FROM ROWS RATHER THAN REPORTED:
// the thread was read ONCE on mount, so a turn that finished at 23:42:59Z after the user returned at
// ~23:40 was never shown (D1) → a screen showing nothing invites a re-send → the same question ran
// twice and billed twice, $1.5158 + $0.9721 (D3) → two fresh assistant rows pushed
// `pickRecoveredAnswer` into its `ambiguous` branch → its INTERNAL SENTENCE was rendered to the user
// (D5). Fix the first and three stop happening; each is still guarded, because "it can't happen any
// more" is exactly what nobody re-checks.
//
// ⛔ NOTHING WAS EVER KILLED, AND THE GUARD SAYS SO BECAUSE THE BRIEF SAID OTHERWISE: there is no
// unmount abort in the chat hook and /api/chat persists the assistant turn from its own completion
// path. The failure was always the screen, never the server.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const findings = []

const HOOK = 'src/lib/next/use-lora-chat.ts'
const RECOVERY = 'src/lib/next/chat-recovery.ts'
const SCROLL = 'src/lib/next/use-stick-to-bottom.ts'
const THREAD = 'src/components/redesign/LoraThread.tsx'

// ⛔ COMMENTS STRIPPED. All four files now carry PROSE quoting the defect — including the leaked
// sentence itself, verbatim, as the record of what must never render. A guard that read the quotation
// as the code would report the very defect it exists to prevent. (Bitten twice today: once by a
// comment satisfying a check, once by my own mutation landing in one.)
const strip = (s) => s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')

// ── (D1) A COMPLETED TURN ARRIVING WHILE MOUNTED MUST BE SHOWN ────────────────────────────────────
{
  const src = strip(read(HOOK))
  if (!src) findings.push(`(D1) ${HOOK} is unreadable — the surface's only link to the server cannot be checked.`)
  else {
    const hasVis = /addEventListener\(\s*['"]visibilitychange['"]/.test(src)
    const hasFocus = /addEventListener\(\s*['"]focus['"]/.test(src)
    if (!hasVis && !hasFocus) {
      findings.push(`(D1) ${HOOK} never re-reads the thread on visibility or focus regain. \`hydratedForRef\` reads ONCE PER CLIENT on mount, so an answer persisted AFTER the user returns is never shown — measured 2026-08-05: returned ~23:40, answer landed 23:42:59, screen stayed empty for good. The server had finished; the screen had stopped looking.`)
    }
    // ⛔ AND THE REFRESH MUST BE WATERMARKED. A read that always adopts the server's thread would stomp
    // an in-flight optimistic user turn on every tab focus, and a slow response landing after a client
    // switch could paint ANOTHER CLIENT'S history — the d55f739 class.
    if ((hasVis || hasFocus) && !/threadMaxIdRef/.test(src)) {
      findings.push(`(D1) the thread refresh does not consult \`threadMaxIdRef\`. Without the watermark a refresh adopts whatever the server returns — stomping an in-flight user turn on every focus, and risking another client's history after a switch.`)
    }
    // ⛔ NO POLLING. Russ ruled it out and it is not needed: the answer is durable server-side.
    if (/setInterval\s*\(/.test(src)) {
      findings.push(`(D1) ${HOOK} uses setInterval — a polling loop. The thread refresh is event-driven (visibility/focus) by decision; polling was explicitly ruled out and the answer is already durable server-side.`)
    }
  }
}

// ── (D5) NO INTERNAL SENTENCE MAY REACH THE RENDER ────────────────────────────────────────────────
{
  const hookSrc = strip(read(HOOK))
  const recSrc = read(RECOVERY)
  // The leaked string, matched on its own distinctive words rather than the constant name, so renaming
  // the constant cannot smuggle it back.
  const LEAK = /won.{0,3}t guess which is yours|Scroll up to see the full thread/i
  if (LEAK.test(hookSrc)) {
    findings.push(`(D5) the ambiguity sentence is reachable from ${HOOK}. It reached a user on 2026-08-05. It explains OUR machinery to someone who did not ask, then asks them to do the work of finding their own answer. On ambiguity the surface must RE-READ AND RENDER the thread instead.`)
  }
  if (/COPY\.AMBIGUOUS\b/.test(hookSrc)) {
    findings.push(`(D5) ${HOOK} still renders COPY.AMBIGUOUS. The branch is correct — refusing to guess is right — but its copy is internal and must never be the thing a user reads.`)
  }
  // The constant is KEPT as the record of why the branch exists; it must be named so nobody renders it.
  if (recSrc && !/AMBIGUOUS_INTERNAL_DO_NOT_RENDER/.test(recSrc)) {
    findings.push(`(D5) ${RECOVERY} no longer marks the ambiguity copy as internal. The name is the warning: a bare \`AMBIGUOUS\` invites the next author to render it, which is exactly what happened.`)
  }
  // The ambiguous branch must still EXIST — dropping the refusal would be a different, worse defect.
  // ⛔ ASSERT THE RETURN, NOT THE WORD. The first version grepped /'ambiguous'/ over the whole file and
  // went GREEN when the branch was deleted, because the TYPE UNION on line 20 still contains the string.
  // Caught by firing the failure path; it would never have been caught by reading the guard.
  if (recSrc && !/return\s*\{\s*status:\s*'ambiguous'/.test(strip(recSrc))) {
    findings.push(`(D5) ${RECOVERY} no longer returns status 'ambiguous'. Refusing to guess between two new answers is CORRECT and must survive; only its copy was the problem.`)
  }
}

// ── (D2) SEND MUST ALWAYS LAND ON THE USER'S OWN TURN ─────────────────────────────────────────────
{
  const scrollSrc = strip(read(SCROLL))
  const threadSrc = strip(read(THREAD))
  if (!/const forceBottom = /.test(scrollSrc)) {
    findings.push(`(D2) ${SCROLL} exposes no forceBottom. \`setPin(true)\` alone does NOT scroll: the next followBottom() calls stillFollowing(), which re-checks \`getY() < lastAutoYRef.current - 4\` — still true after the user scrolled up — so it un-pins again and refuses. The pin is set and cancelled in the same breath.`)
  } else {
    // The whole point is resetting the POSITION MEMORY, not just the flag.
    const fn = (scrollSrc.match(/const forceBottom = [\s\S]*?\n  \}/) || [''])[0]
    if (!/lastAutoYRef\.current\s*=\s*-1/.test(fn) || !/setPin\(true\)/.test(fn) || !/bottom\(/.test(fn)) {
      findings.push(`(D2) forceBottom does not reset \`lastAutoYRef\`. Resetting the pin without clearing the position memory leaves \`userMovedUp()\` still true, so the deliberate scroll is cancelled by its own gate — which is the defect verbatim.`)
    }
  }
  if (threadSrc && !/forceBottom\(/.test(threadSrc)) {
    findings.push(`(D2) ${THREAD} never calls forceBottom, so sending does not scroll to the sent message when the user has scrolled up.`)
  }
  // BOTH send paths, or one of them stays broken.
  if (threadSrc && /<textarea/.test(threadSrc)) {
    // ⛔ ANCHOR ON THE SEND BUTTON, NOT ON "the first onClick that calls send(". The first version
    // matched the SUGGESTION button — which legitimately forces the scroll — so the real send button was
    // never inspected and the leg passed with it broken. Found by firing the failure path.
    const sendBtn = (threadSrc.match(/<button[\s\S]{0,400}?aria-label="Send"/) || [''])[0]
    if (sendBtn && !/forceBottom/.test(sendBtn)) {
      findings.push(`(D2) the SEND BUTTON does not force the scroll.`)
    }
    const keyPath = (threadSrc.match(/onKeyDown=\{[\s\S]{0,600}?\}\}/) || [''])[0]
    if (keyPath && !/forceBottom/.test(keyPath)) {
      findings.push(`(D2) the ENTER-TO-SEND path does not force the scroll. The keyboard path and the button path must agree, or one of them stays broken and only some users see it.`)
    }
  }
}

if (findings.length) {
  console.error(`[chat-screen-tracks-server] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  · ${f}`)
  process.exit(1)
}
console.log('[chat-screen-tracks-server] PASS — the thread re-reads on visibility/focus behind a watermark with no polling, the ambiguity copy is internal and unrenderable while the refusal survives, and both send paths force the scroll by clearing the position memory. LORAMER_CHAT_SCREEN_TRACKS_SERVER_V1')
