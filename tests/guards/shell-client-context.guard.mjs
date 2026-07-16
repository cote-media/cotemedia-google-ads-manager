#!/usr/bin/env node
// LORAMER_SHELL_CLIENT_CONTEXT_GUARD_V1
//
// FAILS if a -next page can serve the WRONG client, or carry one client's state into another.
//
// THE BUG IT GUARDS: the "resolve the client from the validated URL param" rule was fixed on 2026-06-20 and REGRESSED
// three weeks later at team/page.tsx:22 (`const first = (clients||[])[0]`) — because the pattern lived in SIX files and
// nothing could see the seventh. Ask-Lora on Team then answered about the wrong client in PRODUCTION (the 2026-07-15
// 23:28:38 spend row carries Ennis while the URL said Veterinary). Separately, client-profile carried NaicsPicker's
// `query`/`selected` and ClientPage's `gateDraft` across a soft switch (TopBar.tsx:82 keeps the pathname → React reuses
// the subtree → useState survives), pre-ticking the previous client's value-model answers one click from writing them.
//
// BOTH HALVES, or it goes green while the bug is live:
//   (a) SERVER — every Shell-mounting page resolves via the ONE resolver; hand-rolled context FAILS.
//   (b) CLIENT — the mount key exists at SHELL level and is keyed on clientId, so no page can outlive a switch.
// A server-only guard would have passed through the entire profile bleed: the server was right and the CLIENT leaked.
//
// AUTHORITATIVE SOURCE = THE CODE (the filesystem set of pages + their text), never a doc — a doc can be
// honest-but-false (G3: the registry said Google age/gender were "VERIFIED in-code"; zero rows have ever landed).
// HERMETIC: pure filesystem reads. No network, no DB, no writes. Safe in CI/build.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, relative } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const NEXT_DIR = resolve(ROOT, 'src/app/dashboard-next')
const SHELL = resolve(ROOT, 'src/components/redesign/Shell.tsx')
const RESOLVER = resolve(ROOT, 'src/lib/next/shell-client.ts')

const failures = []
const fail = (m) => failures.push(m)
const read = (p) => { try { return readFileSync(p, 'utf8') } catch { return null } }

// Strip comments + string literals before pattern-matching CODE.
// WHY THIS EXISTS: the first run of this guard FALSE-POSITIVED on team/page.tsx — the fix's own comment quotes the old
// buggy expression `(clients||[])[0]` to explain what regressed, and a raw-text regex cannot tell prose from code. A
// guard that fires on a comment is worse than no guard: it trains you to ignore it. Strings go too ('https://…' would
// otherwise look like a line comment). Deliberately simple — it only needs to be right about THIS repo's source.
function codeOnly(src) {
  let out = '', i = 0, n = src.length
  while (i < n) {
    const c = src[i], d = src[i + 1]
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += ' '; i++
      while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++ }
      i++; continue
    }
    out += c; i++
  }
  return out
}

// Recursively collect every page.tsx under dashboard-next (route names are derived, never hardcoded).
function pages(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = resolve(dir, e)
    if (statSync(p).isDirectory()) pages(p, out)
    else if (e === 'page.tsx') out.push(p)
  }
  return out
}

// ── (a) SERVER: every Shell-mounting page resolves client context through the ONE resolver ────────────────────
if (!read(RESOLVER)) fail(`MISSING: ${relative(ROOT, RESOLVER)} — the single client-context resolver does not exist.`)

// The hand-rolled shapes this bug has actually taken. Each is a real regression, not a hypothetical:
//   `[0]` / `.order('created_at')` + index → team/page.tsx:22, the 2026-07-15 wrong-client bug
//   `searchParams.clientId` read raw       → the six pages that each re-implemented validation independently
const HANDROLLED = [
  { re: /\(clients\s*\|\|\s*\[\]\)\[0\]/, why: "resolves `(clients||[])[0]` — the first client by created_at, ignoring the URL (this IS the team/page.tsx:22 bug)" },
  { re: /list\.find\(\(?c\)?\s*=>\s*c\.id === searchParams\.clientId\)/, why: 'hand-rolls the URL-param validation instead of calling resolveShellClient (six copies of this is how the 2026-06-20 fix regressed)' },
  { re: /searchParams[?.]*\.clientId\s*\|\|/, why: 'uses the raw searchParams.clientId without validating it against listAccessibleClients (Lesson 53 — an unvalidated param is an IDOR seam)' },
]

let shellPages = 0, allowlisted = 0
for (const p of pages(NEXT_DIR)) {
  const raw = read(p) || ''
  const src = codeOnly(raw)               // CODE only — comments/strings cannot trigger a finding
  const rel = relative(ROOT, p)
  if (!/<Shell\b/.test(src)) continue // not a Shell page → out of scope
  shellPages++

  const usesResolver = /resolveShellClient\s*\(/.test(src)
  // A genuinely client-less surface (the portfolio) may opt out, but ONLY with an in-file justification naming the guard.
  const isAllowlisted = /LORAMER_SHELL_CLIENT_CONTEXT_V1 — ALLOWLISTED/.test(raw) // marker is a comment → read RAW
  if (isAllowlisted) { allowlisted++; continue }

  if (!usesResolver) {
    fail(`${rel} mounts <Shell> but never calls resolveShellClient — it can serve the WRONG client. Use the resolver, or add an in-file "LORAMER_SHELL_CLIENT_CONTEXT_V1 — ALLOWLISTED" justification if the surface is genuinely client-less.`)
  }
  for (const h of HANDROLLED) {
    if (h.re.test(src)) fail(`${rel} ${h.why}.`)
  }
}
if (shellPages === 0) fail('no <Shell>-mounting pages found — guard cannot be trusted; check NEXT_DIR')

// ── (b) CLIENT: the mount key exists at SHELL level and is keyed on clientId ──────────────────────────────────
const shellSrc = read(SHELL)
if (!shellSrc) fail(`MISSING: ${relative(ROOT, SHELL)}`)
else {
  // The key must wrap {children} and be keyed on clientId — that is what unmounts the subtree on a switch.
  const shellCode = codeOnly(shellSrc)
  const keyed = /key=\{\s*clientId\b[^}]*\}/.test(shellCode)
  if (!keyed) {
    fail(`${relative(ROOT, SHELL)} has NO mount key on clientId — client-scoped component state SURVIVES a client switch (TopBar.tsx:82 is a soft nav that keeps the pathname, so React reuses the subtree). This is the profile state-bleed bug: NaicsPicker's query/selected and ClientPage's gateDraft carried across, one click from writing client A's data onto client B.`)
  } else {
    // ...and it must actually wrap the children, not sit on some unrelated node.
    const wrapsChildren = /key=\{\s*clientId[^}]*\}[\s\S]{0,400}?\{children\}/.test(shellCode)
    if (!wrapsChildren) fail(`${relative(ROOT, SHELL)} has a clientId key but it does not wrap {children} — only a key on the children's subtree remounts the page on a client switch.`)
  }
}

// ── REPORT ────────────────────────────────────────────────────────────────────────────────────────────────────
console.log('LORAMER_SHELL_CLIENT_CONTEXT_GUARD_V1')
console.log(`  Shell-mounting -next pages : ${shellPages} (${allowlisted} allowlisted client-less)`)
console.log(`  single resolver present    : ${read(RESOLVER) ? 'yes' : 'NO'}`)
console.log(`  Shell mount key on clientId: ${shellSrc && /key=\{\s*clientId\b/.test(codeOnly(shellSrc)) ? 'yes' : 'NO'}`)

if (failures.length) {
  console.error('\n✗ GUARD FAILED — a -next surface can serve or corrupt the wrong client:\n')
  for (const f of failures) console.error('  • ' + f)
  console.error('\nWHY THIS MATTERS: the server can be perfectly right and the CLIENT still leak — component state')
  console.error('survives a soft client switch, and the save handlers close over the NEW clientId. Both halves or neither.\n')
  process.exit(1)
}
console.log('\n✓ GUARD PASSED — every Shell page resolves through the one resolver, and the Shell remounts on client switch.')
