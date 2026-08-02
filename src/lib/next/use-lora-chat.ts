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
import { classifyTurnFailure, pickRecoveredAnswer, COPY, RECOVERY_WINDOW_MS, RECOVERY_POLL_MS } from '@/lib/next/chat-recovery'
import { renderSubjectLine } from '@/lib/chat/tool-subject' // LORAMER_CHAT_STATUS_SUBJECT_V1 — one renderer, shared with the guard
import { logNextConversationTurn, NEXT_CHAT_SURFACE } from '@/lib/next/log-conversation-turn'

export type Msg = { role: 'user' | 'assistant'; content: string; recoveryKey?: string }

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
  const [period, setPeriod] = useState<SharedPeriod>(() => getSharedPeriod())
  const [streamStatus, setStreamStatusRaw] = useState<string | null>(null)
  // LORAMER_LAGGING_EVENT_CANNOT_GATE_A_SYNCHRONOUS_CONSUMER_V1 — the SSE handler fires many times in one tick;
  // reading `streamStatus` there is stale by construction. The ref is the synchronous truth, the state is what
  // renders, and setStreamStatus writes both so they cannot drift.
  const streamStatusRef = useRef<string | null>(null)
  const setStreamStatus = useCallback((v: string | null | ((p: string | null) => string | null)) => {
    const next = typeof v === 'function' ? (v as (p: string | null) => string | null)(streamStatusRef.current) : v
    streamStatusRef.current = next
    setStreamStatusRaw(next)
  }, [])
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

  useEffect(() => {
    if (!active) return
    const cid = clientId || null
    if (hydratedForRef.current === cid) return
    hydratedForRef.current = cid
    if (!cid) { setMessages([]); return }   // portfolio Shell (no real client) — nothing to load
    let cancelled = false
    ;(async () => {
      try {
        const params = new URLSearchParams({ clientId: cid, surface: NEXT_CHAT_SURFACE })
        const r = await fetch('/api/conversations?' + params.toString())
        const d = await r.json().catch(() => ({}))
        const rows = Array.isArray(d.messages) ? d.messages : []
        threadMaxIdRef.current = rows.reduce((mx: number, m: { id?: number }) => Math.max(mx, Number(m?.id) || 0), 0) || null // LORAMER_CHAT_ANSWER_RECOVERY_V1
        const prior = rows.map((m: { role: 'user' | 'assistant'; content: string }) => ({ role: m.role, content: m.content }))
        if (!cancelled) setMessages(prior)   // this client's OWN history (empty array if none) — never the prior client's
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
  }, [active, clientId])

  useEffect(() => {
    // LORAMER_NEXT_CHAT_VIEWPORT_PROBE_V1 — STICKY for the session. This effect runs once on mount and
    // reads window.location.search; -next navigates CLIENT-SIDE (TopBar does router.push(?clientId=)),
    // which REWRITES the query and drops `debug=chat`. That is the most likely reason the readout was
    // invisible on 2026-07-26 — the flag was silently lost on the way to the client page. Once seen, it
    // is remembered for the tab, and `?debug=off` clears it.
    try {
      const q = new URLSearchParams(window.location.search).get('debug')
      if (q === 'off') { sessionStorage.removeItem('loramer:debug-chat'); setDebug(false); return }
      const on = q === 'chat' || sessionStorage.getItem('loramer:debug-chat') === '1'
      if (on) sessionStorage.setItem('loramer:debug-chat', '1')
      setDebug(on)
    } catch { /* URL/storage unavailable — stay off */ }
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

  // Fired from the textarea's onFocus. t=0 baseline, then t=600ms after the keyboard animation settles.
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

  const send = useCallback(async (text: string) => {
    const q = text.trim()
    if (!q || loading) return
    // LORAMER_NEXT_CONV_WRITE_V1 — snapshot the drill focus at turn start so BOTH turns of one exchange share a
    // scope even if the panel closes mid-flight (rowCtxRef is cleared on close). 'drill' = opened from a drill row.
    const turnScope = rowCtxRef.current ? 'drill' : null
    const next = [...messages, { role: 'user' as const, content: q }]
    setMessages(next)
    setInput('')
    setLoading(true)
    // LORAMER_NEXT_CONV_WRITE_V1 — persist the USER turn (fire-and-forget; never awaited, never throws). Logged
    // regardless of whether the reply below succeeds — the user really said it, exactly as the legacy surfaces log.
    logNextConversationTurn({ clientId, role: 'user', content: q, scope: turnScope })
    // LORAMER_CHAT_CLIENT_ABORT_V1 — a DELIBERATE client-side ceiling SHORTER than the server maxDuration (300s), so a
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
        if (ev === 'tool' && data?.phase === 'start') setStreamStatus(renderSubjectLine(data))
        else if (ev === 'tool' && data?.phase === 'finish') setStreamStatus((s) => s) // keep the last subject; the next start replaces it
        else if (ev === 'delta' && !streamStatusRef.current) setStreamStatus('Working…')
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
      setMessages((m) => [...m, { role: 'assistant', content: reply }])
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
      // ONE bubble, keyed, replaced in place — never a second bubble appended.
      const key = `rec:${Date.now()}`
      setMessages((m) => [...m, { role: 'assistant', content: COPY.CHECKING, recoveryKey: key }])
      const replace = (content: string) =>
        setMessages((m) => m.map((x) => (x.recoveryKey === key ? { role: 'assistant' as const, content } : x)))
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
            if (got.status === 'ambiguous') { replace(COPY.AMBIGUOUS); done = true; break }
          } catch { /* a failed recovery read must never throw into the turn */ }
          await new Promise((r) => setTimeout(r, RECOVERY_POLL_MS))
        }
      }
      if (!done) {
        // The answer may still land after our window closes (server maxDuration 300s > our 240s), so force
        // the next open to re-read the thread rather than trusting the per-client hydration guard.
        hydratedForRef.current = null
        replace(kind === 'aborted' ? COPY.ABORTED_UNCONFIRMED : COPY.NETWORK_UNCONFIRMED)
      }
    } finally {
      clearTimeout(abortTimer)
      setStreamStatus(null)
      setLoading(false)
    }
  }, [messages, loading, clientId, clientName, period])


  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
  }

  return {
    messages, setMessages, input, setInput, loading, streamStatus, period,
    debug, probeLine, inputRef, rowCtxRef, threadMaxIdRef, hydratedForRef,
    send, onKeyDown, onComposerFocus, probeRef,
  }
}
