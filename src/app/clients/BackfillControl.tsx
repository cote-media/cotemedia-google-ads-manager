'use client'
// LORAMER_BACKFILL_CONTROL_V1
// Per-platform "Backfill history" control for the /clients Connections UI.
// Reads GET /api/backfill/status on mount and drives POST /api/backfill/run in
// resumable laps until complete. One lap per POST (the route runs the full
// remaining window up to its internal chunk cap, then we re-POST to resume).
// The button is disabled while a lap runs to prevent the parallel-invocation
// cursor race.

import { useEffect, useState } from 'react'

type Status = {
  earliestDate: string | null
  targetDate: string | null
  complete: boolean
  updatedAt: string | null
} | null

export default function BackfillControl({
  clientId,
  platform,
  onComplete,
}: {
  clientId: string
  platform: string
  onComplete?: () => void
}) {
  const [status, setStatus] = useState<Status>(null)
  const [loaded, setLoaded] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')

  async function loadStatus() {
    try {
      const r = await fetch('/api/backfill/status?clientId=' + clientId)
      const d = await r.json()
      if (d && d.platforms && d.platforms[platform]) {
        setStatus(d.platforms[platform])
      } else {
        setStatus(null)
      }
    } catch {
      setStatus(null)
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => {
    loadStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, platform])

  async function runBackfill() {
    if (running) return
    setRunning(true)
    setError('')
    setProgress('Starting...')
    try {
      let done = false
      let laps = 0
      let lastEarliest = ''
      while (!done && laps < 20) {
        laps += 1
        const r = await fetch('/api/backfill/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, platform }),
        })
        const d = await r.json()
        if (!r.ok || (d && d.error)) {
          setError((d && d.error) || 'Backfill failed')
          break
        }
        if (d && d.complete) {
          done = true
          break
        }
        const earliest = (d && d.earliest) || ''
        if (earliest && earliest === lastEarliest) {
          break
        }
        lastEarliest = earliest
        setProgress('Backfilling... reached ' + (earliest || '...'))
      }
      await loadStatus()
      if (done && onComplete) onComplete()
    } catch {
      setError('Backfill failed')
    } finally {
      setRunning(false)
      setProgress('')
    }
  }

  if (!loaded) return null

  const complete = !!(status && status.complete)
  const earliest = (status && status.earliestDate) || null

  return (
    <div className="mt-1 flex items-center justify-between px-3">
      <p className="text-[11px] font-sans text-muted">
        {running
          ? progress || 'Backfilling...'
          : complete
          ? 'History: complete back to ' + (earliest || 'start')
          : earliest
          ? 'History: partial, back to ' + earliest
          : 'History: not backfilled yet'}
      </p>
      {!complete && (
        <button
          onClick={runBackfill}
          disabled={running}
          className="text-[11px] font-sans text-blue-600 hover:text-blue-800 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 ml-2"
        >
          {running ? 'Working...' : earliest ? 'Resume backfill' : 'Backfill history'}
        </button>
      )}
      {error && (
        <span className="text-[11px] font-sans text-red-500 ml-2">{error}</span>
      )}
    </div>
  )
}
