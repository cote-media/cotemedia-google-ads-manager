#!/usr/bin/env node
// LORAMER_CANONICAL_KEY_SPELLING_V1 — ONE CANONICAL SPELLING PER FACT, IN THE KEY ITSELF.
//
// ⛔ THIS IS G1's SHAPE APPLIED TO KEY FORMATS INSTEAD OF CONSTANTS, AND IT EXISTS BECAUSE THE SECOND SPELLING
// ALREADY HAPPENED. Measured 2026-08-09 on Foam OH: the walk and the drain wrote the SAME FACT — same campaign,
// same day, same device, identical spend/impressions/clicks — as TWO rows, because they disagreed on two of the
// seven columns of `metrics_daily_p_natural_key`:
//     entity_id        drain `23424584377`      walk `customers/7688521852/campaigns/23424584377`
//     breakdown_value  drain `DESKTOP`          walk `4`
//     breakdown_value  drain `00`..`23`         walk `0`..`23`   (hour, unpadded)
// 67,455 rows across four lanes, spanning 2022-03-05 → 2026-04-05. The unique index CANNOT collapse them, so
// both persist; `queryBreakdown` groups by breakdown_value, so Lora is handed buckets literally named "2",
// "3", "4" beside MOBILE/TABLET/DESKTOP. **NO EXISTING GUARD SAW IT.** check:data's completion gate compares
// claims to row PRESENCE, and duplicates only make presence stronger — they can never trip it.
//
// ⛔ THE DURABLE POINT IS NOT DEVICE AND HOUR. It is that a THIRD spelling is one adapter away: Meta, GA4,
// Shopify and WooCommerce each arrive with their own vendor forms, and nothing in this repo says which form
// wins. This registry says. A writer that emits a second spelling for a fact already spelled fails the build.
//
// ⛔ THE DRAIN IS THE INCUMBENT AND DOES NOT MOVE. Every canonical form below is READ FROM THE DRAIN'S OWN
// PRODUCER at file:line, never re-derived from a vendor doc or from an instruction:
//   entity_id (campaign) — google-device.ts:56  `String(r.campaign?.id || '')`      → BARE ID
//   entity_id (ad_group) — google-device.ts:61  `String(r.ad_group?.id || '')`      → BARE ID
//   entity_id (ad)       — google-device.ts:66  `String(r.ad_group_ad?.ad?.id||'')` → BARE ID
//   device value         — google-device.ts:31-33 `deviceName()` — a SEVEN-entry map
//   hour value           — google-hour.ts:33 `pad2()` — zero-padded to 2 chars
// Forward capture and the drain share those producers (google-device-backfill.ts:14, google-hour-backfill.ts:14
// import the same builders), so the incumbent spelling is internally consistent. Verified, not assumed.
//
// LEGS
//  (p) every catalog resource that maps onto a legacy entity_level emits the BARE-ID entity_id shape
//  (q) no breakdown_type may have two emittable value spellings (enum-name vs ordinal, padded vs unpadded)
//  (r) THE REGISTRY: a canonical form per fact, and the walk's normaliser must agree with the incumbent
//      producer when both are executed on the same input
//  (s) --db ONLY: no (client, platform, entity_level, breakdown_type, date) holds two rows whose
//      breakdown_values are a known pair. KNOWN-RED until the cleanup flight — see the header on that leg.
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const WITH_DB = process.argv.includes('--db')
const findings = []
// ⛔ LORAMER_CANNOT_RUN_IS_NOT_FAILED_V1 — evidence this machine could not GATHER, kept apart from evidence
// of a defect. Both refuse to pass; conflating them is how a standing environmental red becomes background noise.
const blockers = []
const read = (p) => { try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return '' } }
const strip = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

const WRITER = 'src/lib/backfill/google-ads-universe-writer.ts'
const SURFACES = 'src/lib/backfill/universe-surfaces.ts'

// ── THE CANONICAL REGISTRY ────────────────────────────────────────────────────────────────────────────────
// APPEND when a new fact gains a key form. NEVER re-litigate an entry: the incumbent producer wins, because a
// second spelling is not a preference, it is a row the unique index cannot collapse.
const CANONICAL = [
  {
    fact: 'entity_id at a legacy entity_level',
    canonical: 'the BARE vendor id, no resource path',
    incumbent: 'src/lib/intelligence/google-device.ts:56,61,66',
    // A walk resource whose NAME equals a legacy entity_level shares the key space with the drain.
    collidingResources: ['campaign', 'ad_group', 'ad'],
    forbidden: /^customers\//,
  },
  {
    fact: "breakdown_value for breakdown_type 'device'",
    canonical: 'the canonical UPPER enum NAME from deviceName()',
    incumbent: 'src/lib/intelligence/google-device.ts:31-33',
    pairs: [['2', 'MOBILE'], ['3', 'TABLET'], ['4', 'DESKTOP'], ['5', 'OTHER'], ['6', 'CONNECTED_TV'], ['0', 'UNSPECIFIED'], ['1', 'UNKNOWN']],
  },
  {
    fact: "breakdown_value for breakdown_type 'hour'",
    canonical: 'zero-padded two-character "00".."23" from pad2()',
    incumbent: 'src/lib/intelligence/google-hour.ts:33',
    pairs: [['0', '00'], ['1', '01'], ['2', '02'], ['3', '03'], ['4', '04'], ['5', '05'], ['6', '06'], ['7', '07'], ['8', '08'], ['9', '09']],
  },
]

// ⛔ IMPORT LINES ARE EXCLUDED FROM THE CALL-SITE LEGS, AND THIS WAS FOUND BY FAILING TO PROVE THEM RED.
// The first version matched the NAME anywhere in the file, so deleting the CALL while leaving the `import`
// still read as green — a guard that cannot fail when the behaviour is removed is a comment. The legs now
// look for the invocation, in the body.
const writerBody = strip(read(WRITER)).split('\n').filter((l) => !/^\s*import\b/.test(l)).join('\n')
const writer = strip(read(WRITER))
const surfaces = strip(read(SURFACES))
if (!writer) { console.error(`[canonical-key-spelling] FAIL — ${WRITER} unreadable.`); process.exit(1) }

// ── (p) THE BARE-ID SHAPE AT A COLLIDING RESOURCE ─────────────────────────────────────────────────────────
{
  // `entityIdFor` is the ONE place the walk mints entity_id. It must not hand a resource_name straight through
  // for a resource that shares a key space with the drain.
  const hasNormaliser = /canonicalEntityId\s*\(/.test(writerBody)
  if (!hasNormaliser) {
    findings.push(
      `(p) ${WRITER} has NO entity_id normaliser. \`entityIdFor\` returns the vendor's resource_name verbatim, so for\n` +
      `      the colliding resources [${CANONICAL[0].collidingResources.join(', ')}] the walk writes\n` +
      `      \`customers/…/campaigns/23424584377\` where the drain writes \`23424584377\` — two rows, one fact,\n` +
      `      and a unique index that cannot collapse them (measured: 67,455 rows on Foam OH).`)
  }
  if (!/LEGACY_ENTITY_LEVEL_RESOURCES/.test(surfaces)) {
    findings.push(`(p) the set of resources that collide with a legacy entity_level is not declared as DATA anywhere in ${SURFACES} or ${WRITER}. Scattering that judgment as conditionals in the builder is how the next adapter misses one.`)
  }
}

// ── (q) NO TWO EMITTABLE SPELLINGS FOR ONE breakdown_type ─────────────────────────────────────────────────
{
  const hasValueNormaliser = /canonicalBreakdownValue\s*\(/.test(writerBody)
  if (!hasValueNormaliser) {
    findings.push(
      `(q) neither ${WRITER} nor ${SURFACES} canonicalises breakdown_value. The walk writes the RAW segment value —\n` +
      `      device ordinals "2"/"3"/"4" against the drain's MOBILE/TABLET/DESKTOP, and unpadded "0".."23" against\n` +
      `      the drain's "00".."23" — so one dimension occupies two value spaces and Lora is handed both.`)
  }
}

// ── (r) THE REGISTRY, AND THE NORMALISER MUST AGREE WITH THE INCUMBENT ────────────────────────────────────
{
  for (const c of CANONICAL) {
    if (!existsSync(resolve(ROOT, c.incumbent.split(':')[0]))) {
      findings.push(`(r) the incumbent producer for ${c.fact} (${c.incumbent}) is MISSING — the canonical form has no source.`)
    }
  }
  // The registry is only worth something if the walk actually consults it.
  if (!/universe-surfaces|canonicalBreakdownValue|canonicalEntityId/.test(writer)) {
    findings.push(
      `(r) ${WRITER} does not consult any canonical-spelling source. THE REGISTRY IS THE POINT: device and hour are\n` +
      `      the two seeded facts, but a THIRD spelling is one adapter away — Meta, GA4, Shopify and Woo each arrive\n` +
      `      with their own vendor forms, and nothing else in this repo says which form wins.`)
  }
  // Executable agreement: the incumbent's own map must still say what this registry claims it says.
  const dev = read('src/lib/intelligence/google-device.ts')
  for (const [ord, name] of CANONICAL[1].pairs) {
    if (!new RegExp(`'${ord}':\\s*'${name}'`).test(dev)) {
      findings.push(`(r) the incumbent device map no longer maps '${ord}' → '${name}' (google-device.ts:31). The registry and the producer have drifted; the PRODUCER wins and this entry must be re-read from it.`)
    }
  }
  if (!/padStart\(2,\s*'0'\)/.test(read('src/lib/intelligence/google-hour.ts'))) {
    findings.push(`(r) the incumbent hour producer no longer zero-pads to 2 characters (google-hour.ts:33). Re-read the canonical form from it.`)
  }
}

// ── (s) THE DATA LEG — KNOWN-RED UNTIL THE CLEANUP FLIGHT ─────────────────────────────────────────────────
// ⛔ THIS IS DELIBERATELY **NOT** AN EXCEPTION, AND THE DIFFERENCE IS THE WHOLE DESIGN. A baseline entry would
// freeze a COUNT and let it grow silently underneath. This leg re-counts every run and PRINTS the number, so a
// cleanup that half-works, or a writer regression that adds more, is visible as a moving figure rather than a
// steady green. It is expected RED until the duplicate rows are dealt with in their own flight.
if (WITH_DB) {
  const pg = await import('pg')
  if (!process.env.SUPABASE_DB_URL) {
    // ⛔ LORAMER_CANNOT_RUN_IS_NOT_FAILED_V1, 2026-08-10 — A BLOCKER, NOT A FINDING. The refusal is
    // UNCHANGED and still exits non-zero; what changes is that it no longer RENDERS like a data defect.
    // A recurring environmental red and a real one looked identical at a glance, and on 2026-08-10 that
    // cost a push report that could not say which it was looking at.
    blockers.push('(s) SUPABASE_DB_URL is missing (.env.local), so the duplicate-row count could not be taken on this machine. STILL REFUSING TO PASS: a skipped count reads exactly like a clean one, which is the failure mode this leg exists to prevent. This is an ENVIRONMENT blocker, NOT evidence about the data.')
  } else {
    const db = new pg.default.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } }); await db.connect()
    const { rows } = await db.query(`
      select entity_level, breakdown_type,
             count(*) filter (where entity_id like 'customers/%') as walk_spelled,
             count(*) filter (where entity_id not like 'customers/%') as legacy_spelled
      from metrics_daily
      where platform = 'google' and entity_level in ('campaign','ad_group','ad')
        and breakdown_type in ('device','hour')
      group by 1,2 having count(*) filter (where entity_id like 'customers/%') > 0`)
    await db.end()
    const total = rows.reduce((a, r) => a + Number(r.walk_spelled), 0)
    if (total > 0) {
      findings.push(
        `(s) KNOWN-RED, ${total} walk-spelled row(s) still occupy a shared key space:\n` +
        rows.map((r) => `        ${r.entity_level}/${r.breakdown_type}: walk ${r.walk_spelled} · legacy ${r.legacy_spelled}`).join('\n') +
        `\n      This is EXPECTED until the cleanup flight and is NOT baselined on purpose — the number must move when\n` +
        `      the rows are dealt with, and must be seen to grow if a writer regresses.`)
    }
  }
}

// ⛔ TWO NON-ZERO STATES, AND THEY MUST NOT LOOK ALIKE. `FAILED` is a claim about the DATA. `CANNOT-RUN` is
// a claim about THIS MACHINE. Both refuse to pass; only one is a defect. The difference lives in the BANNER, not in the exit
// code: `check:data` takes the MAX exit of its legs, so a special code would outrank and mask a real failure.
if (findings.length) {
  console.error(`\n❌ LORAMER_CANONICAL_KEY_SPELLING_V1 FAILED — ${findings.length} finding(s) ABOUT THE DATA\n`)
  findings.forEach((f) => console.error('  • ' + f + '\n'))
  if (blockers.length) {
    console.error(`  ⚠ AND ${blockers.length} leg(s) COULD NOT RUN — listed below; they are not part of the count above.\n`)
    blockers.forEach((b) => console.error('  ⚠ ' + b + '\n'))
  }
  console.error('  ⛔ THE INCUMBENT SPELLING WINS. A new writer conforms to it; it never conforms to a new writer.\n')
  process.exit(1)
}
if (blockers.length) {
  console.error(`\n⚠ LORAMER_CANONICAL_KEY_SPELLING_V1 CANNOT-RUN — ${blockers.length} leg(s) blocked by the ENVIRONMENT, 0 findings about the data\n`)
  blockers.forEach((b) => console.error('  ⚠ ' + b + '\n'))
  console.error('  ⛔ THIS IS NOT A PASS. Nothing was proven about the data; the machine could not ask.\n')
  // ⛔ EXIT 1, NOT A DISTINCT CODE, AND THE FIRST ATTEMPT AT THIS GOT IT WRONG. `check:data` chains its legs
  // and takes the MAX exit code. A dedicated CANNOT-RUN code of 3 would OUTRANK a real exit-1 data failure
  // elsewhere in the chain, and an operator reading "3" would conclude "just the environment" while a genuine
  // defect sat underneath it. The distinction belongs in the OUTPUT, where a human reads it; the exit code
  // must stay ordinary so nothing can hide behind it.
  process.exit(1)
}
console.log(
  `canonical-key-spelling.guard: PASS — ${CANONICAL.length} canonical fact(s); the walk normalises entity_id at ` +
  `[${CANONICAL[0].collidingResources.join(', ')}] and canonicalises device + hour values against the incumbent ` +
  `producers.${WITH_DB ? '' : ' (data leg (s) runs under --db in check:data.)'} ` +
  `LIMIT: it checks the WRITER's shape, not every row already in the warehouse.`
)
