// LORAMER_CHAT_TURN_FAILED_DURABLE_V1 — the durable failed-turn instrument's landing route.
//
// WHY: ★CHAT-TURN-FAILED-TELEMETRY-INVISIBLE — `[chat] TURN FAILED` is a console.error in a CLIENT
// component; it prints to the browser and never reaches a server log (proven 2026-08-05: Vercel returned
// "No logs found" over the exact window while the conversation row answered the question). An instrument
// that cannot be read where the reader is standing is not an instrument. And since the pair-write
// (LORAMER_CHAT_TURN_PAIR_WRITE_V1, 86bb230) a failed turn leaves ZERO conversation rows by design — this
// table is the ONLY witness for "did the user ask something and get nothing?".
//
// GATE SHAPE = THE VIEWPORT-PROBE PRECEDENT (viewport-probe/route.ts), plus the one thing that route's own
// header says durability requires: "if it has to survive longer, this becomes a table and that needs a
// migration" — migration 064 is that table. (1) an authenticated session is required; (2) the payload must
// carry the exact literal probe tag — a stray or malformed POST writes nothing; (3) ONE append-only insert,
// no Anthropic call, no platform fetch. The client fires-and-forgets; nothing user-visible waits on this.
//
// ⛔ NO QUESTION TEXT, NO ANSWER TEXT — failure metadata only. err_message is the ERROR string, truncated
// here as defence in depth (the client module never sends text fields; guard leg 7b pins that).
// ⛔ NEVER touches client_conversations — telemetry stays out of the conversation store by law.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

// LORAMER_NO_CACHED_DB_READ_V1 / token-freshness guard leg (a): this route's import closure reaches the
// token tables through authOptions, and its own supabase WRITE must never ride a cached fetch (Lesson 52).
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const MARKER = 'LORAMER_TURN_FAILED'
const PHASES = new Set(['turn-failed', 'recovery-verdict', 'mount-recovery'])
const RECOVERED = new Set(['found', 'ambiguous', 'nothing'])

export async function POST(request: Request) {
  const session = (await getServerSession(authOptions)) as any
  if (!session?.user?.email) return new NextResponse(null, { status: 401 })

  const body = await request.json().catch(() => ({} as any))
  // Hard gate: an exact literal, not a truthy flag (the viewport-probe rule).
  if (body?.probe !== 'chat-turn-failed') return new NextResponse(null, { status: 400 })
  if (!PHASES.has(body?.phase)) return new NextResponse(null, { status: 400 })

  const s = (v: unknown, cap: number) => (typeof v === 'string' && v ? v.slice(0, cap) : null)
  const { error } = await supabaseAdmin.from('chat_turn_failures').insert({
    client_id: s(body.clientId, 40),
    user_email: session.user.email,
    surface: s(body.surface, 60) ?? 'unknown',
    phase: body.phase,
    branch: s(body.branch, 60),
    err_name: s(body.errName, 60),
    err_message: s(body.errMessage, 200),
    signal_aborted: typeof body.signalAborted === 'boolean' ? body.signalAborted : null,
    elapsed_ms: Number.isFinite(body.elapsedMs) ? Math.round(body.elapsedMs) : null,
    correlation_key: s(body.correlationKey, 80) ?? 'none',
    recovered: RECOVERED.has(body?.recovered) ? body.recovered : null,
  })
  if (error) {
    console.error(`${MARKER} insert FAILED: ${error.message}`)
    return new NextResponse(null, { status: 500 })
  }
  // One greppable line beside the row, so the live tail is readable without a query.
  console.error(`${MARKER} ${JSON.stringify({ user: session.user.email, phase: body.phase, branch: s(body.branch, 60), recovered: RECOVERED.has(body?.recovered) ? body.recovered : null, key: s(body.correlationKey, 80) })}`)
  return new NextResponse(null, { status: 204 })
}
