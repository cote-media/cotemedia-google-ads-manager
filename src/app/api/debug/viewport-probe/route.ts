// LORAMER_NEXT_CHAT_VIEWPORT_PROBE_V1 — the instrument for the ONE measurement that unblocks
// DECISIONS LORAMER_NEXT_CHAT_KEYBOARD_BLEED_V1 ("no sixth attempt until the mechanism is identified").
//
// WHY THIS EXISTS: the previous instrument (?debug=chat, LORAMER_NEXT_CHAT_DEBUG_V1) was built for a
// HORIZONTAL symptom (★UI-OVERFLOW) and renders ten horizontal-axis fields. It does NOT capture
// `visualViewport.scale` at all — the single number that decides whether the keyboard bleed is iOS
// auto-zoom or something else. It also required a human to read a 12px monospace box on a phone with
// the keyboard up, and on 2026-07-26 that produced no number.
//
// So: the CLIENT posts its measurements here and the SERVER logs them. Nobody has to read anything.
//
// ⛔ DEBUG-ONLY, THREE WAYS: (1) an authenticated session is required; (2) the payload must carry the
// exact literal probe tag; (3) the client only ever calls this when ?debug=chat is on. It performs NO
// database write, NO Anthropic call and NO platform fetch — it appends one console line. There is no
// cost and no row for a normal user or a cohort member, because a normal user never calls it.
//
// READ THE RESULT WITH: Vercel runtime logs, filtered on the marker below.
// ⚠ RETENTION IS THE LIMIT: runtime logs are not kept forever, so the measurement should be read soon
// after it is taken. If it has to survive longer, this becomes a table and that needs a migration.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// NOT exported: a Next.js route module may only export route handlers and its known config keys, and
// an extra export fails the BUILD (not tsc — caught by `npm run build`, which is why tsc is never the
// gate here). Kept module-local.
const MARKER = 'LORAMER_VIEWPORT_PROBE'

export async function POST(request: Request) {
  const session = (await getServerSession(authOptions)) as any
  if (!session?.user?.email) return new NextResponse(null, { status: 401 })

  const body = await request.json().catch(() => ({} as any))
  // Hard gate: an exact literal, not a truthy flag. A stray or malformed POST logs nothing.
  if (body?.probe !== 'chat-viewport') return new NextResponse(null, { status: 400 })

  // One line per sample, marker-prefixed so it is greppable out of the runtime log stream.
  console.error(`${MARKER} ${JSON.stringify({ user: session.user.email, ...body })}`)
  return new NextResponse(null, { status: 204 })
}
