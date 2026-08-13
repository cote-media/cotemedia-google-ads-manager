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

// ⛔ RE-POINTED 2026-08-05 BY LORAMER_CHAT_SHARED_THREAD_V1, AND NOT WEAKENED BY ONE ASSERTION.
// The message list, bubbles, markdown, composer, input, send button, jump-to-bottom and ALL scroll
// behaviour moved OUT of the two containers and into the shared surface (LoraThread.tsx +
// lora-thread.module.css + use-stick-to-bottom.ts). Every property this guard tests is still required
// and still true — it simply lives in a different file now, so the sources are CONCATENATED rather than
// swapped. Nothing that had to be present may go missing; a rule satisfied from the shared file is
// satisfied for BOTH surfaces, which is stronger than the per-surface version this replaces.
// ⛔ THE CONTAINMENT HALF — that each container still MOUNTS the shared surface — is asserted by
// tests/guards/lora-thread-shared.guard.mjs, which red-proves on a deleted mount. Neither guard is
// sufficient alone and that split is deliberate.
const sharedCss = read('src/components/redesign/lora-thread.module.css')
const sharedTsx = read('src/components/redesign/LoraThread.tsx') + read('src/lib/next/use-stick-to-bottom.ts')
const chat = read('src/components/redesign/chat.module.css') + sharedCss
const page = read('src/app/dashboard-next/lora/lora-page.module.css') + sharedCss
const pageTsx = read('src/app/dashboard-next/lora/LoraPageClient.tsx') + sharedTsx
const shell = read('src/components/redesign/redesign.module.css')
const launcher = read('src/components/redesign/ChatLauncher.tsx') + sharedTsx
if (!sharedCss || !sharedTsx) { console.error('FAIL: the shared chat surface (LoraThread + lora-thread.module.css + use-stick-to-bottom) is missing — every rule below moved there.'); process.exit(1) }
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
// SAME TRAP, TSX EDITION — and it caught this guard on its own first run. The banned pattern below is
// `className="ti …"`, and the fix comments in LoraPageClient.tsx QUOTE that string to explain why it
// is banned. A guard that fires on the documentation of a rule is not checking the rule (the CSS half
// of this file learned it first). `//` is only a comment when it is not part of a `://` URL.
const stripTs = (src) => (src || '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

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
if (!rules(chat, 'composerShared').some((b) => /flex-shrink\s*:\s*0/.test(b))) {
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
  // ⛔ WIDENED TO ACCEPT A var() FALLBACK, AND THAT IS STRICTER OVERALL, NOT LOOSER. This demanded
  // `var(--accent)` with NO fallback while lora-thread-shared.guard.mjs REQUIRES one — both chat
  // surfaces sever custom-property inheritance (the page renders outside Shell, the shelf is portaled
  // out of `.root`), so a bare var() there resolves to NOTHING, which is exactly how the send button
  // became a white glyph in a transparent circle on a white bar. Two guards contradicting each other is
  // a defect in the pair. The token stays mandatory here; the fallback is mandatory there.
  if (!rules(page, 'send').concat(rules(page, 'sendBtn')).some((b) => /background\s*:\s*var\(--accent[,)]/.test(b))) {
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
    // ⛔ RE-POINTED, NOT RELAXED. The effect that re-scrolls on a new message now lives in
    // useStickToBottom, which receives those three values as `watch` rather than naming them — so the
    // literal dep array cannot exist any more, by construction. The PROPERTY is unchanged: an effect
    // keyed on message/loading/status change must run the pin-aware scroll. The pre-extraction spelling
    // still satisfies it, so this cannot hide a regression back to the old shape.
    ['on new message', /\}, \[(?:messages, loading, streamStatus|active, \.\.\.watch)\]\)/],
    // Behaviour, not shape: onFocus must run the probe AND scroll. The exact one-liner changed when
    // the focus handler learned that the keyboard arrives after focus, and a shape-pinned regex failed
    // on the improvement — second time tonight, so this one matches what must be TRUE.
    // (`bottom(` matches followBottom( too — the focus scroll became pin-aware in
    // LORAMER_LORA_PAGE_STICK_TO_BOTTOM_V1 and both spellings are a scroll-to-bottom.)
    // ⛔ ANCHOR MOVED 2026-08-13 (LORAMER_GEO_PROBE_DISARMED_V1), SEEN RED FIRST: `onComposerFocus()` was
    // the probe's focus hook and was removed with the probe family. THE PROPERTY IS UNCHANGED — focusing
    // the composer must still scroll to the newest message — and the anchor is now the scroll call itself,
    // the callee, not the removed probe beside it (★GUARD-LOCATORS-PIN-TODAYS-CALL-SITE: anchor on the
    // callee, never the neighbour).
    ['on composer focus', /onFocus=\{\(\) => \{[\s\S]{0,160}[bB]ottom\(/],
  ]) {
    if (!re.test(pageTsx)) fail(`THE LORA PAGE DOES NOT SCROLL TO BOTTOM ${what}. iOS does NOT do this for us — measured: clearance -2013 at scrollY 149, -761 at 1475, +308 only at the document bottom.`)
  }

  // ── 7a. STICK-TO-BOTTOM: AUTO-SCROLL MAY NEVER OVERRIDE A DELIBERATE USER SCROLL ────────────────
  // THE BUG (2026-07-27, Russ, "worst one"): every auto-scroll was unconditional, so scrolling up to
  // read history got yanked back down. THE CLASS: any NEW auto-scroll added to this page must be
  // pin-aware too — which is why this checks that the pin exists AND that the two known automatic
  // callers go through it, rather than checking one line.
  if (!/pinnedRef/.test(pageTsx) || !/const followBottom =/.test(pageTsx)) {
    fail('THE LORA PAGE HAS NO STICK-TO-BOTTOM PIN. Auto-scroll must follow the bottom ONLY while the user is already near it; an auto-scroll that overrides a deliberate upward scroll is worse than no auto-scroll (Russ, 2026-07-27).')
  }
  // ⛔ RE-POINTED, NOT RELAXED (LORAMER_CHAT_SHARED_THREAD_V1). These three anchors were written against
  // LoraPageClient's ORIGINAL text and cannot survive an extraction by construction: the scroll listener
  // no longer targets `window` by name (the shared machine binds to `el() ?? window` so ONE
  // implementation drives the document AND the shelf's element), and the new-message effect no longer
  // carries the literal dep array `[messages, loading, streamStatus]` because the hook receives them as
  // `watch`. THE ASSERTIONS ARE IDENTICAL — a scroll listener must exist, and the new-message scroll must
  // go through the pin — only the shape they look for has moved. Every OTHER leg in this file was left
  // untouched and passes against the extracted code unchanged.
  if (!/addEventListener\('scroll'/.test(pageTsx)) {
    fail('NOTHING WATCHES THE SCROLL POSITION, so the pin can never be released or restored. Track it: unpin when the user moves upward, re-pin when they return to the bottom.')
  }
  // MEASURED 2026-07-27: globals.css sets `html { scroll-behavior: smooth }`, and `behavior: 'auto'`
  // means "use the computed scroll-behavior" — so every scroll this page called instant was ANIMATED,
  // still moving 3.7s later on a 26,677px thread. 'instant' is the only value that ignores the CSS.
  if (/scroll-behavior\s*:\s*smooth/.test(strip(read('src/app/globals.css') || '')) && /behavior:\s*'auto'/.test(stripTs(pageTsx))) {
    fail("THE LORA PAGE SCROLLS WITH behavior:'auto' WHILE globals.css SETS `html { scroll-behavior: smooth }`. 'auto' defers to the CSS, so the scroll is ANIMATED — measured still moving 3.7 SECONDS later on a 26,677px thread, under the user's finger. Use 'instant' where instant is meant.")
  }
  // A pin that governs only the DECISION to scroll, and not the scrolls already scheduled, is not a
  // pin. Gate-A measured this: a settle at the bottom scheduled a +250ms retry, the user scrolled up
  // and correctly unpinned inside that window, and the orphaned timer dragged them back anyway.
  const bottomFn = (pageTsx.match(/const bottom = \([\s\S]*?\n  \}\n/) || [''])[0]
  if (!/requestAnimationFrame\(\(\) => \{ if \(stillFollowing\(\)\)/.test(bottomFn) || !/setTimeout\(\(\) => \{ if \(stillFollowing\(\)\)/.test(bottomFn)) {
    fail('THE DEFERRED SCROLL RETRIES DO NOT OBEY THE PIN. `bottom()` fires three times to survive late markdown layout; if the rAF and +250ms shots run unconditionally, a user who scrolls up inside that window is dragged back by a scroll they already cancelled — measured on a 23,548px thread, every time.')
  }
  // ⚠ AND THE GATE MAY NOT BE THE REACT PIN ALONE. INSTRUMENTED IN WEBKIT: after a scroll to the top,
  // the ResizeObserver fired at t+111ms and the `scroll` EVENT did not arrive until t+134ms — so a
  // gate that learns the user's position only from the event reads a stale `true` in between and
  // scrolls them back. The synchronous truth is "is the view now above where WE last put it".
  if (!/const stillFollowing = \(\)/.test(pageTsx) || !/lastAutoYRef/.test(pageTsx) || !/const userMovedUp = \(\)/.test(pageTsx)) {
    fail('THE FOLLOW GATE HAS NO SYNCHRONOUS POSITION CHECK. The scroll event LAGS (measured 134ms vs a ResizeObserver at 111ms), so a pin updated only from that event is stale exactly when it matters. Record where the last automatic scroll put the view and compare against it in the same tick.')
  }
  if (!/new ResizeObserver\(/.test(pageTsx)) {
    fail('NOTHING RE-GLUES THE VIEW WHILE CONTENT IS STILL GROWING. A hydrated markdown thread lays out after our last retry — measured landing 64px short on open and 1,294px short after an answer — so a pinned view must follow the list resizing, not just fire three scrolls inside 250ms.')
  }
  // The NEW-MESSAGE effect and the KEYBOARD-ARRIVAL handler are the two automatic scrolls. Both must
  // be pin-aware. A bare `bottom(` in either is the regression.
  const msgEffect = (pageTsx.match(/const didInitialScroll[\s\S]*?\}, \[(?:messages, loading, streamStatus|active, \.\.\.watch)\]\)/) || [''])[0]
  if (!/followBottom\(/.test(msgEffect)) {
    fail('THE NEW-MESSAGE AUTO-SCROLL IS NOT PIN-AWARE. A new message arriving while the user is reading history must NOT yank the view to the bottom.')
  }
  // ⛔ LOCATOR REPAIRED 2026-08-07 — ★GUARD-LOCATORS-PIN-TODAYS-CALL-SITE, FOURTH TIME. This anchored on
  // `removeEventListener('resize', apply)` — the ARGUMENT LIST — so renaming the handler to `onResize`
  // (to stamp WHICH event fired, for LORAMER_COMPOSER_VV_PROBE_V1) broke it while the property it
  // protects was untouched. THE PROPERTY IS UNCHANGED AND IS NOT RELAXED: the visualViewport effect
  // must still contain a pin-aware `followBottom(`. Only the anchor moved, from the handler's NAME to
  // the CALLEE (`removeEventListener('resize'`), which is the banked rule: anchor on the callee, never
  // on the argument list.
  // ⛔ AND THE REPAIR WENT FURTHER THAN THE RENAME, BECAUSE THE OLD ANCHOR HAD BEEN GREEN FOR THE WRONG
  // REASON SINCE bb84bc1. `pageTsx` is LoraPageClient CONCATENATED WITH the shared thread, and bb84bc1
  // added a SECOND `const vv = typeof window` to LoraPageClient (the header's own visualViewport
  // effect, which correctly has no followBottom). The old non-greedy match therefore STARTED in the
  // header's effect and only reached a `followBottom(` by running past the file boundary into the
  // thread's effect — it was asserting across two unrelated effects and passing by accident.
  // ANCHORED ON THE PROPERTY INSTEAD: the effect that OWNS the keyboard arrival is the one that writes
  // `--lora-kb-inset`, and that is what must also contain the pin-aware scroll. Identifier-independent,
  // and it can no longer match the wrong effect. ★GUARD-LOCATORS-PIN-TODAYS-CALL-SITE, fourth instance.
  const vvEffect = (pageTsx.match(/setProperty\('--lora-kb-inset'[\s\S]*?removeEventListener\('resize'/) || [''])[0]
  if (!/followBottom\(/.test(vvEffect)) {
    fail('THE KEYBOARD-ARRIVAL SCROLL IS NOT PIN-AWARE. Russ called this one out by name: the visualViewport-resize scroll must obey the same rule as every other auto-scroll.')
  }

  // ── 7b. THE STICKY COMPOSER AND ITS KEYBOARD INSET ─────────────────────────────────────────────
  // Russ: the composer must stay visible at every scroll position. The ONLY sanctioned way to do that
  // here is `position: sticky` with a bottom inset — fixed is banned (checked above, and it is the
  // pattern six overlay attempts died on).
  const composerRules = rules(page, 'composer')
  if (!composerRules.some((b) => /position\s*:\s*sticky/.test(b))) {
    fail('THE COMPOSER IS NOT STICKY. At the end of the document it is only visible when the thread is scrolled to the bottom, so reading history means scrolling all the way back down to type.')
  }
  // ⛔ LOCATOR REPAIRED 2026-08-07, AND THE PROPERTY IS DELIBERATELY UNCHANGED — read this before
  // assuming a guard was weakened to fit new code. This pinned the VARIABLE NAME `--lora-kb-inset`.
  // LORAMER_COMPOSER_SIGNED_OFFSET_V1 moved the composer onto `--lora-composer-bottom` because
  // `--lora-kb-inset` is THRESHOLDED (`raw > 100 ? raw : 0`) and therefore discards the NEGATIVE offsets
  // a collapsing toolbar produces — measured −90 against this repo's own device values.
  // WHAT THIS ASSERTION ACTUALLY PROTECTS, quoted from its own failure text: a VAR (not a hardcoded
  // bottom, which cannot lift clear of the keyboard) WITH A 0px FALLBACK (so no-JS / no-visualViewport /
  // a stale value degrades to the layout-viewport bottom, the geometry already proven on device).
  // BOTH CLAUSES STILL HOLD and are still enforced; the name is no longer part of the claim. That the
  // var is DERIVED FROM THE VISUAL VIEWPORT is asserted by chat-visual-viewport.guard leg (k), which was
  // strengthened in the same commit — so nothing that was checked here has become unchecked anywhere.
  if (!composerRules.some((b) => /bottom\s*:\s*var\(--[\w-]+,\s*0px\)/.test(b))) {
    fail('THE COMPOSER DOES NOT PIN TO `bottom: var(--…, 0px)`. The default of 0 is load-bearing: with no JS, no visualViewport, or a stale value the composer must degrade to the bottom of the layout viewport, which is the geometry already proven on device. A hardcoded bottom cannot lift clear of the keyboard; a var with no fallback resolves to nothing.')
  }
  if (!/--lora-kb-inset/.test(pageTsx) || !/visualViewport/.test(pageTsx)) {
    fail('NOTHING SETS `--lora-kb-inset`. The inset must be measured from visualViewport (docH - offsetTop - vvH), or the sticky composer pins to the layout-viewport bottom, which the iOS keyboard occludes.')
  }
  // The lift paints over the tail of the list unless the list grows by the same amount.
  if (!rules(page, 'list').some((b) => /padding[^;]*var\(--lora-kb-inset/.test(b))) {
    fail('THE LIST DOES NOT COMPENSATE FOR THE COMPOSER LIFT. A composer pulled up by the keyboard inset paints over the last N px of the thread — the newest turn, the one being answered — unless the list gains the same padding.')
  }

  // ── 7c. JUMP-TO-BOTTOM — what makes unpinning safe ─────────────────────────────────────────────
  if (!/aria-label="Jump to latest"/.test(pageTsx)) {
    fail('NO JUMP-TO-BOTTOM AFFORDANCE. Once auto-scroll stops following the user, the only way back to the newest turn is scrolling a 20,000px thread by hand.')
  }
  if (!rules(page, 'jump').some((b) => /position\s*:\s*absolute/.test(b))) {
    fail('THE JUMP-TO-BOTTOM BUTTON IS NOT `position: absolute` INSIDE THE STICKY COMPOSER. A floating button is the obvious place to reach for position:fixed — which is banned on this page. Riding the composer gives it the keyboard lift for free and no geometry of its own.')
  }

  // ── 7d. NOTHING ON THIS PAGE MAY DEPEND ON A SHELL-PROVIDED STYLESHEET ─────────────────────────
  // THE BUG (2026-07-27): the back button rendered `<i class="ti ti-chevron-left">`, but the Tabler
  // webfont is linked from a single <link> inside Shell and this page renders WITHOUT Shell. The
  // glyph never existed, and a transparent borderless button with no content is invisible.
  // THE CLASS, and it is the SECOND instance: rendering outside Shell silently drops whatever Shell
  // provided. First the CSS custom properties (the invisible send button), then the icon font.
  // ⚠ THE CLASS ENFORCER, not just today's instance. ENUMERATED 2026-07-27 (Russ's instruction): what
  // does Shell actually provide that a Shell-less page silently loses?
  //   1. the `.root` CSS custom-property scope  → guarded above (`shell.tokens` must be carried)
  //   2. the Tabler icons webfont <link>        → Shell-ONLY, and it is what made the back button vanish
  //   3. Instrument Sans                        → NOT at risk: globals.css:5 @imports it app-wide
  //   4. TopBar / rail / MobileNav / ChatLauncher → chrome, dropped ON PURPOSE for a full-screen chat
  //   5. the auth + onboarding gate             → never was Shell's; it is dashboard-next/layout.tsx
  // So the standing rule is: every stylesheet Shell loads that is NOT also loaded globally is a
  // Shell-only provision, and a Shell-less page may not depend on one. If Shell gains another, this
  // fails until someone decides — deliberately — whether the page needs it.
  const shellSrc = read('src/components/redesign/Shell.tsx') || ''
  const globalsSrc = (read('src/app/globals.css') || '') + (read('src/app/layout.tsx') || '')
  const shellOnlyHrefs = [...shellSrc.matchAll(/rel="stylesheet"\s+href="([^"]+)"|href="([^"]+)"\s+rel="stylesheet"/g)]
    .map((m) => m[1] || m[2])
    .filter((h) => {
      const family = (h.match(/family=([^&:]+)/) || [])[1]
      return !globalsSrc.includes(h) && !(family && globalsSrc.includes(family.replace(/\+/g, ' ')))
    })
  const KNOWN_SHELL_ONLY = ['tabler-icons']
  const unaccounted = shellOnlyHrefs.filter((h) => !KNOWN_SHELL_ONLY.some((k) => h.includes(k)))
  if (unaccounted.length) {
    fail(`SHELL LOADS ${unaccounted.length} STYLESHEET(S) THAT NOTHING ELSE LOADS, AND THEY ARE NOT ACCOUNTED FOR: ${unaccounted.join(', ')}. /dashboard-next/lora renders WITHOUT Shell, so anything only Shell provides is silently absent there — twice already (the CSS custom properties, then the icon font). Decide explicitly whether the page depends on this, then add it to KNOWN_SHELL_ONLY with the reason.`)
  }
  if (/className="ti |className=\{`ti |class="ti /.test(stripTs(pageTsx))) {
    fail('THE LORA PAGE USES THE `ti` ICON WEBFONT. It is linked ONLY from Shell.tsx and this page renders OUTSIDE Shell, so every such glyph is an empty element — which is exactly why Russ reported "there is no back button" on a button that was in the DOM and in bounds. Use inline SVG; depend on nothing handed down.')
  }
  if (!/<svg /.test(pageTsx)) {
    fail('THE LORA PAGE RENDERS NO INLINE SVG. Its icons must be self-contained — see above.')
  }
  // The close affordance must paint something of its own, not rely on a glyph for its entire bulk.
  if (!rules(page, 'back').some((b) => /background\s*:\s*var\(--/.test(b)) || !rules(page, 'back').some((b) => /width\s*:\s*\d+px/.test(b))) {
    fail('THE CLOSE BUTTON HAS NO SURFACE AND NO SIZE OF ITS OWN. It was `background:none; border:none; padding:4px` around a glyph that did not render — roughly 8px of nothing. Give it its own box so its visibility never depends on its contents.')
  }
  // Behaviour, not shape (third time this file has been bitten by a shape-pinned regex): there must be
  // a next-frame retry AND a delayed retry. How they are spelled changed when they learned to obey the
  // pin.
  if (!/requestAnimationFrame\(/.test(pageTsx) || !/setTimeout\([\s\S]{0,60}, 250\)/.test(pageTsx)) {
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
