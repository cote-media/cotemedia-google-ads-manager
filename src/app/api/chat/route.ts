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

// LORAMER_CHAT_MAXDURATION_V1 — make the function ceiling EXPLICIT instead of inheriting the (invisible, dashboard-
// settable) project default. A real turn on 2026-07-24 ran ~59s server-side (multi-tool Opus loop) and returned 200,
// but the browser had already given up → the user saw a failure for an answer that existed. 300s is the Vercel Pro
// DEFAULT with fluid compute (verified 2026-07-24: Pro default 300s, max 800s, extended 1800s beta) — ~5× the
// observed worst case, so the SERVER is never the limiter within any realistic turn; the deliberate cap the user
// feels is the SHORTER client-side AbortController in ChatLauncher. This is a STOPGAP — the durable fix is streaming
// (QUEUE ★CHAT-STREAMING); a 59s answer that renders progressively is alive, a 59s spinner is dead.
export const maxDuration = 300

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
  } = await request.json()

  if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 })

  // LORAMER_QUERY_METRICS_OWNERSHIP_V1 / LORAMER_RBAC_ACCESS_ORG_V1 — when a client is in scope, the signed-in
  // viewer MUST have ACCESS (owner ∪ org-grant ∪ legacy) before we fetch its intelligence or expose query_metrics.
  // resolveAccess is membership-aware and fails closed → this unblocks a GRANTED member's Ask-Lora on a shared
  // client while cross-org isolation still 404s. clientId is optional here, so only gate when present. Downstream
  // owner-keyed reads run on ownerEmail (via /api/intelligence's own resolveAccess gate + the tool loop), NEVER the
  // viewer — the share-runs-on-the-owner keystone is preserved.
  if (clientId) {
    const access = await resolveAccess(clientId, session.user.email)
    if (!access?.ok) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 }) // 404, don't confirm the id
    }
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
        systemPrompt = buildClaudeContext(intelligence, focus, rowContext)
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
        const { prefix, suffix } = buildClaudeContextCacheable(intelligence2, focus, rowContext)
        systemArr = [
          { type: 'text', text: prefix, cache_control: { type: 'ephemeral' } },
          ...(suffix ? [{ type: 'text', text: suffix }] : []),
        ]
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
    const encoder = new TextEncoder()
    let ctrl: ReadableStreamDefaultController<Uint8Array> | undefined
    // start() runs synchronously on construction, so `ctrl` is live before the loop below writes to it. This
    // ordering is the whole fix: an earlier cut awaited the chain FIRST and only then built the stream, so every
    // frame queued and replayed at the end — measured as 152 deltas delivered inside a 332ms window at the tail
    // of a 125s turn. That is the shape of streaming with none of its value. The loop must write into a LIVE
    // controller while it runs.
    const stream = new ReadableStream<Uint8Array>({ start(c) { ctrl = c } })
    const emitRaw = (event: string, data: any) => {
      try { ctrl?.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) } catch { /* client gone */ }
    }

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
          requestOptions,
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
        await logSpend({
          userEmail: session.user.email,
          clientId,
          endpoint: 'chat',
          model: answered,   // LORAMER_LORA_MODEL_CHAIN_V1 — the ANSWERING model, never the primary constant
          inputTokens: usage.input,
          outputTokens: usage.output,
          cacheReadTokens: usage.cache_read,
          cacheCreationTokens: usage.cache_create,
        })
        emitRaw('done', { model: answered })
      } catch (e: any) {
        // POST-token failure. Status is already fixed at 200, so the only honest channel is an SSE error event.
        console.error('Chat error (streaming, post-token):', e)
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
    logSpend({
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
