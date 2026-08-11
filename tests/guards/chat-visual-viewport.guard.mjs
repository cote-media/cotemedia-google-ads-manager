#!/usr/bin/env node
// LORAMER_LORA_HEADER_VISUAL_VIEWPORT_V1 + LORAMER_CHAT_COMPOSER_CLIP_V1 — the JS/CSS facts behind the
// 2026-08-07 keyboard flight, pinned so the next edit cannot quietly undo half of them.
//
// ⛔ ITS LIMIT IS ON ITS FACE, AND IT IS THE REASON THIS FILE CANNOT BE THE PROOF: ★CHAT-RENDER-
// MEASUREMENT-MISSING IS OPEN. NOTHING IN THIS REPO RENDERS A PAGE, OPENS A KEYBOARD, OR MEASURES A
// PIXEL. This guard reads TEXT. It can prove that both visualViewport events are subscribed, that a
// dismissal path exists, that every listener is removed, and that the composer cap is derived rather
// than hard-coded. It CANNOT prove the header stays put under a thumb-flick, that the transform lands
// on the right element, or that the composer clips correctly — those are LAYOUT and belong to Gate-B on
// device. A green run here must never be read as "the keyboard case is fixed".
//
// ═══ THE ASSERTIONS ═════════════════════════════════════════════════════════════════════════════════
//   (a) BOTH visualViewport events are subscribed — 'resize' AND 'scroll'. `resize` fires when the
//       keyboard opens or closes; `scroll` is what fires when the user flicks the visual viewport with
//       the keyboard ALREADY UP, which is the failing gesture. Subscribing to one fixes half the defect
//       and looks fixed.
//   (b) a blur/focusout dismissal path exists. developer.apple.com/forums/thread/800154 (iOS 26):
//       visualViewport.offsetTop does NOT reset to 0 after dismissal, so resize alone leaves the
//       element displaced. This is an OPEN vendor bug, not a defensive nicety.
//   (c) every listener added is removed — a cleanup return that unsubscribes both vv events and the
//       focusout. A page this route mounts and unmounts on every navigation leaks otherwise.
//   (d) the composer cap DERIVES from viewport height (a `--lora-composer-max` custom property written
//       from visualViewport, consumed inside a min()), rather than resting on a bare literal.
//   (e) NO dvh anywhere in either stylesheet — this surface bans it (on iOS dvh resolves to the LARGE
//       viewport, so a dvh-sized element overhangs before the keyboard is involved).
//   (f) no maximum-scale / user-scalable — suppressing pinch-zoom is an accessibility regression and
//       does not restore scale on blur anyway.
//
// ⛔ LORAMER_GUARD_ROOT — HANDLED, AND STATED BECAUSE ★GUARD-IGNORES-LORAMER-GUARD-ROOT IS OPEN. That
// defect is a guard resolving to the REAL tree while a throwaway proof believes it read a scratch one,
// which makes the RED half of "seen red" worthless. This guard (1) HONOURS LORAMER_GUARD_ROOT — the RED
// proof for this commit ran against a scratch tree and the findings came from THAT tree; (2) falls back
// MODULE-RELATIVE, never process.cwd(); (3) FAILS CLOSED — an unreadable file is a FAILURE, not a pass.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const PAGE_TSX = 'src/app/dashboard-next/lora/LoraPageClient.tsx'
const PAGE_CSS = 'src/app/dashboard-next/lora/lora-page.module.css'
const THREAD_TSX = 'src/components/redesign/LoraThread.tsx'
const THREAD_CSS = 'src/components/redesign/lora-thread.module.css'
const HOOK_TS = 'src/lib/next/use-lora-chat.ts'
const findings = []

const read = (rel) => {
  try { return readFileSync(resolve(ROOT, rel), 'utf8') }
  catch (e) { findings.push(`UNREADABLE ${rel} under ROOT ${ROOT} — ${e.message}. A guard that cannot read its evidence FAILS; it does not pass.`); return null }
}
// Comments QUOTE the defective forms to teach them; stripping first is mandatory or the guard fails on
// its own documentation. "QUOTATION IS NOT ASSERTION" — banked twice on 2026-07-29.
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const hookTs = read(HOOK_TS)
const pageTsx = read(PAGE_TSX)
const threadTsx = read(THREAD_TSX)
const pageCss = read(PAGE_CSS)
const threadCss = read(THREAD_CSS)

if (pageTsx) {
  const code = strip(pageTsx)

  // ── (a) BOTH EVENTS ───────────────────────────────────────────────────────────────────────────────
  const hasVv = /visualViewport/.test(code)
  if (!hasVv) {
    findings.push(`(a) ${PAGE_TSX} never reads window.visualViewport. The header is position:sticky against the LAYOUT viewport; the keyboard changes the VISUAL one, so without this the header detaches on a thumb-flick.`)
  } else {
    for (const evt of ['resize', 'scroll']) {
      if (!new RegExp(`addEventListener\\(\\s*['"]${evt}['"]`).test(code)) {
        findings.push(`(a) no visualViewport '${evt}' listener in ${PAGE_TSX}. BOTH are required: 'resize' fires when the keyboard opens/closes, 'scroll' fires when the visual viewport is flicked with the keyboard ALREADY UP — which is the failing gesture. One of the two fixes half the defect and looks fixed.`)
      }
    }
  }

  // ── (b) THE DISMISSAL PATH ────────────────────────────────────────────────────────────────────────
  if (!/(focusout|blur)/.test(code)) {
    findings.push(`(b) ${PAGE_TSX} has no focusout/blur path. developer.apple.com/forums/thread/800154 (iOS 26): visualViewport.offsetTop does NOT reset to 0 after keyboard dismissal, so 'resize' alone leaves the header displaced. This is an OPEN vendor bug, not defensive coding.`)
  }

  // ── (g) ONE OWNER PER KEYBOARD STATE — LORAMER_LORA_HEADER_ONE_OWNER_V1 ───────────────────────────
  // sticky is resolved by the BROWSER every frame (a sticky offset is a function of scroll). A JS
  // transform applied a frame later is a SECOND writer, and during momentum scroll with the keyboard up
  // the two disagree every frame — that is the flicker, and it is not a throttling problem. The fix
  // keeps the browser as the owner and has JS supply only a PARAMETER (`top`), so exactly one thing
  // computes the painted position. ⛔ AND position:fixed IS NOT AN OPTION HERE: chat-scroll-chain.guard
  // refuses it on this page after six overlay attempts died on hand-positioned geometry. That guard was
  // not weakened to fit this code; its refusal produced this design.
  if (!/style\.top\s*=/.test(code)) {
    findings.push(`(g) ${PAGE_TSX} never sets the header's inline \`top\`. With the keyboard up sticky must resolve the position ITSELF from a JS-supplied offset — otherwise the only way to move the header is a transform, which lands a frame after the browser's own resolution and IS the flicker.`)
  }
  // The ONLY translate3d the page may write is the resting identity. A non-zero one means the frame-late
  // correction is back alongside sticky's own — two writers again.
  for (const m of code.matchAll(/translate3d\(([^)]*)\)/g)) {
    const args = m[1].split(',').map((x) => x.trim())
    if (!(args[0] === '0' && args[1] === '0' && args[2] === '0')) {
      findings.push(`(g) ${PAGE_TSX} writes a NON-ZERO translate3d(${m[1].trim()}) to the header. Only the resting identity is allowed: a transform offset alongside position:sticky reintroduces the second writer this flight removed.`)
    }
  }
  if (/position:\s*fixed/.test(code)) {
    findings.push(`(g) ${PAGE_TSX} introduces position:fixed. The Lora page must stay in normal flow — chat-scroll-chain.guard enforces it after six overlay attempts died on hand-positioned geometry.`)
  }

  // ── (h) THE KEYBOARD DETECTOR IS THE EXISTING ONE, NOT A SECOND ANSWER ────────────────────────────
  if (!/--lora-kb-inset/.test(code)) {
    findings.push(`(h) ${PAGE_TSX} does not read --lora-kb-inset. The keyboard-up test must REUSE the measured inset LoraThread already computes; a second detector is a second answer to the same question, and the two disagree on exactly the frames that matter.`)
  }
  if (/documentElement\.clientHeight/.test(code)) {
    findings.push(`(h) ${PAGE_TSX} re-derives the keyboard geometry from documentElement.clientHeight. That is LoraThread's calculation and it must not be duplicated here — one measurement, one owner.`)
  }

  // ── (c) CLEANUP ───────────────────────────────────────────────────────────────────────────────────
  const added = (code.match(/addEventListener\(/g) || []).length
  const removed = (code.match(/removeEventListener\(/g) || []).length
  if (removed < added) {
    findings.push(`(c) ${PAGE_TSX} adds ${added} listener(s) and removes ${removed}. This page mounts and unmounts on every navigation, so an unremoved visualViewport listener keeps a detached header alive and firing.`)
  }
}

// ── (d) THE CAP IS DERIVED, NOT A BARE LITERAL ──────────────────────────────────────────────────────
if (threadCss && threadTsx) {
  const css = strip(threadCss)
  const tsx = strip(threadTsx)
  const wroteFromViewport = /--lora-composer-max/.test(tsx) && /visualViewport|vv\.height/.test(tsx)
  const consumed = /max-height\s*:\s*min\([^;]*--lora-composer-max/.test(css)
  if (!wroteFromViewport) {
    findings.push(`(d) ${THREAD_TSX} never writes --lora-composer-max from the visual viewport. Then the composer cap is 40vh and a 120px literal, neither of which shrinks when the keyboard opens, so on a short visible area the composer is most of what is left.`)
  }
  if (!consumed) {
    findings.push(`(d) .input's max-height does not consume --lora-composer-max inside a min(). It must be a min() term so the live value can only cap LOWER and can never raise the ceiling above the static ones.`)
  }
}

// ── (e) NO dvh · (f) NO ZOOM SUPPRESSION ────────────────────────────────────────────────────────────
// ⛔ chat.module.css JOINED THE SCAN 2026-08-11 (LORAMER_CHAT_GEOMETRY_PROBE_V1 Phase B). The ban listed
// the page and thread stylesheets — written when those were the whole surface — and the SHELF's chrome
// stylesheet kept `height:100dvh` on `.panel` for months, unseen: the one file the ban never reached,
// found by the geometry harness's structural map, and the exact Lesson-68 shape (a) file-list gap this
// suite keeps producing. Desktop measured clean (panel==docH on Safari AND Chrome, 2026-08-11), but the
// unit is banned for what it does where chrome is dynamic (iPad is the unmeasured pairing), and a ban
// with a hole is not a ban. This leg was SEEN RED against the live tree before the CSS moved to svh.
const SHELF_CSS = 'src/components/redesign/chat.module.css'
const shelfCss = read(SHELF_CSS)
for (const [rel, text] of [[PAGE_CSS, pageCss], [THREAD_CSS, threadCss], [SHELF_CSS, shelfCss]]) {
  if (!text) continue
  const code = strip(text)
  if (/\b\d+(\.\d+)?dvh\b/.test(code)) {
    findings.push(`(e) ${rel} uses dvh. This surface bans it: on iOS dvh resolves to the LARGE viewport while documentElement.clientHeight is the small one, so a dvh-sized element overhangs before the keyboard is even involved.`)
  }
  if (/maximum-scale|user-scalable/.test(code)) {
    findings.push(`(f) ${rel} references maximum-scale/user-scalable. That disables pinch-zoom for every user to hide one input's zoom — an accessibility regression — and iOS does not restore scale on blur either way. The fix is font-size >= 16px.`)
  }
}

// ═══ (j) PINNED-ELEMENT INVENTORY — LORAMER_PINNED_ELEMENT_SWEEP_V1 ═════════════════════════════════
// ⛔ THIS IS THE ★PINNED-ELEMENTS-FIXED-ONE-AT-A-TIME ENFORCER, AND IT IS THE POINT OF THE LEG.
// THREE FLIGHTS ON THIS SURFACE EACH FIXED THE ONE ELEMENT THAT WAS REPORTED while its siblings carried
// the same defect: 97f2bfb (composer), fb95147 (header), and this one (chevron). Every element pinned
// against the viewport must therefore be DECLARED with an owner, and an UNDECLARED one FAILS — so the
// next sticky rule added to this surface cannot ship without someone deciding who positions it.
//   js-top           JS writes an inline `top` from visualViewport.offsetTop while the keyboard is up.
//   param            sticky offset is a var() JS writes; the BROWSER computes the painted position.
//   declared-unfixed known to carry the defect, deliberately not fixed, with the reason recorded here.
const PINNED = {
  // ⛔ DEMOTED 2026-08-07 FROM `gate-b:fb95147` — A FALSE PROOF MARKER, AND THE RULE IT BROKE IS NOW
  // WRITTEN DOWN: a provenBy MAY ONLY NAME A CAPTURE THAT EXERCISED THE MECHANISM, NEVER ONE THAT
  // MERELY OBSERVED THE OUTCOME. Gate-B showed the header LOOKED right. It did not show the JS ran —
  // and it almost certainly did not: LoraPageClient gates JS-owned placement on
  // `parseFloat(--lora-kb-inset) > 0`, and that value measured 0 in 15 device samples on 2026-08-05
  // (★LORA-KB-INSET-IS-DEAD-MACHINERY, DECISIONS LORAMER_LAYOUT_VIEWPORT_TRACKS_VISUAL_ON_CHROME_IOS_V1)
  // and in 3 of the 4 captures on 2026-08-07. The header is solid because the LAYOUT viewport itself
  // tracks the visual one, so plain sticky was already correct — a reason nobody had written down.
  head: { owner: 'js-top', file: PAGE_CSS, provenBy: 'unproven' },
  probe: { owner: 'js-top', file: PAGE_CSS, provenBy: 'unproven' },
  // ⛔ provenBy IS THE ANSWER TO ★GUARD-LEDGER-GREEN-ON-UNPROVEN-ELEMENT. On 2026-08-07 leg (k) printed
  // this element GREEN while it was broken on a device, because the ledger recorded a DECLARATION and
  // the declaration was an assertion I had reasoned to. `unproven` is a LEGAL value and it is PRINTED
  // ON EVERY RUN, so "declared" can never again be read as "correct".
  // ✅ PROMOTED 2026-08-07 — THE FIRST ENTRY ON THIS SURFACE WHOSE MARKER MEANS WHAT IT SAYS.
  // ⛔ THE STANDING RULE APPLIED, AND THE MECHANISM NAMED SO A LATER READER CAN CHECK IT: a provenBy may
  // only cite a capture that exercised the MECHANISM, never one that merely observed the OUTCOME.
  // THE MECHANISM UNDER TEST was the double-count — `raw` reducing to `−offsetTop` and being written
  // into `bottom`, applying a correction sticky was ALREADY making, which showed as ~2× displacement.
  // THE CAPTURE EXERCISED IT: shot 1 caught `offsetTop −15` MID-FLICK with `composer-bottom 0px` and
  // `d 15` — the element moved by the offset ONCE, not twice. ⛔ THE ZEROES ARE NOT THE PROOF; A
  // NON-ZERO offsetTop THAT NO LONGER DOUBLES IS. And `apply#1298 … age 0ms` shows the loop running
  // flat out through the flick, so this is the fix holding UNDER LOAD rather than a gesture that failed
  // to reproduce.
  composer: { owner: 'param', file: THREAD_CSS, provenBy: 'gate-b:ff233aa' },
  landingProbe: {
    owner: 'declared-unfixed', file: THREAD_CSS, provenBy: 'unproven',
    why: 'sticky top:0 inside the SHARED thread component AND NEUTERED — its gate moved to '
       + '`loramer:debug-landing`, which nothing sets (LORAMER_NEXT_LANDING_PROBE_VISIBLE_V1). Fixing it '
       + 'means adding a visualViewport subscription INSIDE the shared component for an element nothing '
       + 'renders: new pinning machinery on a live shared path for zero user-visible benefit. DECLARED, '
       + 'not forgotten — ★LANDING-PROBE-STICKY-UNFIXED carries the re-check.',
  },
}
for (const [rel, text] of [[PAGE_CSS, pageCss], [THREAD_CSS, threadCss]]) {
  if (!text) continue
  for (const m of strip(text).matchAll(/\.([A-Za-z][\w-]*)\s*\{[^}]*position:\s*sticky/g)) {
    const cls = m[1]
    if (!PINNED[cls]) {
      findings.push(`(j) UNDECLARED PINNED ELEMENT \`.${cls}\` (position: sticky) in ${rel}. Every element pinned against the viewport must be declared in this guard's PINNED ledger with an owner — js-top, param, or declared-unfixed WITH ITS REASON. Three flights on this surface each fixed the one element that was reported while its siblings carried the same defect; this leg is what stops a fourth.`)
    } else if (PINNED[cls].file !== rel) {
      findings.push(`(j) \`.${cls}\` is declared against ${PINNED[cls].file} but its sticky rule is in ${rel}. The ledger has drifted from the stylesheets it describes.`)
    }
  }
}
// ── (k) ONE WRITER, AND THE PARAMETER MUST BE SIGNED — LORAMER_COMPOSER_SIGNED_OFFSET_V1 ───────────
// ⛔ THIS IS THE LEG THAT PASSED A BROKEN ELEMENT. It asserted only that SOME var() was used, which is
// a claim about plumbing and not about correctness. It now asserts the two things that were actually
// wrong: that the composer's offset is the SIGNED, UNTHRESHOLDED value, and that the value is derived
// from the visual viewport rather than from a constant.
if (threadCss && threadTsx) {
  const css = strip(threadCss)
  const tsx = strip(threadTsx)
  const composer = /\.composer\s*\{([^}]*)\}/.exec(css)
  if (!composer) {
    findings.push(`(k) no .composer rule found in ${THREAD_CSS}.`)
  } else {
    const v = /(top|bottom)\s*:\s*var\(\s*(--[\w-]+)/.exec(composer[1])
    if (!v) {
      findings.push(`(k) .composer's sticky offset is not driven by a custom property. It is a \`param\` owner: JS supplies the VALUE and the BROWSER computes the painted position; a literal offset cannot track the viewport and a JS-written top/transform would add the second writer this arc removed.`)
    } else {
      const varName = v[2]
      // ⛔ THE THRESHOLDED VAR IS REFUSED BY NAME. `--lora-kb-inset` is gated `raw > 100 ? raw : 0`,
      // which DISCARDS the negative offsets a collapsing toolbar produces — measured −90 on this
      // repo's own banked device values, i.e. the composer 90px too high with content below it.
      if (varName === '--lora-kb-inset') {
        findings.push(`(k) .composer is driven by --lora-kb-inset, which is THRESHOLDED (\`raw > KEYBOARD_MIN_DELTA_PX ? raw : 0\`) and therefore discards the NEGATIVE offsets a toolbar collapse produces. The composer needs the SIGNED value.`)
      }
      // The var must be WRITTEN, and written from the visual viewport rather than a constant.
      const writeRe = new RegExp(`setProperty\\(\\s*'${varName}'\\s*,\\s*\`\\$\\{([^}]*)\\}px\``)
      const w = writeRe.exec(tsx)
      if (!w) {
        findings.push(`(k) ${THREAD_TSX} never writes ${varName}. The stylesheet reads a property nothing sets, so the composer silently falls back to its default offset.`)
      } else if (/Math\.max\(|Math\.min\(|\?\s*[\w.]+\s*:/.test(w[1])) {
        findings.push(`(k) ${varName} is written through a clamp or a conditional (\`${w[1].trim()}\`). It must be the SIGNED, unthresholded offset — a clamp to 0 is exactly the defect measured on 2026-08-07.`)
      }
      // ⛔ CORRECTED 2026-08-07, AND THIS IS NOT A WEAKENING — IT IS AN ASSERTION THAT ENCODED A BELIEF
      // THE DEVICE DATA HAS SINCE FALSIFIED. This leg used to REQUIRE `docH − vv.offsetTop − vv.height`,
      // written when I believed the pan term belonged in the offset. Three captures showed that on this
      // engine it reduces to `−offsetTop` and double-counts a pan sticky already follows. Requiring it
      // would now mandate the defect. The PROPERTY the leg protects is unchanged — the offset must be
      // DERIVED FROM THE VISUAL VIEWPORT rather than from a constant — and leg (p) takes the stricter
      // half by refusing offsetTop outright. Nothing that was checked has become unchecked.
      if (!/const raw\s*=\s*Math\.round\(\s*docH\s*-\s*vv\.height\s*\)/.test(tsx)) {
        findings.push(`(k) the offset is no longer derived from the VISUAL VIEWPORT (docH − vv.height). A \`param\` owner must track the visual viewport, not merely consume a var() — that distinction is what let a broken element read green. ⚠ It must ALSO exclude offsetTop; leg (p) enforces that half.`)
      }
    }
  }
}
// ── (m) THE PROBE IS FLAG-GATED AND CANNOT REACH A NORMAL USER ─────────────────────────────────────
if (threadTsx) {
  const tsx = strip(threadTsx)
  if (/vvProbeRef/.test(tsx) && !/\{debug && !isPanel && <div ref=\{vvProbeRef\}/.test(tsx)) {
    findings.push(`(m) the visual-viewport probe is not gated on \`debug && !isPanel\`. A measurement readout that can render for a normal user is a defect, not an instrument.`)
  }
}

// ── (l) NO CONDITIONAL RENDER FOR A PINNED RIDER — THE CHEVRON DEFECT ITSELF ────────────────────────
// `.jump` rides the composer, so its GEOMETRY was never wrong. It was `{!pinned && (<button …>)}` — a
// conditional render driven by scroll-derived React state, so every crossing of the 80px threshold
// mounted or unmounted it a render late. That is the "bounces, slightly after" Russ reported.
if (threadTsx) {
  const code = strip(threadTsx)
  if (/\{\s*!pinned\s*&&/.test(code)) {
    findings.push(`(l) ${THREAD_TSX} still gates a pinned rider behind \`{!pinned && …}\`. A conditional render driven by scroll state mounts and unmounts the element on every threshold crossing, one React render late — that IS the flicker. Hidden state must be a CLASS so the box never leaves the layout.`)
  }
  if (!/jumpHidden/.test(code)) {
    findings.push(`(l) ${THREAD_TSX} does not apply a hidden CLASS to the jump-to-bottom control. Without it the only way to hide it is to stop rendering it, which is the defect this leg exists to prevent.`)
  }
}
if (threadCss) {
  const hidden = /\.jumpHidden\s*\{([^}]*)\}/.exec(strip(threadCss))
  if (!hidden) {
    findings.push(`(l) ${THREAD_CSS} has no .jumpHidden rule.`)
  } else if (/(^|;)\s*(display|position|width|height|margin|padding|top|right|bottom|left)\s*:/.test(hidden[1])) {
    findings.push(`(l) .jumpHidden changes a LAYOUT property (${hidden[1].trim().slice(0, 60)}…). It may only change paint — opacity/visibility/pointer-events — or hiding the control still disturbs the layout on every threshold crossing.`)
  }
}

// ═══ (n) THE PROBE MUST PRINT EVERY VARIABLE THAT POSITIONS A PINNED ELEMENT ════════════════════════
// ⛔ THIS IS THE 3dd4692 DEFECT TURNED INTO AN ENFORCER. That commit moved the composer from
// `--lora-kb-inset` to `--lora-composer-bottom` AND SHIPPED A PROBE THAT STILL PRINTED THE OLD ONE.
// The device capture then showed `inset 168` beside 336px of displacement — a contradiction that was
// unresolvable ONLY because the variable that actually positioned the element was never on screen.
// An instrument aimed at the wrong variable costs a whole Gate-B round trip and looks like a mystery.
if (threadCss && threadTsx) {
  const css = strip(threadCss)
  const tsx = strip(threadTsx)
  const positioning = new Set()
  // Every var() used in a top/bottom inside a rule that is position: sticky.
  for (const m of css.matchAll(/\{[^}]*position:\s*sticky[^}]*\}/g)) {
    for (const v of m[0].matchAll(/(?:top|bottom)\s*:\s*var\(\s*(--[\w-]+)/g)) positioning.add(v[1])
  }
  // ⛔ ANCHOR ON THE WHOLE PROBE EFFECT, NOT ON THE textContent ASSIGNMENT. First cut anchored on the
  // template literal alone and reported a FALSE POSITIVE: the probe reads the var through a `readVar`
  // helper ABOVE the assignment, so the name is in the effect but not in the template. That is
  // ★GUARD-LOCATORS-PIN-TODAYS-CALL-SITE in miniature, caught in the same commit that added the leg —
  // the property is "the probe surfaces this variable", not "this string appears in that one literal".
  const probeBlock = (tsx.match(/const tick = \(\)[\s\S]*?requestAnimationFrame\(tick\)/) || [''])[0]
  for (const v of positioning) {
    if (!probeBlock.includes(v)) {
      findings.push(`(n) the probe never prints \`${v}\`, which POSITIONS a sticky element. An instrument aimed at a variable that no longer positions anything is what made the 2026-08-07 capture unresolvable: 168px of the printed var beside 336px of measured displacement, with the value that could explain it absent from the readout.`)
    }
  }
}

// ═══ (o) THE DEBUG FLAG MUST SURVIVE, AND AN EXPLICIT REQUEST MUST NEVER BE SWALLOWED ══════════════
// ⛔ FOUR GATE-B CAPTURES WERE SPENT ON SESSIONS WHERE THE PROBE WAS SILENTLY OFF. An instrument that
// cannot be relied on to be ARMED is not an instrument, and the round trip it costs is measured in days
// here, not minutes. ★DEBUG-FLAG-DID-NOT-SURVIVE-CAPTURE.
if (hookTs) {
  const code = strip(hookTs)
  if (!/localStorage\.(get|set)Item\(\s*'loramer:debug-chat'/.test(code)) {
    findings.push(`(o) ${HOOK_TS} does not persist the debug flag in localStorage. sessionStorage is scoped to the tab session and dies with a tab close, a discard-and-restore, and — vendor-acknowledged, developer.apple.com/forums/thread/724189 — a URL-bar navigation on WebKit, which is exactly how this flag gets turned on.`)
  }
  // ⛔ THE KILL SWITCH MUST CLEAR BOTH STORES. Writing one and clearing the other leaves a stale key in
  // the store no longer written, and it re-arms on the next mount.
  const offBranch = (code.match(/q === 'off'[\s\S]{0,400}/) || [''])[0]
  for (const store of ['localStorage', 'sessionStorage']) {
    if (!new RegExp(`${store}\\.removeItem`).test(offBranch)) {
      findings.push(`(o) \`?debug=off\` does not clear ${store}. The kill switch must clear BOTH stores or a stale key re-arms the probe on the next mount.`)
    }
  }
  // ⛔ THE URL READ MUST NOT SIT INSIDE A try THAT SWALLOWS IT. An explicit ?debug=chat is a REQUEST,
  // not a convenience: storage may fail in every way it likes and the probe must still arm.
  if (/try\s*\{[^}]*URLSearchParams\(window\.location\.search\)[^}]*getItem/s.test(code)) {
    findings.push(`(o) the URL param is read inside the same try as the storage access, so a storage failure discards an EXPLICIT \`?debug=chat\`. The user asked, the URL says so, and the instrument would stay dark with no signal — the house .catch(() => []) pathology in the one place whose job is to be observable.`)
  }
}
// ⛔ THE ARMED STATE MUST BE VISIBLE, AND UNREACHABLE WHEN OFF.
if (pageTsx) {
  const code = strip(pageTsx)
  if (!/\{debug \?[^}]*styles\.dbg/.test(code)) {
    findings.push(`(o) ${PAGE_TSX} has no debug-gated armed indicator in the header. The probe strip sits above the COMPOSER at the bottom of a scrolled page, so its absence is indistinguishable from a page not scrolled down — which is how four captures were spent.`)
  }
}

// ═══ (p) A TERM THAT IS ONLY VALID AT REST MAY NOT REACH A POSITIONING VARIABLE ════════════════════
// ⛔ MEASURED 2026-08-07, three device captures: with `docH === vvH` on Chrome iOS the expression
// `docH − offsetTop − vvH` REDUCES TO `−offsetTop` — visual-viewport PAN, nothing else. It is 0 at rest
// and transiently SIGNED in momentum (+39, −85 observed), and it was driving the composer's `bottom`.
// ⛔ THE DISPLACEMENT READ 2× THE OFFSET BECAUSE STICKY ALREADY FOLLOWS THE PAN — the term was REDUNDANT
// in motion, not merely mis-scaled. It is meaningful ONLY when offsetTop is 0, which is exactly when it
// contributes nothing. ⇒ IT MUST NOT APPEAR IN AN EXPRESSION THAT FEEDS A POSITIONING VARIABLE.
// ⚠ THIS LEG PINS AN ABSENCE, WHICH IS WEAKER THAN PINNING A BEHAVIOUR AND IS SAID SO: it cannot tell a
// correct expression from an incorrect one, only that the disqualified term is not in it. A deliberate
// exception is possible — put it behind a named marker and this leg's failure text will say so.
if (threadTsx) {
  const code = strip(threadTsx)
  const rawExpr = (code.match(/const raw = [^\n]*/) || [''])[0]
  if (!rawExpr) {
    findings.push(`(p) ${THREAD_TSX} no longer computes \`raw\` — the expression that feeds --lora-composer-bottom and --lora-kb-inset could not be located, so this leg cannot assert anything. A guard that cannot find its evidence FAILS.`)
  } else if (/offsetTop/.test(rawExpr)) {
    findings.push(`(p) \`${rawExpr.trim()}\` includes offsetTop. On Chrome iOS docH === vvH, so this reduces to −offsetTop — visual-viewport PAN, which is 0 at rest and transiently signed in momentum. Sticky ALREADY follows the pan, so feeding it into a positioning variable double-counts it (measured: displacement 2× the offset). The term is only meaningful when it is zero.`)
  }
}

// ── (i) NO interactive-widget — IT IS UNAVAILABLE, NOT MERELY UNUSED ────────────────────────────────
// `interactive-widget=resizes-content` WOULD close this whole class (w3c/csswg-drafts#10464, confirmed
// by the spec author) and WebKit has NOT implemented it (bugs.webkit.org 259770). Every iOS browser is
// WebKit, so adding it to the viewport meta buys nothing and reads to the next person as though the
// keyboard case were handled declaratively. ★IOS-NO-STANDARDS-FIX-FOR-KEYBOARD-VIEWPORT re-checks it.
for (const [rel, text] of [[PAGE_TSX, pageTsx], [PAGE_CSS, pageCss]]) {
  if (!text) continue
  if (/interactive-widget/.test(strip(text))) {
    findings.push(`(i) ${rel} sets interactive-widget. WebKit has not implemented it (bugs.webkit.org 259770) and every iOS browser is WebKit, so it cannot help here — and it reads as though the keyboard case were handled declaratively when it is not.`)
  }
}

if (findings.length) {
  console.error(`[chat-visual-viewport] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('[chat-visual-viewport] PINNED LEDGER — ' + Object.entries(PINNED)
  .map(([k, v]) => `.${k}=${v.owner}/${v.provenBy}`).join(' · ')
  + '  ⛔ `unproven` means DECLARED, NOT VERIFIED — only a device can promote it.')
console.log('[chat-visual-viewport] PASS — every viewport-pinned element DECLARED with an owner (js-top · param · declared-unfixed) · ONE writer each · no pinned rider behind a conditional render · the keyboard test REUSES --lora-kb-inset · header driven from visualViewport on BOTH resize and scroll · focusout dismissal path present (Apple thread/800154) · every listener removed on unmount · composer cap derived from viewport height inside a min() · no dvh · no zoom suppression · no interactive-widget. ⛔ CSS/JS FACTS ONLY — this proves NO pixel; the thumb-flick and the clip are Gate-B on device (★CHAT-RENDER-MEASUREMENT-MISSING).')
