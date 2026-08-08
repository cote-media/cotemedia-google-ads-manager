import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'
import { logSpend } from '@/lib/spend-logger' // LORAMER_SPEND_LOG_V1
import { buildClaudeContext, buildClaudeContextCacheable, buildAgencyScopeContext } from '@/lib/intelligence/build-claude-context'  // LORAMER_PROMPT_CACHING_PHASE_2_ENABLE_V1 + LORAMER_AGENCY_SCOPE_LORA_V1
import { runWithModelChain, AllModelsOverloadedError, provenanceNote, isUserAbort } from '@/lib/lora-model-chain' // LORAMER_LORA_MODEL_CHAIN_V1 + LORAMER_CHAT_STOP_CANCELS_SERVER_V1
import type { ClientIntelligence } from '@/lib/intelligence/intelligence-types'
import { runClaudeToolLoop, runClaudeToolLoopStreaming } from '@/lib/claude-tools'  // LORAMER_QUERY_METRICS_SHARED_LOOP_V1
import { resolveAccess, listAccessibleClientsWithNames } from '@/lib/access/can-access'  // LORAMER_RBAC_ACCESS_ORG_V1 + LORAMER_AGENCY_SCOPE_LORA_V1 (RBAC-scoped roster)
import { parsePersistTarget, makeAssistantTurnWriter } from '@/lib/chat/persist-assistant-turn' // LORAMER_CHAT_SERVER_TURN_WRITE_V1

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
  const persistAssistantTurn = makeAssistantTurnWriter({
    clientId,
    userEmail: session.user.email,
    target: parsePersistTarget(persistTurn),
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

  if (clientId) {
    // Fetch complete intelligence
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

  // LORAMER_PROMPT_CACHING_PHASE_2_ENABLE_V1
  // Build a typed system array with cache_control on the prefix block so
  // Anthropic caches the stable parts (hard constraints, identity, profile,
  // platform data, memory) across turns. Conversation history + rules stay
  // dynamic in the suffix and rebuild each call. Falls back to the plain
  // string `systemPrompt` (Phase-1 wrapper output) if intelligence fetch
  // failed — keeps the existing error path working unchanged.
  let systemArr: any = undefined
  if (clientId) {
    try {
      const intelligenceRes2 = await fetch(
        `${process.env.NEXTAUTH_URL}/api/intelligence?clientId=${clientId}&dateRange=${dateRange || 'LAST_30_DAYS'}${customStart ? '&customStart=' + customStart : ''}${customEnd ? '&customEnd=' + customEnd : ''}`,
        { headers: { Cookie: request.headers.get('cookie') || '' } }
      )
      const intelligenceData2 = await intelligenceRes2.json()
      const intelligence2: ClientIntelligence = intelligenceData2.intelligence
      if (intelligence2) {
        phase('fetch2')
        const { prefix, suffix } = buildClaudeContextCacheable(intelligence2, focus, rowContext)
        // ⛔ LORAMER_PROMPT_CACHE_1H_TTL_V1 — EXTENDED 1-HOUR TTL. `ttl` is the documented field on
        // cache_control and takes '5m' (the default when omitted) or '1h'. ⛔ NO BETA HEADER: extended TTL is
        // GA on the first-party API — verified against the current Anthropic reference this session, NOT from
        // memory, per the standing rule that a model/API fact is never written from recall.
        // ⛔ THE TRADE, STATED WITH THE MEASUREMENT THAT DECIDES IT: a 1h cache WRITE costs 2× base input
        // (vs 1.25× at 5m); a READ costs ~0.1× either way. So 1h needs one more read than 5m to break even.
        // MEASURED THIS SESSION over 22 paired turns: p50 87s, p90 281s, max 365s. **A SINGLE p90 TURN IS
        // 4.7 MINUTES**, so under the 5-minute default the cache written for turn N has essentially expired by
        // the time the user reads that answer and sends turn N+1 — the second turn of a conversation, which is
        // exactly the turn caching exists to serve, was missing. At 1h it hits. That is the whole argument.
        systemArr = [
          { type: 'text', text: prefix, cache_control: { type: 'ephemeral', ttl: '1h' } },
          ...(suffix ? [{ type: 'text', text: suffix }] : []),
        ]
        phase('build2')
      }
    } catch (e) {
      console.error('Cacheable intelligence rebuild error:', e)
    }
  }

  const messages = [
    ...(history || []).map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: message }
  ]

  // LORAMER_QUERY_METRICS_SHARED_LOOP_V1
  // Capped Claude tool-use loop (shared with /api/insight follow-ups via
  // src/lib/claude-tools.ts) exposing query_metrics so chat can answer
  // historical / comparison questions from metrics_daily. Single-shot when the
  // model calls no tool or no clientId is present.
  // ── LORAMER_CHAT_STREAMING_V1 ─────────────────────────────────────────────────────────────────────────────
  // THE KNOWN FOOTGUN, handled explicitly: once SSE headers are written the status code is fixed, so a 401/404/503
  // can no longer be expressed. We therefore do NOT commit to a stream until the model has produced its FIRST
  // token. Every pre-token failure — auth, RBAC, a 529 that exhausts the whole model chain — is raised BEFORE the
  // Response is returned and still comes back as ordinary JSON with its real status. Only a failure AFTER the
  // first token (a later tool-turn dying mid-loop) degrades to an SSE `error` event, which is stated rather than
  // hidden: at that point the user has already seen text, and a status code would be a lie.
  if (CHAT_STREAMING) {
    // LORAMER_CHAT_STREAM_OPENS_AT_RBAC_V1 — `stream`, `ctrl` and `emitRaw` are NO LONGER BUILT HERE. They are
    // constructed immediately after the RBAC gate, far above, so a frame can go out BEFORE the two sequential
    // /api/intelligence fetches instead of after them. That ~20s window used to be three dots on the device.
    // The ordering rule that comment used to carry still holds and is now enforced further up: the controller
    // must be LIVE while the loop runs, never awaited-then-built, or every frame queues and replays at the end
    // (measured once as 152 deltas inside a 332ms window at the tail of a 125s turn).

    // THE FOOTGUN, still handled: once SSE headers are written the status code is fixed. So we do NOT return the
    // Response until either (a) the first token has arrived — at which point streaming is unambiguously the right
    // answer — or (b) the chain has settled. A pre-token failure (auth, RBAC, a 529 exhausting the whole chain)
    // therefore still returns ordinary JSON with its real status. Only a failure AFTER first token degrades to an
    // SSE `error` event, which is honest: the user has already seen text, and a status code would be a lie.
    let firstToken!: () => void
    const firstTokenP = new Promise<void>((r) => { firstToken = r })

    const work = runWithModelChain({
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
          // LORAMER_CHAT_STOP_CANCELS_SERVER_V1 — THE SIGNAL IS THE WHOLE FIX. Aborting client→server
          // does NOT abort server→Anthropic; without this the generation runs to completion and bills
          // in full while the browser shows nothing. `request.signal` only fires because vercel.json
          // now carries `supportsCancellation: true` for this route — without that flag the platform
          // never propagates the disconnect and this line is inert.
          requestOptions: { ...requestOptions, signal: request.signal },
          emit: emitRaw,
          onFirstTurnStarted: firstToken,
        }),
    })

    // Settle-or-first-token. `settled` distinguishes "the chain finished/failed" from "text started flowing".
    let settledErr: any = null
    let settledOk = false
    const settled = work.then(() => { settledOk = true }, (e) => { settledErr = e })
    await Promise.race([firstTokenP, settled])

    if (!settledOk && settledErr) {
      // Pre-token failure — no headers written yet, real status still available. Same branches as the blocking
      // path, so flipping the flag cannot change what an error looks like.
      try { (ctrl as any)?.close() } catch { /* not started */ }
      if (settledErr instanceof AllModelsOverloadedError) {
        console.error(`[chat] ALL MODELS OVERLOADED (streaming) tried=${settledErr.attempts.map((a: any) => a.model).join(',')} dropped=${settledErr.droppedModels.join(',') || 'none'} request_ids=${settledErr.attempts.map((a: any) => a.requestId ?? 'none').join(',')}`)
        return NextResponse.json({ error: 'overloaded', tried: settledErr.attempts.map((a: any) => a.model), dropped: settledErr.droppedModels }, { status: 503 })
      }
      console.error('Chat error (streaming, pre-token):', settledErr)
      return NextResponse.json({ error: settledErr.message }, { status: 500 })
    }

    // Committed to SSE. Everything from here rides the stream; the loop is STILL RUNNING and writing deltas.
    void (async () => {
      try {
        const chain = await work
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
        // email. `model_ms` is the whole model phase — assembly is already broken out in `phases`.
        phase('model')
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
          cacheCreationTokens: usage.cache_create,
          durationMs: Date.now() - t0,   // LORAMER_SPEND_LOG_DURATION_AND_CACHE_V1 — migration 058
        })
        emitRaw('done', { model: answered })
      } catch (e: any) {
        // ⛔ LORAMER_CHAT_STOP_CANCELS_SERVER_V1 — A USER ABORT IS NOT AN ERROR, AND IT STILL COSTS MONEY.
        // Two things have to happen here that the error path does not do, and skipping either one ships a
        // button that lies:
        //   1. THE SPEND ROW. `logSpend` lived ONLY on the success path, so a stopped turn recorded
        //      NOTHING — zero, for tokens that were genuinely generated and genuinely billed. Hiding real
        //      money is the dishonest direction; a stop must be cheaper than a completion, never free.
        //   2. THE ENDPOINT MARKER. `endpoint: 'chat-stopped'` rather than 'chat', so a stopped turn is
        //      distinguishable in `anthropic_spend_log` WITHOUT a migration — and so every existing query
        //      that filters `endpoint = 'chat'` does not silently average partial turns into completed ones.
        // ⚠ THE HONEST LIMIT, STATED RATHER THAN ROUNDED AWAY: `usage` accumulates per COMPLETED tool turn.
        // The turn that was in flight when the abort landed has no final usage event, so its output tokens
        // are NOT knowable and are NOT in this row. THIS UNDER-REPORTS BY THE ABORTED TURN. It is the safe
        // direction for honesty (we never claim to have spent less than we did on completed turns) but it
        // is not exact, and nothing here should be read as exact.
        if (isUserAbort(e)) {
          // ⛔ THE ACCUMULATOR COMES OFF THE ERROR, NOT OFF `work`. `work` is the promise that just
          // REJECTED — awaiting it again yields nothing, which is the shape of a spend row that silently
          // never writes. runClaudeToolLoopStreaming attaches `partialUsage` to the thrown error precisely
          // because that is the only object guaranteed to reach this catch.
          const partial = (e && typeof e === 'object' ? (e as any).partialUsage : null) ?? null
          console.log('[chat] STOPPED by user', JSON.stringify({
            client: typeof clientId === 'string' ? clientId.slice(0, 8) : null,
            elapsed_ms: Date.now() - t0, partial_usage: partial,
          }))
          if (partial) {
            await logSpend({
              userEmail: session.user.email,
              clientId,
              endpoint: 'chat-stopped',
              model: MODEL_CHAIN[0],
              inputTokens: partial.input,
              outputTokens: partial.output,
              cacheReadTokens: partial.cache_read,
              cacheCreationTokens: partial.cache_create,
              durationMs: Date.now() - t0,
            })
          }
          // ⛔ `stopped`, NOT `error`. The client keeps the partial answer on screen and marks it stopped —
          // the user paid for those tokens and discarding them would be the second way to lose their money.
          emitRaw('stopped', { reason: 'user' })
        } else {
        // POST-token failure. Status is already fixed at 200, so the only honest channel is an SSE error event.
        console.error('Chat error (streaming, post-token):', e)
        emitRaw('error', { error: e instanceof AllModelsOverloadedError ? 'overloaded' : (e?.message || 'stream failed') })
        }
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
          // LORAMER_CHAT_STOP_CANCELS_SERVER_V1 — same signal on the blocking path. Stop must work
          // whichever path served the turn, or the button is honest on one and cosmetic on the other.
          requestOptions: { ...requestOptions, signal: request.signal },
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
    phase('model')
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
