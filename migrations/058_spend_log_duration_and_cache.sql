-- LORAMER_SPEND_LOG_DURATION_AND_CACHE_V1 — MAKE THE LATENCY AND CACHE QUESTIONS ANSWERABLE AT ALL.
--
-- ⛔ WHAT THIS FIXES, AND IT IS AN ABSENCE RATHER THAN A BUG. `anthropic_spend_log` holds
-- input_tokens, output_tokens and cost_usd — and nothing else. On 2026-08-06 two latency questions were
-- asked of this table and BOTH were unanswerable: "how long did that turn take" and "what was the cache
-- split". The duration existed only as a wall-clock difference between two rows in a different table, and
-- the cache split existed only in a Vercel console line that expires. `logSpend` has ACCEPTED
-- cacheReadTokens and cacheCreationTokens since LORAMER_LORA_MODEL_PRICING_V1 — it prices with them and
-- then discards them. This adds the three columns so the next latency question is a query, not an
-- archaeology exercise.
--
-- ⛔ ALL THREE ARE NULLABLE WITH NO DEFAULT, DELIBERATELY. A default of 0 would make 138 rows of existing
-- history indistinguishable from a turn that genuinely used no cache and took no time. NULL means "not
-- recorded"; 0 means "recorded as zero". Every percentile and average below must therefore filter on
-- `is not null` rather than trusting a backfilled zero — the honest shape, and the one that keeps the
-- pre-2026-08-06 rows readable as what they are.
--
-- REVERT PATH: `alter table public.anthropic_spend_log drop column …` for each. Additive, nullable, no
-- backfill, no writer depends on them existing before this runs (the logger sends the keys either way and
-- PostgREST ignores unknown ones only if they exist — so apply this BEFORE deploying the logger change).

alter table public.anthropic_spend_log
  add column if not exists duration_ms integer,
  add column if not exists cache_read_tokens integer,
  add column if not exists cache_creation_tokens integer;

comment on column public.anthropic_spend_log.duration_ms is
  'LORAMER_SPEND_LOG_DURATION_AND_CACHE_V1 — wall-clock ms for the whole model call, measured in the route from just before the first model request to just after the last. NULL on rows written before 2026-08-06; NULL is NOT zero.';
comment on column public.anthropic_spend_log.cache_read_tokens is
  'Prompt-cache read tokens (~0.1x input price). NULL = not recorded, 0 = recorded as a genuine cache miss.';
comment on column public.anthropic_spend_log.cache_creation_tokens is
  'Prompt-cache write tokens (1.25x at 5m TTL, 2x at 1h). NULL = not recorded, 0 = nothing written.';

-- The three questions this table could not answer before. Indexed on the column every one of them filters.
create index if not exists anthropic_spend_log_endpoint_created_idx
  on public.anthropic_spend_log (endpoint, created_at desc);
