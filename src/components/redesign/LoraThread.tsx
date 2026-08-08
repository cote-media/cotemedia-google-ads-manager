// LORAMER_CHAT_SHARED_THREAD_V1 — THE CONVERSATION SURFACE, ONCE, FOR BOTH CONTAINERS.
//
// ⛔ WHAT THIS CLOSES. `useLoraChat` extracted the CONVERSATION and left the SURFACE behind, so the
// desktop shelf (ChatLauncher) and the phone page (LoraPageClient) each carried their own copy of the
// message map, the bubbles, the markdown treatment, the empty state, the composer and the send button —
// with the SAME intent and drifting values, in two stylesheets. Every defect on the chat-UI list lives
// in what was not extracted. This is that extraction: ONE presentation component, two thin containers
// that own only their own chrome (the shelf's portal/scrim/header/body-lock/history-back; the page's
// header/back button).
//
// ⛔ IT DEPENDS ON SHELL FOR NOTHING, AND THAT IS A HARD REQUIREMENT RATHER THAN A PREFERENCE. The page
// renders OUTSIDE <Shell> and the shelf is PORTALED OUT of `.root`, and both severances have already
// cost a defect: the CSS custom properties (the send button rendered as a white glyph in a transparent
// circle on a white bar) and the Tabler icon webfont (`<i class="ti ti-chevron-left">` was an EMPTY
// element — a 0×0 invisible button that was in the DOM, in bounds, and perfectly tappable if you knew
// where to aim). So: ICONS ARE INLINE SVG, and every colour is a var WITH A LITERAL FALLBACK.
//
// ⛔ CLEAN ON MOUNT. The shelf stays MOUNTED inside Shell while the page REMOUNTS. Nothing here holds
// state across a client switch — the scroll pin resets on `active` going false — because that is the
// d55f739 cross-client bleed one layer down.
'use client'
import {
  createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type RefObject,
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { LoraTurn, LoraWorking } from './LoraWorking'
import { useStickToBottom } from '@/lib/next/use-stick-to-bottom'
import type { Msg } from '@/lib/next/use-lora-chat'
import s from './lora-thread.module.css'

// LORAMER_LORA_PAGE_ICONS_V1 — INLINE SVG, NOT THE ICON WEBFONT. See the header: the font is linked
// only from Shell and neither surface can rely on it.
const Icon = ({ d, size = 20 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d={d} />
  </svg>
)
const ARROW_UP = 'M12 19V5M5 12l7-7 7 7'
const CHEVRON_DOWN = 'M6 9l6 6 6-6'
// LORAMER_CHAT_COPY_BLOCKS_V1 — the copy affordance's two states, same Icon pattern, path `d` only.
const COPY = 'M8 8V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-3M5 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z'
const CHECK = 'M20 6L9 17l-5-5'

// ── LORAMER_CHAT_COPY_BLOCKS_V1 — COPY-TO-CLIPBOARD ON FENCED BLOCKS ──────────────────────────────
//
// ⛔ THE RESET KEY EXISTS BECAUSE OF d55f739, AND IT IS NOT DEFENSIVE PROGRAMMING. The shelf stays
// MOUNTED inside Shell across a client switch while the page REMOUNTS, and `messages.map` above keys
// by INDEX — so on the shelf React REUSES this component's instance and its state when the whole
// conversation is replaced by another client's. A `copied` flag left true would then read as "you
// copied this" over a block belonging to a different client. The key is the clientId; when it changes
// the flag is cleared. This is the same bleed class one layer down, and it is why the state is not
// simply a local boolean with a timer.
const CopyResetContext = createContext<string>('')

/**
 * ⛔ WORKS MID-STREAM BY CONSTRUCTION, NOT BY A COMPLETION CHECK. react-markdown renders an
 * unterminated fence as a `<pre>` while the answer is still arriving, so the streaming call site gets
 * a working button on a partial block. Nothing here gates on `loading` — a button that appears only
 * when the turn ends is the one the user does not have while they are reading.
 *
 * ⛔ THE BUTTON LIVES INSIDE THE `<pre>` AND IS EXCLUDED FROM THE COPY BY NODE IDENTITY, never by
 * trimming the string afterwards. `code`'s textContent is the fence's own text; when there is no
 * `<code>` child the childNodes are joined with the button's own node skipped. Reading the `<pre>`'s
 * textContent wholesale would paste the word "Copy" into the user's negative-keyword box.
 */
function CopyablePre({ children }: { children?: ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  const resetKey = useContext(CopyResetContext)
  const timer = useRef<number | null>(null)

  // The client switch clears it. So does unmount — a pending timer must not fire into a dead component.
  useEffect(() => { setCopied(false) }, [resetKey])
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])

  const copy = useCallback(async () => {
    const pre = preRef.current
    if (!pre) return
    const code = pre.querySelector('code')
    const text = code
      ? (code.textContent ?? '')
      : Array.from(pre.childNodes)
          .filter((n) => !(n instanceof HTMLElement && n.dataset.loraCopy === '1'))
          .map((n) => n.textContent ?? '')
          .join('')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // ⛔ NO SILENT SUCCESS. clipboard.writeText rejects without a user gesture, on an insecure
      // origin, or when permission is denied. Saying "Copied!" over a clipboard that did not change
      // is worse than the button not working, because the user pastes stale content and trusts it.
      setCopied(false)
    }
  }, [])

  return (
    <pre ref={preRef}>
      <button
        type="button"
        data-lora-copy="1"
        className={s.copyBtn}
        onClick={copy}
        aria-label={copied ? 'Copied' : 'Copy to clipboard'}
        title={copied ? 'Copied' : 'Copy'}
      >
        <Icon d={copied ? CHECK : COPY} size={15} />
      </button>
      {children}
    </pre>
  )
}

// ⛔ ONE RENDERER, TWO CALL SITES, BY CONSTRUCTION. The completed-turn site and the streaming-preview
// site previously each spelled out `<div className={s.md}><ReactMarkdown …>` in full, which is exactly
// how the streaming site would silently miss a change made to the other. `<Md>` is the only markdown
// path in this component now, so the override cannot be present on one site and absent on the other.
const MD_COMPONENTS = { pre: CopyablePre }
function Md({ children }: { children: string }) {
  return (
    <div className={s.md}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{children}</ReactMarkdown>
    </div>
  )
}

export interface LoraThreadProps {
  /** 'panel' = the shelf: THIS component's scroll region is the scroller. 'page' = the DOCUMENT scrolls. */
  variant: 'panel' | 'page'
  messages: Msg[]
  loading: boolean
  streamStatus?: string | null
  /** ⛔ S1 — the answer as it arrives. A PREVIEW, discarded when the authoritative `answer` lands. */
  streamingText?: string
  input: string
  setInput: (v: string) => void
  // ⚠ The hook's own ref type, mirrored EXACTLY. Widening it here to `| null` looked harmless and
  // broke assignment to <textarea ref=…>; the honest fix is to take the type the engine already has.
  inputRef: RefObject<HTMLTextAreaElement>
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onComposerFocus: () => void
  /** LORAMER_CHAT_FRAME_PROBE_V1 — debug-gated in the hook; a no-op without ?debug=chat. */
  noteInput?: () => void
  send: (text: string) => void
  clientId?: string
  clientName?: string
  /** Shown only on an empty thread, and only where the container passes them (the shelf). */
  suggestions?: string[]
  /** False while the shelf is closed, so nothing scrolls or observes behind a hidden surface. */
  active: boolean
  /** Rendered at the top of the scroll region — the shelf's ?debug=chat readout. Nothing by default. */
  debugSlot?: React.ReactNode
  /** LORAMER_NEXT_LANDING_PROBE_VISIBLE_V1 — ?debug=chat. Renders the landing-scroll readout ON SCREEN.
   *  The console line shipped in 1a76a4e was correctly gated and UNREADABLE on Chrome iOS, which is the
   *  only device with the defect. Both containers already hold this flag; it is passed, not re-derived. */
  debug?: boolean
  /** Extra work on composer focus, on top of onComposerFocus. */
  onFocusExtra?: () => void
  /** PAGE VARIANT ONLY — the element that carries `--lora-kb-inset`. See the keyboard effect below. */
  insetTargetRef?: RefObject<HTMLElement | null>
}

// LORAMER_LORA_PAGE_KEYBOARD_INSET_V1 — the same threshold the probe uses to call the keyboard up.
// Device values 2026-07-26: layout 766 vs visual 428. Address-bar chrome moves this by tens of px,
// never by 100+, so nothing below the threshold lifts the composer.
const KEYBOARD_MIN_DELTA_PX = 100

export default function LoraThread({
  variant, messages, loading, streamStatus, streamingText, input, setInput, inputRef,
  onKeyDown, onComposerFocus, noteInput, send, clientId, clientName, suggestions, active,
  debugSlot, debug = false, onFocusExtra, insetTargetRef,
}: LoraThreadProps) {
  const isPanel = variant === 'panel'
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // ⛔ THE SAME MACHINE FOR BOTH, AND THE PAGE'S IS THE ONE THAT SURVIVED. The shelf previously ran a
  // single unconditional `scrollTop = scrollHeight` on every messages/loading change, so scrolling up to
  // read history got yanked back down — the exact defect the page was fixed for. Unified onto the page's
  // pin/unpin machine on Russ's instruction; averaging the two was explicitly refused.
  const { pinned, bottom, followBottom, forceBottom, setPin, probeLines } = useStickToBottom(
    isPanel ? scrollRef : null,
    { watch: [messages, loading, streamStatus, streamingText], contentRef, active },
  )

  // ── THE STICKY COMPOSER AND HOW IT SURVIVES THE KEYBOARD (page variant only) ────────────────────
  // ⛔ THIS EFFECT MOVED HERE FROM LoraPageClient AND IT IS NOT COSMETIC: its second half calls
  // `followBottom()`, which now lives in this component. Extracting the surface without moving it
  // DROPPED THE KEYBOARD-ARRIVAL SCROLL — a real regression, introduced by me, caught by
  // chat-scroll-chain.guard.mjs, not by review. It is exactly the "behaviour change hidden inside a
  // refactor" class, and the only reason it did not ship is that the property was already guarded.
  //
  // The ONLY number computed here is a single bottom inset; the overlay attempts computed a whole rect
  // and fought iOS compositing for all four sides. visualViewport RESIZE is the event that fires when
  // the keyboard really arrives — focus fires before it animates in — and the scroll OBEYS THE PIN like
  // every other auto-scroll, bound to the composer having focus so it cannot fight a user scrolling
  // with the keyboard already down.
  // ⚠ MEASURED 2026-08-05, 15 samples on iOS 26.2 / Chrome 151: docH tracked vvH exactly, so the inset
  // computes to 0 there and `position: sticky` alone holds the composer. Kept anyway — one device is
  // not every device, and the var's 0 fallback IS the observed behaviour.
  useEffect(() => {
    if (variant !== 'page' || !active) return
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return
    const apply = () => {
      const docH = document.documentElement.clientHeight
      const raw = Math.round(docH - (vv.offsetTop || 0) - vv.height)
      const inset = raw > KEYBOARD_MIN_DELTA_PX ? raw : 0
      applyRef.current = { n: applyRef.current.n + 1, docH, off: Math.round(vv.offsetTop || 0), vvH: Math.round(vv.height), raw }
      insetTargetRef?.current?.style.setProperty('--lora-kb-inset', `${inset}px`)
      // ── LORAMER_COMPOSER_SIGNED_OFFSET_V1 — THE COMPOSER GETS THE SIGNED VALUE, UNTHRESHOLDED.
      // `raw` IS the offset the composer needs, INCLUDING NEGATIVES: it is `docH − visualBottom`, i.e.
      // how far the visual bottom sits BELOW the layout bottom once a collapsing toolbar has extended
      // the visible band downward. MEASURED against this file's own banked device values (layout 766,
      // visual 428): keyboard-down + collapsed gives raw −90, the shipped threshold turns that into 0,
      // and the composer ends up 90px ABOVE where it belongs with content below it.
      // ⛔ AND IT IS STATED PLAINLY BECAUSE IT WOULD OTHERWISE BE MISREAD: THIS IS NOT THE FIX FOR THE
      // REPORTED KEYBOARD-UP DEFECT. With the keyboard up raw ≈ 248 — far above the 100 threshold — so
      // the clamp NEVER FIRES in the failing case. This closes a real, provable, adjacent defect and
      // removes the composer's exposure to the cliff; the reported one is what the probe is for.
      // ⚠ WHY --lora-kb-inset KEEPS ITS THRESHOLD RATHER THAN BECOMING A BARE CLAMP: LoraPageClient
      // reads it as the KEYBOARD-UP DETECTOR (`inset > 0`). Unthresholded, ~20px of address-bar chrome
      // would read as "keyboard up" and flip the header into JS-owned placement spuriously — a
      // regression of fb95147. The cliff is removed from the path that matters (the composer now reads
      // the signed var and cannot be teleported by a 105 → 95 crossing) and left where fb95147 needs it.
      insetTargetRef?.current?.style.setProperty('--lora-composer-bottom', `${raw}px`)
      // ── LORAMER_CHAT_COMPOSER_CLIP_V1, 2026-08-07 — THE CAP FOLLOWS THE VISIBLE AREA.
      // The composer already sits ABOVE the keyboard (sticky at `bottom: var(--lora-kb-inset)`), so the
      // clip this fixes is the other direction: a grown field eating the thread that is left. `40vh` and
      // the 120px ceiling are both computed against a viewport that does not shrink when the keyboard
      // opens, so on a SHORT visible area — landscape with the keyboard up is the real case — a 120px
      // composer is most of what remains. This is the only term that can see that, and `min()` in the
      // stylesheet means it can only ever cap LOWER, never raise the ceiling.
      // ⛔ THE 44px FLOOR IS NOT DECORATION: it is the single-line field height (10+10 padding + 22.4
      // line-box + 2 border), so the cap can never fall below one line and trap the caret in a field
      // too short to show it.
      // ⚠ vv.height IS THE MEASURED VISIBLE HEIGHT, so it already has the iOS form-accessory bar (the
      // key/card/location pill) subtracted — the same reason `raw` above is a measurement of the gap
      // rather than an assumption about the keyboard.
      insetTargetRef?.current?.style.setProperty(
        '--lora-composer-max', `${Math.max(44, Math.round(vv.height * 0.4))}px`)
      if (document.activeElement === inputRef.current) {
        followBottom()
        window.setTimeout(() => followBottom(), 200)
      }
    }
    apply()
    // LORAMER_COMPOSER_VV_PROBE_V1 — stamp WHICH event fired and WHEN, so the probe can report staleness.
    const onResize = () => { lastVvRef.current = { name: 'resize', at: Date.now() }; apply() }
    const onScroll = () => { lastVvRef.current = { name: 'scroll', at: Date.now() }; apply() }
    vv.addEventListener('resize', onResize)
    vv.addEventListener('scroll', onScroll)
    return () => { vv.removeEventListener('resize', onResize); vv.removeEventListener('scroll', onScroll) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, active, insetTargetRef, inputRef])

  // ── LORAMER_CHAT_COMPOSER_AUTOGROW_V1 — THE FALLBACK HALF, AND IT IS GATED ON THE SAME QUERY THE CSS
  // USES SO EXACTLY ONE MECHANISM IS EVER LIVE. `field-sizing: content` is NOT Baseline (Chromium 123+,
  // Safari 26.2+), and ⛔ EVERY iOS BROWSER IS WebKit — Chrome-iOS runs Safari's engine, so its Chromium
  // version number says nothing about whether this property exists on Russ's phone. The @supports rule
  // in lora-thread.module.css hands native sizing to engines that have it; this hands the same behaviour
  // to the ones that do not, and CSS.supports is what keeps them from both running and fighting.
  //
  // ⛔ `height = 'auto'` BEFORE READING scrollHeight IS THE WHOLE TRICK, AND OMITTING IT IS THE CLASSIC
  // BUG: scrollHeight of an element already sized to its content returns that size, so a field that has
  // grown never shrinks back — it only ratchets up. Resetting to auto lets the browser recompute the
  // intrinsic height first, which is what makes CLEARING the field return it to one line.
  // The CSS max-height still clamps the painted box, so a long paste stops growing and scrolls itself.
  // ── LORAMER_COMPOSER_SIGNED_OFFSET_V1 + LORAMER_COMPOSER_VV_PROBE_V1, 2026-08-07 ──────────────────
  // composerRef: the element under test — the probe reads its REAL rect rather than what we believe.
  // vvProbeRef: the readout sink, written IMPERATIVELY (never through React) so it updates during a
  // momentum flick without a render per frame.
  // lastVvRef: which visualViewport event last fired and when. ⛔ THIS IS THE READING THAT MATTERS MOST
  // and it is why the probe cannot be event-driven: if NEITHER event fires during a momentum toolbar
  // collapse, the parameter is stale however correct its arithmetic — a THIRD mechanism neither of us
  // had named — and an event-driven readout would simply not update and look like nothing happened.
  const composerRef = useRef<HTMLDivElement>(null)
  const vvProbeRef = useRef<HTMLDivElement>(null)
  const lastVvRef = useRef<{ name: string; at: number }>({ name: 'none', at: 0 })
  // ⛔ WHAT apply() ACTUALLY SAW, AND HOW MANY TIMES IT RAN. The 3dd4692 captures showed `inset 168px`
  // beside `live 0` with an event 4ms old — a contradiction the CODE CANNOT EXPLAIN, because the write
  // is unconditional and there is no path that writes on one condition and skips the inverse. Live
  // values cannot settle it: they say what is true NOW, never what was true when the write happened.
  // A snapshot plus a counter can: same numbers + rising counter ⇒ the write is landing somewhere else;
  // different numbers ⇒ the follow-up never ran; frozen counter ⇒ apply() is being suppressed.
  const applyRef = useRef<{ n: number; docH: number; off: number; vvH: number; raw: number }>(
    { n: 0, docH: -1, off: -1, vvH: -1, raw: -1 })

  const autoGrow = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
        && CSS.supports('field-sizing', 'content')) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [inputRef])
  useEffect(() => { autoGrow() }, [input, autoGrow])

  // ══ LORAMER_COMPOSER_VV_PROBE_V1, 2026-08-07 — THE MEASUREMENT FLIGHT'S ACTUAL DELIVERABLE ═══════
  //
  // ⛔ WRITTEN AGAINST ★LANDING-PROBE-SPEC-IS-WRONG, WHOSE TWO DEFECTS BOTH APPLY HERE:
  //   (a) MISMATCHED BASES — that probe compared `documentElement.scrollHeight` with
  //       `window.innerHeight`, two different objects, so its numbers could not be subtracted.
  //       ⇒ EVERYTHING BELOW IS IN ONE BASIS AND THE BASIS IS PRINTED: the LAYOUT viewport, origin at
  //       its top. `getBoundingClientRect()` is already in that basis, `visualViewport.offsetTop` is the
  //       visual viewport's own offset within it, so `offsetTop + height` IS the visual bottom in the
  //       SAME coordinates as `rect.bottom`. They are directly comparable, which is the whole point.
  //   (b) AN ARMING WINDOW THAT CLOSED BEFORE THE EVENT — it armed for 800ms and the thing it measured
  //       happened later. ⇒ THIS HAS NO ARMING WINDOW AT ALL. It runs continuously for as long as the
  //       debug flag is on.
  //
  // ⛔ IT IS A rAF LOOP AND NOT AN EVENT HANDLER, FOR THE ONE READING THAT MATTERS MOST. Phase 1(c)
  // could not establish from a read whether iOS fires `resize` or `scroll` during a momentum toolbar
  // collapse. If NEITHER fires, the parameter is stale however correct its arithmetic — a third
  // mechanism neither of us had named — and an EVENT-DRIVEN readout would simply not update, which
  // looks identical to nothing happening. A frame loop reports the AGE of the last event, so silence
  // becomes a visible, rising number instead of an absence.
  //
  // ⛔ WHAT EACH READING PROVES — WRITTEN DOWN BEFORE IT RUNS, because a probe whose interpretation is
  // decided after seeing the data can be read to confirm anything:
  //   · `d` (= rect.bottom − visualBottom) ≈ 0            → THE COMPOSER IS TRACKING. Not mechanism (i).
  //   · `d` ≈ −(toolbar height) WHILE `inset` IS CORRECT  → sticky is NOT following a correct parameter
  //                                                          ⇒ (i), the Apple sticky-bottom bug.
  //   · `inset` ≠ the live `docH − offsetTop − vvH`       → the PARAMETER is wrong/stale ⇒ (ii).
  //   · `age` large (hundreds of ms) during the flick     → the events did not fire ⇒ (iii) starvation,
  //                                                          and (ii) is a CONSEQUENCE, not the cause.
  //
  // ⚠ IT RENDERS INSIDE THE COMPOSER, DELIBERATELY: the numbers then travel WITH the element under
  // test, so one screenshot carries both the misplacement and the data that explains it. THE COST IS
  // STATED — if the composer ever leaves the screen entirely the readout goes with it. The reported
  // failure strands it mid-content, where it is plainly visible, so that trade is worth it here; it
  // would not be for a defect that hides the element.
  useEffect(() => {
    if (!debug || variant !== 'page') return
    let raf = 0
    const tick = () => {
      const sink = vvProbeRef.current
      const vv = typeof window !== 'undefined' ? window.visualViewport : null
      if (sink && vv) {
        const docH = document.documentElement.clientHeight
        const off = Math.round(vv.offsetTop || 0)
        const vvH = Math.round(vv.height)
        const visualBottom = off + vvH
        const rect = composerRef.current?.getBoundingClientRect()
        const cTop = rect ? Math.round(rect.top) : NaN
        const cBot = rect ? Math.round(rect.bottom) : NaN
        // ⛔ READ THE VARIABLE THAT ACTUALLY POSITIONS THE ELEMENT. The 3dd4692 probe printed
        // `--lora-kb-inset` — which STOPPED positioning the composer in that same commit, when it moved
        // to `--lora-composer-bottom`. An instrument aimed at the wrong variable is why SHOT A could not
        // be reconciled: 168 of inset cannot produce 336 of displacement, and the value that CAN was
        // never on screen.
        const readVar = (n: string) => insetTargetRef?.current
          ? (insetTargetRef.current.style.getPropertyValue(n).trim() || '(unset)')
          : '(no target)'
        const inset = readVar('--lora-kb-inset')
        const cbot = readVar('--lora-composer-bottom')
        const live = docH - off - vvH
        const ev = lastVvRef.current
        const age = ev.at ? Date.now() - ev.at : -1
        const ap = applyRef.current
        // `.page` is the composer's CONTAINING BLOCK. A sticky element cannot escape it, so if the page
        // box ends above the visual bottom the composer is clamped to the page and travels up with it —
        // the second candidate for SHOT A's 336px, and the only one this field can settle.
        const pageBot = insetTargetRef?.current
          ? Math.round(insetTargetRef.current.getBoundingClientRect().bottom) : NaN
        // ⚠ window.innerHeight is the ONLY untried candidate for measuring keyboard height on this
        // browser. Published guidance says Chrome's innerHeight tracks the toolbar too, i.e. it is
        // probably as useless as docH — UNMEASURED HERE, so it is printed rather than assumed.
        const innerH = Math.round(window.innerHeight)
        sink.textContent =
          `BASIS=layout-vp  docH ${docH}  off ${off}  vvH ${vvH}  visBottom ${visualBottom}  innerH ${innerH}\n` +
          `composer top ${cTop}  bottom ${cBot}   d=bottom-visBottom ${cBot - visualBottom}   pageBot ${pageBot}\n` +
          `kb-inset ${inset}   composer-bottom ${cbot}   live(docH-off-vvH) ${live}\n` +
          `apply#${ap.n} saw docH ${ap.docH} off ${ap.off} vvH ${ap.vvH} raw ${ap.raw}   ev ${ev.name} age ${age}ms`
      }
      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [debug, variant, insetTargetRef])

  const list = (
    <div ref={contentRef} style={{ display: 'contents' }}>
      {messages.length === 0 ? (
        <div className={s.empty}>
          {/* Name the client when there IS one. clientId is the real-client signal — clientName defaults
              to "All clients" on the portfolio Shell, which must NOT become a possessive. */}
          <p className={s.emptyLead}>
            {clientId && clientName
              ? `Ask about ${clientName}’s performance — spend, revenue, breakdowns, or how the money splits.`
              : 'Ask about this client’s performance — spend, revenue, breakdowns, or how the money splits.'}
          </p>
          {suggestions?.length ? (
            <div className={s.suggestions}>
              {suggestions.map((q) => (
                <button key={q} type="button" className={s.suggestion} onClick={() => { send(q); forceBottom() }}>{q}</button>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        // LORAMER_CHAT_MERGE_NOT_REPLACE_V1 — KEYED BY IDENTITY, NOT POSITION. `key={i}` was safe only
        // while the array was replaced wholesale and grew from the end. The merge can now reconcile an
        // optimistic bubble to its server row in place, which is a mid-thread identity change, and an
        // index key would silently rebind every bubble after it. `id` when the server has written the
        // row, the message's own stable local key before that.
        messages.map((m) => (
          <div key={m.id ?? m.lkey} className={m.role === 'user' ? s.rowUser : s.rowAssistant}>
            {/* An assistant turn is LoraTurn: the static mark on the page background at the answer's own
                text margin, then the bubble. Same element and position the working state uses, so
                nothing jumps when the answer lands. */}
            {m.role === 'assistant' ? (
              <LoraTurn>
                <div className={s.bubbleAssistant}>
                  <Md>{m.content}</Md>
                </div>
              </LoraTurn>
            ) : (
              <div className={s.bubbleUser}>{m.content}</div>
            )}
          </div>
        ))
      )}
      {loading && (
        /* ⛔ LORAMER_CHAT_STREAM_THE_ANSWER_V1 (S1) — ONCE THE ANSWER IS ARRIVING, SHOW THE ANSWER.
           MEASURED 2026-08-06: the final 88 seconds of a 365-second turn carried ~12,000 characters of
           real answer text, every ~717ms, and the screen painted none of it. A status line on top of an
           answer that is already on the wire is a worse signal than the answer itself.
           ⚠ STILL ONE INDICATOR PER TURN: the working mark shows while there is nothing to read, and the
           streaming bubble REPLACES it the moment there is. They are never both on screen.
           ⚠ AND THIS IS A PREVIEW, NOT A MESSAGE — it is not in `messages`, it is discarded when the
           authoritative `answer` event lands, and nothing is persisted from it. */
        streamingText ? (
          <div className={s.rowAssistant}>
            <LoraTurn>
              <div className={s.bubbleAssistant}>
                <Md>{streamingText}</Md>
              </div>
            </LoraTurn>
          </div>
        ) : (
          /* ⛔ NO CONTAINER — no pill, no bubble, no border. The mark and the line render on the page
             background and LoraWorking reserves the vertical space the answer will fill. */
          <div className={s.rowAssistant}>
            <LoraWorking status={streamStatus} />
          </div>
        )
      )}
    </div>
  )

  return (
    <>
      {/* LORAMER_CHAT_COPY_BLOCKS_V1 — the copy affordance's reset key. clientId, so a client switch on
          the always-mounted shelf clears every "Copied" flag; '' on the portfolio Shell where there is
          no real client. See the CopyResetContext note above for why a local timer is not enough. */}
      <CopyResetContext.Provider value={clientId ?? ''}>
      <div className={isPanel ? s.scroll : s.list} ref={isPanel ? scrollRef : undefined}>
        {debugSlot}
        {/* LORAMER_NEXT_LANDING_PROBE_VISIBLE_V1 — the landing readout, on screen, ?debug=chat only.
            One line per shot: shot · scrollY · scrollHeight · viewport · pinned · arriving, then REST.
            Russ reads and screenshots this; there is no other channel on Chrome iOS. */}
        {debug && probeLines.length > 0 && (
          <div className={s.landingProbe}>
            {probeLines.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        )}
        {list}
      </div>

      <div ref={composerRef} className={`${s.composerShared} ${isPanel ? s.composerPanel : s.composer}`}>
        {/* LORAMER_COMPOSER_VV_PROBE_V1 — debug-gated, page only. Written imperatively by the rAF loop
            above, never through React, so it stays legible during a momentum flick without costing a
            render per frame. `debug` is the EXISTING ?debug=chat flag (sessionStorage
            `loramer:debug-chat`) — no new gate was invented, which is half of why the landing probe
            became unreachable. */}
        {debug && !isPanel && <div ref={vvProbeRef} className={s.vvProbe} />}
        {/* ⛔ LORAMER_PINNED_ELEMENT_SWEEP_V1, 2026-08-07 — ALWAYS MOUNTED. THE CHEVRON'S DEFECT WAS
            NEVER ITS POSITION, AND THAT IS WHY THE HEADER'S FIX DID NOT TRANSFER TO IT.
            Gate-B: it flickered in sync with flick speed AND SLIGHTLY AFTER IT. This was
            `{!pinned && (<button …>)}` — a CONDITIONAL RENDER. `pinned` is React state that the scroll
            handler drives (use-stick-to-bottom.ts: `dist <= NEAR_BOTTOM_PX ? setPin(true) :
            movedUp && setPin(false)`), so a hard momentum flick crosses the 80px threshold repeatedly,
            and EVERY CROSSING MOUNTED OR UNMOUNTED THIS BUTTON one React render after the event.
            "Bounces, slightly after" is appear/disappear latency — not position judder. The header,
            which is never conditionally rendered, went solid while this did not.
            ⛔ THE FIX IS TO STOP CHANGING EXISTENCE, NOT TO CHASE THE LATENCY. Pinned-ness is now a
            CLASS: the box is always in the layout, and the transition is an opacity change the
            compositor owns. ⚠ THE FRAME-LATE RENDER IS STILL THERE AND IS NOT CLAIMED AWAY — it is
            simply no longer visible as a box appearing and disappearing.
            aria-hidden + tabIndex -1 keep it out of the a11y tree and the tab order while hidden,
            which `{!pinned && …}` used to get for free by not existing. */}
        <button
          type="button"
          className={`${s.jump} ${pinned ? s.jumpHidden : ''}`}
          aria-hidden={pinned}
          tabIndex={pinned ? -1 : 0}
          onClick={() => { setPin(true); bottom('smooth') }}
          aria-label="Jump to latest"
        >
          <Icon d={CHEVRON_DOWN} size={20} />
        </button>
        {/* LORAMER_CHAT_COMPOSER_AUTOGROW_V1 — rows={1} is the FLOOR, the CSS max-height is the CEILING,
            and everything between is either `field-sizing: content` or the effect above. */}
        <textarea
          ref={inputRef}
          className={s.input}
          value={input}
          onChange={(e) => { noteInput?.(); setInput(e.target.value) }}
          onKeyDown={(e) => {
            // Enter-to-send is a send: it gets the same forced scroll as the button. Without this the
            // keyboard path and the button path disagree, which is how one of them stays broken.
            const willSend = e.key === 'Enter' && !e.shiftKey && input.trim() && !loading
            onKeyDown(e)
            if (willSend) forceBottom()
          }}
          // ⚠ FOCUS OBEYS THE PIN. Focusing the composer while reading history used to yank the page to
          // the bottom; it no longer can. Nothing is lost — the composer is sticky on the page and
          // in-flow on the shelf, so it is already on screen wherever they are.
          onFocus={() => { onComposerFocus(); onFocusExtra?.(); followBottom() }}
          placeholder="Ask Lora…"
          rows={1}
        />
        <button
          type="button"
          className={s.send}
          // D2: forceBottom, NOT setPin(true) — see the note on forceBottom. Sending is a deliberate
          // act and must always land on your own message, whatever the pin state was a moment ago.
          onClick={() => { send(input); forceBottom() }}
          disabled={!input.trim() || loading}
          aria-label="Send"
        >
          <Icon d={ARROW_UP} size={19} />
        </button>
      </div>
      </CopyResetContext.Provider>
    </>
  )
}
