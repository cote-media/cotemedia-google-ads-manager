'use client'
// First-time user coachmark explaining the ✦ diamond buttons.
// Shows once per user (stored in localStorage), dismissable.
// Anchors to the first AskClaudeCardButton diamond on the page.
//
// Strategy: it's a fixed-position tooltip near the top-right area where the
// first section diamond lives ("Campaign Performance"). We don't try to dynamically
// anchor — that's fragile across screen sizes. Instead we explain the diamonds
// with a clear illustration and let the user discover them in context.

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'loramer-coachmark-diamonds-seen'

export function DiamondCoachmark() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        // Small delay so dashboard data loads first
        const timer = setTimeout(() => setShow(true), 1500)
        return () => clearTimeout(timer)
      }
    } catch {}
  }, [])

  function dismiss() {
    setShow(false)
    try { localStorage.setItem(STORAGE_KEY, 'true') } catch {}
  }

  if (!show) return null

  return (
    <div
      role="dialog"
      aria-label="Tip about Ask Claude diamonds"
      className="fixed bottom-6 right-6 md:bottom-8 md:right-8 z-50 max-w-sm bg-white border border-accent shadow-xl rounded-xl overflow-hidden"
    >
      <div className="px-4 py-3 bg-blue-50 border-b border-accent/20 flex items-center justify-between">
        <p className="text-xs font-mono uppercase tracking-widest text-accent">✦ Quick tip</p>
        <button
          onClick={dismiss}
          className="text-muted hover:text-ink text-base leading-none ml-2"
          aria-label="Dismiss tip"
        >
          ×
        </button>
      </div>
      <div className="px-4 py-3">
        <p className="text-sm text-ink leading-relaxed mb-3">
          See the <span className="inline-block text-accent font-medium">✦</span> icons on each section? Tap any of them to ask Claude about that specific data — campaign performance, top keywords, budget, anything.
        </p>
        <p className="text-xs text-muted leading-relaxed mb-3">
          Claude already knows which client you&apos;re viewing and what data is on screen.
        </p>
        <button
          onClick={dismiss}
          className="btn-primary text-xs px-3 py-1.5"
        >
          Got it
        </button>
      </div>
    </div>
  )
}
