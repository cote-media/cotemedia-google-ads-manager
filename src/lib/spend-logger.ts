// LORAMER_SPEND_LOG_V1
// Fire-and-forget Anthropic spend logger. Errors are swallowed so
// logging never breaks the API response path. Cost is computed from
// MODEL_PRICING (per-million-token rates).
import { supabaseAdmin } from '@/lib/supabase'

// LORAMER_LORA_MODEL_PRICING_V1 — Anthropic pricing, $ per MILLION tokens (input / output / cache). Update here
// when Anthropic changes rates. Cache rates follow Anthropic's documented structure — cache READ = 0.1x base
// input; 5-min cache WRITE = 1.25x base input — verified 2026-07-14 against Opus 4.8's published $0.50 read /
// $6.25 5m-write on $5 input.
export const MODEL_PRICING: Record<string, { input: number; output: number; cacheRead?: number; cacheWrite5m?: number }> = {
  'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00,  cacheRead: 0.10, cacheWrite5m: 1.25 },
  'claude-haiku-4-5':          { input: 1.00, output: 5.00,  cacheRead: 0.10, cacheWrite5m: 1.25 },
  'claude-sonnet-4-6':         { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite5m: 3.75 },
  'claude-sonnet-4-6-20251022':{ input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite5m: 3.75 },
  'claude-opus-4-8':           { input: 5.00, output: 25.00, cacheRead: 0.50, cacheWrite5m: 6.25 }, // verified 2026-07-14
  'claude-opus-4-6':           { input: 15.00, output: 75.00 }, // legacy/unused — no cache rates (falls back + warns if cache tokens seen)
  'claude-opus-4-7':           { input: 15.00, output: 75.00 }, // legacy/unused — no cache rates (falls back + warns if cache tokens seen)
}

// Exported so the eval/pricing tooling can compute cost without a DB round-trip.
export function computeCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheCreationTokens = 0,
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
  if (cacheReadTokens || cacheCreationTokens) {
    if (rates.cacheRead != null && rates.cacheWrite5m != null) {
      cost += (cacheReadTokens / 1_000_000) * rates.cacheRead + (cacheCreationTokens / 1_000_000) * rates.cacheWrite5m
    } else {
      console.warn(`[spend-logger] no cache rates for ${model}; cache tokens (read=${cacheReadTokens}, create=${cacheCreationTokens}) priced at $0 (input/output only)`)
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
  cacheCreationTokens?: number      // prompt-cache 5-min write tokens
}

export async function logSpend(input: SpendLogInput): Promise<void> {
  try {
    const cost = computeCostUsd(input.model, input.inputTokens, input.outputTokens, input.cacheReadTokens || 0, input.cacheCreationTokens || 0)
    const { error } = await supabaseAdmin.from('anthropic_spend_log').insert({
      user_email: input.userEmail,
      client_id: input.clientId || null,
      endpoint: input.endpoint,
      model: input.model,
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
      cost_usd: cost,
    })
    if (error) console.error('[spend-logger] insert failed:', error)
  } catch (e) {
    console.error('[spend-logger] threw:', e)
  }
}
