// LORAMER_BACKFILL_PROBE_GA_V1
// Read-only diagnostic: how deep does the GA4 Data API actually serve DAILY
// data for a client's property? CRON_SECRET-bearer GET. No DB writes.
// Issues a self-contained runReport with a date dimension over the requested
// window and reports the earliest/latest day GA actually returns data for
// (Lesson 30: report real earliest-from-data, never a swept cursor target).
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getValidGaToken } from '@/lib/ga-token'

export const maxDuration = 60

const GA_DATA_API = 'https://analyticsdata.googleapis.com/v1beta'

function normalizePropertyId(propertyId: string): string {
  if (propertyId.startsWith('properties/')) return propertyId
  return `properties/${propertyId}`
}

function normalizeGaDate(value: string): string | null {
  // GA returns the date dimension as YYYYMMDD.
  if (!/^\d{8}$/.test(value)) return null
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
}

export async function GET(request: Request) {
  const envSecret = (process.env.CRON_SECRET ?? '').trim()
  const authHeader = request.headers.get('authorization') ?? ''
  const gotToken = (
    authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : authHeader
  ).trim()
  if (!envSecret || gotToken !== envSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  const start = searchParams.get('start')
  const end = searchParams.get('end')
  if (!clientId || !start || !end) {
    return NextResponse.json(
      { error: 'Missing clientId, start, or end (YYYY-MM-DD)' },
      { status: 400 }
    )
  }

  // Discover the GA connection from ga_tokens by client_id, and learn which
  // user_email owns it rather than assuming it matches clients.user_email.
  const { data: gaRow, error: gaRowError } = await supabaseAdmin
    .from('ga_tokens')
    .select('user_email, ga_property_id')
    .eq('client_id', clientId)
    .maybeSingle()
  if (gaRowError) {
    return NextResponse.json(
      { error: 'ga_tokens lookup failed', detail: gaRowError.message },
      { status: 500 }
    )
  }
  if (!gaRow?.user_email || !gaRow?.ga_property_id) {
    return NextResponse.json(
      { error: 'Client has no GA connection (no ga_tokens row)' },
      { status: 400 }
    )
  }

  const tokenResult = await getValidGaToken(clientId, gaRow.user_email)
  if (!tokenResult.ok) {
    return NextResponse.json(
      {
        error: 'GA token unavailable',
        reason: tokenResult.reason,
        detail: tokenResult.detail,
      },
      { status: 400 }
    )
  }

  const propertyId = tokenResult.gaPropertyId

  try {
    const url = `${GA_DATA_API}/${normalizePropertyId(propertyId)}:runReport`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenResult.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: start, endDate: end }],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'sessions' }, { name: 'totalRevenue' }],
        limit: '100000',
      }),
    })
    const json = await res.json()
    if (!res.ok) {
      return NextResponse.json({
        clientId,
        propertyId,
        start,
        end,
        rowCount: 0,
        apiError: json?.error?.message || `GA runReport HTTP ${res.status}`,
      })
    }
    const rawRows = (json.rows || []) as Array<{
      dimensionValues?: Array<{ value?: string }>
      metricValues?: Array<{ value?: string }>
    }>
    const dates = rawRows
      .map(r => normalizeGaDate(r.dimensionValues?.[0]?.value ?? ''))
      .filter((d): d is string => Boolean(d))
      .sort()
    const sample = rawRows.slice(0, 3).map(r => ({
      date: normalizeGaDate(r.dimensionValues?.[0]?.value ?? ''),
      sessions: r.metricValues?.[0]?.value ?? null,
      totalRevenue: r.metricValues?.[1]?.value ?? null,
    }))
    return NextResponse.json({
      clientId,
      propertyId,
      start,
      end,
      rowCount: dates.length,
      earliest: dates[0] || null,
      latest: dates[dates.length - 1] || null,
      sample,
    })
  } catch (e: any) {
    return NextResponse.json({
      clientId,
      propertyId,
      start,
      end,
      rowCount: 0,
      apiError: e?.message || String(e),
    })
  }
}
