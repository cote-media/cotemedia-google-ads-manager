#!/usr/bin/env node
// LORAMER_CHANNEL_TYPE_ENUM_V1 — EVERY AdvertisingChannelType ORDINAL MUST RENDER AS A NAME.
//
// ── WHY ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// MEASURED 2026-08-01 on a real assembled context for Foam OH: `channelType` came back as 3, 2 and 10 — raw enum
// ordinals. The old normalizeChannelType keyed on STRING names only and ended `map[type] || type`, so numbers fell
// straight through and build-claude-context.ts:610 rendered `[10]` and `[2]` to the user as the campaign's type,
// on every Google client. :917 did the same on impression-share lines.
// ⛔ AND THE OLD MAP WAS WRONG, NOT MERELY INCOMPLETE: it read `MULTI_CHANNEL: 'Performance Max'`. Google's proto
// says MULTI_CHANNEL = 7 is App Campaigns and PERFORMANCE_MAX = 10 is a separate value the map never carried. An
// App campaign was being reported as Performance Max. Renaming one campaign type as another is not a display bug,
// and a guard that only checked "is it a number" would have let it through.
//
// ── THE ASSERTION ───────────────────────────────────────────────────────────────────────────────────────────────
//   1. every ordinal in the enum resolves to a name — none renders as a bare number and none is dropped
//   2. PERFORMANCE_MAX (10) is present AND resolves to 'Performance Max'
//   3. MULTI_CHANNEL (7) does NOT resolve to 'Performance Max' — the specific historical error, pinned
//   4. an ordinal outside the enum renders UNKNOWN(n), visibly, never a bare token
//   5. the string-name path still works, so a future SDK that returns names does not regress
// ⛔ ORDINALS ARE PINNED HERE FROM GOOGLE'S PROTO, not read back out of the implementation — a guard that derives
// its expectations from the code under test proves only that the code agrees with itself.
// Source: googleapis/googleapis .../v21/enums/advertising_channel_type.proto, fetched 2026-08-01.
//
// ── HONEST LIMIT ────────────────────────────────────────────────────────────────────────────────────────────────
// This checks the MAPPING. It cannot check that Google's enum has not gained a value since 2026-08-01 — a new
// ordinal would correctly render UNKNOWN(15) and this stays green, which is the safe direction but is not the same
// as being current. Re-read the proto when the API major moves.
//
// USAGE: node tests/guards/channel-type-enum-mapped.guard.mjs [--inject-drop-pmax]
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const SRC = 'src/lib/intelligence/google-intelligence.ts'
const src = (() => { try { return readFileSync(path.resolve(ROOT, SRC), 'utf8') } catch { return null } })()
if (!src) { console.error(`✗ ${SRC} unreadable — BROKEN INSTRUMENT, not a pass.`); process.exit(2) }

// Google's proto, pinned. name → ordinal. 12 is absent from the enum (legacy DISCOVERY) and is carried
// deliberately by the implementation, so it is expected to resolve too.
const PROTO = { UNSPECIFIED: 0, UNKNOWN: 1, SEARCH: 2, DISPLAY: 3, SHOPPING: 4, HOTEL: 5, VIDEO: 6,
  MULTI_CHANNEL: 7, LOCAL: 8, SMART: 9, PERFORMANCE_MAX: 10, LOCAL_SERVICES: 11, TRAVEL: 13, DEMAND_GEN: 14 }

const DROP_PMAX = process.argv.includes('--inject-drop-pmax')

// Extract the two maps from the source rather than importing (the module pulls in the whole intelligence graph).
function mapFrom(name) {
  const i = src.indexOf(`const ${name}: Record<string, string> = {`)
  if (i < 0) return null
  const body = src.slice(i, src.indexOf('\n}', i))
  const out = {}
  for (const m of body.matchAll(/'?([A-Z_0-9]+)'?\s*:\s*'([^']*)'/g)) out[m[1]] = m[2]
  return out
}
const byOrdinal = mapFrom('CHANNEL_TYPE_BY_ORDINAL')
const byName = mapFrom('CHANNEL_TYPE_BY_NAME')
if (!byOrdinal || !byName) { console.error(`✗ could not locate both channel-type maps in ${SRC} — BROKEN INSTRUMENT.`); process.exit(2) }
if (DROP_PMAX) { delete byOrdinal['10']; delete byName.PERFORMANCE_MAX; console.log('  [--inject-drop-pmax] removed PERFORMANCE_MAX from BOTH maps in the check INPUT (no file written) — it must go RED.') }

const findings = []
for (const [name, ord] of Object.entries(PROTO)) {
  const o = byOrdinal[String(ord)]
  if (!o) findings.push(`ordinal ${ord} (${name}) has no mapping — it would render as a bare number in Lora's prompt.`)
  if (!byName[name]) findings.push(`string name ${name} has no mapping — a future SDK returning names would regress.`)
}
if (byOrdinal['10'] !== 'Performance Max') findings.push(`ordinal 10 must resolve to 'Performance Max', got ${JSON.stringify(byOrdinal['10'])}.`)
if (byName.PERFORMANCE_MAX !== 'Performance Max') findings.push(`PERFORMANCE_MAX must resolve to 'Performance Max', got ${JSON.stringify(byName.PERFORMANCE_MAX)}.`)
if (byOrdinal['7'] === 'Performance Max' || byName.MULTI_CHANNEL === 'Performance Max') findings.push(`MULTI_CHANNEL (7) is App Campaigns, NOT Performance Max — this is the exact error that shipped. Do not restore it.`)
if (!/UNKNOWN\(\$\{v\}\)/.test(src)) findings.push('the UNKNOWN(n) fallback is gone — an unrecognised value would pass through bare, which is how 10 reached a user.')
if (!/normalizeChannelTypeValue\(row\.campaign\?\.advertising_channel_type\)/.test(src)) findings.push('an advertising_channel_type site is no longer routed through normalizeChannelTypeValue.')

console.log(`[channel-type-enum] ${Object.keys(PROTO).length} proto values checked · ${Object.keys(byOrdinal).length} ordinal mappings · ${Object.keys(byName).length} name mappings`)
console.log('[channel-type-enum] MAPPING CHECK — cannot detect a value Google ADDED after 2026-08-01 (it would render UNKNOWN(n), safe but not current). See the header.')
if (findings.length) {
  console.error(`✗ channel-type-enum FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('✓ channel-type-enum OK — every proto ordinal and name maps, PMax is right, MULTI_CHANNEL is not PMax, UNKNOWN(n) intact.')
process.exit(0)
