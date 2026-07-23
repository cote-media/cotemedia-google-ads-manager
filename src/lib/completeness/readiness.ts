// LORAMER_COMPLETENESS_GATE_V1 F(b) — READINESS COMPOSER (pure, no I/O).
// Combines the data-capture verdict (reconcile() — REUSED, not rebuilt) with the brain/context signals from
// get_client_readiness_signals into ONE per-client "Lora readiness" result: a 0–100 %, a red→amber→green badge,
// the required-vs-soft breakdown, an ORDERED plain-English to-green task list (user-actionable vs auto-resolving),
// and a per-platform completeness row for the Connections UI. Pure: same inputs → same output; no DB, no clock.

import type { ClientResult, StepResult } from './reconcile'
import { blocksGreen, isDegraded, degradedTask, type Health } from '@/lib/connection-health-view' // LORAMER_CONN_DEGRADED_STATE_V1

export type Brain = {
  value_model?: unknown
  business_descriptor?: string | null
  service_area?: string | null
  website?: string | null
  naics_codes?: unknown
}
export type ConnSig = { platform: string; health: string | null }
export type Counts = { count?: number; words?: number; directive?: number; fact?: number }

export type Task = { label: string; kind: 'user' | 'auto'; blocksGreen: boolean }
export type PlatformCompleteness = { platform: string; status: 'complete' | 'importing' | 'issue'; note: string }
export type ReadinessResult = {
  pct: number
  badge: 'green' | 'amber' | 'red'
  required: {
    connectionsHealthy: boolean
    dataCaptureClean: boolean
    valueModelSet: boolean
    profileComplete: boolean
    profileFilled: number       // 0..3
    captureCompleteFraction: number
    redCount: number
    drainingCount: number
  }
  soft: { docs: boolean; memory: boolean; naics: boolean; docsCount: number; memoryCount: number; naicsCount: number }
  tasks: Task[]
  perPlatform: PlatformCompleteness[]
}

const PRETTY: Record<string, string> = { google: 'Google Ads', meta: 'Meta', shopify: 'Shopify', woocommerce: 'WooCommerce', ga: 'Google Analytics' }
const pretty = (p: string) => PRETTY[p] || p
const filled = (s?: string | null) => !!(s && String(s).trim())
const arrLen = (v: unknown) => (Array.isArray(v) ? v.length : 0)

// Weights sum to 1.00. Required gates carry most of the bar; capture DEPTH (draining docks it) + soft add the rest.
const W = { conn: 0.15, clean: 0.15, depth: 0.20, vm: 0.15, profile: 0.15, docs: 0.08, memory: 0.06, naics: 0.06 }

export function computeReadiness(input: {
  clientResult: ClientResult
  connections: ConnSig[]
  brain: Brain
  docs: Counts
  memory: Counts
}): ReadinessResult {
  const { clientResult, connections, brain, docs, memory } = input
  const steps: StepResult[] = clientResult.platforms.flatMap((p) => p.steps)

  const redCount = steps.filter((s) => s.status === 'RED_OUR_DEFECT' || s.status === 'UNKNOWN_BLOCK').length
  const drainingCount = steps.filter((s) => s.status === 'DRAINING').length
  // LORAMER_RECONCILE_ZERO_DELIVERY_V1 — GREEN_WITH_CAVEAT (zero-delivery honest-empty) counts as captured/green: it
  // is NOT a defect and NOT draining, so it must not dock the depth score or block green.
  const greenish = steps.filter((s) => s.status === 'GREEN' || s.status === 'GREEN_TO_RECORDED_FLOOR' || s.status === 'GREEN_WITH_CAVEAT').length
  const captureCompleteFraction = steps.length ? greenish / steps.length : 0

  const connectionsPresent = connections.length >= 1
  // LORAMER_CONN_DEGRADED_STATE_V1 — blocksGreen() covers reconnect + disconnected + degraded (a persistently-
  // failing but logged-in connection is NOT green: its data is stale).
  const connectionsHealthy = connectionsPresent && connections.every((c) => !blocksGreen(c.health as Health))
  const dataCaptureClean = redCount === 0

  const valueModelSet = arrLen(brain.value_model) >= 1
  const profileFilled = [brain.website, brain.business_descriptor, brain.service_area].filter(filled).length
  const profileComplete = profileFilled === 3

  const docsCount = docs.count || 0
  const memoryCount = (memory.directive || 0) + (memory.fact || 0)
  const naicsCount = arrLen(brain.naics_codes)
  const soft = { docs: docsCount >= 1, memory: memoryCount >= 1, naics: naicsCount >= 1, docsCount, memoryCount, naicsCount }

  const score =
    W.conn * (connectionsHealthy ? 1 : 0) +
    W.clean * (dataCaptureClean ? 1 : 0) +
    W.depth * captureCompleteFraction +
    W.vm * (valueModelSet ? 1 : 0) +
    W.profile * (profileFilled / 3) +
    W.docs * (soft.docs ? 1 : 0) +
    W.memory * (soft.memory ? 1 : 0) +
    W.naics * (soft.naics ? 1 : 0)
  const pct = Math.round(score * 100)

  const greenAll = connectionsHealthy && dataCaptureClean && valueModelSet && profileComplete
  const badge: ReadinessResult['badge'] = greenAll ? 'green' : pct >= 50 ? 'amber' : 'red'

  // ── to-green tasks: user-actionable required → soft-user → auto (system/importing) ──────────────────────
  const tasks: Task[] = []
  if (!connectionsPresent) tasks.push({ label: 'Connect an ad or store platform so Lora has data', kind: 'user', blocksGreen: true })
  else for (const c of connections) {
    if (c.health === 'reconnect' || c.health === 'disconnected') tasks.push({ label: `Reconnect ${pretty(c.platform)} — its login needs refreshing`, kind: 'user', blocksGreen: true })
    else if (isDegraded(c.health as Health)) tasks.push({ label: degradedTask(pretty(c.platform)), kind: 'user', blocksGreen: true }) // LORAMER_CONN_DEGRADED_STATE_V1 — failing >24h, NOT a re-auth
  }
  if (!valueModelSet) tasks.push({ label: 'Set the value model — tell Lora where your conversions and ROAS come from', kind: 'user', blocksGreen: true })
  if (!filled(brain.website)) tasks.push({ label: 'Add your website', kind: 'user', blocksGreen: true })
  if (!filled(brain.business_descriptor)) tasks.push({ label: 'Add a short business description so Lora knows what you do', kind: 'user', blocksGreen: true })
  if (!filled(brain.service_area)) tasks.push({ label: 'Add your service area', kind: 'user', blocksGreen: true })
  if (!soft.docs) tasks.push({ label: 'Upload a brand or strategy doc so Lora learns your business', kind: 'user', blocksGreen: false })
  if (!soft.memory) tasks.push({ label: 'Add a rule or fact to guide how Lora reads your account', kind: 'user', blocksGreen: false })
  if (!soft.naics) tasks.push({ label: 'Set your industry (NAICS) so Lora uses the right context', kind: 'user', blocksGreen: false })

  const perPlatform: PlatformCompleteness[] = []
  for (const p of clientResult.platforms) {
    const red = p.steps.some((s) => s.status === 'RED_OUR_DEFECT' || s.status === 'UNKNOWN_BLOCK')
    const draining = p.steps.some((s) => s.status === 'DRAINING')
    // LORAMER_RECONCILE_ZERO_DELIVERY_V1 — a connected ad account that simply never delivered in-window: empty
    // breakdowns are honest (GREEN_WITH_CAVEAT), NOT a defect. `red` still wins (empty-DESPITE-delivery stays alarming),
    // so this only fires when the platform's only not-green cells are zero-delivery caveats → neutral, no scary line.
    const zeroDelivery = p.steps.some((s) => s.status === 'GREEN_WITH_CAVEAT')
    if (red) { perPlatform.push({ platform: p.platform, status: 'issue', note: `${pretty(p.platform)} data capture needs a fix` }); tasks.push({ label: `${pretty(p.platform)} data capture needs a fix — we're on it`, kind: 'auto', blocksGreen: true }) }
    else if (draining) { perPlatform.push({ platform: p.platform, status: 'importing', note: `${pretty(p.platform)} is still importing history` }); tasks.push({ label: `${pretty(p.platform)} is still importing history — no action needed`, kind: 'auto', blocksGreen: false }) }
    else if (zeroDelivery) { perPlatform.push({ platform: p.platform, status: 'complete', note: `No ${pretty(p.platform)} delivery in range — capture is up to date` }) }
    else { const floor = p.steps[0]?.floor || 'platform floor'; perPlatform.push({ platform: p.platform, status: 'complete', note: `Captured to floor (${floor})` }) }
  }

  return {
    pct, badge,
    required: { connectionsHealthy, dataCaptureClean, valueModelSet, profileComplete, profileFilled, captureCompleteFraction, redCount, drainingCount },
    soft, tasks, perPlatform,
  }
}
