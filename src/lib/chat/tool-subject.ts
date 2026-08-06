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


// ⛔ LORAMER_CHAT_STATUS_AGGREGATE_V1 (S2) — CONCURRENT SUBJECTS BECOME ONE TRUTHFUL LINE.
//
// THE DEFECT, MEASURED BY THE FRAME PROBE 2026-08-06: Lora issues tool calls in PARALLEL and the frames
// land 0-2ms apart (seq 11→12 was ONE millisecond). The status line was a single slot, so every subject
// except the last of each burst was on screen for about a millisecond. Russ saw 3 subjects on a turn
// that emitted at least 5 — not a rendering failure and not a missing frame, but a queue collapsing.
//
// ⛔ THE COUNT MUST BE THE REAL COUNT. If five sources are being read it says five. No rounding, no
// "several", no cap that quietly hides work — the whole point of this line is that it reports what is
// actually happening, and a number that is nearly right is the same class of lie as a fake progress bar.
//
// ⚠ COPY IS RUSS'S AND THESE STRINGS ARE PROVISIONAL. The MECHANISM is what ships here; the wording is
// listed for him to approve or rewrite. Anything he changes changes only this function.
export function aggregateSubjects(active: Map<string, string>): string | null {
  const subjects = [...active.values()].filter((s) => typeof s === 'string' && s.trim())
  if (subjects.length === 0) return null
  if (subjects.length === 1) return fitStatusLine(subjects[0], 0)

  // Two or more at once. Lead with the first REAL subject so the line still names something concrete,
  // and count the rest exactly. `Reading X · Y · Z  + 2 more sources` beats a bare "Reading 3 sources"
  // because the specific one is the part that reads as diligence.
  const [first, ...rest] = subjects
  return fitStatusLine(first, rest.length)
}

// ⛔ A SUBJECT MAY NOT BE REPLACED FASTER THAN A PERSON CAN READ IT. 2026-08-06 measured replacements at
// 1ms. This is the floor a caller must respect; it is exported so the guard can assert the value rather
// than infer it from behaviour.
// 1200ms is chosen as ~the time to read a short line, and deliberately NOT longer: a line that lingers
// after its work has finished is its own small lie.
export const MIN_SUBJECT_MS = 1200


// ⛔ LORAMER_CHAT_STATUS_FITS_THE_PHONE_V1 — THE LINE MUST FIT, AND WHAT SURVIVES IS NOT NEGOTIABLE.
//
// OBSERVED ON DEVICE 2026-08-06: "Reading Foam OH · All · 2026 YTD (Jan 1 - Aug 5) +1 more + 1 ..." ran
// off the right edge and was cut mid-word.
//
// ⛔ AND CSS `text-overflow: ellipsis` IS THE WRONG TOOL HERE, WHICH IS WHY THIS FUNCTION EXISTS RATHER
// THAN A STYLE TWEAK: it always cuts the TAIL, and the tail is where the COUNT lives. The browser was
// faithfully deleting the single most important token on the line. Truncation has to be PRIORITY-AWARE,
// and priority is a product decision, not a rendering side effect.
//
// THE PRIORITY, highest first:
//   1. "Reading <client>"        — the client is never dropped. A status naming no one is not a status.
//   2. "+ N more sources"        — the count is never dropped and never rounded. Hiding concurrent work
//                                  is the same class of untruth as a fake progress bar.
//   3. platform, breakdown, range — the middle. Shortened from the RIGHT, because the range is the most
//                                  reconstructible part: a reader who sees the platform can live without
//                                  the exact window, but not the reverse.
//
// ⚠ THE BUDGET IS CHARACTERS, NOT PIXELS, AND THAT IS A STATED APPROXIMATION. Measuring text properly
// needs a layout, and this repo has no render measurement ([[★CHAT-RENDER-MEASUREMENT-MISSING]]) — so a
// conservative character budget is the honest instrument available. 46 is derived, not guessed: a 390px
// screen less 32px of list padding and 13px of mark indent leaves ~345px; at 13px in the app's sans the
// average glyph is ~6.5px wide, giving ~53 characters, and 46 keeps a margin for wide-glyph strings.
// The CSS ellipsis STAYS as a belt-and-braces backstop for anything this misjudges.
export const MAX_STATUS_CHARS = 46

export function fitStatusLine(subject: string, extraCount: number): string {
  const suffix = extraCount > 0 ? `  + ${extraCount} more source${extraCount === 1 ? '' : 's'}` : ''
  const m = /^Reading (.*)$/.exec(subject)
  if (!m) {
    // Not a subject we composed (a bare tool name). Keep the count; trim the rest if it must give.
    const room = MAX_STATUS_CHARS - suffix.length
    return (subject.length > room ? subject.slice(0, Math.max(1, room - 1)) + '\u2026' : subject) + suffix
  }
  const parts = m[1].split(' \u00b7 ')
  const client = parts[0]
  const middle = parts.slice(1)
  const compose = () => `Reading ${[client, ...middle].join(' \u00b7 ')}`

  // Drop the middle from the RIGHT until it fits. The count is already reserved in `suffix`.
  while (middle.length && compose().length + suffix.length > MAX_STATUS_CHARS) middle.pop()

  let line = compose()
  if (line.length + suffix.length > MAX_STATUS_CHARS) {
    // Even the client alone overruns. ELIDE ITS CHARACTERS — never remove it. A truncated client name
    // still tells the reader who is being read about; an absent one tells them nothing.
    const room = Math.max(4, MAX_STATUS_CHARS - suffix.length - 'Reading '.length)
    line = `Reading ${client.length > room ? client.slice(0, room - 1) + '\u2026' : client}`
  }
  return line + suffix
}
