// LORAMER_NATIVE_AUTH_ALLOWLIST_V1 — Mailchimp interest capture for NON-invited visitors (the invite-only
// screen posts here). Writes ONLY to Mailchimp (audience 5bf7067007) — it NEVER touches signup_allowlist:
// a subscriber is an interested lead, NOT an invitee. Bare fetch, no dependency. Single opt-in
// (status_if_new='subscribed', Russ's choice). Never leaks the API key or the raw Mailchimp error.
import { NextResponse } from 'next/server'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const AUDIENCE_ID = '5bf7067007'

export async function POST(request: Request) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
  const email = (body?.email || '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'invalid email' }, { status: 400 })
  }

  const key = process.env.MAILCHIMP_API_KEY
  if (!key || !key.includes('-')) {
    console.error('[interest] MAILCHIMP_API_KEY missing or malformed')
    return NextResponse.json({ error: 'interest capture unavailable' }, { status: 502 })
  }
  const dc = key.split('-').pop() // datacenter prefix, e.g. "us21"
  const subscriberHash = crypto.createHash('md5').update(email).digest('hex')
  const url = `https://${dc}.api.mailchimp.com/3.0/lists/${AUDIENCE_ID}/members/${subscriberHash}`
  const authHeader = 'Basic ' + Buffer.from('any:' + key).toString('base64')

  try {
    const res = await fetch(url, {
      method: 'PUT', // upsert by email hash → idempotent, no "Member Exists" 400 on re-submit
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email_address: email, status_if_new: 'subscribed' }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error('[interest] mailchimp non-2xx', res.status, detail.slice(0, 300))
      return NextResponse.json({ error: 'could not add you to the list right now' }, { status: 502 })
    }
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('[interest] mailchimp request failed:', e?.message || e)
    return NextResponse.json({ error: 'could not add you to the list right now' }, { status: 502 })
  }
}
