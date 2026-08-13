import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'
import { logSpend } from '@/lib/spend-logger' // LORAMER_SPEND_LOG_V1
import { buildClaudeContext, buildClaudeContextCacheable, buildAgencyScopeContext } from '@/lib/intelligence/build-claude-context'  // LORAMER_PROMPT_CACHING_PHASE_2_ENABLE_V1 + LORAMER_AGENCY_SCOPE_LORA_V1
import { runWithModelChain, AllModelsOverloadedError, provenanceNote } from '@/lib/lora-model-chain' // LORAMER_LORA_MODEL_CHAIN_V1
import type { ClientIntelligence } from '@/lib/intelligence/intelligence-types'
import { runClaudeToolLoop, runClaudeToolLoopStreaming } from '@/lib/claude-tools'  // LORAMER_QUERY_METRICS_SHARED_LOOP_V1
import { resolveAccess, listAccessibleClientsWithNames } from '@/lib/access/can-access'  // LORAMER_RBAC_ACCESS_ORG_V1 + LORAMER_AGENCY_SCOPE_LORA_V1 (RBAC-scoped roster)
import { parsePersistTarget, parseUserTurnFlag, makeAssistantTurnWriter } from '@/lib/chat/persist-assistant-turn' // LORAMER_CHAT_SERVER_TURN_WRITE_V1 + LORAMER_CHAT_TURN_PAIR_WRITE_V1

// LORAMER_CHAT_MAXDURATION_V1 — make the function ceiling EXPLICIT instead of inheriting the (invisible, dashboard-
// settable) project default. A real turn on 2026-07-24 ran ~59s server-side (multi-tool Opus loop) and returned 200,
// but the browser had already given up → the user saw a failure for an answer that existed. 300s is the Vercel Pro
// DEFAULT with fluid compute (verified 2026-07-24: Pro default 300s, max 800s, extended 1800s beta) — ~5× the
// observed worst case, so the SERVER is never the limiter within any realistic turn; the deliberate cap the user
// feels is the SHORTER client-side AbortController in ChatLauncher. This is a STOPGAP — the durable fix is streaming
// (QUEUE ★CHAT-STREAMING); a 59s answer that renders progressively is alive, a 59s spinner is dead.
// ⛔ RAISED 300 → 500 ON 2026-08-05 (LORAMER_CHAT_DEADLINE_GAP_CLOSED_V1). The client ceiling moves to
// 440s in the same commit and MUST stay strictly below this — chat-deadline-margin.guard.mjs enforces
// the pair, because the two numbers only mean anything relative to each other.
// ⛔ 500 IS ALLOWED HERE AND IT IS NOT AN ASSUMPTION ABOUT THE PLAN TIER: this project already runs
// maxDuration 800 on cron/sync and cron/order-grain and 1800 on cron/drain, and the drain has been
// OBSERVED running its full window in production (LORAMER_DRAIN_EXTENDED_DURATION_V1). 500 sits well
// under values already deployed and proven, so the ceiling is our judgement, not the platform's.
// ⚠ The comment above still describes the ORIGINAL 300 and its reasoning; it is kept because the
// "server is never the limiter" intent is unchanged — only the number moved.
export const maxDuration = 500

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// LORAMER_LORA_CHAT_MODEL_ENV_V1 + LORAMER_LORA_MODEL_FLOOR_DEFAULT_V1 — the chat model is env-selectable, but the
// CODE DEFAULT IS THE FLOOR. It was 'claude-sonnet-4-6' with a comment ordering future sessions to keep it that way;
// that comment was written for the Sonnet-vs-Opus A/B, which was KILLED 2026-07-14 (ship model = eval model =
// claude-opus-4-8, and the Opus floor is LAW). The stale default cost us: no LORA_CHAT_MODEL env var existed in
// Vercel, so PRODUCTION Lora answered on Sonnet while the 28/28 accuracy gate was measured on a local Opus process —
// the gate did not describe production (2026-07-15 master audit, G10; closed by setting the prod env var).
// An env var is not a law: if the var is ever deleted, this default is what ships. It must BE the floor.
// LORAMER_LORA_OPUS5_MIGRATION_V1 (2026-07-24) — floor raised to claude-opus-5 on Russ's go. Opus 5 re-baselined
// 28/28 corrected (vs 4.8's 27/28 on the same set — it fixed D2, the false-zero Meta-dedup drop) with ZERO
// regressions and IDENTICAL input-token cost (same tokenizer as 4.8; only output is ~2x more verbose). The Vercel
// env var LORA_CHAT_MODEL is flipped to opus-5 the same day; this default must track it (env var is not a law).
const LORA_CHAT_MODEL = process.env.LORA_CHAT_MODEL || 'claude-opus-5'

// LORAMER_LORA_MODEL_CHAIN_V1 — the fallback order, primary first. Every entry is present in MODEL_PRICING
// (spend-logger.ts, verified 2026-07-25), so whichever one answers is priced honestly rather than logged at $0.
// Sonnet is LAST and deliberately: it is the model the 74.1%-era eval baseline ran on, so a Sonnet answer is a
// capability drop the user must be told about — see provenanceNote().
const MODEL_CHAIN = [LORA_CHAT_MODEL, 'claude-opus-4-8', 'claude-sonnet-4-6']

// LORAMER_CHAT_STREAMING_V1 — STAGED BEHIND A FLAG. Unset/anything-but-'1' ⇒ the EXACT blocking path that shipped
// in bf184a4, byte-identical: same loop, same JSON body, same status codes. Set LORA_CHAT_STREAMING=1 in Vercel
// to turn streaming on. The client branches on the RESPONSE's content-type, not on a build-time constant, so one
// deployed client handles both modes and the flag can be flipped (or reverted) with no redeploy.
const CHAT_STREAMING = process.env.LORA_CHAT_STREAMING === '1'

export async function POST(request: Request) {
  // ── LORAMER_CHAT_PHASE_TIMING_V1 — THE ROUTE HAD ZERO Date.now() CALLS ACROSS 377 LINES ────────────
  // ⛔ WHY THIS EXISTS AND WHY IT IS NOT A FIX. ★CHAT-PROMPT-ASSEMBLY-DOUBLE-FETCH has been open since
  // 2026-08-03 with the same sentence in it: "any split anyone quotes is invented." Two sequential internal
  // fetches to /api/intelligence run before the model is ever called, and nobody could say how much of the
  // wait was session lookup, RBAC, fetch #1, fetch #2, or a cache miss — because nothing measured it.
  // ⛔ THE INSTRUMENT COMES BEFORE THE REMEDY (LORAMER_CAPTURE_LIMIT_IS_MEASURED_V1). This flight measures
  // and does NOT collapse the double fetch; that change alters what Lora is TOLD, which is the accuracy
  // surface `npm run evals` protects, so it is an evals-gated flight of its own.
  // ⚠ NO CLIENT DATA ON THE LINE — durations, token counts and a client-id PREFIX only. No question text,
  // no client name, no email. The log line is greppable on the marker `[chat] phases`.
  const t0 = Date.now()
  const phases: Record<string, number> = {}
  let phaseMark = t0
  const phase = (name: string) => { const now = Date.now(); phases[name] = now - phaseMark; phaseMark = now }
  let firstTokenMs: number | null = null

  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const {
    message,
    history,
    clientId,
    clientName,
    dateRange,
    platform = '',  // LORAMER_CHAT_PLATFORM_UNDEFINED_FIX_V1 — default so an absent platform is '' (falsy), never the literal "undefined"
    drillLevel,
    drillCampaign,
    drillAdGroup,
    rowContext,
    customStart,
    customEnd,
    location,  // LORAMER_FOCUS_LOCATION_V1
    persistTurn,  // LORAMER_CHAT_SERVER_TURN_WRITE_V1 — { surface, scope } declared by the caller; absent ⇒ server writes nothing
  } = await request.json()

  if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 })

  // LORAMER_CHAT_SERVER_TURN_WRITE_V1 — built ONCE per request so both paths share one latch.
  // LORAMER_CHAT_TURN_PAIR_WRITE_V1 — when the caller declares userTurn:true, the writer lands the
  // [user, assistant] pair in ONE insert at answer time; a flagless (stale-tab) caller keeps the
  // assistant-only behavior byte-identical. A turn that produces no answer writes nothing.
  const persistAssistantTurn = makeAssistantTurnWriter({
    clientId,
    userEmail: session.user.email,
    target: parsePersistTarget(persistTurn),
    userMessage: parseUserTurnFlag(persistTurn) ? String(message) : null,
  })

  // LORAMER_QUERY_METRICS_OWNERSHIP_V1 / LORAMER_RBAC_ACCESS_ORG_V1 — when a client is in scope, the signed-in
  // viewer MUST have ACCESS (owner ∪ org-grant ∪ legacy) before we fetch its intelligence or expose query_metrics.
  // resolveAccess is membership-aware and fails closed → this unblocks a GRANTED member's Ask-Lora on a shared
  // client while cross-org isolation still 404s. clientId is optional here, so only gate when present. Downstream
  // owner-keyed reads run on ownerEmail (via /api/intelligence's own resolveAccess gate + the tool loop), NEVER the
  // viewer — the share-runs-on-the-owner keystone is preserved.
  if (clientId) {
    phase('session')
    const access = await resolveAccess(clientId, session.user.email)
    if (!access?.ok) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 }) // 404, don't confirm the id
    }
    // LORAMER_CHAT_PHASES_MODEL_KEY_V1 — RBAC gets its OWN marker (the 2026-08-06 brief asked for it and it
    // was never delivered): without this line resolveAccess hides inside fetch1, making fetch1 an upper
    // bound on the intelligence fetch instead of the fetch itself. clientId-less turns emit no rbac key.
    phase('rbac')
  }

  // ── LORAMER_CHAT_STREAM_OPENS_AT_RBAC_V1 ────────────────────────────────────────────────────────────────
  // THE STREAM IS CONSTRUCTED HERE, IMMEDIATELY AFTER RBAC, AND NOT ONE LINE LATER.
  // MEASURED ON DEVICE (Gate-B, 2026-08-02): ~20 SECONDS OF THREE DOTS before anything appeared. The stream
  // used to be built inside the `if (CHAT_STREAMING)` branch far below — AFTER prompt assembly, which is TWO
  // SEQUENTIAL INTERNAL HTTP FETCHES to /api/intelligence (one for the flat prompt, one for the cacheable
  // {prefix, suffix} rebuild). That endpoint is cached ~15 min; on a MISS it pulls all five platforms live.
  // No channel existed while any of that ran, so no frame could be sent however early we wanted to send one.
  //
  // ⛔ WHY THIS LINE AND NOT AN EARLIER ONE — the footgun is unchanged and still respected: once SSE headers
  // are written the status code is fixed. The failures that genuinely NEED a real status code are auth
  // (401/403) and RBAC (404), and BOTH are above this line and still return ordinary JSON. Everything BELOW
  // is already wrapped in try/catch with a prompt fallback and never produced a status code of its own, so
  // nothing is given up by opening the channel here.
  //
  // ⛔ WHAT THE FIRST FRAME MAY SAY. At this instant the viewer is authenticated AND authorised for this
  // client, and the next work is assembling that client's numbers. That is what it says. It does NOT name a
  // tool, a platform, a window or a metric — nothing has been read, and "Reading <client> · Google · Nov–Dec
  // 2024" here would be a FALSE STATUS. "Thinking…" moves to where the model call actually is, in the loop.
  const encoder = new TextEncoder()
  let ctrl: ReadableStreamDefaultController<Uint8Array> | undefined
  // start() runs synchronously on construction, so `ctrl` is live before anything below writes to it.
  const stream = new ReadableStream<Uint8Array>({ start(c) { ctrl = c } })
  const emitRaw = (event: string, data: any) => {
    // LORAMER_CHAT_PHASE_TIMING_V1 — time-to-first-frame, stamped on the FIRST frame of ANY kind. This is the
    // same moment the route already releases its response gate on, so the number means "when the user could
    // first have seen something", not "when the model produced text".
    if (firstTokenMs === null) firstTokenMs = Date.now() - t0
    try { ctrl?.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) } catch { /* client gone */ }
  }
  if (CHAT_STREAMING) {
    emitRaw('status', {
      phase: 'assembling',
      label: clientName ? `Pulling ${clientName}'s latest numbers together…` : 'Pulling the latest numbers together…',
    })
  }

  // LORAMER_FOCUS_LOCATION_V1
  // Build focus description. Honor `location` (the tab) first - that's
  // the most reliable signal of what the user is looking at. Only fall
  // back to platform-based focus when location indicates an ad-view
  // (overview/campaigns/keywords) AND the user is drilling into ad data.
  // Avoids the bug where platform='google' (a default fallback) leaks
  // 'Google Ads campaigns' as the view for Shopify-only clients.
  // LORAMER_FOCUS_LOCATION_V2
  // V1 left location='chat' falling through to platform-based focus,
  // which lies for Shopify-only clients (platform defaults to 'google').
  // The Ask Claude tab is platform-agnostic - use a neutral focus.
  // LORAMER_CROSS_CLAUDE_FOCUS_V1 — emit mode KEYS that normalizeFocus accepts,
  // not human-readable labels. Drill specifics flow through rowContext, not focus.
  // This makes /api/chat and /api/insight produce the same intelligence context
  // for the same question — fixing the cross-surface answer inconsistency where
  // insight bar, right panel, and Ask Claude tab gave different responses.
  let focus: string
  if (location === 'shopify') {
    focus = 'shopify'
  } else if (location === 'woocommerce') {
    focus = 'woocommerce'
  } else if (location === 'chat') {
    focus = 'overview'  // Ask Claude tab is cross-platform; overview gives full context
  } else if (drillLevel === 'adgroups' && drillCampaign) {
    focus = 'adgroups'  // campaign name flows via rowContext
  } else if (drillLevel === 'ads' && drillAdGroup) {
    focus = 'ads'       // ad group name flows via rowContext
  } else if (platform === 'combined' || platform === 'meta' || platform === 'google') {
    focus = 'overview'  // platform top-level views all get full overview context
  } else {
    focus = location || 'overview'
  }

  let systemPrompt = ''
  let systemArr: any = undefined

  // ── LORAMER_CHAT_FIRST_FRAME_V1, 2026-08-11 — ONE FETCH, BOTH BUILDERS, CALLED FROM WHERE EACH MODE
  // NEEDS IT. Two things collapsed into this function, and they are separate fixes that share a body:
  //
  // ⛔ (1) THE DEDUP. This route fetched /api/intelligence TWICE, SEQUENTIALLY, with IDENTICAL parameters —
  // once for the flat prompt (Phase-1) and once for the cacheable {prefix, suffix} rebuild (Phase-2). On an
  // intelligence-cache miss the first call pays the full five-platform live pull and the second usually
  // rides the 15-min cache it just warmed — but "usually" is a race, and two calls could return DIFFERENT
  // snapshots, so the cached prefix could describe different numbers than the flat fallback. ONE response
  // now feeds BOTH builders: half the internal HTTP round-trips, and the two prompt shapes cannot diverge.
  //
  // ⛔ (2) THE MOVE. Assembly is no longer awaited inline before the streaming branch — the streaming path
  // calls this INSIDE its detached async, AFTER the Response has been returned, so the first status frame
  // reaches the device in milliseconds instead of sitting in the stream buffer for the whole assembly +
  // first-token wait (MEASURED at arrival, 2026-08-11 probe: headers at 49.16s, the t+0.1s status frame
  // arriving at 49.17s). The blocking path awaits it inline exactly as before — nothing changes with the
  // flag off.
  //
  // phase keys: fetch1 = the one fetch; build1 = flat prompt; build2 = cacheable pair. `fetch2` no longer
  // exists as a phase — the telemetry line simply stops carrying it, which is itself the measurement.
  const assemblePrompt = async () => {
    if (clientId) {
      try {
        const intelligenceRes = await fetch(
          `${process.env.NEXTAUTH_URL}/api/intelligence?clientId=${clientId}&dateRange=${dateRange || 'LAST_30_DAYS'}${customStart ? '&customStart=' + customStart : ''}${customEnd ? '&customEnd=' + customEnd : ''}`,
          { headers: { Cookie: request.headers.get('cookie') || '' } }
        )
        const intelligenceData = await intelligenceRes.json()
        const intelligence: ClientIntelligence = intelligenceData.intelligence
        if (intelligence) {
          phase('fetch1')
          systemPrompt = buildClaudeContext(intelligence, focus, rowContext)
          phase('build1')
          // LORAMER_PROMPT_CACHING_PHASE_2_ENABLE_V1 — the cacheable pair, from the SAME response.
          // Its own try/catch so a cacheable-build failure degrades to the flat prompt, never to nothing.
          try {
            const { prefix, suffix } = buildClaudeContextCacheable(intelligence, focus, rowContext)
            // ⛔ LORAMER_PROMPT_CACHE_1H_TTL_V1 — EXTENDED 1-HOUR TTL. `ttl` is the documented field on
            // cache_control and takes '5m' (the default when omitted) or '1h'. ⛔ NO BETA HEADER: extended TTL is
            // GA on the first-party API — verified against the current Anthropic reference, NOT from memory,
            // per the standing rule that a model/API fact is never written from recall.
            // ⛔ THE TRADE, STATED WITH THE MEASUREMENT THAT DECIDES IT: a 1h cache WRITE costs 2× base input
            // (vs 1.25× at 5m); a READ costs ~0.1× either way. So 1h needs one more read than 5m to break even.
            // MEASURED over 22 paired turns: p50 87s, p90 281s, max 365s. A SINGLE p90 TURN IS 4.7 MINUTES,
            // so under the 5-minute default the cache written for turn N has essentially expired by the time
            // the user reads that answer and sends turn N+1 — the second turn of a conversation, which is
            // exactly the turn caching exists to serve, was missing. At 1h it hits. That is the whole argument.
            systemArr = [
              { type: 'text', text: prefix, cache_control: { type: 'ephemeral', ttl: '1h' } },
              ...(suffix ? [{ type: 'text', text: suffix }] : []),
            ]
            phase('build2')
          } catch (e) {
            console.error('Cacheable intelligence rebuild error:', e)
          }
        }
      } catch (e) {
        console.error('Intelligence fetch error:', e)
      }
    }
    // Fallback system prompt: agency/all-clients scope (no clientId), OR a single-client intelligence-fetch failure.
    if (!systemPrompt) {
      if (!clientId) {
        // LORAMER_AGENCY_SCOPE_LORA_V1 — no single client is selected. Tools ARE attached at this scope, so give Lora
        // the RBAC-SCOPED roster (only clients THIS viewer can access) + the resolve-a-named-client-or-ask rule.
        const roster = await listAccessibleClientsWithNames(session.user.email)
        systemPrompt = buildAgencyScopeContext(roster)
      } else {
        // LORAMER_CHAT_PLATFORM_UNDEFINED_FIX_V1 — omit the Platform clause entirely when absent; never render "undefined".
        systemPrompt = `You are Lora, an expert digital advertising analyst in LoraMer. Always refer to yourself as Lora. Client: ${clientName}.${platform ? ` Platform: ${platform}.` : ''} Current view: ${focus}.${rowContext ? '\nSpecifically looking at: ' + rowContext : ''}`
      }
    }
  }
  // ⛔ LORAMER_CHAT_HISTORY_CACHE_V1, 2026-08-13 — THE SECOND BREAKPOINT: THE CONVERSATION ITSELF.
  //
  // WHAT WAS MEASURED BEFORE THIS EXISTED (anthropic_spend_log, Opus-5 era): the FULL thread rode
  // `messages` at FULL PRICE on EVERY model call of EVERY turn — and the tool loop re-pays it per
  // iteration. The Escential Group thread (64,010 tokens of history across 230 rows) hit $2.1380 on one
  // turn (285,526 full-price input tokens, 2026-08-07); the shipped prefix cache saved ~$1.49 NET across
  // three weeks because it covered only the small static block while the growing block rode uncached.
  //
  // THE MECHANISM, vendor-documented (platform.claude.com/docs/en/docs/build-with-claude/prompt-caching —
  // the multi-turn conversation pattern): mark the FINAL user message. The cache then covers
  // tools → system → all history → this question. Next turn's lookback (20-block window; ours moves 2
  // blocks/turn) READS that prefix at 0.1× and writes only the new tail. Within THIS turn, tool-loop
  // iterations 2+ read everything through the question at 0.1× — which is exactly where the 2× waste
  // lived. ⛔ ONE CONTINUOUS MIND IS UNTOUCHED: every verbatim turn is still SENT, stored and displayed —
  // only its price changes.
  //
  // ⛔ TTL '5m' HERE IS A MEASURED DECISION AND AN ORDERING LAW, NOT A DEFAULT LEFT TO CHANCE:
  //   · ORDERING (vendor, verbatim): "Cache entries with longer TTL must appear before shorter TTLs" —
  //     the 1h prefix block above MUST precede this 5m block; a 1h-after-5m request is malformed.
  //   · MEASURED inter-turn gaps (347 gaps, Opus-5 era): ≤5m 66% · 5m–1h 12.7% · >1h 21.3%. Expected
  //     marginal cost per M history tokens: 5m = .66×$0.50 + .34×$6.25 = $2.46 · 1h = .787×$0.50 +
  //     .213×$10 = $2.52. 5m is cheaper on the expectation AND cheaper on every cold rewrite ($6.25/M vs
  //     $10/M). The prefix stays 1h for the reason its own comment records (turn N+1 after a long read).
  //   · The 512-token Opus-5 minimum applies to the TOTAL prefix up to the breakpoint (system alone
  //     clears it), so a short thread is never a silent no-op worth special-casing.
  //
  // ⚠ CONTENT SHAPE: cache_control requires array-of-blocks content, so ONLY the final message is
  // converted; history entries stay verbatim strings. Empty text is guarded upstream (message required).
  const messages = [
    ...(history || []).map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    {
      role: 'user' as const,
      content: [
        { type: 'text' as const, text: message, cache_control: { type: 'ephemeral' as const, ttl: '5m' as const } },
      ],
    },
  ]

  // LORAMER_QUERY_METRICS_SHARED_LOOP_V1
  // Capped Claude tool-use loop (shared with /api/insight follow-ups via
  // src/lib/claude-tools.ts) exposing query_metrics so chat can answer
  // historical / comparison questions from metrics_daily. Single-shot when the
  // model calls no tool or no clientId is present.
  // ── LORAMER_CHAT_STREAMING_V1 → LORAMER_CHAT_FIRST_FRAME_V1, 2026-08-11 ─────────────────────────────────
  // ⛔ THE FOOTGUN RULE IS CONSCIOUSLY TRADED, ON RUSS'S CALL, AND THE TRADE IS RECORDED HERE AND IN
  // DECISIONS RATHER THAN QUIETLY MADE. The rule was: never write SSE headers until the model's first
  // token, so a pre-token failure keeps a REAL HTTP status. What it protected, precisely: TWO cases — the
  // 503 all-models-overloaded and a pre-token 500 — as ordinary JSON. What it COST, measured at frame
  // ARRIVAL (2026-08-11 probe, one real turn): headers held 49.16s; the status frame emitted at t+0.1s
  // arrived at t+49.17s, buffered the entire time. The user saw NOTHING — the banked 34.9s / tonight's
  // 49.2s of dead air at the start of EVERY streamed turn — and the ★CHAT-STATUS-SILENT-WINDOWS "Working…"
  // symptom was this same buffering (status frames cannot arrive before headers), not a stomp.
  //
  // ⛔ WHAT REPLACES IT: the Response returns HERE, immediately after RBAC, and prompt assembly + the model
  // chain run inside the detached async. A pre-token failure becomes an SSE `error` frame on HTTP 200 —
  // WHICH THE CLIENT ALREADY HANDLES IDENTICALLY: readChatResponse (chat-stream-read.ts:75) returns
  // {ok:false, error} for an error frame exactly as it does for the JSON body, and every user-facing
  // sentence keys on `d.error` codes (use-lora-chat.ts:648-659), never on the HTTP status. The same
  // machine-readable codes ride the frame ('overloaded', or the error message), so the sentences are
  // byte-identical. The server-side console.error lines survive unchanged, so OUR telemetry keeps the
  // request-id detail.
  //
  // ⛔ WHAT IS GENUINELY GIVEN UP, stated so the trade stays visible: failed streamed turns read HTTP 200
  // in Vercel's status-code view. Anything that counts 5xx as "chat failures" undercounts streamed
  // failures from this commit on — grep for `[chat] ALL MODELS OVERLOADED` / `Chat error (streaming` in
  // runtime logs instead, which carry MORE detail than the status code did.
  //
  // ⛔ WHAT IS NOT TRADED: auth 401 and RBAC 404 sit ABOVE the stream construction and keep their real
  // JSON status codes — the two failures the original footgun comment said "genuinely NEED a real status
  // code" are untouched. And with the flag OFF, the blocking path below is byte-identical to before.
  if (CHAT_STREAMING) {
    // The controller is LIVE (constructed at RBAC, above) while the loop runs — never awaited-then-built,
    // or every frame queues and replays at the end (measured once as 152 deltas inside a 332ms window).
    void (async () => {
      try {
        // ⛔ ASSEMBLY LIVES INSIDE THE STREAM'S LIFETIME NOW. The one fetch (deduped from two, see
        // assemblePrompt) runs while the user already sees "Pulling <client>'s latest numbers together…" —
        // the frame that used to sit in the buffer for the whole of this await.
        await assemblePrompt()
        const chain = await runWithModelChain({
          models: MODEL_CHAIN,
          onOverload: (a) =>
            console.error(`[chat] ANTHROPIC OVERLOADED model=${a.model} request_id=${a.requestId ?? 'none'} elapsed=${a.elapsedMs}ms detail=${a.detail}`),
          run: (model, requestOptions) =>
            runClaudeToolLoopStreaming({
              anthropic,
              model,
              maxTokens: 16000,  // LORAMER_CHAT_MAX_TOKENS_BUMP_V1
              system: systemArr || systemPrompt,  // LORAMER_PROMPT_CACHING_PHASE_2_ENABLE_V1
              messages,
              clientId,
              userEmail: session.user.email,  // LORAMER_QUERY_METRICS_OWNERSHIP_V1
              clientName,  // LORAMER_CHAT_STATUS_SUBJECT_V1 — already on the body; lets the status line name the client with ZERO extra queries
              requestOptions,
              emit: emitRaw,
              // onFirstTurnStarted is gone WITH the race it served — nothing waits on the first token any
              // more. The loop's optional param stays (claude-tools.ts is deliberately untouched; it is on
              // the eval-sensitive list and an unused optional callback harms nothing).
            }),
        })
        const { responseText, usage } = chain.value
        const answered = chain.modelUsed
        const bodyText = responseText || 'I wasn\u2019t able to complete that request. Please try rephrasing.'
        const finalText = chain.fellBack ? provenanceNote(answered, MODEL_CHAIN[0]) + bodyText : bodyText
        console.log('[chat] cache:', { model: answered, fellBack: chain.fellBack, streaming: true, input: usage.input, cache_create: usage.cache_create, cache_read: usage.cache_read, output: usage.output })
        if (chain.fellBack) emitRaw('provenance', { model: answered, primary: MODEL_CHAIN[0] })
        emitRaw('answer', { text: finalText, model: answered, fellBack: chain.fellBack })
        // AWAITED, inside the stream close path, BEFORE the controller closes. In the blocking route logSpend was
        // fire-and-forget AFTER the response returned, which is why it died on the serverless freeze — proven
        // twice in prod (ECONNRESET 22:31:46, UND_ERR_SOCKET 16:43:27). The handler is alive while the stream is
        // open, so the insert completes. This retires that drop class for streamed turns.
        // LORAMER_CHAT_SERVER_TURN_WRITE_V1 — BEFORE logSpend, deliberately: the answer must be at
        // least as durable as its cost row. Detached close path, so a dead browser cannot skip it.
        const persisted = await persistAssistantTurn(finalText)
        if (persisted === 'failed') console.error(`[chat] answer NOT persisted client=${clientId}`)
        // LORAMER_CHAT_PHASE_TIMING_V1 — ONE greppable line, no client data. `client` is an 8-char id PREFIX
        // (enough to join to a row, not enough to identify a business); no question text, no client name, no
        // email. `model_ms` is the whole model phase — assembly is already broken out in `phases`. (This
        // sentence was FICTION until 2026-08-12: the phase was keyed 'model' and the name scalar after the
        // spread destroyed it on every line — LORAMER_CHAT_PHASES_MODEL_KEY_V1 made the comment true.)
        phase('model_ms') // LORAMER_CHAT_PHASES_MODEL_KEY_V1 — never 'model': the name scalar after ...phases clobbered it
        console.log('[chat] phases', JSON.stringify({
          client: typeof clientId === 'string' ? clientId.slice(0, 8) : null,
          total_ms: Date.now() - t0, first_frame_ms: firstTokenMs, ...phases,
          input: usage.input, cache_read: usage.cache_read, cache_create: usage.cache_create, output: usage.output,
          streaming: true, model: answered,
        }))
        await logSpend({
          userEmail: session.user.email,
          clientId,
          endpoint: 'chat',
          model: answered,   // LORAMER_LORA_MODEL_CHAIN_V1 — the ANSWERING model, never the primary constant
          inputTokens: usage.input,
          outputTokens: usage.output,
          cacheReadTokens: usage.cache_read,
          // LORAMER_CHAT_HISTORY_CACHE_V1 — the SPLIT, so the ledger prices 1h prefix writes at 2× and 5m
          // message writes at 1.25× instead of everything at 1.25×. The column still receives the SUM.
          cacheCreationTokens: usage.cache_create_5m,
          cacheCreation1hTokens: usage.cache_create_1h,
          durationMs: Date.now() - t0,   // LORAMER_SPEND_LOG_DURATION_AND_CACHE_V1 — migration 058
        })
        emitRaw('done', { model: answered })
      } catch (e: any) {
        // ⛔ LORAMER_CHAT_FIRST_FRAME_V1 — EVERY streamed failure lands here now, pre-token included, because
        // headers are already out. The only honest channel is an SSE `error` frame — and it is the SAME
        // channel the client already reads: readChatResponse returns {ok:false, error}, and the per-failure
        // sentences key on the code. The console lines below keep the request-id detail the old 503 JSON
        // carried, so server-side telemetry loses nothing to the status code becoming 200.
        if (e instanceof AllModelsOverloadedError) {
          console.error(`[chat] ALL MODELS OVERLOADED (streaming) tried=${e.attempts.map((a: any) => a.model).join(',')} dropped=${e.droppedModels.join(',') || 'none'} request_ids=${e.attempts.map((a: any) => a.requestId ?? 'none').join(',')}`)
        } else {
          console.error('Chat error (streaming):', e)
        }
        emitRaw('error', { error: e instanceof AllModelsOverloadedError ? 'overloaded' : (e?.message || 'stream failed') })
      } finally {
        try { (ctrl as any)?.close() } catch { /* already closed */ }
      }
    })()

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // defeat proxy buffering, which would silently re-create the blocking behavior
      },
    })
  }

  // BLOCKING PATH (flag off) — byte-identical behaviour to before LORAMER_CHAT_FIRST_FRAME_V1: assembly is
  // awaited inline (there is no stream to hold), then the same chain, same JSON body, same status codes.
  await assemblePrompt()

  // LORAMER_LORA_MODEL_CHAIN_V1 — retry the primary, then FALL BACK across models on Anthropic overload.
  // The chain owns the wall-clock budget (95s vs ChatLauncher's 120s abort); hops it cannot afford are DROPPED,
  // never half-run. Only `overloaded_error` advances the chain — any other failure surfaces as itself.
  try {
    const chain = await runWithModelChain({
      models: MODEL_CHAIN,
      onOverload: (a) =>
        // LORAMER_LORA_MODEL_CHAIN_V1 — one line per overloaded hop, carrying the Anthropic request_id and the
        // model, so recurrence rate is MEASURABLE. We do not currently know whether 529s are rare or chronic;
        // without the request_id there is nothing to correlate against Anthropic's side.
        console.error(`[chat] ANTHROPIC OVERLOADED model=${a.model} request_id=${a.requestId ?? 'none'} elapsed=${a.elapsedMs}ms detail=${a.detail}`),
      run: (model, requestOptions) =>
        runClaudeToolLoop({
          anthropic,
          model,
          maxTokens: 16000,  // LORAMER_CHAT_MAX_TOKENS_BUMP_V1
          system: systemArr || systemPrompt,  // LORAMER_PROMPT_CACHING_PHASE_2_ENABLE_V1
          messages,
          clientId,
          userEmail: session.user.email,  // LORAMER_QUERY_METRICS_OWNERSHIP_V1
          requestOptions,
        }),
    })
    const { responseText, usage } = chain.value
    const answered = chain.modelUsed
    // PROVENANCE (LORAMER_LIVE_VS_CAPTURED_ARE_TWO_SOURCES_V1, same law): a substituted model is NEVER silent.
    // Code-authored, not model-authored — the model cannot forget or soften a fact about its own substitution,
    // and the PRIMARY path's prompt stays byte-identical so the eval baseline remains comparable.
    const body = responseText || 'I wasn\u2019t able to complete that request. Please try rephrasing.'
    const finalText = chain.fellBack ? provenanceNote(answered, MODEL_CHAIN[0]) + body : body
    console.log('[chat] cache:', {
      model: answered,
      fellBack: chain.fellBack,
      input: usage.input,
      cache_create: usage.cache_create,
      cache_read: usage.cache_read,
      output: usage.output,
    })
    // LORAMER_CHAT_PHASE_TIMING_V1 — same line, blocking path. streaming:false is the discriminator.
    phase('model_ms') // LORAMER_CHAT_PHASES_MODEL_KEY_V1 — never 'model': the name scalar after ...phases clobbered it
    console.log('[chat] phases', JSON.stringify({
      client: typeof clientId === 'string' ? clientId.slice(0, 8) : null,
      total_ms: Date.now() - t0, first_frame_ms: firstTokenMs, ...phases,
      input: usage.input, cache_read: usage.cache_read, cache_create: usage.cache_create, output: usage.output,
      streaming: false, model: answered,
    }))
    logSpend({
      durationMs: Date.now() - t0,   // LORAMER_SPEND_LOG_DURATION_AND_CACHE_V1 — migration 058
      userEmail: session.user.email,
      clientId,
      endpoint: 'chat',
      // LORAMER_LORA_MODEL_CHAIN_V1 — the model that ACTUALLY answered, never the primary constant. A fallback
      // turn logged at the primary's rate is a FALSE COST, and all three chain models are priced in MODEL_PRICING.
      model: answered,
      inputTokens: usage.input,
      outputTokens: usage.output,
      cacheReadTokens: usage.cache_read,        // LORAMER_LORA_MODEL_PRICING_V1 — honest cache-token cost
      cacheCreationTokens: usage.cache_create,
    })
    // LORAMER_CHAT_SERVER_TURN_WRITE_V1 — AWAITED before the response returns. logSpend above is
    // fire-and-forget and dies on the serverless freeze (route.ts:262-265); the answer must not.
    await persistAssistantTurn(finalText)
    return NextResponse.json({ response: finalText, model: answered, fellBack: chain.fellBack })
  } catch (e: any) {
    // DISTINCT FAILURE MODES — no generic fallthrough. Each carries its own machine-readable `error` code so the
    // client renders a DIFFERENT, TRUE sentence instead of one catch-all that hides which thing broke.
    if (e instanceof AllModelsOverloadedError) {
      console.error(`[chat] ALL MODELS OVERLOADED tried=${e.attempts.map((a) => a.model).join(',')} dropped=${e.droppedModels.join(',') || 'none'} request_ids=${e.attempts.map((a) => a.requestId ?? 'none').join(',')}`)
      return NextResponse.json(
        { error: 'overloaded', tried: e.attempts.map((a) => a.model), dropped: e.droppedModels },
        { status: 503 },
      )
    }
    console.error('Chat error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
