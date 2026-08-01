#!/usr/bin/env node
// LORAMER_CAMPAIGN_TYPE_MATRIX_V1 — THE CAMPAIGN BACKFILL MUST KEEP SELECTING AND STORING CHANNEL TYPE.
//
// ── WHY ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Without channel type on the campaign row, every completeness check has to judge a CRITERIA-DEPENDENT family
// (age/gender, keyword, ad_group) against ACCOUNT SPEND, which is the wrong denominator and produces confident
// false violations. MEASURED 2026-08-01: Foam OH spent $5,956.94 across 90 days on a Performance Max campaign;
// PMax cannot produce age/gender rows; the completion-claim gate recorded 90 days of "missing demographics" that
// could never have existed. A live probe confirmed it — control day served, six test days served EMPTY with no
// refusal, campaign grain PMax-only for 90 of 91 days.
// Google states the ad_group half outright: "Querying resources such as ad_group or ad_group_ad won't return any
// data for your Performance Max campaigns" (developers.google.com/google-ads/api/performance-max/reporting,
// last updated 2026-07-22). 22 of the 51 baselined completion-claim violations are that one step.
//
// ⛔ THE FAILURE THIS PREVENTS IS A QUIET ONE. Dropping a field from a SELECT breaks nothing, throws nothing, and
// fails no test — the rows keep landing, just without the one value that makes a whole class of violation
// diagnosable. It would restore the misclassification silently and nobody would connect the two.
//
// ── THE ASSERTION ───────────────────────────────────────────────────────────────────────────────────────────────
//   1. the campaign backfill GAQL selects `campaign.advertising_channel_type`
//   2. it selects `campaign.advertising_channel_sub_type`
//   3. the row builder writes BOTH into the campaign row's `extra` (channelType / channelSubType) — selecting a
//      field and then discarding it is the exact shape of the defect this fixes, so both halves are checked
//   4. the PRECEDENCE rule survives: the comment naming entity_state_history as the authority stays attached.
//      A rule that lives only in a commit message is a rule that dies at the next refactor.
//
// ── HONEST LIMIT ────────────────────────────────────────────────────────────────────────────────────────────────
// STATIC SOURCE READ. It proves the field is requested and stored; it cannot prove Google returned a value, that
// the value is correct, or that any consumer honours the precedence rule — nothing consumes it yet. Read a green
// as "the field is still wired", never as "campaign type is trustworthy on every row".
//
// USAGE: node tests/guards/campaign-channel-type-captured.guard.mjs [--inject-drop-select] [--inject-drop-store]
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const read = (rel) => { try { return readFileSync(path.resolve(ROOT, rel), 'utf8') } catch { return null } }
const FILE = 'src/lib/backfill/google-campaign-backfill.ts'

const DROP_SELECT = process.argv.includes('--inject-drop-select')
const DROP_STORE = process.argv.includes('--inject-drop-store')

// ── PURE CORE ───────────────────────────────────────────────────────────────────────────────────────────────────
export function decideChannelTypeCapture({ selectsType, selectsSubType, storesType, storesSubType, hasPrecedence }) {
  const f = []
  if (!selectsType) f.push('the campaign backfill GAQL no longer selects `campaign.advertising_channel_type`. Without it every criteria-dependent family is judged against account spend again — the Foam OH PMax misclassification returns, silently.')
  if (!selectsSubType) f.push('the campaign backfill GAQL no longer selects `campaign.advertising_channel_sub_type`.')
  if (!storesType) f.push('`channelType` is no longer written into the campaign row `extra`. Selecting a field and discarding it is the same defect with an extra step.')
  if (!storesSubType) f.push('`channelSubType` is no longer written into the campaign row `extra`.')
  if (!hasPrecedence) f.push('the PRECEDENCE comment is gone. entity_state_history WINS over `extra` when they disagree, because extra stamps a campaign\'s CURRENT type onto historical rows. That rule must stay where it executes.')
  return { findings: f, ok: f.length === 0 }
}

// ── INPUTS ──────────────────────────────────────────────────────────────────────────────────────────────────────
const src = read(FILE)
if (!src) { console.error(`✗ ${FILE} unreadable — BROKEN INSTRUMENT, not a pass.`); process.exit(2) }
const gaqlLine = (src.split('\n').find((l) => l.includes('SELECT campaign.id')) || '')
if (!gaqlLine) { console.error(`✗ could not locate the campaign GAQL in ${FILE} — BROKEN INSTRUMENT, not a pass.`); process.exit(2) }

const selectsType = !DROP_SELECT && gaqlLine.includes('campaign.advertising_channel_type')
const selectsSubType = !DROP_SELECT && gaqlLine.includes('campaign.advertising_channel_sub_type')
const storesType = !DROP_STORE && /channelType:\s*String\(/.test(src)
const storesSubType = !DROP_STORE && /channelSubType:\s*String\(/.test(src)
const hasPrecedence = src.includes('entity_state_history') && src.includes('PRECEDENCE')
if (DROP_SELECT) console.log('  [--inject-drop-select] removed both channel-type fields from the GAQL in the check INPUT (no file written) — it must go RED.')
if (DROP_STORE) console.log('  [--inject-drop-store] removed both extra writes in the check INPUT (no file written) — it must go RED.')

// ── REPORT, ALWAYS WITH ITS DENOMINATOR ─────────────────────────────────────────────────────────────────────────
const v = decideChannelTypeCapture({ selectsType, selectsSubType, storesType, storesSubType, hasPrecedence })
console.log(`[channel-type-captured] ${FILE}`)
console.log(`[channel-type-captured] GAQL selects: type=${selectsType} subType=${selectsSubType} · extra stores: channelType=${storesType} channelSubType=${storesSubType} · precedence comment=${hasPrecedence}`)
console.log('[channel-type-captured] STATIC READ — proves the field is requested and stored, NOT that Google returned it or that any consumer honours precedence. See the header.')
if (!v.ok) {
  console.error(`✗ channel-type-captured FAIL — ${v.findings.length} finding(s):`)
  for (const f of v.findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('✓ channel-type-captured OK — selected, stored, and the precedence rule is still attached.')
process.exit(0)
