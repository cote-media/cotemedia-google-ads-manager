import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { kickoffBackfill } from '@/lib/backfill/kickoff' // LORAMER_SELFSERVE_SPINE_V1 step 2
import { verifyAndHealCredential } from '@/lib/connection-health' // LORAMER_RECONNECT_STATE_MACHINE_V1

export async function POST(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { client_id, platform, account_id, account_name } = await request.json()

  // LORAMER_OWNERSHIP_GATE_20260616 (#20) — same proven gate as /api/insight, /api/intelligence, /api/backfill/run.
  // (this file aliases supabaseAdmin as `supabase`; var is client_id, not clientId)
  const { data: owned } = await supabase
    .from('clients').select('id')
    .eq('id', client_id).eq('user_email', session.user.email).is('deleted_at', null) // LORAMER_DELETE_CLIENT_V1 — archived → 404
    .maybeSingle()
  if (!owned) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  // ══ THE WRITE DISCRIMINATOR — LORAMER_RECONNECT_STATE_MACHINE_V1 ═════════════════════════════════════
  // ⛔ REPLACES delete-then-insert, WHICH WAS THE REPLACEMENT SEMANTICS MISAPPLIED TO REPAIR. The field's
  // rule, vendor-verbatim (Nango): "Re-authorization updates an existing connection's credentials while
  // preserving its data and config. Deleting and re-creating the connection wipes that data." Measured cost
  // here 2026-08-22: a SUCCESSFUL Meta repair demoted the badge Healthy → neutral (health/last_ok/created_at
  // wiped) and the flow read as broken — the observed reconnect loop on f5fbe7e5.
  // THREE BRANCHES, discriminated by account_id EQUALITY against the existing row:
  //   REPAIR      (row exists, same account)  → allowlisted UPDATE. History PRESERVED. No kickoff — the
  //               account's backfill already ran; re-arming priority for a credential repair re-drains for
  //               nothing.
  //   REPLACEMENT (row exists, new account)   → the ONLY resetting branch: fresh row (created_at, health
  //               unverified, onboard steps, backfill_priority=10 kickoff). A different account is a NEW
  //               CONNECTION wearing a reconnect flow; the OLD account's captured rows stay forever
  //               (store-forever — the connection row is a pointer, never the data).
  //   CONNECT     (no row)                    → insert, as it always was.
  const { data: existing } = await supabase
    .from('platform_connections')
    .select('id, account_id')
    .eq('client_id', client_id)
    .eq('platform', platform)
    .eq('user_email', session.user.email)
    .maybeSingle()

  let data: any = null
  if (existing && existing.account_id === account_id) {
    // REPAIR — ⛔ the SET list is the ALLOWLIST (reconnect-preserves-history.guard leg (a)): account_name +
    // user_email only. health / created_at / onboard_steps_done / backfill_priority may NOT appear here —
    // health is RE-PROVEN by the verify below, never inherited and never wiped.
    const { data: upd, error } = await supabase
      .from('platform_connections')
      .update({ account_name, user_email: session.user.email })
      .eq('id', existing.id)
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    data = upd
  } else {
    // REPLACEMENT or CONNECT — the resetting branch. delete-then-insert is CORRECT here and only here.
    await supabase
      .from('platform_connections')
      .delete()
      .eq('client_id', client_id)
      .eq('platform', platform)
      .eq('user_email', session.user.email)
    const { data: ins, error } = await supabase
      .from('platform_connections')
      .insert({ client_id, platform, account_id, account_name, user_email: session.user.email, backfill_priority: 10 })
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    data = ins
    // LORAMER_SELFSERVE_SPINE_V1 step 2 — connect-kickoff for NEW work only (connect + replacement).
    kickoffBackfill(new URL(request.url).origin, client_id, platform)
  }

  // ══ VERIFY THE CLAIM — probe the credential, heal by its OWN resolution key ═════════════════════════════
  // 'alive' → every row on this credential is re-proven healthy (fan-out is the credential key: Meta/Google
  // are singleton-per-email BY SCHEMA). 'dead'/'indeterminate' → healed 0, verified false/null — the UI says
  // so honestly; unknown never claims green. Platforms without a probe (stage 2) return indeterminate.
  const verify = await verifyAndHealCredential({ platform, userEmail: session.user.email })
  return NextResponse.json({
    connection: data,
    verified: verify.verdict === 'alive' ? true : verify.verdict === 'dead' ? false : null,
    healed: verify.healed,
    repair: !!(existing && existing.account_id === account_id),
  })
}

// LORAMER_RECONNECT_STATE_MACHINE_V1 — background verify for an 'unknown' (never-stamped) row: the client
// profile calls this on first view of a health-NULL meta/google row so "Connected — not yet verified"
// resolves to a real verdict without waiting for the morning cron. Ownership-gated like POST; read-mostly
// (the only write is the heal, through the health module's own writer).
export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { client_id, platform } = await request.json()
  const { data: owned } = await supabase
    .from('clients').select('id')
    .eq('id', client_id).eq('user_email', session.user.email).is('deleted_at', null)
    .maybeSingle()
  if (!owned) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  const verify = await verifyAndHealCredential({ platform, userEmail: session.user.email })
  return NextResponse.json({
    verified: verify.verdict === 'alive' ? true : verify.verdict === 'dead' ? false : null,
    healed: verify.healed,
  })
}

export async function DELETE(request: Request) {
  // LORAMER_DISCONNECT_FIX_V1
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  let id = url.searchParams.get('id')

  if (!id) {
    try {
      const body = await request.json()
      id = body?.id
    } catch {}
  }

  if (!id) {
    return NextResponse.json({ error: 'connection id required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('platform_connections')
    .delete()
    .eq('id', id)
    .eq('user_email', session.user.email)
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'connection not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true, deleted: data.length })
}
