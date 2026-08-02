// LORAMER_CHAT_STATUS_SUBJECT_V1 — what a status line is allowed to say, as a PURE function.
//
// THE PROBLEM BEING SOLVED IS SILENCE, NOT SLOWNESS. ★CHAT-STREAMING was escalated to
// demo-critical because Opus 5 median ~19s plus verbosity reads as a dead room, and
// LORAMER_LATENCY_IS_DILIGENCE_V1 already settled that the answer taking ten seconds is a
// FEATURE and the bug is the unexplained wait. Progressive text is one answer to that; a status
// line naming the real work is the one chosen (2026-07-28). The answer still arrives WHOLE.
//
// ⛔ THIS EMITS A SUBJECT, NOT THE TOOL ARGUMENTS. `tu.input` is in scope at the emit site and
// putting it on the wire would ship arbitrary model-authored payload to the browser — filter
// keys, geo scopes, entity levels, and whatever a future tool adds. A status line needs three
// things and gets exactly those three: who, which platform, which window.
//
// ⛔ AND IT NEVER CARRIES AN ID. The client field is a HUMAN NAME resolved server-side or it is
// ABSENT. Never a UUID, never the string "unknown" — an unresolved client means the line reads
// "Reading Google · last 30 days" and simply omits the who. A UUID on screen is worse than no
// name, and "unknown" is a claim we cannot support (ESSENCE: never say what we cannot show).
// tests/guards/chat-status-line.guard.mjs asserts the no-UUID property on the emitted shape.

export interface ToolSubject {
  /** Tool name, already humanised — the one thing that was on the wire before this. */
  tool: string
  /** RESOLVED human client name. Absent if it could not be resolved. NEVER an id. */
  client?: string
  /** 'google' | 'meta' | 'shopify' | … — already the human word in every tool schema. */
  platform?: string
  /** Human window: 'last 30 days', 'Nov–Dec 2024'. Absent if the args named none. */
  window?: string
  /** query_breakdown only — the family being read, e.g. 'geo_city'. */
  breakdown?: string
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 'LAST_30_DAYS' -> 'last 30 days'. Presets are already readable; this only lowers and unsnakes them. */
function humanPreset(v: string): string {
  return v.trim().toLowerCase().replace(/_/g, ' ')
}

/**
 * '2024-11-01'..'2024-12-31' -> 'Nov–Dec 2024'; same month -> 'Nov 2024'; across years ->
 * 'Nov 2024 – Feb 2025'. Returns null on anything unparseable rather than guessing — a wrong
 * window in a status line is a small lie told confidently, which is the class this repo keeps
 * paying for.
 */
export function humanWindow(startDate?: unknown, endDate?: unknown): string | null {
  if (typeof startDate !== 'string' || typeof endDate !== 'string') return null
  const s = /^(\d{4})-(\d{2})-\d{2}$/.exec(startDate.trim())
  const e = /^(\d{4})-(\d{2})-\d{2}$/.exec(endDate.trim())
  if (!s || !e) return null
  const [sy, sm] = [Number(s[1]), Number(s[2])]
  const [ey, em] = [Number(e[1]), Number(e[2])]
  if (sm < 1 || sm > 12 || em < 1 || em > 12) return null
  if (sy === ey && sm === em) return `${MONTHS[sm - 1]} ${sy}`
  if (sy === ey) return `${MONTHS[sm - 1]}–${MONTHS[em - 1]} ${sy}`
  return `${MONTHS[sm - 1]} ${sy} – ${MONTHS[em - 1]} ${ey}`
}

/**
 * Build the status subject for ONE tool_use block.
 *
 * @param toolName   tu.name
 * @param input      tu.input — READ, never forwarded
 * @param boundClientId  the route's bound client. ⛔ At single-client scope the model OMITS
 *   clientId (every schema says it is IGNORED there), so the bound id is the ONLY source of
 *   who — this mirrors the executor's own precedence at claude-tools.ts:315.
 * @param resolveName  id -> human name. Returns undefined when unknown; we then omit `client`.
 */
export function toolSubject(
  toolName: string,
  input: any,
  boundClientId: string | null | undefined,
  resolveName: (id: string) => string | undefined,
): ToolSubject {
  const subject: ToolSubject = { tool: String(toolName || '').replace(/_/g, ' ') }

  // WHO — bound scope wins, exactly as the RBAC executor resolves the target. A model-supplied
  // id is only consulted at agency scope, where there is no bound client.
  const named = typeof input?.clientId === 'string' ? input.clientId.trim() : ''
  const targetId = (boundClientId || '').trim() || named
  if (targetId) {
    const name = resolveName(targetId)
    // ⛔ THE NO-ID RULE, ENFORCED HERE RATHER THAN TRUSTED: even a resolver that hands back the
    // id (a lookup miss returning its input, a future caller wiring it wrong) must not put one
    // on the wire. If what came back looks like a UUID, treat it as unresolved.
    if (name && name.trim() && !UUID_RE.test(name.trim())) subject.client = name.trim()
  }

  // WHICH PLATFORM — already the human word in all three schemas ('google', 'shopify', …).
  if (typeof input?.platform === 'string' && input.platform.trim()) subject.platform = input.platform.trim()

  // WHICH WINDOW — explicit dates beat a preset, because the model only sends dates when it
  // means a specific span and that is the more informative thing to show.
  const explicit = humanWindow(input?.startDate, input?.endDate)
  if (explicit) subject.window = explicit
  else if (typeof input?.baseRange === 'string' && input.baseRange.trim()) subject.window = humanPreset(input.baseRange)
  else if (Array.isArray(input?.windows) && input.windows.length) {
    // query_metrics' explicit-windows mode. Prefer the label the model already wrote; else derive.
    const w0: any = input.windows[0]
    const label = typeof w0?.label === 'string' && w0.label.trim() ? w0.label.trim() : null
    const derived = humanWindow(w0?.startDate, w0?.endDate)
    const one = label || derived
    if (one) subject.window = input.windows.length > 1 ? `${one} +${input.windows.length - 1} more` : one
  }

  // query_breakdown only — which family. Left snake_case: 'geo_city' is the term the product uses.
  if (typeof input?.breakdownType === 'string' && input.breakdownType.trim()) subject.breakdown = input.breakdownType.trim()

  return subject
}

/**
 * Render the one line the user reads: 'Reading Foam OH · Google · Nov–Dec 2024'.
 * Segments are dropped when absent, so an unresolved client degrades to 'Reading Google · …'
 * rather than to a placeholder. Exported so the guard renders the same string the UI does.
 */
export function renderSubjectLine(s: ToolSubject): string {
  const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1)
  const parts = [s.client, s.platform ? cap(s.platform) : undefined, s.breakdown, s.window].filter(Boolean)
  return parts.length ? `Reading ${parts.join(' · ')}` : `Reading ${s.tool}`
}
