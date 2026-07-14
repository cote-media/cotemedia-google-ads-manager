// LORAMER_LEGACY_SURFACE_GATE_V1 (H1/H2) — restrict the un-hardened LEGACY surface to the LEGACY COHORT only.
// The legacy pages (/dashboard family, /clients) and the session-only Google DATA routes (/api/campaigns,
// /keywords, /daily, /google/ads, /google/adgroups(+/daily), /accounts) have NO per-tenant ownership check —
// they fetch a caller-supplied accountId via the shared app MCC (the H1 IDOR) and were reachable by any
// authenticated user (H2). Real cohort users live on -next; gating this surface to isLegacyCohort (the Shopify/
// Meta review + demo fixtures) closes H2 and BOUNDS H1 to the tiny fixture set. NOTE: /agency + /business are
// PUBLIC pre-auth signup doors (NOT legacy tenant pages) and are intentionally NOT gated (LORAMER_SIGNUP_FUNNEL_FIX_V1).
//
// EDGE-SAFE: getToken (JWT cookie, no DB) + the pure isLegacyCohort; imports NOTHING Node-only. The `config.matcher`
// below is an EXPLICIT allow-list of ONLY the legacy paths — everything else (all of -next, the connect helpers
// /api/ga/properties + /api/google-ads/accounts + the OAuth starts, /api/next/*, /api/auth/*, /api/cron/*, /billing,
// and every public/auth/legal page) is NOT matched and passes through completely untouched. `/dashboard-next/*` does
// NOT match `/dashboard/:path*` (the segment boundary after "dashboard" differs), so -next is never gated here.
import { NextResponse, type NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { isLegacyCohort } from '@/lib/legacy-cohort'

export async function middleware(request: NextRequest) {
  const isApi = request.nextUrl.pathname.startsWith('/api/')
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })
  const email = (token?.email as string | undefined) ?? null

  // Not authenticated.
  if (!email) {
    if (isApi) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    return NextResponse.redirect(url)
  }

  // Authenticated but NOT the legacy cohort → a real -next user; deny the legacy surface (no data).
  if (!isLegacyCohort(email)) {
    if (isApi) return new NextResponse(null, { status: 403 }) // no body, no tenant data
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard-next/clients'
    url.search = ''
    return NextResponse.redirect(url)
  }

  // Legacy cohort (reviewer/demo fixtures) → pass through (legacy UI + its routes stay intact).
  return NextResponse.next()
}

export const config = {
  matcher: [
    // /agency + /business are PUBLIC pre-auth signup doors (they set the signup_org_type cookie before login),
    // NOT legacy tenant pages — they must stay ungated (exempt like /login, /signup). Only real legacy surfaces below.
    '/dashboard/:path*',
    '/clients/:path*',
    '/api/campaigns',
    '/api/keywords',
    '/api/daily',
    '/api/google/ads',
    '/api/google/adgroups/:path*',
    '/api/accounts',
  ],
}
