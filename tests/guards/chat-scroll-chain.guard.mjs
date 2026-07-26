#!/usr/bin/env node
// LORAMER_NEXT_CHAT_FULLSCREEN_V1 — the chat chain must have EXACTLY ONE vertical scroller, and it
// must contain its own overscroll.
//
// THE BUG IT GUARDS: on 2026-07-26 the -next chat had TWO live vertical scrollers — the message list
// (.scroll) and the document itself, which nothing locked — and no `overscroll-behavior` anywhere in
// the repo's -next chain. Dragging the messages past either edge CHAINED the scroll to the page
// underneath. It also produced the track/thumb mismatch: the visible scrollbar belonged to the
// document, whose scroll range is far larger than the message list's.
//
// IT GUARDS THE CLASS, NOT TODAY'S INSTANCE: add a third scroller anywhere in the chain, drop the
// overscroll containment, drop the body scroll lock, put a position:fixed inside .panel, or let the
// chat scrim's z-index fall back into a tie — any of those fails this.
//
// ⚠ CEILING, STATED: this is a STATIC check over the CSS and the component source. It proves the
// declarations are present and unique. It CANNOT prove what a real browser composites, cannot see
// runtime inline styles, and says NOTHING about the iOS keyboard bleed (unidentified mechanism,
// blocked behind DECISIONS LORAMER_NEXT_CHAT_KEYBOARD_BLEED_V1). Device behaviour is Gate-B's job.
//
// HERMETIC: filesystem reads only. LORAMER_GUARD_ROOT overrides the tree so the guard can be proven
// failing against a pre-fix checkout without touching the working tree.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return null } }
const failures = []
const fail = (m) => failures.push(m)

const chat = read('src/components/redesign/chat.module.css')
const shell = read('src/components/redesign/redesign.module.css')
const launcher = read('src/components/redesign/ChatLauncher.tsx')
if (!chat || !shell || !launcher) { console.error('FAIL: cannot read the chat chain sources'); process.exit(1) }

// Pull `selector { ...body... }` for a class, top-level and inside media queries.
const rules = (css, cls) => {
  const out = []
  const re = new RegExp(`\\.${cls}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, 'g')
  let m
  while ((m = re.exec(css))) out.push(m[1])
  return out
}
const scrolls = (body) => /overflow(-y)?\s*:\s*(auto|scroll)/.test(body)

// ── 1. EXACTLY ONE VERTICAL SCROLLER IN THE CHAIN ─────────────────────────────────────────────────
// The chain, verified 2026-07-26: body > .root > .body > .main > .subheader > .scrim > .panel > .scroll
const CHAIN = [
  ['root', shell], ['body', shell], ['main', shell], ['subheader', shell],
  ['scrim', chat], ['panel', chat], ['scroll', chat], ['head', chat], ['inputBar', chat],
]
const scrollers = CHAIN.filter(([cls, css]) => rules(css, cls).some(scrolls)).map(([c]) => c)
if (scrollers.length !== 1) {
  fail(`CHAT CHAIN HAS ${scrollers.length} VERTICAL SCROLLERS (${scrollers.join(', ') || 'none'}), expected exactly 1. Two live scrollers is how a drag on the message list chained to the page underneath, and how the visible scrollbar came to belong to a different element than the content being dragged.`)
} else if (scrollers[0] !== 'scroll') {
  fail(`THE SCROLLER IS .${scrollers[0]}, NOT .scroll. The message list must be the one that scrolls; header and composer are pinned by flex.`)
}

// A <textarea> is a scroll container BY DESIGN (the composer grows to max-height then scrolls its own
// draft — P-PL#3). That is correct and is not counted as a layout scroller, but it must not CHAIN
// either, so it carries the same containment.
if (!rules(chat, 'input').some((b) => /overscroll-behavior\s*:\s*(contain|none)/.test(b))) {
  fail('THE COMPOSER `.input` HAS NO `overscroll-behavior: contain`. It legitimately scrolls its own draft at max-height, so without containment a scroll gesture that starts in the textarea chains out of it.')
}

// ── 2. THE SCROLLER CONTAINS ITS OWN OVERSCROLL ───────────────────────────────────────────────────
if (!rules(chat, 'scroll').some((b) => /overscroll-behavior\s*:\s*(contain|none)/.test(b))) {
  fail('`.scroll` HAS NO `overscroll-behavior: contain`. Without it the scroll chains to the document at either edge — the exact page-underneath-scrolling defect reported on 2026-07-26.')
}

// ── 3. THE BODY SCROLL LOCK EXISTS AND RESTORES THE PRIOR VALUE ───────────────────────────────────
if (!/document\.body\.style\.overflow\s*=\s*'hidden'/.test(launcher)) {
  fail('NO BODY SCROLL LOCK in ChatLauncher. `overscroll-behavior` stops the chain; the lock stops the document moving at all while a modal sheet is open. Both, or a drag that starts outside .scroll still scrolls the page.')
}
if (!/const prev = document\.body\.style\.overflow/.test(launcher) || !/document\.body\.style\.overflow = prev/.test(launcher)) {
  fail('THE SCROLL LOCK DOES NOT RESTORE THE PRIOR VALUE. Restoring a hardcoded \'\' clobbers whatever else owned body.overflow — a silent regression somewhere else in the app.')
}

// ── 4. NOTHING INSIDE .panel MAY BE position:fixed ────────────────────────────────────────────────
// .panel runs `animation: slideUp` whose keyframe sets a transform, so for 180ms after open .panel IS
// a containing block for fixed descendants. A fixed header/composer would jump on every open.
for (const cls of ['head', 'scroll', 'inputBar', 'md', 'debug', 'bubbleUser', 'bubbleAssistant']) {
  if (rules(chat, cls).some((b) => /position\s*:\s*fixed/.test(b))) {
    fail(`.${cls} USES position:fixed INSIDE .panel. The .panel slideUp keyframe carries a transform, so .panel becomes the containing block for 180ms after open and a fixed child would be positioned against the panel, not the viewport. Pin with flex.`)
  }
}
if (!rules(chat, 'inputBar').some((b) => /flex-shrink\s*:\s*0/.test(b))) {
  fail('.inputBar LOST `flex-shrink: 0`. The composer is held at the bottom BY FLEX; without this it collapses instead of pinning.')
}

// ── 5. THE CHAT SCRIM OUTRANKS EVERY OTHER FIXED LAYER ────────────────────────────────────────────
const scrimZ = Math.max(...rules(chat, 'scrim').map((b) => { const m = b.match(/z-index\s*:\s*(\d+)/); return m ? +m[1] : -1 }), -1)
if (scrimZ < 0) fail('THE CHAT .scrim HAS NO z-index.')
const others = [...shell.matchAll(/z-index\s*:\s*(\d+)/g)].map((m) => +m[1])
const maxOther = others.length ? Math.max(...others) : 0
if (scrimZ <= maxOther) {
  fail(`CHAT SCRIM z-index ${scrimZ} DOES NOT EXCEED the highest -next layer (${maxOther}). At a TIE the winner is decided by DOM source order, which is an accident, not a design — the chat must own the top band outright.`)
}

// ── 6. THE OVERLAY IS PORTALED ────────────────────────────────────────────────────────────────────
if (!/createPortal\(/.test(launcher) || !/document\.body,/.test(launcher)) {
  fail('THE OVERLAY IS NOT PORTALED TO document.body. No ancestor defeats position:fixed today, but a portal makes that permanent rather than a fact that has to be re-verified every time Shell changes.')
}

if (failures.length) {
  console.error('\n❌ LORAMER_NEXT_CHAT_FULLSCREEN_GUARD_V1 FAILED\n')
  failures.forEach((f) => console.error('  • ' + f))
  console.error('')
  process.exit(1)
}
console.log(`chat-scroll-chain.guard: PASS — one scroller (.scroll) with overscroll containment, body lock restores prior value, nothing fixed inside .panel, scrim z=${scrimZ} > ${maxOther}, overlay portaled.`)
