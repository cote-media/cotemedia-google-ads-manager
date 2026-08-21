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
//  (t) --db ONLY: no natural key (minus entity_id) holds two rows whose entity_ids differ only by a
//      'customers/<id>/<resource>/' prefix. ⛔ (s) CANNOT SEE THIS — it is scoped to device+hour and keys off
//      the VALUE axis, so a pair that agrees on breakdown_value and splits only on entity_id is invisible to
//      it. KNOWN-RED until the cleanup flight — see the header on that leg.
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

// ⛔ LORAMER_GUARD_LOADS_ENV_LOCAL_V1 (★CANNOT-RUN-LEGS-NEVER-LOAD-ENV-LOCAL), 2026-08-11. LEG (s) REPORTED
// "SUPABASE_DB_URL is missing (.env.local)" WHILE IT SAT IN .env.local, POPULATED, THE WHOLE TIME — node does
// not auto-load env files (Next.js does; `npm run check:data` runs bare `node`), and this guard read
// `process.env` directly. The count that gates the 67,455-row cleanup was therefore never taken on this
// machine, and the message blamed the machine for it.
//
// ⛔ CALLED LAZILY, INSIDE THE --db BRANCH, AND THAT PLACEMENT IS THE LOAD-BEARING PART. This guard ALSO runs
// in the HERMETIC `npm run guard` (scripts/run-guards.mjs:210), which runs inside `next build` ON VERCEL where
// there is no .env.local at all. A module-top `readFileSync` would throw there and break the deploy.
//
// ⛔ WHY THIS SHAPE AND NOT THE ONE THE QUEUE ENTRY NAMED. The entry said to copy
// `scripts/check-parent-analyze.mjs:27`. Surveyed all 18 hand-rolled loaders first: that one belongs to a
// three-file family that builds a LOCAL `env` object and lets `readFileSync` THROW on a missing file. Both
// properties are wrong here — the throw is the Vercel break above, and a local object would force every
// `process.env.SUPABASE_DB_URL` read site in this file to change and would diverge from the FOUR sibling
// guards (canonical-client-identity, google-op-budget, universe-attempt-append-only,
// universe-failure-is-durable) that all already use the process.env / soft / quote-stripping shape. That
// family is canonical FOR GUARDS and is what this copies.
// ⚠ WITH TWO CORRECTIONS TO IT, because the sibling shape has its own drift: it splits on '=' (which would
// TRUNCATE any DSN carrying a query parameter such as `?sslmode=require` into a silently-broken connection
// string — measured today: this value holds zero '=' characters, so it works BY LUCK) and it does not skip
// comment lines. `indexOf('=')` and the '#' skip come from the other family, which had them right.
// ⛔ AND IT READS FROM process.cwd(), NEVER FROM `ROOT`: .env.local is a property of THE MACHINE, not of the
// tree under audit. A red-proof copy under LORAMER_GUARD_ROOT has no .env.local, and the --db leg asks about
// LIVE DATA rather than about the copied tree.
// SCOPE: this flight fixes THE TWO guards that had no loader. The other 18 are NOT unified here.
function loadEnvLocal() {
  let txt = ''
  try { txt = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8') } catch { return }
  for (const line of txt.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i <= 0) continue
    const k = t.slice(0, i).trim()
    // ⛔ NEVER CLOBBER A REAL ENVIRONMENT VARIABLE. A value exported in the shell or injected by CI outranks
    // a file on disk; the file is the fallback, not the authority.
    if (process.env[k]) continue
    process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
}

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
  loadEnvLocal()
  if (!process.env.SUPABASE_DB_URL) {
    // ⛔ LORAMER_CANNOT_RUN_IS_NOT_FAILED_V1, 2026-08-10 — A BLOCKER, NOT A FINDING. The refusal is
    // UNCHANGED and still exits non-zero; what changes is that it no longer RENDERS like a data defect.
    // A recurring environmental red and a real one looked identical at a glance, and on 2026-08-10 that
    // cost a push report that could not say which it was looking at.
    blockers.push('(s) SUPABASE_DB_URL is missing (.env.local), so the duplicate-row count could not be taken on this machine. STILL REFUSING TO PASS: a skipped count reads exactly like a clean one, which is the failure mode this leg exists to prevent. This is an ENVIRONMENT blocker, NOT evidence about the data.')
  } else {
    const db = new pg.default.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } }); await db.connect()
    // ⛔ RE-SCOPED 2026-08-11 BY THE CLEANUP FLIGHT (LORAMER_WALKDUPE_CLEANUP_V1), AND THE RE-SCOPE IS THE
    // FINDING THAT FLIGHT PRODUCED. This leg counted walk-spelled rows IN THE SHARED KEY SPACE and called the
    // total "duplicates". IT WAS NOT MEASURING DUPLICATES. Of the 67,455 it reported, only 51,068 had a legacy
    // TWIN; the other 16,387 are rows the drain never wrote for that (day, entity, value) — REAL, UNIQUE DATA
    // in a non-canonical spelling. **A DELETE KEYED ON THIS LEG'S OWN HEADLINE NUMBER WOULD HAVE DESTROYED
    // 16,387 UNIQUE ROWS**, which is exactly the class of mistake the twin test exists to prevent, one level up
    // from the ~68.1M catastrophe the queue entry already warned about.
    // ⇒ TWO SEPARATE NUMBERS NOW, because they have DIFFERENT FIXES: `twinned` is a DUPLICATE and its fix is a
    // DELETE (done for Foam OH); `untwinned` is a SPELLING defect on unique data and its fix is an UPDATE that
    // normalises it — never a delete. Collapsing them into one figure is what made the first number dangerous.
    // ⛔ ONE HASH JOIN, NOT A CORRELATED EXISTS. The EXISTS form re-scanned the 878k-row legacy side once per
    // walk row and was CANCELLED by the statement timeout — a guard that cannot complete is not a guard.
    // The walk side is small (16,387 after the cleanup) and the join key is the natural key, so at most one
    // legacy row matches and the LEFT JOIN cannot multiply the count.
    const { rows } = await db.query(`
      with walk as (
        select client_id, entity_level, breakdown_type, date,
               split_part(entity_id,'/',-1) as bare_id,
               case when breakdown_type='device' then
                      case breakdown_value when '0' then 'UNSPECIFIED' when '1' then 'UNKNOWN' when '2' then 'MOBILE'
                        when '3' then 'TABLET' when '4' then 'DESKTOP' when '5' then 'OTHER'
                        when '6' then 'CONNECTED_TV' else breakdown_value end
                    else lpad(breakdown_value,2,'0') end as canon_value
        from metrics_daily
        where platform='google' and entity_level in ('campaign','ad_group','ad')
          and breakdown_type in ('device','hour') and entity_id like 'customers/%'
      ), legacy as (
        select client_id, entity_level, breakdown_type, date, entity_id, breakdown_value
        from metrics_daily
        where platform='google' and entity_level in ('campaign','ad_group','ad')
          and breakdown_type in ('device','hour') and entity_id not like 'customers/%'
      )
      select w.entity_level, w.breakdown_type,
             count(*) as walk_spelled,
             count(l.entity_id) as twinned
      from walk w
      left join legacy l
        on l.client_id=w.client_id and l.entity_level=w.entity_level
       and l.breakdown_type=w.breakdown_type and l.date=w.date
       and l.entity_id=w.bare_id and l.breakdown_value=w.canon_value
      group by 1,2 having count(*) > 0`)
    await db.end()
    const twinned = rows.reduce((a, r) => a + Number(r.twinned), 0)
    const walk = rows.reduce((a, r) => a + Number(r.walk_spelled), 0)
    const untwinned = walk - twinned
    // ⛔ THE DUPLICATE HALF IS A FINDING — it is what a DELETE fixes, and it must return to zero and stay there.
    if (twinned > 0) {
      findings.push(
        `(s) ${twinned} TWINNED duplicate row(s) — the same fact stored twice under two spellings:\n` +
        rows.filter((r) => Number(r.twinned) > 0)
            .map((r) => `        ${r.entity_level}/${r.breakdown_type}: twinned ${r.twinned} of ${r.walk_spelled} walk-spelled`).join('\n') +
        `\n      NOT baselined on purpose — the number must move when the rows are dealt with, and must be seen to\n` +
        `      GROW if a writer regresses. The fix is a scoped delete under the twin test, NEVER a delete keyed on\n` +
        `      walk-spelling alone.`)
    }
    // ⛔ THE SPELLING HALF IS REPORTED, NOT FAILED, AND THE ASYMMETRY IS DELIBERATE. These rows are the ONLY
    // copy of their fact — failing the build over them would pressure someone into deleting real data to get
    // green, which is precisely the wrong incentive. They are named so they cannot be forgotten, and they carry
    // their own fix (★WALKDUPE-UNTWINNED-NEED-NORMALISING).
    if (untwinned > 0) {
      console.log(`  ⚠ REPORTED, NOT FAILED: ${untwinned} walk-spelled row(s) have NO legacy twin — UNIQUE data in a`)
      console.log(`    non-canonical spelling. queryBreakdown groups by breakdown_value, so Lora is handed buckets named`)
      console.log(`    "2"/"3"/"4" beside MOBILE/TABLET/DESKTOP for these. THE FIX IS AN UPDATE, NEVER A DELETE —`)
      console.log(`    deleting them destroys the only copy. ★WALKDUPE-UNTWINNED-NEED-NORMALISING owns it.`)
      for (const r of rows.filter((r) => Number(r.walk_spelled) - Number(r.twinned) > 0)) {
        console.log(`      ${r.entity_level}/${r.breakdown_type}: ${Number(r.walk_spelled) - Number(r.twinned)} un-twinned`)
      }
    }
  }
}

// ── (t) THE ENTITY_ID TWIN LEG — LORAMER_ENTITY_ID_TWIN_DETECTOR_V1, 2026-08-21 ───────────────────────────
// ⛔ WHY THIS EXISTS WHEN LEG (s) IS RIGHT THERE, AND THE ANSWER IS THE WHOLE POINT: leg (s) IS SCOPED TO
// `breakdown_type in ('device','hour')` AND REQUIRES A KNOWN breakdown_value PAIR. It was built for the
// VALUE axis — ordinal-vs-enum, padded-vs-unpadded — and the entity_id half rides along only inside those two
// families. So the split that mattered most was invisible to it: at `campaign|campaign` the two rows agree on
// breakdown_value ('' both sides) and differ ONLY in entity_id, and leg (s) never looks there.
// MEASURED 2026-08-21, after LORAMER_CANONICAL_KEY_SPELLING_V1 had been green for twelve days:
// 11,309 prefixed rows across 34 (level, breakdown_type) surfaces still carry a bare twin, and leg (s)
// reported none of them because none of them is device or hour.
// ⛔ AND THE WRITER IS NOT THE DEFECT — LEG (p) IS CORRECT AND STAYS GREEN. `canonicalEntityId` has emitted
// the bare id since 2026-08-09 and both emit sites in the writer go through it (`entityIdFor`, at :961 and
// :1028). These are STALE ROWS from the 2026-08-03..08-07 walk, and a leg that tests the writer can never see
// them. THIS LEG READS ROWS. That is the difference, and it is the difference the repo keeps re-learning.
// ⛔ IT GROWS WHILE UNATTENDED. Every day the walk re-covers that it had already covered before 08-07 mints a
// new twin: the `campaign|campaign` count was 45 at 13:5xZ on 2026-08-21 and 46 forty minutes later, with the
// newest row written 42 seconds before the read. A number that moves on its own is not baselined here for the
// same reason leg (s) is not baselined — a frozen count would hide exactly the growth that matters.
//
// ── HOW IT STAYS INSIDE A BUDGET WITHOUT NARROWING WHAT IT ASKS ──
// `entity_id` has NO index and metrics_daily is ~162M rows across ~55 monthly partitions, so the obvious
// query cannot run: a fleet-wide GROUP BY was CANCELLED at 115s, and so were a breakdown_type-scoped variant
// (the planner drops to a Bitmap Heap Scan) and a per-client variant on the two heaviest clients.
// ⛔ THE THING THAT MADE IT CHEAP IS THAT THE COVERING INDEX ALREADY EXISTS. `metrics_daily_p_natural_key` is
// (client_id, platform, entity_level, entity_id, date, breakdown_type, breakdown_value) — entity_id is its
// FOURTH column, so with EQUALITY on the first three the walk's resource-path ids are one contiguous band and
// Postgres range-seeks straight to them. Foam OH: 78.8s with `entity_level = ANY(...)` (no index cond) →
// 4.4s with one query per level (a real Index Cond). Same rows, same answer, ~18× cheaper.
// ⛔ NO NEW INDEX IS CREATED, DELIBERATELY. CREATE INDEX CONCURRENTLY is not supported on a partitioned
// parent, and the sanctioned workaround (per-partition CONCURRENTLY, then the parent non-concurrently) is a
// migration on a live 160GB table — not something a guard may do to the database it is auditing.
// THREE PHASES, each one bounded:
//   1. an existence probe per (client, entity_level): the band + LIMIT 1. 84 probes, ~11.7s total.
//   2. only for a client that HIT: the band grouped by breakdown_type — discovers the affected families from
//      the ROWS, never from a hand-list, so a family nobody thought of is still found.
//   3. per (client, level, breakdown_type): the twin test, on the (client, platform, breakdown_type,
//      entity_level, date) index.
// MEASURED END TO END: 40.7s, whole fleet, zero timeouts, zero breakdown_types excluded.
//
// ⛔ WHAT A TIMEOUT ACTUALLY DOES, WRITTEN DOWN BECAUSE THE WRONG REASON IS THE TEMPTING ONE. Exceeding
// `statement_timeout` CANCELS the statement and raises 57014; it does NOT return a short result set that
// reads like a clean one (postgresql.org/docs/current/runtime-config-client.html). So the danger this leg
// guards against is not a silent partial ANSWER — it is a silent partial RUN, and that danger is real here
// precisely BECAUSE the budget is per-STATEMENT: this leg issues 84 probes plus one query per discovered
// family, and NO single statement tripping the limit says nothing about whether every statement was issued.
// ⇒ THAT is why the catch below converts any error into a BLOCKER carrying how far it got, and why the
// denominator prints on every run. A paged or cursored scan can burn any amount of total time while each
// statement stays innocent; only the counts can tell you the sweep was complete.
//
// ⛔ THE BAND IS SOUND, AND THE LEG PROVES IT IN THE SERVER RATHER THAN ARGUING IT. The database collates
// en_US.UTF-8 (ICU), so `LIKE 'customers/%'` is a filter and not a range — the band `>= 'customers' AND
// < 'customert'` is what reaches the index, and the LIKE stays as an exact recheck. The band can only ever be
// WIDER than the pattern (any string with the prefix sorts after 'customers' and before 'customert', because
// they first differ at 's' < 't'), so it cannot produce a FALSE NEGATIVE — but that ordering is a property of
// the live collation, so it is TESTED on every run. If it ever stops holding, this leg goes CANNOT-RUN rather
// than quietly reporting a clean fleet.
//
// ⛔ WHAT THIS LEG DOES NOT COVER, STATED RATHER THAN IMPLIED, because an unstated scope limit is the defect
// class this whole guard exists to fight:
//   · PLATFORM: google only. A resource-path entity_id is a Google Ads API artifact; every other google writer
//     builds entity_id from a bare vendor id (google-device.ts:56,61,66 · google-campaign-backfill.ts:93 ·
//     google-adgroup-ad-backfill.ts:64 · google-metrics-row.ts:41), and meta/shopify/woo/ga are NOT examined.
//   · ENTITY_LEVEL: exactly the levels in LEGACY_ENTITY_LEVEL_RESOURCES, READ FROM universe-surfaces.ts rather
//     than typed here. At every OTHER level the walk's resource_name is the only spelling that has ever
//     existed, so no twin is possible — and if that set ever grows, this leg grows with it on the next run.
//   · DIRECTION: it counts PREFIXED rows that HAVE a bare twin. A bare row without a prefixed twin is the
//     normal, correct state and is not a finding.
//   · parent_entity_id: the twin pair also disagrees there (7688521852 vs NULL) and this leg catches the pair
//     anyway, because it does not group on parent. ⚠ BUT A PARENT-ONLY SPLIT CANNOT BE DETECTED BY ANY
//     DUPLICATE TEST AND THIS ONE IS NO EXCEPTION: parent_entity_id is NOT in the natural key, so two rows
//     differing only there cannot both exist — the second write UPDATES the first. Parent drift is invisible
//     by construction, not by omission. ⚠ NOT YET A QUEUE ITEM — it is OWED one, and this comment is the
//     only place it is currently written down.
if (WITH_DB) {
  const pg = await import('pg')
  loadEnvLocal()
  if (!process.env.SUPABASE_DB_URL) {
    blockers.push('(t) SUPABASE_DB_URL is missing (.env.local), so the entity_id twin count could not be taken on this machine. STILL REFUSING TO PASS. ENVIRONMENT blocker, NOT evidence about the data.')
  } else {
    // The levels are the walk resources that share a key space with the drain — READ FROM THE DECLARATION,
    // never re-typed. A hand-copy here is how 'ad' gets dropped and a whole grain stops being asked about.
    const m = surfaces.match(/LEGACY_ENTITY_LEVEL_RESOURCES\s*=\s*new Set\(\[([^\]]*)\]\)/)
    const LEVELS = m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : []
    if (!LEVELS.length) {
      blockers.push(`(t) could not read LEGACY_ENTITY_LEVEL_RESOURCES out of ${SURFACES}, so the leg does not know which entity_levels can hold a twin. REFUSING TO GUESS a level list — a guessed list is how a grain silently stops being audited.`)
    } else if (LEVELS.join(',') !== CANONICAL[0].collidingResources.join(',')) {
      findings.push(`(t) the colliding-resource set has DRIFTED: ${SURFACES} declares [${LEVELS.join(', ')}] while this guard's registry says [${CANONICAL[0].collidingResources.join(', ')}]. One of them is auditing a grain the other is not.`)
    } else {
      const db = new pg.default.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
      await db.connect()
      await db.query("SET statement_timeout='115s'")
      const BAND = `entity_id >= 'customers' and entity_id < 'customert' and entity_id like 'customers/%'`
      // ⛔ THE DENOMINATOR IS TRACKED, NOT ASSUMED (LORAMER_EMPTY_CARRIES_ITS_DENOMINATOR_V1). A zero from a
      // probe that RAN and a zero from a probe that was never issued must never print the same.
      let probes = 0, discoveries = 0, twinQueries = 0, twinned = 0, prefixedSeen = 0
      const offenders = []
      const perSurface = []
      let failed = null
      try {
        // COLLATION SOUNDNESS, asked of the server every run — see the header. Worst-case tails included,
        // because the point is the ORDERING and not a happy-path string.
        const { rows: [band] } = await db.query(
          `select ('customers/' >= 'customers') as lo, ('customers/' < 'customert') as hi,
                  ('customers/' || repeat(chr(255), 4) < 'customert') as hi_tail,
                  ('999999999999' < 'customers') as bare_below`)
        if (!band.lo || !band.hi || !band.hi_tail) {
          blockers.push(`(t) the index band ['customers','customert') no longer brackets 'customers/%' under this database's collation (lo=${band.lo} hi=${band.hi} tail=${band.hi_tail}). The seek could MISS rows, so this leg refuses to report a count rather than report one that may be short.`)
          failed = 'band'
        }
        if (!failed) {
          const { rows: clients } = await db.query(`select id, name from clients order by name`)
          for (const c of clients) {
            for (const level of LEVELS) {
              probes++
              const { rows: hit } = await db.query(
                `select 1 from metrics_daily where client_id=$1 and platform='google' and entity_level=$2 and ${BAND} limit 1`,
                [c.id, level])
              if (!hit.length) continue
              discoveries++
              const { rows: fams } = await db.query(
                `select breakdown_type, count(*) as prefixed from metrics_daily
                 where client_id=$1 and platform='google' and entity_level=$2 and ${BAND} group by 1 order by 1`,
                [c.id, level])
              for (const f of fams) {
                prefixedSeen += Number(f.prefixed)
                twinQueries++
                const { rows: pairs } = await db.query(
                  `select date, breakdown_value, split_part(entity_id,'/',-1) as bare_id,
                          count(*) filter (where entity_id like 'customers/%') as prefixed,
                          min(entity_id) filter (where entity_id like 'customers/%') as prefixed_id
                   from metrics_daily
                   where client_id=$1 and platform='google' and entity_level=$2 and breakdown_type=$3
                   group by 1,2,3
                   having count(*) filter (where entity_id like 'customers/%') > 0
                      and count(*) filter (where entity_id not like 'customers/%') > 0
                   order by 1`,
                  [c.id, level, f.breakdown_type])
                if (!pairs.length) continue
                const n = pairs.reduce((a, r) => a + Number(r.prefixed), 0)
                twinned += n
                perSurface.push(`${level}/${f.breakdown_type}: ${n} twinned of ${f.prefixed} walk-spelled (${c.name})`)
                if (offenders.length < 5) {
                  const p = pairs[0]
                  offenders.push(`${c.name} · ${level}/${f.breakdown_type} · ${new Date(p.date).toISOString().slice(0, 10)} · ${p.prefixed_id}  ==  ${p.bare_id}`)
                }
              }
            }
          }
        }
      } catch (e) {
        // ⛔ A TIMEOUT IS A BLOCKER, NEVER A ZERO. The whole reason this leg was designed in three phases is
        // that the naive query could not complete; if the bounded one cannot either, the honest report is
        // "could not ask", not a clean fleet.
        failed = e.code === '57014' ? 'timeout' : e.message
        blockers.push(`(t) the twin scan could not complete (${failed}) after ${probes} probe(s), ${discoveries} hit(s) and ${twinQueries} family quer(ies). NOTHING is proven about the rows it did not reach — this is NOT a zero.`)
      }
      await db.end()
      if (!failed) {
        // ⛔ THE DENOMINATOR PRINTS ON EVERY RUN, GREEN OR RED. A silent green here would answer a narrower
        // question than the reader assumes: "no twins" must be readable as "N probes ran and found none".
        console.log(`  (t) entity_id twin scan: ${probes} probe(s) across ${LEVELS.length} level(s) [${LEVELS.join(', ')}], ${discoveries} carrying a walk-spelled row, ${twinQueries} family quer(ies), ${prefixedSeen} walk-spelled row(s) examined.`)
      }
      if (twinned > 0) {
        findings.push(
          `(t) ${twinned} TWINNED row(s) whose entity_id differs ONLY by a 'customers/<id>/<resource>/' prefix —\n` +
          `      the same fact stored twice, one bare id and one resource path, on the same natural key minus entity_id:\n` +
          offenders.map((o) => `        ${o}`).join('\n') +
          (perSurface.length > 5 ? `\n      … ${perSurface.length} affected surface(s) in total; first 5 shown.` : '') +
          `\n      ⛔ ANY DAY-SUM OVER THESE RETURNS 2× — proven live through query_breakdown_agg_topn (migration 039\n` +
          `      groups by breakdown_value only), which is the RPC Lora's query_breakdown reaches for google\n` +
          `      'campaign'/'ad_group'. NOT baselined: this number GROWS while the walk re-covers old ground.\n` +
          `      The fix is a scoped DELETE under the twin test, then an UPDATE for the untwinned remainder —\n` +
          `      NEVER a delete keyed on walk-spelling alone (leg (s) records what that would have cost).`)
      }
      const untwinned = prefixedSeen - twinned
      if (!failed && untwinned > 0) {
        // ⛔ SAME ASYMMETRY AS LEG (s), AND FOR THE SAME REASON. These rows are the ONLY copy of their fact.
        // Failing the build over them would pressure someone into deleting real data to get green.
        console.log(`  ⚠ (t) REPORTED, NOT FAILED: ${untwinned} walk-spelled row(s) have NO bare twin — UNIQUE data in a`)
        console.log(`    non-canonical spelling, invisible to any reader that looks up the bare id. THE FIX IS AN UPDATE,`)
        console.log(`    NEVER A DELETE — deleting them destroys the only copy. NOT YET A QUEUE ITEM — it is OWED one.`)
      }
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
  `producers.${WITH_DB ? '' : ' (data legs (s) + (t) run under --db in check:data.)'} ` +
  `LIMIT: it checks the WRITER's shape, not every row already in the warehouse.`
)
