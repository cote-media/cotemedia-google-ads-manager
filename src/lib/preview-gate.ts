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
import { redirect } from 'next/navigation'
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

// EVERY server page / data-loader under /dashboard-next MUST call requirePreviewUser() as its
// FIRST line. Do NOT rely on the layout redirect alone for content isolation: a Next.js App Router
// LAYOUT redirect() still streams the child page's RSC payload in the 307 body, so protected
// content would be present in the raw bytes for non-allowlisted users. Calling this FIRST inside
// the page makes redirect() throw before any content is computed → nothing protected is rendered
// or serialized. Fails closed (redirects to /dashboard) on any non-allowlisted / error case.
export async function requirePreviewUser(): Promise<void> {
  if (!(await isPreviewUser())) redirect('/dashboard')
}
