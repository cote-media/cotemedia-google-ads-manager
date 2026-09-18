#!/usr/bin/env node
// LORAMER_ATTEMPT_TIMING_V1 — A REQUEST'S WALL TIME IS SPLIT INTO THE VENDOR'S SHARE AND OURS, ON THE ATTEMPT ROW.
//
// Round 3 (2026-09-18) could not say whether Google or the write path dominated a 192k-row request: the ledger held
// start/finish only. Every later number (the reservation predictor, the fire ceiling, the write-chunk question)
// needs the split. This guard proves:
//   (a) migration 098 declares stream_ms / upsert_ms / duration_ms on universe_attempt_log
//   (b) appendAttemptFinished carries streamMs / upsertMs / durationMs into stream_ms / upsert_ms / duration_ms
//   (c) BEHAVIOUR: captureSurfaceStreaming measures streamMs (time awaiting the vendor iterator) and upsertMs (time
//       awaiting the upsert) separately — a slow stream raises streamMs and not upsertMs, and vice versa
//   (d) the worker's range path writes all three on the attempt-finished row (durationMs from the range's open)
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire, Module } from 'node:module'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()
const findings = []
const check = (c, m) => { if (!c) findings.push(m) }
const read = (rel) => { try { return readFileSync(resolve(ROOT, rel), 'utf8') } catch (e) { findings.push(`UNREADABLE ${rel} — ${e.message}. A guard that cannot read its evidence FAILS.`); return '' } }
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')

const MIG = 'migrations/098_attempt_timing.sql'
const LEDGER = 'src/lib/backfill/universe-attempt-log.ts'
const CAPTURE = 'src/lib/backfill/universe-stream-capture.ts'
const ADAPTER = 'src/lib/backfill/capture-adapter.ts'
const WORKER = 'src/lib/backfill/universe-v2-worker.ts'

// (a)
{
  const mig = read(MIG)
  for (const col of ['stream_ms', 'upsert_ms', 'duration_ms']) {
    check(new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\s+integer`, 'i').test(mig), `(a) ${MIG} does not add ${col} integer to universe_attempt_log.`)
  }
}
// (b)
{
  const l = strip(read(LEDGER))
  check(/streamMs\?: number/.test(l) && /upsertMs\?: number/.test(l) && /durationMs\?: number/.test(l), `(b) ${LEDGER}: appendAttemptFinished's detail must accept streamMs / upsertMs / durationMs.`)
  check(/stream_ms: detail\.streamMs \?\? null/.test(l) && /upsert_ms: detail\.upsertMs \?\? null/.test(l) && /duration_ms: detail\.durationMs \?\? null/.test(l), `(b) ${LEDGER}: the attempt_finished insert must carry stream_ms / upsert_ms / duration_ms (null when not measured).`)
}
// (d)
{
  const w = strip(read(WORKER))
  check(/streamMs: res\.streamMs, upsertMs: res\.upsertMs, durationMs: Date\.now\(\) - rangeStartedAt/.test(w), `(d) ${WORKER}: the range path's appendAttemptFinished must write streamMs/upsertMs from the capture result and durationMs from the range's open (rangeStartedAt).`)
}

// (c) behaviour
const out = mkdtempSync(join(tmpdir(), 'attempt-timing-'))
const origResolve = Module._resolveFilename
try {
  const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
  const r = spawnSync(tsc, [resolve(ROOT, CAPTURE), resolve(ROOT, ADAPTER),
    '--target', 'es2020', '--module', 'commonjs', '--moduleResolution', 'node',
    '--skipLibCheck', '--noResolve', '--rootDir', resolve(ROOT), '--outDir', out], { encoding: 'utf8' })
  if (r.error) findings.push(`could not run tsc — ${r.error.message}`)
  const stub = join(out, '__stub.js')
  writeFileSync(stub, `module.exports = { upsertMetricsChunked: async () => ({ written: 0, chunks: 0 }) }\n`)
  Module._resolveFilename = function (request, ...rest) {
    if (request === '@/lib/backfill/capture-adapter') return join(out, 'src/lib/backfill/capture-adapter.js')
    if (request.startsWith('@/')) return stub
    return origResolve.call(this, request, ...rest)
  }
  const req = createRequire(import.meta.url)
  const cap = req(join(out, 'src/lib/backfill/universe-stream-capture.js'))
  if (typeof cap.captureSurfaceStreaming !== 'function') findings.push(`(c) ${CAPTURE} does not export captureSurfaceStreaming`)
  else {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
    const adapter = {
      platform: 'fixture', fetchShape: 'stream', retention: { floorDate: null, basis: 'fixture' },
      closure: { mayInferFromOrder: true }, dayClosure: 'ordered',
      dateOf: (row) => row.d,
      buildRows: (surface, ctx, rows) => ({ rows: rows.map((r) => ({ date: r.d })), grainDeclines: 0, seen: rows.length, droppedNoDate: 0, droppedEmptySegment: 0, droppedAllZeroMetrics: 0 }),
      serializeError: (e) => String(e),
    }
    const surface = { resource: 'campaign', segment: '', entityLevel: 'campaign', breakdownType: '' }
    const ctx = { clientId: 'c', userEmail: 'u', accountId: 'a' }
    const run = async (streamDelayMs, upsertDelayMs) => cap.captureSurfaceStreaming({
      adapter, surface, ctx, startDate: '2026-01-01', endDate: '2026-01-03',
      stream: async function* () { for (const d of ['2026-01-01', '2026-01-02', '2026-01-03']) { await sleep(streamDelayMs); yield { d } } },
      upsert: async (rows) => { await sleep(upsertDelayMs); return { written: rows.length } },
    })
    const slowStream = await run(15, 0)
    const slowUpsert = await run(0, 15)
    check(typeof slowStream.streamMs === 'number' && typeof slowStream.upsertMs === 'number', `(c) the capture result must carry streamMs and upsertMs — got ${JSON.stringify({ s: slowStream.streamMs, u: slowStream.upsertMs })}`)
    check(slowStream.streamMs >= 40 && slowStream.upsertMs < 20, `(c) a slow vendor stream (3 pulls × 15 ms) must raise streamMs (≥40) and not upsertMs (<20) — got stream ${slowStream.streamMs} / upsert ${slowStream.upsertMs}`)
    check(slowUpsert.upsertMs >= 40 && slowUpsert.streamMs < 20, `(c) a slow upsert (3 days × 15 ms) must raise upsertMs (≥40) and not streamMs (<20) — got stream ${slowUpsert.streamMs} / upsert ${slowUpsert.upsertMs}`)
    check(slowStream.rowsWritten === 3 && slowStream.daysCommitted.length === 3 && slowUpsert.daysCommitted.length === 3, `(c) the timing must not change what is written: 3 rows / 3 days expected — got ${slowStream.rowsWritten}/${slowStream.daysCommitted.length} and ${slowUpsert.rowsWritten}/${slowUpsert.daysCommitted.length}`)
  }
} catch (e) {
  findings.push(`(c) could not drive captureSurfaceStreaming — ${e.message}. A guard that cannot run its subject FAILS rather than passing.`)
} finally {
  Module._resolveFilename = origResolve
  rmSync(out, { recursive: true, force: true })
}

if (findings.length) {
  console.error(`[attempt-timing] FAIL — ${findings.length} finding(s):`)
  for (const f of findings) console.error('  • ' + f)
  process.exit(1)
}
console.log('[attempt-timing] PASS — stream_ms / upsert_ms / duration_ms are declared (098), carried by appendAttemptFinished, measured separately by captureSurfaceStreaming (a slow stream moves only streamMs, a slow upsert only upsertMs), and written by the worker\'s range path.')
