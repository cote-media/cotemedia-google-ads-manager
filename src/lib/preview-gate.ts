// LORAMER_PREVIEW_GATE_V1
// Server-only per-user preview gate for the build-dark redesign program (see
// docs/LORAMER_REDESIGN_SPEC.md §2 — OPERATING MODEL). Renders the redesign ONLY for an
// allowlist of Russ's own accounts; demo@loramer.com and every other user fall through to the
// CURRENT screencast-matching UI. FAIL-CLOSED: any error / missing env / missing session /
// empty email returns false (CURRENT UI). Mirrors the getServerSession pattern in
// src/lib/welcome-gate.ts.
//
// The allowlist lives in process.env.PREVIEW_ALLOWLIST (comma-separated emails). It has NO
// NEXT_PUBLIC_ prefix on purpose — it must stay server-only and never ship in the client bundle.
// This util must only be imported by server components / route handlers, never a 'use client' module.
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

function allowlist(): Set<string> {
  return new Set(
    (process.env.PREVIEW_ALLOWLIST || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0)
  )
}

export async function isPreviewUser(): Promise<boolean> {
  try {
    const session = await getServerSession(authOptions)
    const email = session?.user?.email?.trim().toLowerCase()
    if (!email) return false
    return allowlist().has(email)
  } catch (e) {
    console.error('[preview-gate] check failed, defaulting to CURRENT UI:', e)
    return false
  }
}
