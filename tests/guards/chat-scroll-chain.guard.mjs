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
const page = read('src/app/dashboard-next/lora/lora-page.module.css')
const pageTsx = read('src/app/dashboard-next/lora/LoraPageClient.tsx')
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
// STRIP COMMENTS BEFORE SCANNING. Without this the guard matches its own subject matter: the page CSS
// carries "⛔ NOTHING position:fixed" and "⛔ NO dvh ANYWHERE" as comments explaining WHY they are
// banned, and a naive scan reads those as violations. A guard that fires on the documentation of a
// rule is not checking the rule.
const strip = (css) => (css || '').replace(/\/\*[\s\S]*?\*\//g, '')

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

// ── 7. THE PAGE CHAIN (LORAMER_LORA_PAGE_V1) ──────────────────────────────────────────────────────
// Mobile Lora is a SECOND surface over the same engine. A guard that only covered the shelf would
// silently guard half the product the moment the page shipped — which is exactly the gap that let an
// invisible send button live in production for five and a half hours.
if (!page || !pageTsx) {
  fail('CANNOT READ the /dashboard-next/lora page sources — the page half of the chat surface is unguarded. Treat as failure, never a pass.')
} else {
  // The page is validated on DOCUMENT-flow scrolling. A scroll container in its chain would pin the
  // composer to that container's height, which is the overlay pattern that failed six times.
  const pageScrollers = ['page', 'list', 'composer', 'head'].filter((c) => rules(page, c).some(scrolls))
  if (pageScrollers.length) {
    fail(`THE LORA PAGE HAS ${pageScrollers.length} SCROLL CONTAINER(S) (${pageScrollers.join(', ')}). The page works BECAUSE the document scrolls — a scroller here pins the composer to its height and reintroduces the overlay geometry the probe was built to escape.`)
  }
  if (/position\s*:\s*fixed/.test(strip(page))) {
    fail('THE LORA PAGE USES position:fixed. Six overlay attempts died on hand-positioned geometry; the page must stay in normal flow.')
  }
  if (/\bdvh\b/.test(strip(page))) {
    fail('THE LORA PAGE USES dvh. The 874 finding: on iOS dvh resolves to the LARGE viewport (874) while documentElement.clientHeight is the small one (766), so a dvh-sized surface overhangs before the keyboard is involved.')
  }
  if (!rules(page, 'input').some((b) => /font-size\s*:\s*16px/.test(b))) {
    fail('THE LORA PAGE INPUT IS NOT 16px. iOS auto-zooms any focused input under 16px — MEASURED at 1.1431818x (LORAMER_NEXT_CHAT_INPUT_16PX_V1).')
  }
  if (!rules(page, 'send').some((b) => /background\s*:\s*var\(--accent\)/.test(b))) {
    fail('THE LORA PAGE SEND BUTTON does not use var(--accent) — check it has a visible background at all.')
  }
  // The page renders OUTSIDE Shell, so it is outside `.root` and inherits the portal trap.
  if (!/shell\.tokens/.test(pageTsx)) {
    fail('THE LORA PAGE DOES NOT CARRY `.tokens`. It renders outside <Shell>, therefore outside `.root`, so every var(--) resolves to nothing and every colour dies exactly as the send button did (LORAMER_PORTAL_SEVERS_CSS_VARS_V1).')
  }
  // The probe FALSIFIED "iOS scrolls the focused input into view". Scroll is ours to manage.
  // Pinned to BEHAVIOUR, not to a one-liner's exact shape: the mount effect grew (it now also takes
  // scrollRestoration off the browser), and a guard that only matched the original single line failed
  // on an improvement. Match the things that must be TRUE, not the way they were first written.
  for (const [what, re] of [
    ['on mount', /history\.scrollRestoration = 'manual'[\s\S]{0,400}bottom\(\)/],
    ['on new message', /\}, \[messages, loading, streamStatus\]\)/],
    // Behaviour, not shape: onFocus must run the probe AND scroll. The exact one-liner changed when
    // the focus handler learned that the keyboard arrives after focus, and a shape-pinned regex failed
    // on the improvement — second time tonight, so this one matches what must be TRUE.
    ['on composer focus', /onFocus=\{\(\) => \{[\s\S]{0,120}onComposerFocus\(\)[\s\S]{0,120}bottom\(/],
  ]) {
    if (!re.test(pageTsx)) fail(`THE LORA PAGE DOES NOT SCROLL TO BOTTOM ${what}. iOS does NOT do this for us — measured: clearance -2013 at scrollY 149, -761 at 1475, +308 only at the document bottom.`)
  }
  if (!/requestAnimationFrame\(go\)/.test(pageTsx) || !/setTimeout\(go/.test(pageTsx)) {
    fail('THE LORA PAGE SCROLLS ONLY ONCE PER CHANGE. A hydrated markdown thread is not laid out at commit time — measured 22,784px of content settling after React commits — so a single scroll lands against a stale scrollHeight and the page sits at the top. Scroll again on the next frame and after a beat.')
  }
  // A full-screen page with no visible exit is a trap. router.back() alone is not an exit: on a fresh
  // load there is nothing to go back to and the tap silently does nothing.
  if (!/aria-label="Close Lora"/.test(pageTsx) || !/new URL\(document\.referrer\)\.origin === window\.location\.origin/.test(pageTsx)) {
    fail('THE LORA PAGE HAS NO RELIABLE EXIT. It needs a visible close affordance AND a same-origin-referrer test with a real fallback route — history.length counts the whole tab, so back can exit the app entirely (measured: it landed on about:blank) — otherwise a fresh load traps the user on a full-screen surface.')
  }
  // The keyboard arrives AFTER focus on iOS; only visualViewport resize marks its arrival.
  if (!/visualViewport/.test(pageTsx) || !/addEventListener\('resize'/.test(pageTsx)) {
    fail('THE LORA PAGE DOES NOT SCROLL ON KEYBOARD ARRIVAL. focus fires before the keyboard animates in, so a focus-only scroll runs against a full-height viewport and is undone — it passes in headless (no keyboard) and fails on device.')
  }
  if (!/env\(safe-area-inset-top/.test(page) || !/env\(safe-area-inset-bottom/.test(page)) {
    fail('THE LORA PAGE IS MISSING a safe-area inset (top and bottom are both required on a full-screen surface).')
  }
}

// ── 8. NO TRANSPORT / PANEL LANGUAGE IN USER-FACING COPY ──────────────────────────────────────────
// Two problems, both real: "reopen this panel" is factually FALSE on a page, and strings that narrate
// the client's own transport read as the machinery talking rather than as Lora.
const recovery = read('src/lib/next/chat-recovery.ts')
if (!recovery) {
  fail('CANNOT READ chat-recovery.ts — the user-facing copy is unguarded.')
} else {
  const copyBlock = (recovery.match(/export const COPY = \{[\s\S]*?\n\}/) || [''])[0]
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  for (const [what, re] of [
    ['panel/shelf/overlay language', /\b(panel|shelf|overlay)\b/i],
    ['a claim that the answer was lost', /(answer (was|is) lost|connection dropped before)/i],
    ['an invitation to re-ask', /(ask again|try rephrasing that|re-?send your question\b(?!.*(haven|wasn)))/i],
  ]) {
    if (re.test(copyBlock)) fail(`USER-FACING COPY CONTAINS ${what}. Every string in this surface is Lora speaking, on a PAGE — not a client narrating its own transport, and never a claim the client cannot verify.`)
  }
  if (!/SERVER_ERROR:/.test(copyBlock)) {
    fail('NO SERVER_ERROR STRING. A definite 500 must not render as a connection story — that is the 2026-07-27 defect.')
  }
}

if (failures.length) {
  console.error('\n❌ LORAMER_NEXT_CHAT_FULLSCREEN_GUARD_V1 FAILED\n')
  failures.forEach((f) => console.error('  • ' + f))
  console.error('')
  process.exit(1)
}
console.log(`chat-scroll-chain.guard: PASS — shelf + page. one scroller (.scroll) with overscroll containment, body lock restores prior value, nothing fixed inside .panel, scrim z=${scrimZ} > ${maxOther}, overlay portaled.`)
