// LORAMER_ENTITY_STATE_SCD2_V1 — SLICE 1: the two Google fields we already fetch and throw away.
//
// SCOPE, deliberately narrow: `campaign.advertising_channel_type`, `campaign.status`, and
// `conversion_action.include_in_conversions_metric`. All three are ALREADY selected on existing GAQL calls
// (google-intelligence.ts:198/788 and :386), so this writer adds **ZERO API operations** — it persists a
// payload that is presently built, read once for the prompt, and dropped. Negative keywords are NOT in this
// slice: they are the only declared family with a row-count hazard and they want this invariant proven first.
//
// ⛔ THE TRANSITION INVARIANT IS THE WHOLE DESIGN, NOT AN OPTIMISATION.
// An UNCHANGED value writes NOTHING. A writer that re-observes daily and appends regardless would put
// 10k negative keywords × 365 days = 3.65M rows/year into this table for ONE client — the row inflation
// Fivetran explicitly warns about for frequently-changing tables, and it would dwarf metrics_daily. The
// planner below is PURE so that invariant is provable without a database.
//
// ⛔ AND THE SECOND RULE THAT MATTERS AS MUCH: AN ABSENT ROW IS **UNKNOWN**, NEVER FALSE.
// "No row saying this term was negated" does not mean it was not negated — it means we were not looking, or
// were not looking yet. resolveEntityStateAsOf never returns a bare value; it returns a verdict.

export type ChangeSource = 'first_observation' | 'poll_transition' | 'event'

// What a capture pass SAW. Pure input — no DB, no dates.
export type ObservedFact = {
  entityLevel: string
  entityId: string
  entityName?: string
  stateKey: string
  stateValue: string
  valueJson?: Record<string, unknown>
  isSet?: boolean // default false = scalar
}

// What the table currently holds OPEN (valid_to IS NULL) for the same client+platform+account.
export type OpenRow = {
  entityLevel: string
  entityId: string
  stateKey: string
  stateValue: string
  isSet?: boolean
  validFrom: string
}

export type Transition =
  | { op: 'open'; fact: ObservedFact; validFrom: string; changeSource: ChangeSource }
  | { op: 'close'; row: OpenRow; validTo: string }
  | { op: 'touch'; row: OpenRow } // unchanged: refresh last_seen_at ONLY. Never a new row.

const k = (e: { entityLevel: string; entityId: string; stateKey: string }) => `${e.entityLevel}|${e.entityId}|${e.stateKey}`
const km = (e: { entityLevel: string; entityId: string; stateKey: string; stateValue: string }) => `${k(e)}|${e.stateValue}`

// PURE. Given what we saw, what is open, and which (entity,key) pairs we have EVER observed before, produce
// the minimal transition set. `everObservedKeys` is what lets a first sighting be labelled honestly even when
// a set is currently empty — without it, re-adding to an emptied set would falsely read as a first observation
// and the reader would be told the start date is unknown when it is not.
export function planEntityStateTransitions(
  observed: ObservedFact[],
  openRows: OpenRow[],
  everObservedKeys: Set<string>,
  observationDate: string,
): Transition[] {
  const out: Transition[] = []
  const openByMember = new Map(openRows.map((r) => [km(r), r]))
  const openByKey = new Map<string, OpenRow[]>()
  for (const r of openRows) {
    const key = k(r)
    const arr = openByKey.get(key)
    if (arr) arr.push(r)
    else openByKey.set(key, [r])
  }
  const seenMembers = new Set<string>()
  const touchedKeys = new Set<string>()

  for (const f of observed) {
    const isSet = f.isSet === true
    const key = k(f)
    touchedKeys.add(key)
    seenMembers.add(km(f))
    const exact = openByMember.get(km(f))

    // ── UNCHANGED → touch only. THE no-op that keeps this table small. ──
    if (exact) { out.push({ op: 'touch', row: exact }); continue }

    if (isSet) {
      // A new MEMBER. first_observation only if we have never seen this (entity,key) at all.
      out.push({ op: 'open', fact: f, validFrom: observationDate,
        changeSource: everObservedKeys.has(key) ? 'poll_transition' : 'first_observation' })
      continue
    }

    // ── SCALAR ──
    const openScalar = (openByKey.get(key) || [])[0]
    if (!openScalar) {
      out.push({ op: 'open', fact: f, validFrom: observationDate,
        changeSource: everObservedKeys.has(key) ? 'poll_transition' : 'first_observation' })
    } else {
      // Value changed: close the old row AS OF the observation date, open the new one the same day.
      out.push({ op: 'close', row: openScalar, validTo: observationDate })
      out.push({ op: 'open', fact: f, validFrom: observationDate, changeSource: 'poll_transition' })
    }
  }

  // ── SET MEMBERS THAT DISAPPEARED → close. Only for (entity,key) pairs this pass actually observed:
  // a key we did not look at this run must NOT be interpreted as "removed". Not looking is not absence.
  for (const r of openRows) {
    if (r.isSet !== true) continue
    if (!touchedKeys.has(k(r))) continue
    if (seenMembers.has(km(r))) continue
    out.push({ op: 'close', row: r, validTo: observationDate })
  }
  return out
}

// ── THE READ PRIMITIVE. Not query_config (that is the next slice) — this is the contract every reader owes. ──
export type StateVerdict =
  | { verdict: 'KNOWN'; value: string; validFrom: string; validTo: string | null; changeSource: ChangeSource
      // TRUE only when the value is provably in force on the asked date. 'first_observation' still returns
      // KNOWN — we do know the value — but startIsProven=false says the START date is our sighting, not truth.
      startIsProven: boolean }
  | { verdict: 'UNKNOWN'; reason: 'before_first_observation' | 'never_observed' | 'not_in_declared_set' }

export type HistoryRow = OpenRow & { validTo: string | null; changeSource: ChangeSource }

// ⛔ NEVER returns a bare value and NEVER treats absence as false. A caller asking "was this negated on D"
// and getting UNKNOWN must say so — that is ESSENCE law 6 at the read boundary.
export function resolveEntityStateAsOf(
  rows: HistoryRow[], entityLevel: string, entityId: string, stateKey: string, asOf: string,
  declared = true,
): StateVerdict {
  if (!declared) return { verdict: 'UNKNOWN', reason: 'not_in_declared_set' }
  const mine = rows.filter((r) => r.entityLevel === entityLevel && r.entityId === entityId && r.stateKey === stateKey)
  if (mine.length === 0) return { verdict: 'UNKNOWN', reason: 'never_observed' }
  const hit = mine.find((r) => r.validFrom <= asOf && (r.validTo === null || r.validTo > asOf))
  if (!hit) return { verdict: 'UNKNOWN', reason: 'before_first_observation' }
  return {
    verdict: 'KNOWN', value: hit.stateValue, validFrom: hit.validFrom, validTo: hit.validTo,
    changeSource: hit.changeSource, startIsProven: hit.changeSource !== 'first_observation',
  }
}

// ── SLICE-1 EXTRACTOR. Pure: an intelligence payload in, observed facts out. No DB, no network. ──
// The DECLARED SET for slice 1 lives here and nowhere else, so widening it is one visible edit.
export const SLICE1_DECLARED_KEYS = ['advertising_channel_type', 'campaign_status', 'include_in_conversions'] as const

type CampaignLike = { id?: string; campaignId?: string; name?: string; campaignName?: string; channelType?: string; status?: string }
type ConvActionLike = { id?: string; name?: string; includeInConversions?: boolean; category?: string }

export function extractGoogleSlice1(intel: {
  campaigns?: CampaignLike[]
  impressionShares?: CampaignLike[]
  conversionActions?: ConvActionLike[]
}): ObservedFact[] {
  const out: ObservedFact[] = []
  const seen = new Set<string>()
  // channelType arrives on BOTH campaigns and impressionShares; take whichever carries it, once per campaign.
  for (const c of [...(intel.campaigns || []), ...(intel.impressionShares || [])]) {
    const id = String(c.id || c.campaignId || '')
    if (!id) continue
    const name = String(c.name || c.campaignName || '')
    if (c.channelType && !seen.has(`t${id}`)) {
      seen.add(`t${id}`)
      out.push({ entityLevel: 'campaign', entityId: id, entityName: name, stateKey: 'advertising_channel_type', stateValue: String(c.channelType) })
    }
    if (c.status && !seen.has(`s${id}`)) {
      seen.add(`s${id}`)
      out.push({ entityLevel: 'campaign', entityId: id, entityName: name, stateKey: 'campaign_status', stateValue: String(c.status) })
    }
  }
  for (const a of intel.conversionActions || []) {
    const id = String(a.id || '')
    if (!id || typeof a.includeInConversions !== 'boolean') continue
    out.push({
      entityLevel: 'conversion_action', entityId: id, entityName: String(a.name || ''),
      stateKey: 'include_in_conversions', stateValue: a.includeInConversions ? 'true' : 'false',
    })
  }
  return out
}

// ── PERSIST. Isolated, additive, and a NO-OP until migration 048 is applied. ──────────────────────────────
// ⛔ IT MUST NEVER THROW INTO A CAPTURE LANE. This rides an existing capture pass; a failure here must not
// cost the metrics rows that pass already wrote. Errors are logged LOUD and swallowed AT THIS BOUNDARY ONLY —
// which is the opposite of the `.catch(() => [])` house pathology because nothing downstream reads a
// fabricated empty: a failed persist simply means no state row, and an absent row reads as UNKNOWN.
import { supabaseAdmin } from '@/lib/supabase'

export type PassOutcome = 'ok' | 'skipped' | 'error'
export type PassResult = { opened: number; closed: number; unchanged: number; outcome: PassOutcome
  entitiesExamined: number; factsExamined: number; skipped?: string }

// LORAMER_EMPTY_CARRIES_ITS_DENOMINATOR_V1 — ⛔ EVERY EXIT PATH RECORDS, INCLUDING THE ONES THAT DID NOTHING.
// entity_state_history holding zero rows is AMBIGUOUS on its own: the writer may have run and found nothing
// changed, or nothing may have run at all. The standing answer to that — "check the logs" — is a HUMAN
// instruction, and human instructions are precisely what failed four times on 2026-07-30; Vercel free-tier
// logs also expire in an hour. So the pass writes its own denominator: entities and facts EXAMINED, next to
// rows opened/closed/touched, on every invocation including empty, skipped and thrown ones.
// It is best-effort and never throws — a failed pass-log write must not cost the capture it is describing —
// but it is attempted on all five exits, which the guard proves behaviourally rather than by inspection.
async function recordPass(args: {
  clientId: string; platform: string; accountId: string; observationDate: string; mode: string
  entitiesExamined: number; factsExamined: number
  opened: number; closed: number; touched: number; outcome: PassOutcome; detail?: string
}): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('capture_pass_log').insert({
      pass_marker: 'entity_state_slice1', mode: args.mode, platform: args.platform,
      client_id: args.clientId, account_id: args.accountId, observation_date: args.observationDate,
      entities_examined: args.entitiesExamined, facts_examined: args.factsExamined,
      rows_opened: args.opened, rows_closed: args.closed, rows_touched: args.touched,
      outcome: args.outcome, detail: args.detail ?? null,
    })
    // Table absent (049 not applied) → say so ONCE, loudly. Do NOT fall back to silence: a missing pass log
    // returns us to exactly the ambiguity this exists to remove, and that must be visible.
    if (error) console.warn(`[entity-state] PASS LOG UNAVAILABLE (${error.message}) — zero-rows is ambiguous until migration 049 is applied`)
  } catch (e: any) {
    console.warn(`[entity-state] PASS LOG THREW (${e?.message ?? e}) — zero-rows is ambiguous for this pass`)
  }
}

export async function persistEntityState(args: {
  clientId: string; platform: string; accountId: string; observed: ObservedFact[]; observationDate: string
  mode?: string
}): Promise<PassResult> {
  const { clientId, platform, accountId, observed, observationDate } = args
  const mode = args.mode ?? 'catchup'
  const entitiesExamined = new Set(observed.map((f) => `${f.entityLevel}|${f.entityId}`)).size
  const factsExamined = observed.length
  const base = { clientId, platform, accountId, observationDate, mode, entitiesExamined, factsExamined }

  // EXIT 1 — nothing observed. STILL RECORDS: "we ran, we examined 0 facts" is the denominator that
  // separates a quiet pass from a pass that never happened.
  if (observed.length === 0) {
    await recordPass({ ...base, opened: 0, closed: 0, touched: 0, outcome: 'ok' })
    return { opened: 0, closed: 0, unchanged: 0, outcome: 'ok', entitiesExamined, factsExamined }
  }
  try {
    const { data: openData, error: openErr } = await supabaseAdmin
      .from('entity_state_history')
      .select('entity_level, entity_id, state_key, state_value, is_set, valid_from')
      .eq('client_id', clientId).eq('platform', platform).eq('account_id', accountId)
      .is('valid_to', null)
    // EXIT 2 — could not read the open set (e.g. 048 not applied). RECORDS as 'skipped': "we could not
    // look" is a different fact from "we looked and saw nothing", and collapsing them is the ambiguity.
    if (openErr) {
      console.warn(`[entity-state] client=${clientId} SKIPPED — ${openErr.message}`)
      await recordPass({ ...base, opened: 0, closed: 0, touched: 0, outcome: 'skipped', detail: openErr.message })
      return { opened: 0, closed: 0, unchanged: 0, outcome: 'skipped', entitiesExamined, factsExamined, skipped: openErr.message }
    }

    const openRows: OpenRow[] = (openData || []).map((r: any) => ({
      entityLevel: r.entity_level, entityId: r.entity_id, stateKey: r.state_key,
      stateValue: r.state_value, isSet: r.is_set === true, validFrom: r.valid_from,
    }))
    const { data: everData } = await supabaseAdmin
      .from('entity_state_history')
      .select('entity_level, entity_id, state_key')
      .eq('client_id', clientId).eq('platform', platform).eq('account_id', accountId)
    const ever = new Set((everData || []).map((r: any) => `${r.entity_level}|${r.entity_id}|${r.state_key}`))

    const plan = planEntityStateTransitions(observed, openRows, ever, observationDate)
    const closes = plan.filter((t) => t.op === 'close') as Extract<Transition, { op: 'close' }>[]
    const opens = plan.filter((t) => t.op === 'open') as Extract<Transition, { op: 'open' }>[]
    const touches = plan.filter((t) => t.op === 'touch').length

    // CLOSE BEFORE OPEN — the scalar partial unique index (048) permits exactly one open row per
    // (entity, state_key), so opening first would collide with the row we are about to close.
    for (const c of closes) {
      await supabaseAdmin.from('entity_state_history').update({ valid_to: c.validTo })
        .eq('client_id', clientId).eq('platform', platform).eq('account_id', accountId)
        .eq('entity_level', c.row.entityLevel).eq('entity_id', c.row.entityId)
        .eq('state_key', c.row.stateKey).eq('state_value', c.row.stateValue).is('valid_to', null)
    }
    if (opens.length) {
      const rows = opens.map((o) => ({
        client_id: clientId, platform, account_id: accountId,
        entity_level: o.fact.entityLevel, entity_id: o.fact.entityId, entity_name: o.fact.entityName ?? null,
        state_key: o.fact.stateKey, state_value: o.fact.stateValue, value_json: o.fact.valueJson ?? null,
        is_set: o.fact.isSet === true, valid_from: o.validFrom, valid_to: null, change_source: o.changeSource,
      }))
      const { error } = await supabaseAdmin.from('entity_state_history').insert(rows)
      // EXIT 3 — the write failed. RECORDS as 'error' with the reason.
      if (error) {
        console.error(`[entity-state] client=${clientId} INSERT failed: ${error.message}`)
        await recordPass({ ...base, opened: 0, closed: closes.length, touched: touches, outcome: 'error', detail: error.message })
        return { opened: 0, closed: closes.length, unchanged: touches, outcome: 'error', entitiesExamined, factsExamined, skipped: error.message }
      }
    }
    // `touch` refreshes last_seen_at only — it proves we were still LOOKING, which is what separates
    // "unchanged" from "we stopped observing". Never a new row.
    if (touches) {
      await supabaseAdmin.from('entity_state_history').update({ last_seen_at: new Date().toISOString() })
        .eq('client_id', clientId).eq('platform', platform).eq('account_id', accountId).is('valid_to', null)
    }
    // EXIT 4 — success.
    await recordPass({ ...base, opened: opens.length, closed: closes.length, touched: touches, outcome: 'ok' })
    return { opened: opens.length, closed: closes.length, unchanged: touches, outcome: 'ok', entitiesExamined, factsExamined }
  } catch (e: any) {
    // EXIT 5 — threw. RECORDS as 'error'. A pass that died still ran, and that must be readable.
    console.error(`[entity-state] client=${clientId} persist FAILED (non-fatal to capture): ${e?.message ?? e}`)
    await recordPass({ ...base, opened: 0, closed: 0, touched: 0, outcome: 'error', detail: String(e?.message ?? e) })
    return { opened: 0, closed: 0, unchanged: 0, outcome: 'error', entitiesExamined, factsExamined, skipped: String(e?.message ?? e) }
  }
}
