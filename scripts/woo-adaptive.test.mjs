// LORAMER_WOO_BACKFILL_SAFE_V1 — PURE unit proof of the adaptive de-escalation (no DB, no network).
// Run: npx tsx scripts/woo-adaptive.test.mjs   (imports the TS source directly)
// Proves: (i) 21→7→1 de-escalation on a window error; per-day-floor failure → ok:false + failedDay;
// contiguous partial capture of the newest good days; a fully-good window = ONE fetch, no de-escalation.
import { adaptiveFetchWindow } from '../src/lib/backfill/woo-adaptive.ts'

function dayspan(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000) + 1
}
function eachDay(a, b) {
  const out = []
  let d = a
  while (d <= b) { out.push(d); const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + 1); d = t.toISOString().slice(0, 10) }
  return out
}

// Mock "store": 1 order/day, EXCEPT the bad day has 1000. A fetch THROWS if the window's total > 500
// (simulates a host memory-fatal on a heavy window) — so any window containing the bad day fails,
// AND the bad day itself fails even at per-day. Records the size of every window tried.
function makeStore(badDay) {
  const sizesTried = []
  let calls = 0
  const fetchOrders = async (start, end) => {
    calls++
    sizesTried.push(dayspan(start, end))
    let total = 0
    const orders = []
    for (const d of eachDay(start, end)) {
      const n = d === badDay ? 1000 : 1
      total += n
      for (let i = 0; i < n; i++) orders.push({ date_created: d + 'T12:00:00', status: 'completed' })
    }
    if (total > 500) throw new Error('mock memory fatal (' + total + ' orders in ' + start + '..' + end + ')')
    return orders
  }
  return { fetchOrders, sizesTried: () => sizesTried, calls: () => calls }
}

let failures = 0
function assert(name, cond, detail) {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? '  [' + detail + ']' : ''))
  if (!cond) failures++
}

const main = async () => {
  // CASE 1: 21-day window containing a bad day → de-escalates 21→7→1, fails at the bad day, captures
  // the contiguous newest good days above it.
  const badDay = '2018-12-05'
  const s1 = makeStore(badDay)
  const r1 = await adaptiveFetchWindow(s1.fetchOrders, '2018-11-22', '2018-12-12')
  const sizes = s1.sizesTried()
  assert('(i) de-escalates 21→7→1', sizes.includes(21) && sizes.includes(7) && sizes.includes(1), 'sizes=' + JSON.stringify([...new Set(sizes)]))
  assert('(ii) per-day-floor failure → ok:false', r1.ok === false, 'ok=' + r1.ok)
  assert('(ii) reports the failed day', r1.failedDay === badDay, 'failedDay=' + r1.failedDay)
  // newest good days above the bad day = 2018-12-06..2018-12-12 = 7 days × 1 order
  assert('partial contiguous capture of newest good days', r1.orders.length === 7, 'captured=' + r1.orders.length)
  assert('fail-fast (does NOT fetch every day)', s1.calls() <= 6, 'calls=' + s1.calls())

  // CASE 2: a fully-good 21-day window → ONE fetch at size 21, ok:true, no de-escalation.
  const s2 = makeStore('1900-01-01') // bad day not in range
  const r2 = await adaptiveFetchWindow(s2.fetchOrders, '2019-01-01', '2019-01-21')
  assert('all-good window = ok:true', r2.ok === true, 'ok=' + r2.ok)
  assert('all-good window = ONE fetch, no de-escalation', s2.calls() === 1 && s2.sizesTried()[0] === 21, 'calls=' + s2.calls() + ' sizes=' + JSON.stringify(s2.sizesTried()))
  assert('all-good window captures all 21 days', r2.orders.length === 21, 'captured=' + r2.orders.length)

  // CASE 3: a single BAD day as a 1-day window → immediate ok:false (floor), no capture.
  const s3 = makeStore('2018-12-05')
  const r3 = await adaptiveFetchWindow(s3.fetchOrders, '2018-12-05', '2018-12-05')
  assert('per-day bad window → ok:false + failedDay', r3.ok === false && r3.failedDay === '2018-12-05', 'ok=' + r3.ok + ' failedDay=' + r3.failedDay)

  console.log('\n' + (failures === 0 ? 'ALL PURE ASSERTIONS PASS' : failures + ' ASSERTION(S) FAILED'))
  process.exit(failures === 0 ? 0 : 1)
}
main()
