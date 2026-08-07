'use client'
// LORAMER_NEXT_LANDING_SCROLL_V1 — the Overview's half of the arrival intent.
//
// A one-line client component mounted by the Overview (a server component) purely so there is somewhere
// for a `useEffect` to live. It renders nothing.
//
// ⛔ WHY IT CANNOT JUST BE "scroll to top on mount": that would break the GOOD half of the router's
// restoration. A user who scrolls the Overview, opens a drill and comes back SHOULD land where they
// were — that is App Router doing its job. Only an arrival FROM LORA is being corrected here, and the
// only thing that knows the arrival came from Lora is the navigation that left it. Hence the one-shot
// intent rather than an unconditional scroll.
import { useEffect } from 'react'
import { consumeLanding, jumpToTopInstant, LANDING } from '@/lib/next/landing-scroll'

export default function LandingScroll({ clientId }: { clientId?: string | null }) {
  useEffect(() => {
    // Consumed once. If Lora did not record an intent for this client, this is a no-op and the router's
    // own restoration is left entirely alone.
    if (consumeLanding(LANDING.OVERVIEW, clientId ?? null) === 'top') jumpToTopInstant()
  }, [clientId])
  return null
}
