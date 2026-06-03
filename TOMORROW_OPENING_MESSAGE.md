# Russ's opening message for the next Claude chat
# Copy everything between the lines below

---

I'm Russell Côté, founder of Cote Media and the sole non-developer building LoraMer — a business intelligence platform for marketing agencies and business owners. You're picking up an active multi-week build with hundreds of shipped commits. I do NOT touch code — I paste your terminal commands and your Claude Code instructions, and I run Supabase/Vercel in the browser. Every command you give me must be complete and paste-ready with the destination labeled (macOS Terminal / Cursor Agents window / Supabase SQL Editor / Vercel dashboard). Never a placeholder I have to hunt down.

Before you do ANYTHING else, open LORAMER_HANDOFF.md and execute the MANDATORY READING GATE at the very top — every step, in order. That means: read every project document, sweep the project knowledge base with project_knowledge_search, have me run a Claude Code investigate-only sweep of the relevant code + git, and read the prior chats with conversation_search / recent_chats — and ONLY THEN open CONTINUE_HERE.md. I'm dead serious about this: last time a Claude skipped the reading and rebuilt a design we already had a doc for. Don't. If a tool can read it, read it. "I couldn't see it" is not an answer when project_knowledge_search, conversation_search, recent_chats, and Claude Code exist.

Where we are right now:
- Historical Data Engine Phase 0a is COMPLETE — nightly cron forward-captures daily metrics for all five platforms (Shopify, Meta, Google, WooCommerce, GA) into metrics_daily, all verified reconciling.
- Phase 0b backfill is DONE and proven on one client: the Google account-level backfill route (/api/backfill/google) pulled My Vacation Network's full real history — 658 daily rows back to 2024-05-17, $76.5k spend — in one clean run after we fixed a cross-request cursor race (V2, single-invocation internal loop).
- Both the Google Ads developer token and CRON_SECRET have been rotated.
- The ONLY thing left in Phase 0b is the query_metrics tool — the basic query layer that proves multi-period comparison ("last 7 days vs 6 / 12 / 18 months ago") on the data we now have. That's your first task. CONTINUE_HERE.md has the detail.

After the query tool proves out on My Vacation Network, the next phase (Phase 1) is generalizing backfill + the query layer across the other platforms and clients — and replacing the secret-pasting backfill trigger with a real in-app button, because the current curl flow is bad for a non-coder.

Standing rules: RIGHT > FAST — take the 30 minutes, never ship a guess; when unsure about an anchor or a fact, have me run a grep/sed/cat or a Claude Code read first. Think as long as you need; keep your OUTPUT terse — no recaps, no "here's what I'll do," no apologies, just the next labeled step.

Don't fuck it up.

---
