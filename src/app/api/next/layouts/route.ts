// LORAMER_NEXT_CARD_ENGINE_V1 — named saved-view persistence (locked decision A). Layouts key off the VIEWER
// (user_email = the signed-in person customizing THEIR view; a shared viewer gets their own layout, NOT the
// owner's) — the contract's "layout keys off viewer, data off owner". Per user_email + page_key + client_id (nullable).
//
// Backed by the dashboard_layouts table (migration 022 — APPLIED 2026-06-29; VIEWER-keyed; UNIQUE NULLS NOT
// DISTINCT on (user_email,page_key,client_id,name) so the upsert's onConflict works for the nullable client_id).
// The engine still fails HONESTLY on any error (GET → keep the built-in default view; POST → "Couldn't save").
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

// GET ?pageKey=&clientId= → { views: SavedView[], defaultName: string|null }
export async function GET(request: Request) {
  const session = (await getServerSession(authOptions)) as any
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sp = new URL(request.url).searchParams
  const pageKey = sp.get('pageKey') || ''
  const clientId = sp.get('clientId') || null

  let q = supabaseAdmin
    .from('dashboard_layouts')
    .select('name, view, is_default')
    .eq('user_email', email)
    .eq('page_key', pageKey)
  q = clientId ? q.eq('client_id', clientId) : q.is('client_id', null)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: 'layouts unavailable', detail: error.message }, { status: 500 })

  const rows = data || []
  const views = rows.map((r: any) => ({ name: r.name, ...(r.view || {}) }))
  const def = rows.find((r: any) => r.is_default)
  return NextResponse.json({ views, defaultName: def?.name || (rows[0] as any)?.name || null })
}

// POST { pageKey, clientId, view:{name,cards,layout,pinned}, setDefault } → upsert one named view (VIEWER-keyed).
export async function POST(request: Request) {
  const session = (await getServerSession(authOptions)) as any
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null)
  if (!body?.view?.name || !body?.pageKey) return NextResponse.json({ error: 'pageKey + view.name required' }, { status: 400 })
  const clientId = body.clientId || null
  // RESHAPE FIX 2 — persist the page settings (global date range + compare) alongside cards/layout so they survive refresh.
  const { name, cards, layout, pinned, globalPeriod, globalCustom, compareMode, customCompare } = body.view

  if (body.setDefault) {
    let clr = supabaseAdmin.from('dashboard_layouts').update({ is_default: false }).eq('user_email', email).eq('page_key', body.pageKey)
    clr = clientId ? clr.eq('client_id', clientId) : clr.is('client_id', null)
    await clr
  }
  const { error } = await supabaseAdmin
    .from('dashboard_layouts')
    .upsert({
      user_email: email, page_key: body.pageKey, client_id: clientId, name,
      view: { cards, layout, pinned: pinned || [], globalPeriod, globalCustom, compareMode, customCompare }, is_default: !!body.setDefault, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_email,page_key,client_id,name' })
  if (error) return NextResponse.json({ error: 'save failed', detail: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
