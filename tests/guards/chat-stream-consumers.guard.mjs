#!/usr/bin/env node
// LORAMER_CHAT_STREAMING_CONSUMERS_GUARD_V1
//
// FAILS if /api/chat can stream while any consumer still reads its body with a blocking res.json().
//
// THE BUG IT GUARDS: recon (2026-07-25) enumerated THREE consumers — ChatLauncher.tsx and the two legacy
// dashboard call sites — all reading `await res.json()`. A streamed body read that way yields a parse error or a
// silent empty answer. The legacy pair is the dangerous half: middleware bounces most users away from it, so it
// is exactly the surface that breaks without anyone noticing until a cohort member hits it.
//
// IT ACTIVATES OFF THE ROUTE'S OWN SHAPE, not off a date or a flag value: if src/app/api/chat/route.ts contains a
// branch that can return `text/event-stream`, every consumer must use the dual-mode reader. Delete the streaming
// branch and this guard goes quiet on its own. Add a FOURTH consumer with res.json() and it fails.
//
// ⚠ CEILING — STATED, NOT IMPLIED. This is a static check. It can prove a consumer does not call res.json(); it
// CANNOT prove the replacement reader handles partial chunks, a mid-stream `error` event, an idle-gap abort, or a
// frame split across two reads. Those are Gate-A's job and were proven there. A guard that claimed otherwise
// would be the "unenforceable guard that manufactures false confidence" the FIX-WITH-GUARD law warns about —
// so the scope is deliberately narrow and honest rather than broad and reassuring.
//
// HERMETIC: filesystem reads only.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join, relative } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const ROUTE = resolve(ROOT, 'src/app/api/chat/route.ts')
const SRC = resolve(ROOT, 'src')
const READER = 'readChatResponse'

const read = (p) => { try { return readFileSync(p, 'utf8') } catch { return null } }
const failures = []
const route = read(ROUTE)
if (!route) { console.error('FAIL: cannot read src/app/api/chat/route.ts'); process.exit(1) }

// Does the route have a streaming branch at all?
const canStream = /text\/event-stream/.test(route)
if (!canStream) {
  console.log('chat-stream-consumers.guard: PASS — /api/chat has no streaming branch; nothing to enforce.')
  process.exit(0)
}

// Walk src/ for every consumer of /api/chat.
const files = []
;(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    const st = statSync(p)
    if (st.isDirectory()) walk(p)
    else if (/\.(ts|tsx)$/.test(p)) files.push(p)
  }
})(SRC)

const consumers = []
for (const f of files) {
  if (f === ROUTE) continue
  const src = read(f)
  if (!src || !/fetch\(\s*['"]\/api\/chat['"]/.test(src)) continue
  consumers.push({ file: relative(ROOT, f), src })
}

if (consumers.length === 0) {
  failures.push('NO CONSUMERS FOUND: the route can stream but no fetch("/api/chat") call site was located. The guard cannot verify anything — treat as failure, never a silent pass.')
}

for (const c of consumers) {
  // For each /api/chat fetch, inspect the window after it for a blocking body read.
  for (const m of c.src.matchAll(/fetch\(\s*['"]\/api\/chat['"]/g)) {
    const win = c.src.slice(m.index, m.index + 2500)
    const usesReader = win.includes(READER)
    const usesJson = /await\s+res(ponse)?\.json\(\)/.test(win)
    if (!usesReader && usesJson) {
      failures.push(`${c.file}: reads /api/chat with a blocking res.json() while the route can return text/event-stream. A streamed body read this way yields an empty or unparseable answer. Use ${READER}() — it branches on the response's own content-type and is byte-identical to res.json() when streaming is off.`)
    } else if (!usesReader && !usesJson) {
      failures.push(`${c.file}: calls /api/chat but the guard cannot see how it reads the body. Route the read through ${READER}() so the streaming/blocking branch is inspectable.`)
    }
  }
}

// The reader itself must actually branch on content-type — otherwise the migration is cosmetic.
const readerSrc = read(resolve(ROOT, 'src/lib/chat-stream-read.ts'))
if (!readerSrc) failures.push('src/lib/chat-stream-read.ts is MISSING — the dual-mode reader every consumer is required to use does not exist.')
else if (!/content-type/i.test(readerSrc) || !/getReader\(\)/.test(readerSrc)) {
  failures.push('chat-stream-read.ts does not branch on content-type AND read a stream — a reader that cannot do both is not dual-mode, so consumers only appear migrated.')
}

if (failures.length) {
  console.error('\n❌ LORAMER_CHAT_STREAMING_CONSUMERS_GUARD_V1 FAILED\n')
  failures.forEach((f) => console.error('  • ' + f))
  console.error(`\n  consumers found: ${consumers.length}\n`)
  process.exit(1)
}
console.log(`chat-stream-consumers.guard: PASS — route can stream; all ${consumers.length} /api/chat consumer(s) route their body read through ${READER}(), which branches on content-type. (Static check: does NOT prove partial-chunk handling — see header.)`)
