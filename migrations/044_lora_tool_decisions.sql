-- LORAMER_LORA_TOOL_DECISION_LOG_V1
-- Migration 044: NEW table lora_tool_decisions — the L2-retrieval instrument. ADDITIVE; alters NOTHING existing.
-- Records, per chat tool-loop turn, whether Lora called a tool and which one, PLUS the classified breakdown FAMILY
-- the question was about (classified at WRITE time). Written fire-and-forget by src/lib/lora-tool-log.ts (mirrors
-- logSpend: swallows all errors, never blocks the response). NO foreign keys — the logger must NEVER fail a turn.
--
-- WHY family, NOT question_text: the chat content already lives line-for-line in client_conversations (role/content
-- per turn); storing the question here would DUPLICATE it. This table stores only the DECISION + its family label,
-- which is all the L2 skip-rate needs.
-- CONVERSATION REFERENCE — DELIBERATELY OMITTED: client_conversations has NO conversation/thread id (its PK is a
-- per-MESSAGE bigint `id`; grouping is only the tuple (client_id, user_email, surface, created_at)). There is no
-- clean key to reference, so we skip it rather than invent one. Correlation, if ever needed, is temporal on
-- (client_id, created_at, surface) — not a stable FK.
CREATE TABLE IF NOT EXISTS lora_tool_decisions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid,
  client_id     uuid,
  family        text,        -- classified breakdown family (write-time), or 'unknown'; never the raw question text
  tool_called   boolean     NOT NULL,
  tool_name     text,
  turn_index    integer     NOT NULL,
  model         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lora_tool_decisions_created_at     ON lora_tool_decisions (created_at);
CREATE INDEX IF NOT EXISTS idx_lora_tool_decisions_client_created ON lora_tool_decisions (client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lora_tool_decisions_family_created ON lora_tool_decisions (family, created_at);

-- REVERT PATH (no staging DB — this is the revert): DROP TABLE IF EXISTS lora_tool_decisions;
