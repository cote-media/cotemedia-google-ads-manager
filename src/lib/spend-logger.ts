// LORAMER_SPEND_LOG_V1
// Fire-and-forget Anthropic spend logger. Errors are swallowed so
// logging never breaks the API response path. Cost is computed from
// MODEL_PRICING (per-million-token rates).
import { supabaseAdmin } from '@/lib/supabase'

// LORAMER_LORA_MODEL_PRICING_V1 — Anthropic pricing, $ per MILLION tokens (input / output / cache). Update here
// when Anthropic changes rates. Cache rates follow Anthropic's documented structure — cache READ = 0.1x base
// input; 5-min cache WRITE = 1.25x base input — verified 2026-07-14 against Opus 4.8's published $0.50 read /
// $6.25 5m-write on $5 input.
// LORAMER_CHAT_HISTORY_CACHE_V1 — cacheWrite1h added 2026-08-13. ⛔ THE DEFECT THIS ENDS: the chat route
// has shipped ttl:'1h' on its prefix since 08-07 while computeCostUsd priced EVERY cache write at the 5m
// rate — cost_usd under-reported 1h writes by 37.5% (2× base vs 1.25× base, vendor-verified at
// platform.claude.com/docs/en/docs/build-with-claude/prompt-caching: "1-hour cache write tokens are 2
// times the base input tokens price"). Measured under-report to the switch date: 487,753 Opus-5
// cache-creation tokens × $3.75/M ≈ $1.83. Rates below are 2× base for every model carrying cache rates.
export const MODEL_PRICING: Record<string, { input: number; output: number; cacheRead?: number; cacheWrite5m?: number; cacheWrite1h?: number }> = {
  'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00,  cacheRead: 0.10, cacheWrite5m: 1.25, cacheWrite1h: 2.00 },
  'claude-haiku-4-5':          { input: 1.00, output: 5.00,  cacheRead: 0.10, cacheWrite5m: 1.25, cacheWrite1h: 2.00 },
  'claude-sonnet-4-6':         { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite5m: 3.75, cacheWrite1h: 6.00 },
  'claude-sonnet-4-6-20251022':{ input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite5m: 3.75, cacheWrite1h: 6.00 },
  // LORAMER_LORA_OPUS5_MIGRATION_V1 — Opus 5 is the incoming chat/eval floor. Rates VERIFIED 2026-07-24 against
  // Anthropic's live models overview ($5 in / $25 out) + the universal cache structure (read 0.1x → $0.50; 5m-write
  // 1.25x → $6.25). This entry MUST exist before the model flips, or an unmapped model logs $0 and cost lies (banked law).
  'claude-opus-5':             { input: 5.00, output: 25.00, cacheRead: 0.50, cacheWrite5m: 6.25, cacheWrite1h: 10.00 },
  'claude-opus-4-8':           { input: 5.00, output: 25.00, cacheRead: 0.50, cacheWrite5m: 6.25, cacheWrite1h: 10.00 }, // verified 2026-07-14
  // 4.6/4.7 were stale at $15/$75; current published is $5/$25 (verified 2026-07-24, live overview) — corrected + cache
  // rates added so a fallback to either never mis-prices. Both are currently unused (spend log shows no rows). (OPUS5_MIGRATION_V1)
  'claude-opus-4-7':           { input: 5.00, output: 25.00, cacheRead: 0.50, cacheWrite5m: 6.25, cacheWrite1h: 10.00 },
  'claude-opus-4-6':           { input: 5.00, output: 25.00, cacheRead: 0.50, cacheWrite5m: 6.25, cacheWrite1h: 10.00 },
}

// Exported so the eval/pricing tooling can compute cost without a DB round-trip.
// ⛔ LORAMER_CHAT_HISTORY_CACHE_V1 — the 5th parameter CHANGED MEANING, and the change direction is the
// safe one. It used to be "all cache-creation tokens, priced at 5m"; it is now "5m-TTL creation tokens",
// with 1h-TTL creation in the new 6th parameter. A caller not yet passing the split (there are none in
// src/ — both were updated in this commit) would price its creation tokens at the CHEAPER 5m rate, which
// is exactly the under-pricing the old code already had — never a new over-charge.
export function computeCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheCreation5mTokens = 0,
  cacheCreation1hTokens = 0,
): number {
  const rates = MODEL_PRICING[model]
  if (!rates) {
    // Unknown model — log it but don't crash. NEVER silently price at $0 without a warning.
    console.warn('[spend-logger] unknown model pricing:', model)
    return 0
  }
  let cost = (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output
  // Prompt-cache tokens: price them when the model carries cache rates. If cache tokens are present but the model
  // has no cache rates, keep the prior input/output-only behavior and WARN — never silently price cache at $0.
  if (cacheReadTokens || cacheCreation5mTokens || cacheCreation1hTokens) {
    if (rates.cacheRead != null && rates.cacheWrite5m != null) {
      cost += (cacheReadTokens / 1_000_000) * rates.cacheRead + (cacheCreation5mTokens / 1_000_000) * rates.cacheWrite5m
      // ⛔ 1h writes cost 2× base (vendor-verified). A model with cache rates but no 1h rate prices 1h
      // writes at the 5m rate WITH A WARNING — visible, never silent, and never $0.
      if (cacheCreation1hTokens) {
        if (rates.cacheWrite1h != null) {
          cost += (cacheCreation1hTokens / 1_000_000) * rates.cacheWrite1h
        } else {
          console.warn(`[spend-logger] no 1h cache-write rate for ${model}; ${cacheCreation1hTokens} 1h-write tokens priced at the 5m rate (under-priced)`)
          cost += (cacheCreation1hTokens / 1_000_000) * rates.cacheWrite5m
        }
      }
    } else {
      console.warn(`[spend-logger] no cache rates for ${model}; cache tokens (read=${cacheReadTokens}, create5m=${cacheCreation5mTokens}, create1h=${cacheCreation1hTokens}) priced at $0 (input/output only)`)
    }
  }
  return cost
}

export type SpendLogInput = {
  userEmail: string
  clientId?: string | null
  endpoint: string                  // 'insight' | 'ch' | other
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number          // LORAMER_LORA_MODEL_PRICING_V1 — prompt-cache read tokens (priced when the model has cache rates)
  cacheCreationTokens?: number      // prompt-cache 5m-TTL write tokens (LORAMER_CHAT_HISTORY_CACHE_V1 — was "all writes")
  cacheCreation1hTokens?: number    // prompt-cache 1h-TTL write tokens, priced at 2× base — the column stores the SUM
  // LORAMER_SPEND_LOG_DURATION_AND_CACHE_V1 — wall-clock ms for the model call. Optional so every existing
  // caller (insight, evals) keeps compiling; omitted ⇒ the column stays NULL, which reads as "not recorded"
  // rather than "took no time". Never pass 0 to mean unknown.
  durationMs?: number
}

export async function logSpend(input: SpendLogInput): Promise<void> {
  try {
    const cost = computeCostUsd(input.model, input.inputTokens, input.outputTokens, input.cacheReadTokens || 0, input.cacheCreationTokens || 0, input.cacheCreation1hTokens || 0)
    const { error } = await supabaseAdmin.from('anthropic_spend_log').insert({
      user_email: input.userEmail,
      client_id: input.clientId || null,
      endpoint: input.endpoint,
      model: input.model,
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
      cost_usd: cost,
      // LORAMER_SPEND_LOG_DURATION_AND_CACHE_V1 — migration 058. The cache figures were already ACCEPTED and
      // priced by computeCostUsd above and then thrown away; they are now persisted so the split survives the
      // 1-hour Vercel log expiry. ⛔ `?? null` NOT `|| 0` — a real 0 (genuine cache miss) and an absent value
      // must stay distinguishable, or every percentile over this table silently averages in fake zeros.
      duration_ms: input.durationMs ?? null,
      cache_read_tokens: input.cacheReadTokens ?? null,
      // ⛔ THE COLUMN KEEPS ITS MEANING: TOTAL creation tokens, both TTLs. The split exists for PRICING
      // (cost_usd above is computed from it); persisting it would be a schema change to answer a question
      // cost_usd now answers. `?? null` preserved — absent stays distinguishable from a real 0.
      cache_creation_tokens: (input.cacheCreationTokens != null || input.cacheCreation1hTokens != null)
        ? (input.cacheCreationTokens ?? 0) + (input.cacheCreation1hTokens ?? 0)
        : null,
    })
    if (error) console.error('[spend-logger] insert failed:', error)
  } catch (e) {
    console.error('[spend-logger] threw:', e)
  }
}
