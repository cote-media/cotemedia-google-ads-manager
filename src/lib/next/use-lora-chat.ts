// LORAMER_LORA_CHAT_HOOK_V1 — THE CONVERSATION ENGINE, extracted from ChatLauncher unchanged.
//
// WHY: mobile Lora becomes its own PAGE (LORAMER_LORA_PAGE_SHELL_RESOLUTION_V1) while desktop keeps the
// right-docked shelf. Two containers, ONE engine. Forking the engine would mean two send loops, two
// recovery paths and two persistence paths drifting apart — the exact shape of defect this repo has
// spent the day paying for.
//
// THIS IS A MECHANICAL EXTRACTION. Every block below was MOVED from ChatLauncher, not rewritten. The
// ONLY substantive change is that the shelf's `open` became `active`, because the shelf is open/closed
// and the page is always on. Behaviour is otherwise identical, and the existing chat guards + a WebKit
// re-run of the shelf's Gate-A are what prove it.
//
// WHAT STAYED IN THE CONTAINERS (deliberately — these are container concerns, not engine concerns):
//   shelf → open state, the portal, the scrim/panel markup, the body scroll lock, the history/back
//           entry, Esc-to-close, and the legacy ?debug=chat horizontal readout (it measures the panel
//           rect, which only the shelf has)
//   page  → document scroll management, its own markup
'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { readChatResponse, CHAT_IDLE_GAP_MS, CHAT_TOTAL_MS } from '@/lib/chat-stream-read'
import { getSharedPeriod, type SharedPeriod } from '@/lib/next/period-bus'
import { classifyTurnFailure, pickRecoveredAnswer, COPY, RECOVERY_WINDOW_MS, RECOVERY_POLL_MS, type ConvRow } from '@/lib/next/chat-recovery'
import { renderSubjectLine, aggregateSubjects, MIN_SUBJECT_MS } from '@/lib/chat/tool-subject' // LORAMER_CHAT_STATUS_SUBJECT_V1 — one renderer, shared with the guard
import { logNextConversationTurn, NEXT_CHAT_SURFACE } from '@/lib/next/log-conversation-turn'
// LORAMER_CHAT_MERGE_NOT_REPLACE_V1 — the thread is merged, never replaced. `Msg` moved to that module
// because the merge OWNS the shape (id + lkey are the merge's own keys); it is re-exported here so every
// existing `import type { Msg } from '@/lib/next/use-lora-chat'` keeps working.
import { mergeThreadForClient, newLocalKey, type Msg } from '@/lib/next/merge-thread'
// LORAMER_CHAT_IN_FLIGHT_SURVIVES_REMOUNT_V1 — the one fact that has to outlive the mount.
import { markTurnInFlight, clearTurnInFlight, readTurnInFlight, remainingWindowMs } from '@/lib/next/in-flight-turn'

export type { Msg }

// LORAMER_NEXT_CHAT_VISUAL_VIEWPORT_V2 / PROBE — "the keyboard is up" is a MEASURED geometric fact:
// the layout viewport is materially taller than the visual one. Device values 2026-07-26: 766 vs 428.
const KEYBOARD_MIN_DELTA_PX = 100

// `panelRef` is the container's own outer element. The probe reports its rect, and the shelf and the
// page have different outer elements — so the container supplies it rather than the engine assuming one.
export function useLoraChat({ clientId, clientName, active, panelRef }: {
  clientId?: string; clientName?: string; active: boolean
  panelRef?: React.RefObject<HTMLElement | null>
}) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  // ⛔ LORAMER_CHAT_STOP_CANCELS_SERVER_V1 — THE LIVE CONTROLLER AND THE REASON IT WAS ABORTED.
  // The turn already owns an AbortController, but it exists for DEADLINES and nothing outside the send
  // closure can reach it. Stop needs both halves: a handle to abort, and a way for the catch to tell a
  // USER stop from a TIMEOUT — because they must not behave the same. A timeout is "we do not know what
  // happened" and starts a recovery poll; a stop is "the user decided" and must NEVER be recovered, or a
  // turn they cancelled reappears minutes later. `controller.signal.aborted` is true for BOTH, so the
  // signal alone cannot answer it — hence a separate flag set only on the user path.
  const turnControllerRef = useRef<AbortController | null>(null)
  const userStoppedRef = useRef(false)
  const [period, setPeriod] = useState<SharedPeriod>(() => getSharedPeriod())
  const [streamStatus, setStreamStatusRaw] = useState<string | null>(null)
  // LORAMER_LAGGING_EVENT_CANNOT_GATE_A_SYNCHRONOUS_CONSUMER_V1 — the SSE handler fires many times in one tick;
  // reading `streamStatus` there is stale by construction. The ref is the synchronous truth, the state is what
  // renders, and setStreamStatus writes both so they cannot drift.
  const streamStatusRef = useRef<string | null>(null)
  // ⛔ (S2) THE READABLE FLOOR. A subject replaced 1ms after it appears was never shown at all. A
  // replacement inside MIN_SUBJECT_MS is DEFERRED, not dropped — the newest pending value wins when the
  // floor expires, so nothing is lost and nothing flickers.
  const statusSetAtRef = useRef<number>(0)
  const pendingStatusRef = useRef<{ v: string | null; t: number } | null>(null)
  const setStreamStatus = useCallback((v: string | null | ((p: string | null) => string | null)) => {
    const next = typeof v === 'function' ? (v as (p: string | null) => string | null)(streamStatusRef.current) : v
    // Clearing (null) is immediate — a turn ending must never wait on a cosmetic floor.
    const now = Date.now()
    const elapsed = now - statusSetAtRef.current
    if (next !== null && statusSetAtRef.current && elapsed < MIN_SUBJECT_MS) {
      pendingStatusRef.current = { v: next, t: now }
      window.setTimeout(() => {
        const p = pendingStatusRef.current
        if (!p) return
        pendingStatusRef.current = null
        statusSetAtRef.current = Date.now()
        streamStatusRef.current = p.v
        setStreamStatusRaw(p.v)
      }, MIN_SUBJECT_MS - elapsed)
      return
    }
    pendingStatusRef.current = null
    statusSetAtRef.current = next === null ? 0 : now
    streamStatusRef.current = next
    setStreamStatusRaw(next)
  }, [])
  // ⛔ LORAMER_CHAT_STREAM_THE_ANSWER_V1 (S1) — THE ANSWER TEXT, AS IT ARRIVES.
  // MEASURED 2026-08-06 by the frame probe: deltas land every ~717ms carrying 79-212 characters, about
  // 12,000 characters over 88 seconds, and the screen painted NONE of it. That is the answer already on
  // the wire while the user looks at a static line.
  // ⚠ THIS SUPERSEDES A BANKED DECISION, and it is Russ's to make: LORAMER_CHAT_STATUS_SUBJECT_V1
  // decided "THE ANSWER ARRIVES WHOLE" and made `delta` a liveness marker only. He overrode it on the
  // measurement. The `answer` event REMAINS AUTHORITATIVE — this is a preview that is thrown away the
  // moment the real one lands, never a second source of truth.
  const [streamingText, setStreamingText] = useState<string>('')
  // LORAMER_CHAT_STOP_CANCELS_SERVER_V1 — the streamed text mirrored into a ref. The catch runs OUTSIDE
  // the SSE reader's closure, so `live` is unreachable there and React state is a frame behind; a stop
  // must keep text the user already paid for, and a frame-behind read would drop the last delta.
  const streamingTextRef = useRef<string>('')
  // The partial answer of a STOPPED turn, surfaced as its own thing. ⛔ It is NOT pushed into `messages`:
  // the thread's identity/merge machinery (recoveryKey, lkey, mergeThreadForClient) is load-bearing and a
  // stopped partial has no server row to merge against, so inventing one would put a message in the
  // thread that the server does not have. Kept as a distinct, clearly-marked surface instead.
  const [stoppedText, setStoppedText] = useState<string | null>(null)

  // ⛔ (S2) CONCURRENT TOOL SUBJECTS — AGGREGATED, NOT OVERWRITTEN. MEASURED: tool frames arrive in
  // bursts 0-2ms apart (seq 11→12 was 1ms), and a single-slot status showed only the LAST. Russ saw 3
  // subjects on a turn that emitted at least 5. `renderedStatus` in the probe proved it: at seq 11 the
  // screen still held the previous line; 1ms later it held seq 11's, already being replaced by seq 12's.
  const activeToolsRef = useRef<Map<string, string>>(new Map())
  const [probeLine, setProbeLine] = useState<string | null>(null)
  const [debug, setDebug] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const rowCtxRef = useRef<string | null>(null)
  const threadMaxIdRef = useRef<number | null>(null)
  const hydratedForRef = useRef<string | null>(null)

  useEffect(() => {
    setPeriod(getSharedPeriod())
    const onPeriod = (e: Event) => { const d = (e as CustomEvent).detail; if (d) setPeriod(d as SharedPeriod) }
    window.addEventListener('loramer:period', onPeriod)
    return () => window.removeEventListener('loramer:period', onPeriod)
  }, [])

  // Esc closes; focus the input + scroll to the newest message when open/updated.

  // ⛔ LORAMER_CHAT_SCREEN_TRACKS_SERVER_V1 — ONE THREAD READ, TWO CALLERS. The mount hydration below
  // and the visibility-regain refresh further down MUST NOT be two implementations of "load the thread";
  // that is how the two chat surfaces drifted in the first place, one layer up.
  // LORAMER_CHAT_MERGE_NOT_REPLACE_V1 — WHICH CLIENT THE CURRENT `messages` BELONG TO. Not derivable
  // from `clientId`: the prop changes the instant the user switches, while `messages` still holds the
  // PREVIOUS client's thread until a read lands. This ref is the only thing that can tell those apart,
  // and it is what makes the merge client-scoped rather than a cross-client leak.
  const messagesClientRef = useRef<string | null>(null)
  // LORAMER_CHAT_IN_FLIGHT_SURVIVES_REMOUNT_V1 — is `send` running in THIS mount? Distinguishes "a turn
  // is in flight and already being watched here" from "a turn was in flight when a previous mount died".
  const turnRunningRef = useRef(false)

  // ⛔ THE SINGLE FUNNEL. Every path that adopts a server thread goes through here — mount hydration,
  // the visibility/focus refresh, and the recovery ambiguous branch. There were three hand-rolled
  // wholesale replaces; there is now one merge, and a guard that fails the build if a fourth appears.
  const applyServerThread = useCallback((cid: string, rows: readonly unknown[]) => {
    const localClientId = messagesClientRef.current
    messagesClientRef.current = cid
    setMessages((prev) => mergeThreadForClient(prev, rows, { localClientId, serverClientId: cid }))
  }, [])

  const readThread = useCallback(async (cid: string): Promise<Msg[] | null> => {
    try {
      const params = new URLSearchParams({ clientId: cid, surface: NEXT_CHAT_SURFACE })
      const r = await fetch('/api/conversations?' + params.toString(), { cache: 'no-store' })
      const d = await r.json().catch(() => ({}))
      const rows = Array.isArray(d.messages) ? d.messages : []
      return rows as Msg[]
    } catch { return null }   // a failed read must never blank a live thread
  }, [])

  useEffect(() => {
    if (!active) return
    const cid = clientId || null
    if (hydratedForRef.current === cid) return
    hydratedForRef.current = cid
    // Portfolio Shell (no real client) — nothing to load. ⚠ THIS BARE REPLACE IS CORRECT AND STAYS:
    // there is no client, so there is no thread to merge INTO and nothing to preserve. The merge guard
    // allowlists this one site by name; it must not be "fixed" into a merge.
    if (!cid) { setMessages([]); messagesClientRef.current = null; return }
    let cancelled = false
    ;(async () => {
      try {
        const params = new URLSearchParams({ clientId: cid, surface: NEXT_CHAT_SURFACE })
        const r = await fetch('/api/conversations?' + params.toString())
        const d = await r.json().catch(() => ({}))
        const rows = Array.isArray(d.messages) ? d.messages : []
        threadMaxIdRef.current = rows.reduce((mx: number, m: { id?: number }) => Math.max(mx, Number(m?.id) || 0), 0) || null // LORAMER_CHAT_ANSWER_RECOVERY_V1
        // LORAMER_CHAT_MERGE_NOT_REPLACE_V1 — was `setMessages(rows.map(m => ({role, content})))`, which
        // discarded the ids AND anything typed while the fetch was in flight. The merge is client-scoped,
        // so "this client's OWN history — never the prior client's" still holds by construction.
        if (!cancelled) applyServerThread(cid, rows)
      } catch { /* a failed load must not blank a live thread or cross-contaminate — leave the fresh-mount empty state */ }
    })()
    return () => {
      cancelled = true
      // ⚠ RELEASE THE GUARD ON CANCEL. The ref is claimed BEFORE the async fetch so two overlapping
      // runs cannot both hydrate — but if this run is torn down before its fetch lands, the claim must
      // be released or the NEXT run early-returns and NOTHING ever hydrates.
      // MEASURED: the page mounts with active=true, so React StrictMode's mount→cleanup→mount cycle hit
      // exactly this — pass 1 claimed the ref and started the fetch, cleanup cancelled it, pass 2
      // early-returned on the claim. The GET returned 34 messages and the page rendered 0 bubbles and
      // the empty state. The shelf never showed it because its effect is gated on `open`, which starts
      // false, so both StrictMode passes early-returned and the real run happened once on user action.
      // This also protects any genuine remount, not just StrictMode.
      if (hydratedForRef.current === cid) hydratedForRef.current = null
    }
  }, [active, clientId, applyServerThread])

  useEffect(() => {
    // LORAMER_NEXT_CHAT_VIEWPORT_PROBE_V1 — STICKY for the session. This effect runs once on mount and
    // reads window.location.search; -next navigates CLIENT-SIDE (TopBar does router.push(?clientId=)),
    // which REWRITES the query and drops `debug=chat`. That is the most likely reason the readout was
    // invisible on 2026-07-26 — the flag was silently lost on the way to the client page. Once seen, it
    // is remembered for the tab, and `?debug=off` clears it.
    // ── LORAMER_DEBUG_FLAG_SURVIVES_V1, 2026-08-07 — THE INSTRUMENT COST A GATE-B ROUND TRIP.
    // FOUR device captures came back with NO readout: the flag had not survived the trip to the page,
    // so the one screenshot that separates the last two composer candidates still does not exist.
    // ⛔ WHICH EVENT CLEARED IT WAS NEVER ISOLATED, AND THAT IS RECORDED RATHER THAN GUESSED
    // (★DEBUG-FLAG-DID-NOT-SURVIVE-CAPTURE). Three candidates, and the fix below covers all three:
    //   1. TAB CLOSE / DISCARD — sessionStorage is scoped to the tab session and dies with it (MDN).
    //      A tab the OS discarded under memory pressure and restored is the same shape. UNVERIFIED.
    //   2. URL-BAR NAVIGATION ON WebKit, VENDOR-ACKNOWLEDGED — developer.apple.com/forums/thread/724189:
    //      sessionStorage does not persist when you navigate to another route on the same site by
    //      editing the URL in the address bar. EVERY iOS BROWSER IS WebKit, and pasting the URL is
    //      exactly how this flag gets turned on. The likeliest, and still a bet.
    //   3. ⛔ THE ONE PROVABLE FROM THE CODE, AND A DEFECT WHATEVER ELSE IS TRUE: the old `catch`
    //      swallowed a storage failure AND TOOK AN EXPLICIT `?debug=chat` DOWN WITH IT, because the URL
    //      read sat INSIDE the try. The user asks for the probe, the URL says so, and the instrument
    //      stays dark with no signal — the house `.catch(() => [])` pathology in the one place whose
    //      entire job is to be observable.
    //
    // ⛔ THE URL IS READ OUTSIDE THE try AND WINS UNCONDITIONALLY. Persistence is a convenience; an
    // explicit request is not. Storage may fail in every way it likes and `?debug=chat` still arms.
    const q = (() => {
      try { return new URLSearchParams(window.location.search).get('debug') } catch { return null }
    })()
    if (q === 'off') {
      // The kill switch clears BOTH stores. Writing one and clearing the other would leave a stale key
      // in the store we no longer write, and it would re-arm on the next mount.
      try { localStorage.removeItem('loramer:debug-chat') } catch { /* ignore */ }
      try { sessionStorage.removeItem('loramer:debug-chat') } catch { /* ignore */ }
      setDebug(false)
      return
    }
    // localStorage is the store that survives tab close, discard and restore; sessionStorage is still
    // READ so a session armed before this change keeps working rather than silently going dark.
    let remembered = false
    try { remembered = localStorage.getItem('loramer:debug-chat') === '1' } catch { /* ignore */ }
    if (!remembered) {
      try { remembered = sessionStorage.getItem('loramer:debug-chat') === '1' } catch { /* ignore */ }
    }
    const on = q === 'chat' || remembered
    if (on) {
      try { localStorage.setItem('loramer:debug-chat', '1') } catch { /* persistence is best-effort */ }
    }
    setDebug(on)
  }, [])

  // LORAMER_NEXT_CHAT_VIEWPORT_PROBE_V1 — THE MEASUREMENT, automatic. On composer focus (i.e. the
  // moment the keyboard is summoned) capture the full viewport state and POST it to the server, which
  // logs it. Russ reads nothing and relays nothing.
  // TWO SAMPLES, deliberately: the keyboard ANIMATES in, so a single synchronous read at focus captures
  // the PRE-keyboard state and would lie. t=0 is the baseline, t=600ms is after the animation settles;
  // the DIFFERENCE between them is the signal.
  // `scale` is the number that decides the mechanism: > 1 means iOS auto-zoomed on the sub-16px input,
  // which shrinks the VISUAL viewport while position:fixed stays sized to the LAYOUT viewport — that
  // would explain content appearing below a "full-screen" sheet. == 1 falsifies the auto-zoom candidate.

  const probeSample = useCallback((phase: string) => {
    try {
      const vv = window.visualViewport
      const scrim = document.querySelector('[role="dialog"]')?.getBoundingClientRect()
      const panel = panelRef?.current?.getBoundingClientRect()
      const r = (b?: DOMRect) => (b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom) } : null)
      return {
        probe: 'chat-viewport',
        phase,
        at: new Date().toISOString(),
        route: window.location.pathname + window.location.search,
        ua: navigator.userAgent,
        vv: vv ? { scale: vv.scale, height: vv.height, width: vv.width, offsetTop: vv.offsetTop, offsetLeft: vv.offsetLeft, pageTop: vv.pageTop, pageLeft: vv.pageLeft } : null,
        doc: { clientHeight: document.documentElement.clientHeight, clientWidth: document.documentElement.clientWidth },
        win: { innerHeight: window.innerHeight, innerWidth: window.innerWidth, scrollY: window.scrollY },
        scrim: r(scrim as DOMRect | undefined),
        panel: r(panel),
      }
    } catch { return null }
  }, [])

  // LORAMER_NEXT_CHAT_PROBE_FREEZE_V1 — FREEZE THE DISPLAY ON THE FIRST KEYBOARD-OPEN SAMPLE.
  // THE DEFECT THIS FIXES (2026-07-26): the readout live-updated, so by the time Russ looked at it, it
  // was showing whatever the latest sample was — and he relayed `scale 1.000 / vvH 766`, which the
  // server proved was the focus+600 sample taken SIX SECONDS BEFORE the keyboard opened. The number was
  // true and the phase was wrong, and it very nearly banked a false falsification of the real cause.
  // The screen now latches the first sample where the keyboard is actually up and holds it, so what a
  // human reads is always the phase that matters. The SERVER still receives every sample.

  const frozenRef = useRef(false)
  useEffect(() => { if (active) frozenRef.current = false }, [active])   // fresh latch per open

  const probeRef = useRef<(p: string) => void>(() => {})
  probeRef.current = (phase: string) => {
    if (!debug) return   // HARD GATE — no flag, no capture, no request. Ever.
    const s = probeSample(phase)
    if (!s) return
    // "keyboard is up" = the VISUAL viewport is materially shorter than the LAYOUT viewport. Measured
    // 2026-07-26: 766 -> 428, a 338px delta. 100px is well clear of address-bar chrome jitter.
    const keyboardUp = !!s.vv && s.doc.clientHeight - s.vv.height > 100
    if (!frozenRef.current) {
      setProbeLine(`${keyboardUp ? 'KEYBOARD UP · ' : ''}scale ${s.vv ? s.vv.scale.toFixed(4) : 'no-vv'} · vvH ${s.vv ? Math.round(s.vv.height) : '—'} · docH ${s.doc.clientHeight} · overhang ${s.vv ? Math.round(s.doc.clientHeight - s.vv.height) : '—'} · panelBottom ${s.panel?.bottom ?? '—'}`)
      if (keyboardUp) frozenRef.current = true   // latch: this is the phase a human must see
    }
    void fetch('/api/debug/viewport-probe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s),
      keepalive: true,   // the page may be mid-layout-thrash; keepalive so the beacon still lands
    }).catch(() => { /* a failed probe must never surface to the user */ })
  }

  // ── LORAMER_CHAT_FRAME_PROBE_V1 — WHAT THE SCREEN ACTUALLY RECEIVES, AND WHEN ─────────────────────
  // ⛔ THE QUESTION, AND IT IS NOT ANSWERABLE FROM A CODE READ. Streaming is CONFIRMED ON in production
  // (`streaming: true` in the route's own `[chat] cache:` log, twice), and the route emits per-tool
  // subjects — "Reading Foam OH · Google · Nov–Dec 2024". Russ still sees "Working…" for most of a
  // multi-minute turn. THREE possibilities and a code read cannot separate them: the frames are NOT
  // ARRIVING, they ARE arriving and NOT RENDERING, or they are being OVERWRITTEN faster than a human
  // can read them. FIVE UI theories have died from code reads on this repo; this is the instrument.
  //
  // ⛔ TIMESTAMPS ARE THE POINT, NOT THE FRAME NAMES. The three silent windows have never been
  // measured: (a) before the first frame — auth, RBAC and context assembly, with no channel open;
  // (b) between a tool `start` and its `finish`, where one subject holds however long the query runs;
  // (c) the final composing turn, where only `delta` moves and by decision paints nothing. `sinceSendMs`
  // and `sincePrevMs` are what turn "8 frames arrived" into "and there were 94 seconds of silence here".
  //
  // ⛔ HARD-GATED ON `debug`, exactly like the viewport probe: no flag, no capture, no request, ever.
  // It reuses the SAME auth-gated endpoint rather than adding a second one — a debug surface with two
  // doors is two things to secure.
  const turnStartRef = useRef<number>(0)
  const lastFrameAtRef = useRef<number>(0)
  const frameSeqRef = useRef<number>(0)
  const probeFrameRef = useRef<(ev: string, data: any) => void>(() => {})
  probeFrameRef.current = (ev: string, data: any) => {
    if (!debug) return
    const now = Date.now()
    const seq = ++frameSeqRef.current
    const sincePrev = lastFrameAtRef.current ? now - lastFrameAtRef.current : 0
    lastFrameAtRef.current = now
    // The LABEL is what the user would see. Captured verbatim so "the frame arrived" and "the frame
    // carried something worth showing" are separable — a `tool` frame with an empty subject renders as
    // nothing and would otherwise look identical to a frame that never came.
    const label = typeof data?.label === 'string' ? data.label
      : ev === 'tool' ? `${data?.phase ?? '?'}:${data?.name ?? data?.tool ?? '?'}`
      : ev === 'delta' ? `+${String(data?.text ?? '').length}ch`
      : null
    void fetch('/api/debug/viewport-probe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({
        probe: 'chat-viewport',          // the endpoint's literal gate — one door, not two
        phase: `frame:${ev}`,
        at: new Date(now).toISOString(),
        route: window.location.pathname + window.location.search,
        frame: {
          seq, event: ev, label,
          sinceSendMs: turnStartRef.current ? now - turnStartRef.current : null,
          sincePrevMs: sincePrev,
          // What the USER is looking at right now. If this reads "Working…" while `label` carries a
          // real subject, the frames arrive and the render is the defect — which is the whole question.
          renderedStatus: streamStatusRef.current,
        },
      }),
    }).catch(() => { /* a failed probe must never surface to the user */ })
  }

  // ⛔ EVERY send() INVOCATION, WITH ENOUGH TO TELL A RE-FIRE FROM A KEYSTROKE. ★CHAT-FIVE-DEFECTS left
  // "was the second send programmatic or Russ retyping" UNRESOLVED, and it must not stay a guess: a
  // programmatic re-fire arrives with no interaction behind it, so `msSinceLastInput` is large and
  // `hadRecentInteraction` is false, while a keystroke has both. `textHash` (a length + cheap digest,
  // never the text) tells a duplicate question from a new one without logging what anyone asked.
  const lastInputAtRef = useRef<number>(0)
  const probeSendRef = useRef<(text: string) => void>(() => {})
  probeSendRef.current = (text: string) => {
    if (!debug) return
    const now = Date.now()
    let h = 0
    for (let i = 0; i < text.length; i++) { h = (h * 31 + text.charCodeAt(i)) | 0 }
    void fetch('/api/debug/viewport-probe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({
        probe: 'chat-viewport',
        phase: 'send',
        at: new Date(now).toISOString(),
        route: window.location.pathname + window.location.search,
        send: {
          textLen: text.length,
          textHash: h,                                   // identity WITHOUT content
          msSinceLastInput: lastInputAtRef.current ? now - lastInputAtRef.current : null,
          hadRecentInteraction: !!lastInputAtRef.current && now - lastInputAtRef.current < 30_000,
          visibility: document.visibilityState,
        },
      }),
    }).catch(() => {})
  }

  // Fired from the textarea's onFocus. t=0 baseline, then t=600ms after the keyboard animation settles.
  // LORAMER_CHAT_FRAME_PROBE_V1 — TYPING counts as interaction, not just Enter. A send preceded by
  // neither is the signature of a programmatic re-fire, which is the question this half exists to
  // settle; without this a user who typed and clicked Send would look exactly like a re-fire.
  const noteInput = useCallback(() => { lastInputAtRef.current = Date.now() }, [])

  const onComposerFocus = useCallback(() => {
    if (!debug) return
    probeRef.current('focus+0')
    window.setTimeout(() => probeRef.current('focus+600'), 600)
  }, [debug])

  // LORAMER_NEXT_CHAT_VIEWPORT_PROBE_V1 — SAMPLE ON VIEWPORT CHANGE, not only on focus.
  // CAUGHT IN GATE-A: the panel AUTO-FOCUSES the composer ~60ms after open, so by the time Russ taps
  // the message box the textarea is ALREADY focused and onFocus never fires again. On iOS that is
  // fatal to the whole instrument — programmatic focus does not raise the keyboard, so the only sample
  // would be the no-keyboard state, which is exactly the reading we already have and do not need.
  // visualViewport.resize fires when the keyboard actually opens, whatever caused it. That is the
  // event that matters, so it is sampled directly and the focus path is kept as a belt.

  useEffect(() => {
    if (!debug || !active) return
    const vv = window.visualViewport
    if (!vv) return
    let t: number | undefined
    const onResize = () => {
      window.clearTimeout(t)
      probeRef.current('vv-resize')                                   // immediate: the transition itself
      t = window.setTimeout(() => probeRef.current('vv-resize+600'), 600) // settled: after the animation
    }
    vv.addEventListener('resize', onResize)
    return () => { vv.removeEventListener('resize', onResize); window.clearTimeout(t) }
  }, [debug, active])

  // ── LORAMER_CHAT_SCREEN_TRACKS_SERVER_V1 — D1: THE SCREEN MUST TRACK THE SERVER ────────────────
  // ⛔ THE DEFECT, PROVEN FROM ROWS AND NOT FROM A CODE READ. `hydratedForRef` reads the thread ONCE PER
  // CLIENT, on mount, and never again. MEASURED 2026-08-05: user turn 23:38:37Z, Russ navigated away and
  // back at ~23:40 (the one read ran THERE), and the answer was persisted at 23:42:59Z. The server
  // finished; the screen had already stopped looking. **NOTHING WAS KILLED** — there is no unmount abort
  // in this file, and /api/chat writes the assistant turn from its own completion path regardless of the
  // browser. The surface was correct at the instant it looked and permanently wrong afterwards.
  //
  // ⛔ AND IT IS THE ROOT OF A CHAIN: a screen showing nothing invites a re-send, a re-send bills a second
  // turn ($1.5158 + $0.9721 for one question that night), and two fresh assistant rows then push
  // `pickRecoveredAnswer` into its `ambiguous` branch — whose internal sentence reached the user (D5).
  //
  // THE MECHANISM IS THE CHEAPEST ONE THAT WORKS AND NOTHING MORE: re-read the EXISTING thread when the
  // surface becomes visible again. ⛔ No polling loop, no notification channel, no new table, no push —
  // all four were considered and are not needed, because the answer is already durable server-side and
  // /api/conversations already returns it.
  //
  // ⚠ THE WATERMARK IS WHAT MAKES A LATE READ SAFE. `threadMaxIdRef` is the max row id we have already
  // rendered; a refresh only ADOPTS the server's thread when it carries ids ABOVE it. Without that a slow
  // response landing after a client switch could paint another client's history, which is the d55f739
  // class. Same discriminator `pickRecoveredAnswer` uses, deliberately — one rule, not two.
  useEffect(() => {
    if (!active) return
    const cid = clientId || null
    if (!cid) return
    let running = false
    const refresh = async () => {
      if (running || document.visibilityState !== 'visible') return
      running = true
      try {
        const rows = await readThread(cid)
        if (!rows) return
        const maxId = rows.reduce((mx: number, m: any) => Math.max(mx, Number(m?.id) || 0), 0)
        // NOTHING NEW ON THE SERVER → SKIP THE WORK. ⚠ THIS IS NOW AN OPTIMISATION, NOT A SAFETY GATE,
        // and the distinction is the whole of fix (3). It used to be the only thing standing between a
        // refresh and a wholesale replace — and it did not stand, because a NULL watermark falls straight
        // through it: `threadMaxIdRef.current != null` short-circuits false and the replace ran
        // unconditionally. MEASURED, and wider than "hydration failed": :131 reads `reduce(...) || null`,
        // so reduce's 0 becomes null and EVERY BRAND-NEW CONVERSATION carries a null watermark on the
        // HAPPY PATH. The first refresh after the first turn was therefore an unconditional replace by
        // design, not by failure. Falling through is now harmless because the fall-through MERGES.
        if (!maxId || (threadMaxIdRef.current != null && maxId <= threadMaxIdRef.current)) return
        threadMaxIdRef.current = maxId
        applyServerThread(cid, rows)
      } finally { running = false }
    }
    const onVis = () => { void refresh() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    // Fire once on mount-with-active too: returning via a client-side route change re-mounts without ever
    // firing visibilitychange, which is EXACTLY the path Russ took.
    void refresh()
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
    }
  }, [active, clientId, readThread, applyServerThread])

  // ⛔ LORAMER_CHAT_IN_FLIGHT_SURVIVES_REMOUNT_V1 — RESUME A TURN THE PREVIOUS MOUNT WAS WATCHING.
  //
  // ONE MECHANISM, BOTH TAILS, and that is why it is a resumed RECOVERY rather than a new poll:
  //   · the tab was backgrounded mid-turn and came back to a fresh mount → the record is found here, the
  //     working indicator comes back, and the poll runs out the turn's remaining window;
  //   · the page never went anywhere and no trigger ever fired (the 22:03 loss) → the record is STILL
  //     found here, because it is written the moment `send` starts and only cleared when the turn ends.
  //     The poll is the trigger that was missing.
  //
  // ⚠ WHY REUSE `chat-recovery` RATHER THAN BUILD A SECOND MECHANISM — the brief asked and the code
  // answers: `pickRecoveredAnswer` + `RECOVERY_WINDOW_MS`/`RECOVERY_POLL_MS` ALREADY do exactly this, and
  // a second poll would be a second discriminator that drifts from the first. Same reasoning that put ONE
  // `readThread` behind two callers. A realtime SUBSCRIPTION was considered and rejected: it is a new
  // channel, new permissions and a new failure mode for an answer that is already durable and already
  // reachable through an endpoint we call anyway.
  //
  // ⚠ AND THIS IS ONLY SAFE BECAUSE OF e3c1f05. The poll lands the thread through `applyServerThread`,
  // which MERGES — so an answer arriving here cannot duplicate a bubble the mount already rendered, and
  // cannot erase an optimistic turn. Under the old wholesale replace this fix would have shipped a
  // second way to blank the screen.
  useEffect(() => {
    if (!active) return
    const cid = clientId || null
    if (!cid) return
    // A turn running in THIS mount is already being watched by `send`'s own loop. Without this the
    // desktop shelf — which can be closed and reopened mid-turn, re-running this effect — would start a
    // second poll alongside the live one.
    if (turnRunningRef.current) return
    const rec = readTurnInFlight(cid, Date.now())
    if (!rec) return   // absent, another client's, or past the 500s bound — all three refuse in the module

    let cancelled = false
    setLoading(true)
    setStreamStatus(COPY.RESUMED)
    ;(async () => {
      try {
        while (!cancelled && remainingWindowMs(rec, Date.now()) > 0) {
          try {
            const rows = await readThread(cid)
            if (rows) {
              const got = pickRecoveredAnswer(rows as ConvRow[], rec.sinceId ?? 0)
              // 'ambiguous' counts as landed for the same reason the recovery branch adopts the thread:
              // more than one new answer means the answers are all present and in order. Show them.
              if (got.status === 'found' || got.status === 'ambiguous') {
                threadMaxIdRef.current = rows.reduce((mx: number, m: any) => Math.max(mx, Number(m?.id) || 0), 0) || threadMaxIdRef.current
                applyServerThread(cid, rows)
                break
              }
            }
          } catch { /* a failed resume read must never throw into a mount */ }
          await new Promise((r) => setTimeout(r, RECOVERY_POLL_MS))
        }
      } finally {
        // ⚠ CLEARED ON EVERY EXIT, INCLUDING THE TIMEOUT. A record that outlives its window would make
        // the NEXT mount light the indicator for a turn that is already over — the defect, inverted.
        if (!cancelled) {
          clearTurnInFlight()
          setLoading(false)
          setStreamStatus(null)
        }
      }
    })()
    return () => { cancelled = true }
  }, [active, clientId, readThread, applyServerThread, setStreamStatus])

  const send = useCallback(async (text: string) => {
    const q = text.trim()
    if (!q || loading) return
    // LORAMER_NEXT_CONV_WRITE_V1 — snapshot the drill focus at turn start so BOTH turns of one exchange share a
    // scope even if the panel closes mid-flight (rowCtxRef is cleared on close). 'drill' = opened from a drill row.
    const turnScope = rowCtxRef.current ? 'drill' : null
    // LORAMER_CHAT_MERGE_NOT_REPLACE_V1 — the optimistic turn carries a stable local key from birth. It
    // is what React renders against until the server row's id arrives, and what lets the merge reconcile
    // this exact bubble to that row IN PLACE instead of showing the message twice.
    const next: Msg[] = [...messages, { role: 'user' as const, content: q, lkey: newLocalKey('u') }]
    if (clientId) messagesClientRef.current = clientId
    setMessages(next)
    setInput('')
    setLoading(true)
    // LORAMER_CHAT_IN_FLIGHT_SURVIVES_REMOUNT_V1 — RECORD THE TURN BEFORE ANY AWAIT. If the page dies
    // between here and the first byte, the next mount still knows to keep looking. `threadMaxIdRef` is
    // captured NOW because it is the watermark `pickRecoveredAnswer` needs, and it advances during the turn.
    turnRunningRef.current = true
    if (clientId) markTurnInFlight({ clientId, sinceId: threadMaxIdRef.current, startedAt: Date.now() })
    // LORAMER_CHAT_FRAME_PROBE_V1 — the clock every frame gap is measured against.
    setStreamingText('')
    activeToolsRef.current.clear()
    turnStartRef.current = Date.now()
    lastFrameAtRef.current = 0
    frameSeqRef.current = 0
    probeSendRef.current(q)
    // LORAMER_NEXT_CONV_WRITE_V1 — persist the USER turn (fire-and-forget; never awaited, never throws). Logged
    // regardless of whether the reply below succeeds — the user really said it, exactly as the legacy surfaces log.
    logNextConversationTurn({ clientId, role: 'user', content: q, scope: turnScope })
    // LORAMER_CHAT_CLIENT_ABORT_V1 — a DELIBERATE client-side ceiling SHORTER than the server maxDuration (500s as of
    // 2026-08-05; was 300s), so a
    // slow turn fails at a KNOWN bound with an HONEST message instead of at an unknown browser/gateway limit that
    // surfaced a misleading "Network error." 120s clears the observed ~59s worst case (and heavier multi-tool turns),
    // so normal turns are untouched. Stopgap; the durable fix is streaming (★CHAT-STREAMING).
    // LORAMER_CHAT_STREAMING_V1 — IDLE-GAP, not total-duration. A streamed turn has no meaningful total bound; a
    // DEAD one stops producing bytes. The timer is re-armed on every SSE event, so a legitimately long multi-tool
    // answer never trips it while a dropped connection is caught in 45s. With streaming OFF nothing re-arms it and
    // it degrades to exactly the original 120s total cap — byte-identical behavior, one timer, no second code path.
    // LORAMER_CHAT_ANSWER_RECOVERY_V1 — DUAL DEADLINE. The old rearmIdle REPLACED the total cap, so once
    // the first event arrived the absolute ceiling vanished and a stream dripping one byte every 40s ran
    // forever. The ABSOLUTE deadline is now set once and never re-armed; the IDLE timer arms only AFTER the
    // first SSE event (rearmIdle is called from the event callback), so with streaming OFF — no events ever —
    // the total cap alone governs and a healthy 200s blocking turn is never killed by an idle gap it was not
    // in. Every re-arm is CLAMPED to the remaining time, so the deadline always wins.
    const controller = new AbortController()
    turnControllerRef.current = controller
    userStoppedRef.current = false
    streamingTextRef.current = ''
    setStoppedText(null)   // a new question clears the previous stop; it does not stack
    const deadlineAt = Date.now() + CHAT_TOTAL_MS
    let abortTimer = setTimeout(() => controller.abort(), CHAT_TOTAL_MS)
    const rearmIdle = () => {
      clearTimeout(abortTimer)
      abortTimer = setTimeout(() => controller.abort(), Math.max(0, Math.min(CHAT_IDLE_GAP_MS, deadlineAt - Date.now())))
    }
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: q,
          history: messages, // prior turns only (server appends the new message from `message`)
          clientId,
          clientName,
          dateRange: period.dateRange || 'LAST_30_DAYS',
          customStart: period.customStart,
          customEnd: period.customEnd,
          location: 'chat',
          // LORAMER_CHAT_SERVER_TURN_WRITE_V1 — declare the conversation target so the SERVER writes
          // the assistant turn. This is what moves ownership; without it the server writes nothing.
          persistTurn: { surface: NEXT_CHAT_SURFACE, scope: turnScope },
          ...(rowCtxRef.current ? { rowContext: rowCtxRef.current } : {}), // LORAMER_NEXT_PLATFORM_PAGE_V1 — per-row focus (drill ✦); absent otherwise
        }),
      })
      const d = await readChatResponse(res, (ev, data, live) => {
        // FIRST, so a frame is recorded even if something below throws. A probe that only runs on the
        // happy path cannot see the failure it was built for.
        probeFrameRef.current(ev, data)
        rearmIdle()
        // LIVE RENDER. `live` is the answer text accumulated so far, so the user watches it appear instead of a
        // spinner. On a tool event the reader has already cleared it (preamble is narration, not answer) and we
        // show what Lora is actually doing. All of this is TRANSIENT — cleared in the finally block, and
        // logNextConversationTurn still fires only on the authoritative answer, so nothing provisional persists.
        // LORAMER_CHAT_STATUS_SUBJECT_V1 — the line now names the WORK, not the tool: "Reading Foam OH · Google ·
        // Nov–Dec 2024". renderSubjectLine is the SAME function the guard drives, so what ships and what is
        // proven cannot drift.
        // ⛔ THE ANSWER ARRIVES WHOLE (decided 2026-07-28). `delta` no longer paints text into the status line —
        // it only marks that work is still moving, so the idle timer re-arms and the mark keeps animating. The
        // authoritative `answer` event renders the reply in one piece, exactly as the blocking path does.
        // LORAMER_CHAT_STATUS_FIRST_V1 — the `status` channel was DECLARED in the StreamEmit union and NEVER
        // EMITTED, so the first thing that could set this line was the first tool event. On a data question
        // that is the far side of a whole model turn, and the device showed dots for over a minute. `status`
        // now leads every turn, so the line is the FIRST thing on screen rather than the last.
        // ⛔ S1 — PAINT THE ANSWER. `live` is the reader's accumulated delta text and it is ALREADY the
        // final-turn answer (claude-tools: `stream.on('text')` → emit('delta') is the FINAL turn only;
        // the reader clears `live` on any tool frame, so preamble narration never leaks in).
        if (ev === 'delta') { streamingTextRef.current = live; setStreamingText(live) }

        if (ev === 'status' && data?.label) setStreamStatus(data.label)
        else if (ev === 'tool' && data?.phase === 'start') {
          // ⛔ AGGREGATE, DO NOT REPLACE. Key on the tool_use id so a finish can remove exactly its own
          // entry; two starts 1ms apart now produce ONE line naming BOTH, instead of one winning.
          const id = String(data?.id ?? `t${activeToolsRef.current.size}`)
          activeToolsRef.current.set(id, renderSubjectLine(data))
          setStreamStatus(aggregateSubjects(activeToolsRef.current))
        }
        else if (ev === 'tool' && data?.phase === 'finish') {
          // The line holds until the NEXT start — removing it here would blank the status between tools,
          // which is the silence this flight exists to remove, one layer smaller.
          const id = String(data?.id ?? '')
          if (id) activeToolsRef.current.delete(id)
        }
        // ⚠ NO `delta → "Working…"` FALLBACK ANY MORE. It existed because delta painted nothing and the
        // line needed *something*; now the delta paints the answer itself, so a generic word on top of
        // real text would be noise. If no status has arrived the line simply stays empty and the
        // streaming bubble carries the signal.
      })
      // LORAMER_CHAT_FAILURE_BRANCHES_V1 — EVERY failure mode gets its OWN sentence. Before this, a 503 from an
      // exhausted model chain and a 500 from a real bug rendered the SAME string, so the user could not tell
      // "Anthropic is busy, retry in a minute" from "something is broken, tell Russ" — and neither could we,
      // reading a screenshot. The `error` codes are machine-readable and set by the route, not sniffed from prose.
      const reply = d.ok
        ? (d.response || 'I wasn’t able to complete that — please try rephrasing.')
        : d.error === 'Client not found'
          ? 'I can’t access this client’s data from here.'
          : d.error === 'overloaded'
            // Chain exhausted: every model was busy. This is Anthropic-side capacity, NOT your data and NOT a
            // bug — say so, because the honest action is "wait and re-ask", not "report a problem".
            ? 'Claude is overloaded right now — I tried every model available to me and all of them were busy. Nothing is wrong with your data or your connection. Please try again in a minute.'
            // LORAMER_CHAT_500_HONESTY_V1 — a DEFINITE server error gets the server string. On
            // 2026-07-27 a 500 ("Request timed out" from the model chain) rendered as a connection
            // story: the connection was fine, the server answered, and no answer was ever produced.
            : COPY.SERVER_ERROR
      // ⛔ THE PREVIEW IS DISCARDED THE MOMENT THE AUTHORITATIVE ANSWER EXISTS. `reply` comes from the
      // `answer` event (or an error branch); the streamed text was never a second source of truth.
      setStreamingText('')
      setMessages((m) => [...m, { role: 'assistant', content: reply, lkey: newLocalKey('a') }])
      // LORAMER_CHAT_SERVER_TURN_WRITE_V1 — the assistant turn is written SERVER-SIDE by /api/chat,
      // from inside the stream close path. It is NOT written here and must never be: this line ran
      // only if the browser survived the read, which is how two answers were lost on 2026-07-26.
      // The user turn above stays client-side (unchanged this slice).
    } catch (e) {
      // LORAMER_CHAT_ANSWER_RECOVERY_V1 (amends LORAMER_CHAT_CLIENT_ABORT_V1 + LORAMER_CHAT_FAILURE_BRANCHES_V1).
      // Classify on the SIGNAL WE OWN, not the error's name: iOS Safari reports an abort as
      // `TypeError: Load failed`, identical to a real network drop, which is how a COMPLETED turn rendered as
      // "the connection dropped" on 2026-07-26. No string here may assert the answer was lost — since the
      // server persists the assistant turn from its own completion path, that claim is false and unknowable.
      // ⛔ A USER STOP IS NOT A TURN FAILURE, AND IT MUST NOT ENTER ANY RECOVERY PATH.
      // `classifyTurnFailure` would call this `aborted` — the same verdict a DEADLINE gets — and the
      // aborted branch starts a recovery poll and shows ABORTED_UNCONFIRMED ("we do not know if it
      // landed"). For a deliberate stop both are wrong: the user knows exactly what happened, and a
      // recovered answer arriving minutes later is WORSE THAN NO BUTTON — it is the turn they paid to
      // cancel, rendering itself anyway.
      // ⚠ THE PARTIAL TEXT IS KEPT ON PURPOSE. Those tokens were generated and billed; discarding them
      // would be the second way to lose the user's money. It is committed as a normal assistant turn and
      // the UI marks it stopped, rather than being thrown away or left floating as a live stream.
      if (userStoppedRef.current) {
        const partial = streamingTextRef.current
        setStoppedText(partial && partial.trim() ? partial : '')
        clearTurnInFlight()
        return
      }
      const kind = classifyTurnFailure(controller.signal.aborted, e)
      // LORAMER_CHAT_FAILURE_TELEMETRY_V1 — CAPTURE THE DECISION, do not infer it later. On 2026-07-27
      // the server returned a definite 500 and the client took the CATCH path and showed a network
      // story; from server logs alone it was impossible to tell whether the fetch threw, what it threw,
      // or whether our own abort fired. One line, console only, no PII beyond the client id.
      try {
        console.error('[chat] TURN FAILED', JSON.stringify({
          branch: kind,
          signalAborted: controller.signal.aborted,
          errName: (e as { name?: string } | null)?.name ?? null,
          errMessage: String((e as { message?: string } | null)?.message ?? '').slice(0, 200),
          elapsedMs: Date.now() - (deadlineAt - CHAT_TOTAL_MS),
          clientId: clientId ?? null,
        }))
      } catch { /* telemetry must never break a turn */ }
      // ⛔ LORAMER_ONE_WORKING_INDICATOR_PER_TURN_V1 — CLEAR `loading` BEFORE THE RECOVERY BUBBLE EXISTS,
      // AND THE ORDER OF THESE TWO STATEMENTS IS THE WHOLE FIX.
      //
      // THE DEFECT, OBSERVED ON DEVICE 2026-08-05 (Chrome iOS, Foam OH, one turn): a large static LM mark,
      // then a bubble reading "Still working on this one…", then a SECOND animating LM mark reading
      // "Working…". Two indicators, stacked, for a single turn.
      //
      // ⛔ IT IS NOT A STYLING BUG AND IT IS NOT IN LoraWorking. `setLoading(false)` lives in the `finally`
      // below, and `finally` cannot run until this catch block RETURNS — and this catch block AWAITS the
      // recovery poll for up to RECOVERY_WINDOW_MS (90s). So for that entire window `loading` is still
      // true, every surface keeps rendering `{loading && <LoraWorking/>}`, and the recovery bubble we
      // append on the next line renders through LoraTurn WITH ITS OWN AVATAR MARK. Two marks, two working
      // copies, one turn — deterministically, on every recovered turn, on both surfaces.
      //
      // THE RECOVERY BUBBLE *IS* THE WORKING INDICATOR from here on: it says so in its own words. So the
      // generic one must stand down at the moment the specific one appears, not 90 seconds later.
      //
      // ⚠ BEHAVIOUR THIS DELIBERATELY CHANGES, stated rather than discovered later: `send()` early-returns
      // on `loading`, so the composer was locked for the whole recovery window. It no longer is. That is
      // correct — the turn is over as far as the UI is concerned and the poll is a background READ, never a
      // re-POST — and it is safe, because `replace()` targets the bubble by `recoveryKey` and still lands
      // in place however many turns are appended after it.
      setLoading(false)
      setStreamStatus(null)
      setStreamingText('')
      activeToolsRef.current.clear()
      // ONE bubble, keyed, replaced in place — never a second bubble appended.
      const key = `rec:${Date.now()}`
      setMessages((m) => [...m, { role: 'assistant', content: COPY.CHECKING, recoveryKey: key, lkey: newLocalKey('rec') }])
      // ⛔ SPREAD, NOT REBUILD. This used to return a fresh `{ role, content }` and drop both
      // `recoveryKey` and — once keys became stable — `lkey`. Under an index key that was invisible;
      // under a stable key it DESTROYS THE BUBBLE'S IDENTITY mid-thread, so React unmounts the message
      // the user is reading and mounts a different one in its place. The spread preserves both.
      const replace = (content: string) =>
        setMessages((m) => m.map((x) => (x.recoveryKey === key ? { ...x, role: 'assistant' as const, content } : x)))
      // RECOVERY IS A READ. It re-fetches the thread; it NEVER re-POSTs /api/chat. A silent retry would
      // double the spend on a turn that most likely already succeeded.
      let done = false
      const since = threadMaxIdRef.current
      if (clientId && since != null) {
        const until = Date.now() + RECOVERY_WINDOW_MS
        while (!done && Date.now() < until) {
          try {
            const params = new URLSearchParams({ clientId, surface: NEXT_CHAT_SURFACE })
            const rr = await fetch('/api/conversations?' + params.toString())
            const dd = await rr.json().catch(() => ({}))
            const got = pickRecoveredAnswer(Array.isArray(dd.messages) ? dd.messages : [], since)
            if (got.status === 'found') { threadMaxIdRef.current = got.maxId; replace(got.text); done = true; break }
            // ⛔ LORAMER_CHAT_SCREEN_TRACKS_SERVER_V1 — D5: DO NOT NARRATE OUR OWN UNCERTAINTY AT A USER.
            // This used to render COPY.AMBIGUOUS (now AMBIGUOUS_INTERNAL_DO_NOT_RENDER) — "There's more than one new answer on this client and I
            // won't guess which is yours. Scroll up to see the full thread." — which reached Russ on
            // 2026-08-05. It explains OUR machinery to someone who did not ask about it, and it asks them
            // to do the work. The answers are all present and in order: SHOW THEM. Dropping the recovery
            // bubble entirely and adopting the server's thread is both more honest and more useful.
            if (got.status === 'ambiguous') {
              const all = await readThread(clientId)
              if (all && all.length) {
                threadMaxIdRef.current = all.reduce((mx: number, m: any) => Math.max(mx, Number(m?.id) || 0), 0) || got.maxId
                // LORAMER_CHAT_MERGE_NOT_REPLACE_V1 — adopting the server's thread no longer means
                // discarding the recovery bubble by side effect. The merge keeps it (it has no server row
                // yet) and the explicit filter below is what removes it, deliberately, on the other branch.
                applyServerThread(clientId, all)
                setMessages((m) => m.filter((x) => x.recoveryKey !== key))
              } else {
                // The read failed. Still never show the internal sentence — drop the placeholder and let
                // the visibility refresh pick the thread up.
                setMessages((m) => m.filter((x) => x.recoveryKey !== key))
              }
              done = true; break
            }
          } catch { /* a failed recovery read must never throw into the turn */ }
          await new Promise((r) => setTimeout(r, RECOVERY_POLL_MS))
        }
      }
      if (!done) {
        // The answer may still land after our window closes (server maxDuration 500s > our 440s), so force
        // the next open to re-read the thread rather than trusting the per-client hydration guard.
        hydratedForRef.current = null
        replace(kind === 'aborted' ? COPY.ABORTED_UNCONFIRMED : COPY.NETWORK_UNCONFIRMED)
      }
    } finally {
      clearTimeout(abortTimer)
      // LORAMER_CHAT_IN_FLIGHT_SURVIVES_REMOUNT_V1 — the turn is over on THIS mount, whichever branch got
      // here. Leaving the record behind would make the next mount resume a finished turn.
      turnRunningRef.current = false
      clearTurnInFlight()
      setStreamStatus(null)
      setStreamingText('')
      activeToolsRef.current.clear()
      setLoading(false)
    }
  }, [messages, loading, clientId, clientName, period])


  // ⛔ LORAMER_CHAT_STOP_CANCELS_SERVER_V1 — ABORTING THE FETCH IS THE WHOLE POINT, NOT A UI GESTURE.
  // The abort closes the HTTP connection; `vercel.json`'s `supportsCancellation` makes the platform
  // surface that as `request.signal` on the function; the route forwards it to the Anthropic SDK; and
  // Anthropic stops generating AND stops billing. Every link is required — dropping any one leaves a
  // button that hides output while the meter runs.
  // The flag is set BEFORE abort() so the catch, which runs synchronously off the rejection, can never
  // observe the abort without the reason for it.
  const stop = useCallback(() => {
    userStoppedRef.current = true
    try { turnControllerRef.current?.abort() } catch { /* already gone */ }
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    lastInputAtRef.current = Date.now()   // LORAMER_CHAT_FRAME_PROBE_V1 — evidence of a real keystroke
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
  }

  return {
    messages, setMessages, input, setInput, loading, streamStatus, streamingText, stoppedText, period,
    debug, probeLine, inputRef, rowCtxRef, threadMaxIdRef, hydratedForRef, noteInput,
    send, stop, onKeyDown, onComposerFocus, probeRef,
  }
}
