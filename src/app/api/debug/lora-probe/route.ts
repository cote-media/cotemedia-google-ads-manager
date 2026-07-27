// LORAMER_LORA_PAGE_PROBE_V1 — THROWAWAY, BRANCH-ONLY. Never merge to main.
//
// WHY A SECOND ENDPOINT INSTEAD OF RELAXING THE EXISTING ONE:
// /api/debug/viewport-probe is session-gated and lives on main. Relaxing it would put an
// unauthenticated write-path into production for the sake of a throwaway test — the exact shape of
// hole this repo has laws against. So the existing endpoint is UNTOUCHED and this separate one exists
// only on the probe branch and dies with it.
//
// WHAT IT ACCEPTS: unauthenticated POSTs carrying the exact literal tag below. Nothing else.
// WHAT IT DOES: appends ONE console line. No session, no database, no model call, no platform fetch,
// no cookies read, nothing returned to the caller but 204.
// WHAT IT EXPOSES: nothing. It is write-only into the Vercel runtime log and returns no data at all,
// so it cannot be used to read anything out of the system.
//
// THE PAGE IT SERVES IS 40 LINES OF HARD-CODED DUMMY TEXT — no client data, no DB, no /api/chat.
import { NextResponse } from 'next/server'

const MARKER = 'LORAMER_LORA_PAGE_PROBE'

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({} as any))
  // Exact literal, not a truthy flag. A stray or malformed POST logs nothing.
  if (body?.probe !== 'lora-page-probe') return new NextResponse(null, { status: 400 })
  console.error(`${MARKER} ${JSON.stringify(body)}`)
  return new NextResponse(null, { status: 204 })
}
