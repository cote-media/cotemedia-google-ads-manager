#!/usr/bin/env node
// LORAMER_POLL_MODE_CUTOVER_V1 — A TOPIC HAS EXACTLY ONE DELIVERY LANE. NOT TWO. NOT ZERO.
//
// ⛔ WHY TWO IS A DEFECT, AND IT IS ARITHMETIC RATHER THAN TIDINESS. Vercel Queues fans a topic out to every
// consumer group, and "multiple route files with the same topic create separate consumer groups, each
// receiving a copy of every message". A push trigger and a poll receive on one topic are two groups, so both
// lanes get every message — and they get it AT THE SAME INSTANT. Walk the write path and the cost is exact:
// both read coverage (`rangesStillOwed`) BEFORE either commits a day, so both see the identical owed set,
// both charge `requests_spent`, and both call the vendor. Coverage-before-fetch makes a SEQUENTIAL second
// pass nearly free and does NOTHING about a concurrent one. The vendor ops double, and the op meter — which
// sums `requests_spent` — doubles with them, so the number that gates future publishing is wrong in the
// direction that looks safe. There is no lock between the lanes: the advisory lock inside
// `universe_attempt_open` serialises `attempt_no` derivation only, and it is released before the vendor call.
//
// ⛔ WHY ZERO IS THE SAME DEFECT WEARING THE OPPOSITE COSTUME. ★V2-CONSUMER-HAS-NO-TRIGGER-REGISTRATION is
// the failure of publishing into a topic nothing reads: the producer returns 200 forever, `publishedOf`
// counts up forever, and nothing is consumed. A cutover that removes the push trigger and forgets the poll
// cron produces exactly that, and every producer-side instrument would keep reading green through it.
//
// THE TWO LEGS:
//   (a) each known topic is claimed by EXACTLY ONE lane — a `queue/v2beta` trigger in vercel.json, or a poll
//       cron whose route calls `receive(TOPIC, …)`. Two claims is red. Zero claims is red.
//   (b) a poll lane that is not on a cron schedule does not count as a lane — an unscheduled poller is a
//       route nobody calls, which is the zero case with extra steps.
//
// ⚠ WHAT THIS CANNOT REACH, STATED SO ITS GREEN IS NOT OVER-READ: it proves the CONFIGURATION, never the
// DEPLOYED STATE. A deployment still serving an older binary can have a lane this file cannot see, which is
// precisely how the walk kept running an old consumer after a deploy. The runtime half — two
// `attempt_started` rows sharing a `message_key` with different `invocation_id` — belongs in check:data and
// is NOT built by this guard.
//
// USAGE: node tests/guards/one-delivery-lane-per-topic.guard.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const VERCEL = 'vercel.json'
const findings = []

// The topics this repo delivers. A topic absent from here is not policed, which is stated rather than
// implied — adding a topic is a decision, and so is leaving one out.
const TOPICS = ['google-ads-universe', 'google-ads-universe-v2']

const read = (rel) => {
  try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch { return null }
}

const walk = (dir, out = []) => {
  let entries = []
  try { entries = readdirSync(resolve(ROOT, dir)) } catch { return out }
  for (const e of entries) {
    const rel = join(dir, e)
    let st
    try { st = statSync(resolve(ROOT, rel)) } catch { continue }
    if (st.isDirectory()) walk(rel, out)
    else if (/\.tsx?$/.test(e)) out.push(rel)
  }
  return out
}

const raw = read(VERCEL)
if (!raw) {
  console.error('[one-delivery-lane-per-topic] CANNOT RUN — vercel.json unreadable. A guard that cannot read its subject FAILS rather than passing.')
  process.exitCode = 2
  process.exit()
}
let parsed = null
try { parsed = JSON.parse(raw) } catch (e) {
  console.error(`[one-delivery-lane-per-topic] CANNOT RUN — vercel.json is not valid JSON (${e.message}).`)
  process.exitCode = 2
  process.exit()
}

const crons = (parsed.crons || []).map((c) => String(c.path || ''))
const files = walk('src')

// ⛔ COMMENTS DO NOT DELIVER. Stripping them removes FALSE positives only — the same standing rule
// universe-stream-consumer applies, for the same reason: a doc comment naming a topic is not a lane.
const nocomment = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

for (const topic of TOPICS) {
  const pushLanes = []
  for (const [file, cfg] of Object.entries(parsed.functions || {})) {
    for (const t of (cfg.experimentalTriggers || [])) {
      if (String(t.type || '') === 'queue/v2beta' && String(t.topic || '') === topic) pushLanes.push(file)
    }
  }

  const pollLanes = []
  for (const f of files) {
    if (!/^src\/app\/api\//.test(f)) continue
    const src = nocomment(read(f) || '')
    if (!/\breceive\s*\(/.test(src)) continue
    // The lane must reach THIS topic — either by the literal or via the contract constant it imports.
    const byLiteral = src.includes(`'${topic}'`) || src.includes(`"${topic}"`)
    const byContract = /universe-v2-contract/.test(src) && /\breceive\s*\(\s*TOPIC\b/.test(src) && topic.endsWith('-v2')
    if (!byLiteral && !byContract) continue
    // (b) an unscheduled poller is not a lane.
    const route = f.replace(/^src\/app/, '').replace(/\/route\.tsx?$/, '')
    const scheduled = crons.some((p) => p.split('?')[0] === route)
    if (!scheduled) {
      findings.push(`(b) ${f} polls topic '${topic}' but has NO cron entry in vercel.json. An unscheduled poller is a route nobody calls — the zero-lane case with extra steps.`)
      continue
    }
    pollLanes.push(f)
  }

  const total = pushLanes.length + pollLanes.length
  if (total > 1) {
    findings.push(`(a) topic '${topic}' has ${total} delivery lanes — push: [${pushLanes.join(', ') || 'none'}] · poll: [${pollLanes.join(', ') || 'none'}]. Two lanes are two consumer groups, each receiving a COPY of every message and processing it CONCURRENTLY: both read coverage before either commits, so the vendor ops DOUBLE and the op meter doubles with them.`)
  } else if (total === 0) {
    findings.push(`(a) topic '${topic}' has NO delivery lane — no queue/v2beta trigger and no scheduled poller. The producer will publish into a topic nothing reads and every producer-side instrument will read green through it (★V2-CONSUMER-HAS-NO-TRIGGER-REGISTRATION).`)
  }
}

if (findings.length) {
  console.error(`[one-delivery-lane-per-topic] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error(`  - ${f}`)
  console.error('  ⇒ SPEC: DECISIONS LORAMER_POLL_MODE_CUTOVER_V1. Exactly one lane per topic: two double the vendor spend, zero delivers nothing while reading green.')
  process.exitCode = 1
} else {
  console.log(`[one-delivery-lane-per-topic] PASS — ${TOPICS.length} topic(s) checked, each claimed by exactly one delivery lane. ⛔ LIMIT: this proves the CONFIGURATION, never the deployed state; a deployment still serving an older binary can carry a lane this file cannot see.`)
}
