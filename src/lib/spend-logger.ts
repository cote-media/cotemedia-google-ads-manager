// LORAMER_SPEND_LOG_V1
// Fire-and-forget Anthropic spend logger. Errors are swallowed so
// logging never breaks the API response path. Cost is computed from
// MODEL_PRICING (per-million-token rates).
import { supabaseAdmin } from '@/lib/supabase'

// Anthropic pricing as of May 2026, $ per million tokens.
// Update here when Anthropic changes rates.
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00 },
  'claude-haiku-4-5':          { input: 1.00, output: 5.00 },
  'claude-sonnet-4-6':         { input: 3.00, output: 15.00 },
  'claude-sonnet-4-6-20251022':{ input: 3.00, output: 15.00 },
  'claude-opus-4-6':           { input: 15.00, output: 75.00 },
  'claude-opus-4-7':           { input: 15.00, output: 75.00 },
}

function computeCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const rates = MODEL_PRICING[model]
  if (!rates) {
    // Unknown model — log it but don't crash. We can fix pricing later.
    console.warn('[spend-logger] unknown model pricing:', model)
    return 0
  }
  return (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output
}

export type SpendLogInput = {
  userEmail: string
  clientId?: string | null
  endpoint: string                  // 'insight' | 'ch' | other
  model: string
  inputTokens: number
  outputTokens: number
}

export async function logSpend(input: SpendLogInput): Promise<void> {
  try {
    const cost = computeCostUsd(input.model, input.inputTokens, input.outputTokens)
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
