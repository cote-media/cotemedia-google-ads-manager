#!/usr/bin/env -S npx --yes tsx@4.23.13
// LORAMER_GOOGLE_HOLE_MAP_DETECTOR_V1 — THE PROOF-ON-ONE. ONE vendor op, everything else warehouse reads.
//
// WHAT IT PROVES, in order:
//   (a) inception — readAccountInception; if absent, ONE metered+ledgered discovery op through the writer's
//       own executor (the ONLY executor of INCEPTION_DISCOVERY_GAQL). Null → UNKNOWN → the proof STOPS here,
//       which is a valid result, not a failure.
//   (b) the composed stop for the base surface, through resolveWalkStop (the one composition site).
//   (c) the enumerator over two spans, paged under the walk's own bounds, with the two-tier split.
//   (d) the side-by-side against the ACCOUNT-GRAIN hole count on the same span — read here, in the proof,
//       through the density RPC. The ENUMERATOR may not read that RPC (stream-consumer guard leg (g)); the
//       proof reads it precisely because the comparison is the point.
//
// USAGE (repo root, .env.local present):
//   npx --yes tsx@4.23.13 scripts/google-hole-map-proof.ts <clientId> <spanA start> <spanA end> [<spanB start> <spanB end>]
//   add --no-discover to refuse the vendor op (proves UNKNOWN-refuses without spending).
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const ROOT = process.cwd()
if (existsSync(resolve(ROOT, '.env.local'))) {
  for (const line of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
// The Supabase client constructs a realtime client on Node 20; nothing here opens a socket.
;(globalThis as any).WebSocket = (globalThis as any).WebSocket || class { constructor() {} close() {} }

const argv = process.argv.slice(2)
const noDiscover = argv.includes('--no-discover')
const pos = argv.filter((a) => !a.startsWith('--'))
const [clientId, aStart, aEnd, bStart, bEnd] = pos
if (!clientId || !aStart || !aEnd) {
  console.error('usage: google-hole-map-proof.ts <clientId> <spanA start> <spanA end> [<spanB start> <spanB end>] [--no-discover]')
  process.exit(2)
}
const spans = [{ label: 'SPAN-A', start: aStart, end: aEnd }]
if (bStart && bEnd) spans.push({ label: 'SPAN-B', start: bStart, end: bEnd })

const main = async () => {
  const { supabaseAdmin } = await import('../src/lib/supabase')
  const writer = await import('../src/lib/backfill/google-ads-universe-writer')
  const { enumerateGoogleHoles } = await import('../src/lib/backfill/google-hole-map')
  const { readGoogleQuotaPause, holdGoogleWork } = await import('../src/lib/backfill/google-quota-store')
  const { MAX_ENTRIES_SCANNED_PER_RUN } = await import('../src/lib/backfill/universe-resumer')
  const { SCAN_ALLOWANCE_MS } = await import('../src/lib/backfill/universe-v2-contract')
  const VENDOR = 'google'

  // ── the connection, resolved by UUID, never by name ─────────────────────────────────────────────────
  const { data: client } = await supabaseAdmin.from('clients').select('id, name, user_email').eq('id', clientId).single()
  const { data: conn } = await supabaseAdmin.from('platform_connections').select('account_id, user_email').eq('client_id', clientId).eq('platform', VENDOR).limit(1).maybeSingle()
  if (!client || !conn) { console.error(`no client/google connection for ${clientId}`); process.exit(2) }
  const userEmail = (conn.user_email as string | null) || (client.user_email as string)
  const customerId = String(conn.account_id)
  console.log(`CLIENT ${client.name} · ${clientId} · google account ${customerId}`)

  // ── (a) inception: stored, else ONE op ───────────────────────────────────────────────────────────────
  let inception = await writer.readAccountInception({ clientId, vendor: VENDOR })
  if (inception) {
    console.log(`INCEPTION (stored) raw="${inception.rawStartDateTime}" derived=${inception.inceptionDate} source=${inception.source}`)
  } else if (noDiscover) {
    console.log('INCEPTION absent and --no-discover set — UNKNOWN by choice; no op spent.')
  } else {
    const qp = await readGoogleQuotaPause()
    if (holdGoogleWork(qp)) { console.log(`INCEPTION discovery HELD — quota sentinel state=${qp.state} paused=${qp.paused} (${qp.reason ?? ''}). No op spent. STOP.`); process.exit(0) }
    const { googleAdsStreamFor } = await import('../src/lib/backfill/universe-vendor-stream')
    const { googleAdsCaptureAdapter } = await import('../src/lib/backfill/capture-adapters/google-ads.adapter')
    const streamFor = await googleAdsStreamFor(userEmail, customerId)
    // The adapter is needed only for its meter + platform; discovery streams through the injected stream,
    // never through adapter.stream, so entryOf must never be reached.
    const adapter = googleAdsCaptureAdapter(streamFor, () => { throw new Error('inception discovery never streams a surface') })
    const prov = { messageKey: null, invocationId: randomUUID() }
    console.log(`INCEPTION absent — spending ONE op: ${writer.INCEPTION_DISCOVERY_GAQL}`)
    inception = await writer.discoverAccountInception({ clientId, vendor: VENDOR, adapter, stream: streamFor, prov })
    if (!inception) { console.log('INCEPTION UNKNOWN after the op (zero campaigns, held, or error — see the ledger row). STOP: the proof cannot floor without it, and that is the valid result.'); process.exit(0) }
    console.log(`INCEPTION (discovered) raw="${inception.rawStartDateTime}" derived=${inception.inceptionDate} source=${inception.source} invocation=${prov.invocationId}`)
  }
  if (!inception) {
    // Prove the MODULE's refusal, not the script's: hand it the span and show it returns refused and nothing else.
    const r = await enumerateGoogleHoles({ clientId, start: spans[0].start, end: spans[0].end, bounds: { allowanceMs: SCAN_ALLOWANCE_MS, maxEntries: MAX_ENTRIES_SCANNED_PER_RUN } })
    console.log(`ENUMERATOR on UNKNOWN → refused=${r.refused}${r.refused ? ` reason="${r.reason}"` : ' (DEFECT: it returned a page on UNKNOWN)'} · keys=${Object.keys(r).join(',')}`)
    console.log('STOP — UNKNOWN inception. Run without --no-discover to spend the op.')
    process.exit(r.refused ? 0 : 1)
  }

  // ── (b) the composed stop for the base surface ─────────────────────────────────────────────────────
  const facts = await writer.readWalkStopAccountFacts({ clientId, vendor: VENDOR, discover: null })
  const stop = await writer.resolveWalkStop({ clientId, vendor: VENDOR, resource: 'customer', segment: '', facts })
  console.log(`STOP wall=${stop.surfaceWall ? stop.surfaceWall.wallDate : 'null (no vendor refusal recorded)'} inception=${facts.inceptionDate} earliestHeld=${facts.earliestHeldDate} → stopDate=${stop.stopDate} inceptionKnown=${stop.inceptionKnown} basis="${stop.basis}"`)

  // ── (c)+(d) per span ────────────────────────────────────────────────────────────────────────────────
  const bounds = { allowanceMs: SCAN_ALLOWANCE_MS, maxEntries: MAX_ENTRIES_SCANNED_PER_RUN }
  for (const s of spans) {
    const t0 = Date.now()
    let from: number | null = 0, pages = 0, scanned = 0, belowFloor = 0, totalEntries = 0
    const tiers = { ledgerAttested: 0, rowAttested: 0, presenceOnly: 0, attestedEmpty: 0, uncovered: 0 }
    const uncovered: any[] = []
    const surfacesUncovered = new Set<string>()
    let refused: string | null = null
    while (from !== null) {
      const page = await enumerateGoogleHoles({ clientId, start: s.start, end: s.end, bounds, fromEntry: from })
      if (page.refused) { refused = page.reason; break }
      pages += 1; scanned += page.scanned; belowFloor += page.belowFloor; totalEntries = page.totalEntries
      for (const k of Object.keys(tiers) as Array<keyof typeof tiers>) tiers[k] += page.tiers[k]
      uncovered.push(...page.uncovered)
      for (const t of page.perSurface) if (t.uncovered > 0) surfacesUncovered.add(`${t.surface.resource}|${t.surface.segment}`)
      from = page.nextEntry
    }
    if (refused) { console.log(`${s.label} ${s.start}..${s.end} REFUSED — ${refused}`); continue }
    uncovered.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
    const uncoveredDays = uncovered.reduce((n, u) => n + u.days, 0)
    // (d) the account-grain count on the SAME span — read HERE, never in the enumerator.
    const { data: dens, error: dErr } = await supabaseAdmin.rpc('coverage_density_days', { p_client_id: clientId, p_platform: VENDOR, p_start: s.start, p_end: s.end })
    const drow: any = Array.isArray(dens) ? dens[0] : dens
    const spanDays = Math.round((Date.parse(s.end) - Date.parse(s.start)) / 86_400_000) + 1
    const acctPresent = dErr || !drow ? null : ((drow.present_days as string[] | null)?.length ?? 0)
    const acctHoles = acctPresent === null ? null : spanDays - acctPresent
    console.log(`\n${s.label} ${s.start}..${s.end} (${spanDays} days) — ${pages} page(s), ${scanned}/${totalEntries} entries scanned, ${belowFloor} below floor, ${Date.now() - t0}ms`)
    console.log(`  covered — ledger-attested ${tiers.ledgerAttested} · row-attested ${tiers.rowAttested} · presence-only ${tiers.presenceOnly}`)
    console.log(`  attestedEmpty ${tiers.attestedEmpty}`)
    console.log(`  UNCOVERED surface-days ${tiers.uncovered} in ${uncovered.length} contiguous span(s) across ${surfacesUncovered.size} distinct surface(s) (span-days ${uncoveredDays})`)
    console.log(`  SIDE BY SIDE — account-grain holes on this span: ${acctHoles === null ? `UNREADABLE (${dErr?.message ?? 'no row'})` : `${acctHoles} of ${spanDays} days (present ${acctPresent})`} · grain-aware uncovered surface-days: ${tiers.uncovered} across ${surfacesUncovered.size} surfaces`)
    const oldest = uncovered.slice(0, 5).map((u) => `${u.surface.resource}/${u.surface.segment || '(base)'} ${u.start}..${u.end} (${u.days}d)`)
    if (oldest.length) console.log(`  oldest spans: ${oldest.join(' · ')}`)
  }
}

main().catch((e) => { console.error('PROOF FAILED —', e?.message ?? e); process.exit(1) })
