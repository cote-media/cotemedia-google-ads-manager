// LORAMER_LORA_PAGE_PROBE_V1 — THROWAWAY. Delete after we learn from it.
//
// THE ONE QUESTION: does a NORMAL DOCUMENT keep the composer above the iOS keyboard, via the browser's
// own scroll-into-view, WITHOUT us computing any geometry?
//
// Six attempts at the overlay approach failed. Every one of them positioned the composer by hand. This
// page positions nothing: the composer is an ordinary in-flow element at the end of the document, and
// the browser is left to do what it does natively on focus.
//
// RULES THIS PROBE OBEYS — break any of them and it stops being a valid test:
//   · NO dvh anywhere (the 874 finding: dvh resolves to the LARGE viewport, 874 on a 766 layout one)
//   · NO visualViewport binding, NO JS geometry, NO position:fixed on the composer
//   · page height by normal document flow; the DOCUMENT is the scroller
//   · carried over: 16px input (no iOS auto-zoom), safe-area insets, overscroll-behavior contain
//
// ⚠ LIVES AT /lora-probe, THE APP ROOT — deliberately NOT under /dashboard-next. That tree's layout
// runs isPreviewUser() and enforceWelcomeGate(), which is what blocked access. Moving the route OUT of
// the gated tree needs ZERO middleware change: middleware's matcher only covers legacy paths
// (/dashboard/*, /clients/*, six /api routes) and never matched this. No exemption, no hole.
//
// ⚠ DELIBERATELY NOT WRAPPED IN <Shell>. Shell's `.main` sets `overflow: hidden` and `.root` sets
// `min-height: 100vh` with a flex column — that would defeat document-flow scrolling and the probe
// would be testing the overlay pattern again by accident. NOTE FOR THE REAL BUILD: if /lora ends up
// inside Shell, that `overflow: hidden` has to be dealt with or the whole approach is moot.
'use client'
import { useEffect, useRef, useState } from 'react'

const BUBBLES = Array.from({ length: 40 }, (_, i) => ({
  role: i % 2 === 0 ? 'assistant' : 'user',
  text: i % 2 === 0
    ? `Assistant message ${i + 1}. This is filler so the document genuinely overflows and the page has something real to scroll.`
    : `User message ${i + 1}.`,
}))

export default function LoraProbePage() {
  const [line, setLine] = useState('PROBE ARMED — tap the box')
  const frozen = useRef(false)
  const composerRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) { setLine('no visualViewport'); return }

    const sample = (phase: string) => {
      const c = composerRef.current?.getBoundingClientRect()
      const t = taRef.current?.getBoundingClientRect()
      const docH = document.documentElement.clientHeight
      const keyboardUp = docH - vv.height > 100
      // THE NUMBER THAT ANSWERS THE QUESTION: the composer's bottom edge, expressed in VISUAL-viewport
      // coordinates, against the bottom of the visible band. <= 0 means the browser kept it on screen
      // by itself. > 0 means it is under the keyboard and document flow did NOT save us.
      const visibleBottom = vv.height
      const composerBottomInVisual = c ? c.bottom - vv.offsetTop : null
      const clearance = composerBottomInVisual == null ? null : Math.round(visibleBottom - composerBottomInVisual)

      const payload = {
        probe: 'lora-page-probe',
        phase: `page-${phase}`,
        at: new Date().toISOString(),
        route: window.location.pathname,
        note: 'lora page probe — public, dummy content only',
        ua: navigator.userAgent,
        vv: { scale: vv.scale, height: vv.height, width: vv.width, offsetTop: vv.offsetTop, offsetLeft: vv.offsetLeft, pageTop: vv.pageTop, pageLeft: vv.pageLeft },
        doc: { clientHeight: docH, clientWidth: document.documentElement.clientWidth, scrollHeight: document.documentElement.scrollHeight },
        win: { innerHeight: window.innerHeight, innerWidth: window.innerWidth, scrollY: Math.round(window.scrollY) },
        composer: c ? { top: Math.round(c.top), bottom: Math.round(c.bottom), h: Math.round(c.height) } : null,
        textarea: t ? { top: Math.round(t.top), bottom: Math.round(t.bottom) } : null,
        verdict: { keyboardUp, composerBottomInVisual: composerBottomInVisual == null ? null : Math.round(composerBottomInVisual), visibleBottom: Math.round(visibleBottom), clearancePx: clearance, composerVisible: clearance != null && clearance >= 0 },
      }
      if (!frozen.current) {
        setLine(`${keyboardUp ? 'KEYBOARD UP · ' : ''}vvH ${Math.round(vv.height)} · docH ${docH} · scrollY ${Math.round(window.scrollY)} · composerBottom ${payload.verdict.composerBottomInVisual ?? '—'} · clearance ${clearance ?? '—'} · ${clearance != null && clearance >= 0 ? 'VISIBLE' : 'UNDER KEYBOARD'}`)
        if (keyboardUp) frozen.current = true   // latch the keyboard-up phase, per the 07-26 lesson
      }
      void fetch('/api/debug/lora-probe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), keepalive: true,
      }).catch(() => {})
    }

    sample('mount')
    let t: number | undefined
    const onResize = () => {
      window.clearTimeout(t)
      sample('vv-resize')
      t = window.setTimeout(() => sample('vv-resize+600'), 600)
    }
    vv.addEventListener('resize', onResize)
    vv.addEventListener('scroll', onResize)
    return () => { vv.removeEventListener('resize', onResize); vv.removeEventListener('scroll', onResize); window.clearTimeout(t) }
  }, [])

  return (
    <>
      <style>{`
        /* Plain markup, inline styles — no CSS module, no design tokens, nothing to inherit or sever. */
        .p-wrap { font-family: system-ui, -apple-system, sans-serif; color: #0f172a; background: #fff; }
        .p-head {
          position: sticky; top: 0; z-index: 2; background: #fff;
          border-bottom: 1px solid #f1f5f9;
          padding: calc(12px + env(safe-area-inset-top, 0px)) 16px 12px;
          font-weight: 600; font-size: 15px;
        }
        .p-readout {
          position: sticky; top: 0; z-index: 3;
          background: #facc15; color: #0f172a;
          font: 700 14px/1.35 ui-monospace, Menlo, monospace;
          padding: 8px 12px; white-space: pre-wrap; overflow-wrap: anywhere;
          border-bottom: 2px solid #0f172a;
        }
        /* THE LIST IS NOT A SCROLL CONTAINER. The DOCUMENT scrolls — that is the whole point of the
           probe. overscroll-behavior is set as instructed; with document-flow scrolling it is inert
           here, and that is worth knowing rather than hiding. */
        .p-list { overscroll-behavior: contain; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
        .p-bubble { max-width: 85%; padding: 9px 13px; border-radius: 14px; font-size: 14px; line-height: 1.5; }
        .p-a { background: #f1f5f9; color: #0f172a; align-self: flex-start; }
        .p-u { background: #2563eb; color: #fff; align-self: flex-end; }
        /* COMPOSER: ordinary in-flow element. No position:fixed, no sticky, no computed height. */
        .p-composer {
          display: flex; align-items: flex-end; gap: 8px;
          border-top: 1px solid #f1f5f9; background: #fff;
          padding: 12px 14px calc(12px + env(safe-area-inset-bottom, 0px));
        }
        .p-input {
          flex: 1; min-width: 0; resize: none; max-height: 120px; padding: 10px 12px;
          border: 1px solid #dbe2ea; border-radius: 12px; font: inherit; font-size: 16px;
          line-height: 1.4; outline: none; overscroll-behavior: contain;
        }
        .p-send {
          flex-shrink: 0; width: 38px; height: 38px; border-radius: 50%; border: none;
          background: #2563eb; color: #fff; font-size: 18px; display: grid; place-items: center;
        }
      `}</style>
      <div className="p-wrap">
        <div className="p-readout">{line}</div>
        <div className="p-head">Lora page probe — throwaway</div>
        <div className="p-list">
          {BUBBLES.map((b, i) => (
            <div key={i} className={`p-bubble ${b.role === 'user' ? 'p-u' : 'p-a'}`}>{b.text}</div>
          ))}
        </div>
        <div className="p-composer" ref={composerRef}>
          <textarea ref={taRef} className="p-input" rows={1} placeholder="Type here — keyboard up, 3 seconds" />
          <button type="button" className="p-send" aria-label="Send">↑</button>
        </div>
      </div>
    </>
  )
}
