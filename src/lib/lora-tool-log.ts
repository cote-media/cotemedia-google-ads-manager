// LORAMER_LORA_TOOL_DECISION_LOG_V1 — the L2-RETRIEVAL instrument. Mirrors src/lib/spend-logger.ts logSpend EXACTLY
// in shape + failure posture: async, wrapped in try/catch, swallows ALL errors (console.error, never throws), and is
// called FIRE-AND-FORGET (not awaited) so it can never block or break a chat turn. Records, per chat tool-loop turn,
// whether Lora called a tool for a question and which one — measurement only; it changes NOTHING about the loop.
import { supabaseAdmin } from '@/lib/supabase'
import { classifyFamily } from '@/lib/lora-family-classify' // LORAMER_LORA_TOOL_DECISION_LOG_V1 — classify at WRITE time

export type ToolDecisionInput = {
  clientId?: string | null
  questionText: string           // TRANSIENT — used only to classify the family; NEVER stored (chat content lives in client_conversations)
  toolCalled: boolean
  toolName?: string | null
  turnIndex: number
  model: string
}

export async function logToolDecision(input: ToolDecisionInput): Promise<void> {
  try {
    // best-effort org resolution — this runs on the FIRE-AND-FORGET path (never awaited by the response), so the
    // extra read adds NO latency to the answer. A miss/failure just leaves org_id null; the row still lands.
    let orgId: string | null = null
    if (input.clientId) {
      try {
        const { data } = await supabaseAdmin.from('clients').select('org_id').eq('id', input.clientId).maybeSingle()
        orgId = (data?.org_id as string | undefined) || null
      } catch { /* org lookup is best-effort; never block the log */ }
    }
    // Classify the question into a breakdown FAMILY at write time and store ONLY the label — never the raw question
    // (chat content already lives line-for-line in client_conversations; a second copy would be duplication).
    const { family } = classifyFamily(input.questionText || '')
    const { error } = await supabaseAdmin.from('lora_tool_decisions').insert({
      org_id: orgId,
      client_id: input.clientId || null,
      family,
      tool_called: input.toolCalled,
      tool_name: input.toolName || null,
      turn_index: input.turnIndex,
      model: input.model,
    })
    if (error) console.error('[lora-tool-log] insert failed:', error)
  } catch (e) {
    console.error('[lora-tool-log] threw:', e)
  }
}
