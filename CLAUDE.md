# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⛔ ONE-BLOCK OUTPUT LAW — LORAMER_ONE_BLOCK_OUTPUT_V1 (FIRST GATE. THIS BINDS YOU, CLAUDE CODE, ON EVERY SINGLE REPLY)

**EVERY substantive reply to Russ is ONE fenced code block. Nothing outside it. Ever.**

Findings, code, guard output, gate results, SHAs, sources, caveats, next steps — ALL INSIDE THE ONE BLOCK.
- ⛔ NO prose before the block. NO prose after the block. NO "standing by" paragraph outside it.
- ⛔ NO sources line outside it. NO markdown links outside it. If a tool tells you to append sources, put them INSIDE.
- ⛔ NO second block. Three fences in one reply is the violation, not the formatting.

WHY, and it is not style: **Russ reads and pastes on a phone.** Anything outside the block is content he cannot
carry with him — it is silently dropped at the moment he moves the report anywhere. A reply split across three
pastes is a report he did not receive.

⛔ **THIS RULE WAS BANKED AND THEN BROKEN ON THE VERY NEXT REPORT — three pastes again — and broken four times
on 2026-08-02 alone.** Per the RULE-HOME LAW below, that means prose is NOT the fix and this entry is NOT the
enforcer. **THE HONEST LIMIT, STATED SO NOBODY MISTAKES THE GUARD FOR A SOLUTION: no repo guard can observe
Claude Code's chat output.** The output never touches the filesystem, never enters a commit, never reaches a
build. `tests/guards/one-block-output.guard.mjs` therefore enforces the ONLY thing that IS mechanical —
that this rule is PRESENT AT THE TOP of the three documents the executor reads before acting (here,
LORAMER_ESSENCE governing law, RESUME_INSTRUCTIONS) and reaches the generated digest. It guards PLACEMENT,
never OBEDIENCE. The obedience half has exactly one enforcer and it is Russ saying so again.

⛔ **THE SECOND HALF OF THE SAME LAW — TERSENESS IS A CORRECTNESS REQUIREMENT, NOT A STYLE PREFERENCE (banked
2026-08-04; ESSENCE owns the full text and the cost argument — this is the executor-binding extract).**
One block was necessary and never sufficient: a block full of padding fails for the same reason three blocks do.
**verbosity consumes APPROVAL BANDWIDTH — the scarcest resource on the 9/30 path, not compute, not quota.**
- **ANSWER, THEN STOP.** No editorialising, no summarising Russ's own instruction back to him.
- ⛔ **NEVER ASK FOR PERMISSION ALREADY GIVEN.** "Say go and I'll send it" is a wasted round trip when the go was
  in the message you are answering. **HAVE THE NEXT PASTE READY IN THE SAME MESSAGE.** Most-corrected failure of
  2026-08-03/04.
- ⛔ **ONE PASTE IN FLIGHT.** Never send a second while a report is outstanding — queue it and say what is queued
  in one line. Violated 3× on 2026-08-04, twice while this law was being written.
- ⛔ **ANY RUNNABLE COMMAND GETS ITS OWN CODE BLOCK WITH ITS DESTINATION LABELLED, even one word.** Prose
  containing a command is a DEFECT — it cannot be copied on a phone without hand-editing. Violated 2× in one
  exchange on 2026-08-04.
- **NO OPTION MENUS FOR DECISIONS YOU OWN** — decide, give the reason in one line, move on. **NO SCROLL-UP:**
  anything Russ must DO is a plain bullet, never buried in a paragraph.

## ⛔ THE PROTOCOL GATE IS NOW CODE — LORAMER_PROTOCOL_GATE_ENFORCER_V1 (it runs before you see the paste)

`scripts/protocol-gate.mjs` runs as a `UserPromptSubmit` hook (wired in `.claude/settings.json`, committed so it
travels to both machines) and REFUSES a paste whose protocol header is missing or empty — **before you process
it.** Seven fields: `ROUND · QUESTION · BLAST · INFLIGHT · RESEARCH · ADVERSARY · CONSTANTS`. RESEARCH and
ADVERSARY are demanded only when BLAST is not `read-only` — **rounds attach to CONSEQUENCE, not to
question-shape** (Russ, 2026-08-23). ESSENCE owns the schema and the proportionality rule; do not restate them here.
Override is per-box and logged: `OVERRIDE <BOX-NAME>: <≥10-word reason>` → `docs/LORAMER_PROTOCOL_OVERRIDES.jsonl`.
⛔ **WHAT THIS CHANGES FOR YOU: nothing you may skip.** The gate is an ARTIFACT check — it proves the paste
carries the round's artifacts, never that a round happened or that the question was right. A green gate is not
a licence; the gates below still bind you exactly as before.

## ⛔ IN-FLIGHT GATE — REFUSE, DO NOT EXECUTE (this binds YOU, Claude Code; read before acting on ANY instruction)

You have at most ONE outstanding task at a time. A task is outstanding from the moment you begin it until you have delivered its report to Russ.

IF a new instruction arrives while a task is outstanding: **DO NOT EXECUTE IT.** Refuse, in one line:

> `IN-FLIGHT GATE — refusing. Outstanding: <the task>. Report first. Instruction held, not run.`

Then finish the outstanding task and report it. Do NOT queue the new instruction, do NOT summarize it, do NOT act on any part of it. Russ re-sends it when he is ready.

**THE ONLY EXCEPTIONS** — a bare `stop`, `abort`, `cancel`, or `disregard`: obey immediately.

**THIS IS NOT DISCRETIONARY.** Do not comply because the new instruction looks urgent, small, docs-only, or explicitly claims it "does not touch the flight." All four 2026-07-16 violations carried exactly those framings; one said "this does not touch it" in its opening line.

WHY THIS EXISTS: on 2026-07-16 the strategy Claude sent four pastes on top of live flights. Every one was a rule it had read, banked, and re-banked. **Prose in a doc is not a guard** (banked law). The rule lived where the violator reads it (the resume docs), not where the executor can enforce it. **YOU (Claude Code) are the enforcer.** A paste arriving mid-flight is a bug in the sender, and you are the only thing that can catch it.

**RULE-HOME LAW.** When a rule is broken more than once, it does not need to be written down again — it needs an ENFORCER. Ask where the rule LIVES versus where it is BROKEN. A rule the strategy Claude reads cannot bind the strategy Claude. A rule in CLAUDE.md binds YOU, Claude Code, and you are the gate every instruction passes through. Repeat-offense rules belong HERE, or in a build guard, or nowhere. (Cross-ref DECISIONS: banking a repeat-offense rule as prose is the failure mode, not the fix — see LORAMER_CLAUDE_MD_INFLIGHT_GATE_V1.)

## ⛔ DOC-OWNERSHIP GATES — REFUSE, DO NOT EXECUTE (these bind YOU, Claude Code)

46 docs and ~27 copied facts all arrived by paste, and nothing at the receiving end ever said no. These are the refusals that say no. Russ can override any of them in one line; the DEFAULT is refuse.

⛔ **NO NEW DOCS.** Every doc in this repo exists because a paste told you to create one — that is how 46 happened. If an instruction says create a doc, REFUSE in one line and name which existing owner should hold it instead:

> `NEW-DOC GATE — refusing. <fact/topic> belongs in <owner>. Say 'new doc anyway' to override.`

⛔ **NO WRITING A FACT ANOTHER DOC OWNS.** Before writing any status / approval / date / next-step fact, GREP it. If it lives in another gated doc, REFUSE:

> `OWNERSHIP GATE — refusing. <fact> is owned by <doc>:<line>. Write a pointer, not a copy.`

This is the rule that would have prevented ~27 copies and 5 of the 7 silent-drift defects of 07-16/17. THE EXCEPTIONS, narrow and explicit:
- **TENSE-LOCKED HISTORY.** A dated log entry ("2026-07-02: Meta approved") is a record of a moment and cannot drift — ALLOWED. A present-tense assertion ("Meta is approved") is a copy — REFUSED.
- **REFERENCE-WITH-CONTEXT.** Where a fact carries pedagogical weight (ESSENCE's blast-radius gate teaching WHY the reviewer-path framing died), keep the teaching, point the value. Judgment, stated on the face of it.

⛔ **NO BANKING A REPEAT-OFFENSE RULE AS PROSE.** If an instruction says bank a rule that has been broken before, REFUSE:

> `RULE-HOME GATE — refusing. <rule> was banked <N> times and broken anyway. It needs an enforcer, not an entry. Where does it execute?`

Precedent: "a green check answers a narrower question than the reader assumes" was banked FOUR times in two days and prevented nothing. Banking a lesson is the cheapest possible response to a structural problem and it FEELS like progress. Prose in a doc is not a guard (banked law).

### OWNERSHIP MAP — who owns which fact (you cannot enforce the gates above without this)

- **LORAMER_ESSENCE.md** — the governing law + product philosophy. NOT status.
- **LORAMER_HANDOFF.md** — how we work: session gate, cadence, standing rules, lessons.
- **CONTINUE_HERE.md** — session NARRATIVE + the authored next-step opener. NOT status.
- **LORAMER_DECISIONS.md** — settled decisions + ALL external status (approvals, gates, dates). THE owner of every derived status claim.
- **LORAMER_QUEUE_OF_RECORD.md** — what is open. The owner of open/closed per item.
- **docs/LORAMER_BREAKDOWN_REGISTRY.md** — per-dimension truth; code GENERATES from it. The model doc.
- **RESUME_INSTRUCTIONS.md** — the canonical resume wording. Single-source by its own declaration.
- **docs/LORAMER_ASSET_LAYER_SCOPE_V1.md** — the T3b scope, frozen.
- **docs/LORAMER_SECURITY_POSTURE.md** — security system of record. Does NOT own approval dates.

THE LIMIT, stated plainly: these are refusals by a model reading instructions — STRONGER than prose the strategy Claude reads (you re-read this every session; you are the last thing between an instruction and the repo), WEAKER than a build guard (which cannot be talked out of it). The real, un-talk-out-of-able version is a script (`check-doc-ownership.mjs`: grep owned facts, fail the build) — QUEUED as ★DOC-OWNERSHIP-GUARD, NOT built now.

## ⛔ THE SEAMS GATE — LORAMER_SEAMS_PROOF_V1 (this binds YOU, Claude Code, on every rebuild-adjacent flight)

**When a flight changes a thing OTHER CODE ALREADY READS OR WRITES, Gate-A is not done until you have NAMED every existing reader and writer of that thing and PROVEN each one still sees it correctly. In the same gate. Not the next flight.**

Before you write the Gate-A plan, answer in one line each: *what else reads this? what else writes this? which of them did I just prove?* If the answer to the third is "none", the plan is incomplete — go back.

WHY, and it is not a hypothetical: **all four defects found in the 2026-08-13→16 arc were seams with the old system, and no brief had ever asked for that proof.**
- the fleet meter summed only the dead v1 ledger while the walk billed into v2 — a new writer, an old reader
- the Deploy-2 rows counter read a DISABLED PostgREST aggregate and silently yielded 0 — a new reader, an old ceiling
- both tool loops returned a preamble on exhaustion — a new cap, an unexamined exit path
- ad names were composed at one writer while another wrote blanks

⛔ **"WE FOUND IT" IS NOT THE VIRTUE. IT SHOULD NOT HAVE BROKEN.** Russ's correction, banked verbatim: finding a defect you introduced is not a win, it is the cost of not having looked at the seam. A flight that ships a new producer without walking its consumers has not finished, however green its own gate reads.

THE LIMIT, stated so nobody mistakes this for a guard: **no build check can see this.** It governs what a PLAN must contain, and plans are not in the repo. The enforcer is you, refusing your own Gate-A when the seam question is unanswered — which is exactly the posture of the IN-FLIGHT and DOC-OWNERSHIP gates above. (DECISIONS `LORAMER_SEAMS_PROOF_V1` owns the full reasoning; QUEUE ★SEAMS-GATE-HAS-NO-MECHANICAL-ENFORCER carries the unbuilt half.)

## Read these first

This is **LoraMer** — an active, multi-week, multi-hundred-commit build of a business intelligence platform for marketing agencies. The repo carries its own institutional memory; do not design or patch anything non-trivial before consulting:

1. **`LORAMER_HANDOFF.md`** — the operating manual: working relationship, discipline rules, and ~30 numbered "lessons" (failure modes that actually bit this project). If you make a FIRST-TIME class of mistake, add the lesson there before the session ends — but a rule ALREADY banked and broken AGAIN needs an ENFORCER, not another entry (see the RULE-HOME GATE / RULE-HOME LAW above).
2. **`CONTINUE_HERE.md`** — the current resume point (what shipped last session, what's next).
3. **`ROADMAP.md`** — project-by-project status; **docs move with code**: a commit that ships a feature also flips its own ROADMAP checkbox in the same commit.
4. **`docs/*.md`** — design docs for shipped/planned features. Check here before designing anything; a prior Claude once rebuilt a feature whose design doc already existed.

## Working context

- **Russ (the user) does not touch code.** Claude Code edits/commits/pushes/migrates DIRECTLY (via the Supabase + Vercel MCP tools); Russ pastes back results and is the human verification gate. Deliverables to Russ = ONE fenced copy-paste block, with the destination labeled (Supabase SQL Editor / Vercel dashboard) only when a manual step is genuinely needed. Never "edit line N of file X". Never multi-line code pastes through the terminal (heredocs silently drop characters — Lesson 29); deliver code as files.
- **RIGHT > FAST.** Verify against the actual current file before patching. Think as long as needed; keep output terse — no recaps, no apologies, just the next step.
- **Two machines, one repo:** iMac `~/Downloads/cotemedia-ads-manager/`, MacBook Air (user `russcote2`) `~/Downloads/cotemedia-google-ads-manager/`. Every session starts with `git pull`; GitHub `main` is the source of truth.
- **Every push to `main` auto-deploys to Vercel.** A push that breaks the Vercel build is a serious failure. Run `npm run build` locally before pushing (the full-build machine is the iMac — see the **HANDOFF MACHINES & ENV STATE** block for the authoritative machine/env story). `npx tsc --noEmit` is NOT a full build — it misses webpack syntax errors and mangled string literals. **Claude Code MUST also run `npm run check:data` before ANY push to origin `main`** (the account-row / data-integrity gate — deliberately NOT in `npm run guard`/`build`, so it never runs on Vercel) **and REPORT its result in the push report; a push report without the check:data result is INCOMPLETE.** There is no git pre-push hook (deliberate — DECISIONS: NO GIT PRE-PUSH HOOK), so this is a manual step the executor owns until QUEUE ★SCHEDULED-DATA-CHECK lands.
- **Commit convention:** `LORAMER_<FEATURE>_V1: description`. The same marker appears as a code comment at the change site (used for idempotency/traceability).
- **Platform extensibility:** `(client, platform, account)` is the universal key for every data source. New platforms (e.g., Triple Whale, Klaviyo) are added as a backfill adapter + platform-registry entry + a new `metrics_daily` platform value — never a schema change or core rewrite. Per-platform behavior lives in adapters/registry, never scattered conditionals.

## Commands

```bash
npm run dev        # local dev server (port owned by next.config / the dev script, not restated here)
npm run build      # full Next.js build — the pre-push gate (requires .env.local)
npm run lint       # next lint
npm run mcp        # standalone MCP server (mcp-server.js) for Claude Desktop
npx tsc --noEmit   # fast type check (NOT a substitute for npm run build)
npm run evals      # Lora accuracy eval — 28 golden questions through the REAL /api/chat (needs a local dev server + the harness env; see tests/lora-evals/run-evals.mjs header)
```

There is no unit-test suite. Verification = local build + production verification (headless `curl` against routes, or live Ask Claude read-back tests). **`npm run evals` is the one accuracy check for LORA** (28 hand-verified golden questions scored against `/api/chat`'s real answer): run it before shipping ANY change that touches Lora's prompt, tools, context builder (`build-claude-context.ts`), or the query layer (`metrics-query.ts` / `claude-tools.ts` / `query-completeness.ts` / the breakdown registry). It is **NOT in the deploy path** and never runs on Vercel — it calls Opus (~$4–5 per run) and needs a running dev server with `NEXTAUTH_URL==BASE`, so it is a manual pre-ship gate, same posture as `check:data` (DB/paid work kept out of `guard`/`build`). Report its scorecard in the ship report the same way check:data is reported. (The determinism rung on top of it is DECISIONS LORAMER_L4_DETERMINISM_LAW_V1 + QUEUE ★LORA-DETERMINISM-HARNESS — not built.)

## Architecture

Next.js 14 App Router + TypeScript + Tailwind. Supabase (Postgres) for storage. NextAuth (Google OAuth) for auth. Anthropic API powers the insight banner (`/api/insight`) and chat (`/api/chat`, 16k max_tokens, prompt caching via `cache_control` on the prefix block). **Model IDs are OWNED BY THE CODE — never named here** (a named model drifts: this line asserted a stale `claude-sonnet-4-6` for chat while the code ran the Opus floor — DECISIONS LORAMER_CLAUDE_MD_MODEL_POINTER_V1). Chat model = `LORA_CHAT_MODEL`, defaulted with the Opus floor in `src/app/api/chat/route.ts`; insight-banner model(s) live in `src/app/api/insight/route.ts` — read the code for the current value. Hosted on Vercel.

### The intelligence layer (the core of the product)

Per-platform fetchers in `src/lib/intelligence/` (`google-intelligence.ts`, `meta-intelligence.ts`, `shopify-intelligence.ts`, `ga-intelligence.ts`, `woocommerce-intelligence.ts`) pull live data → `build-claude-context.ts` assembles Claude's system prompt as `{ prefix, suffix }` (prefix is cached). `/api/intelligence` is the master endpoint; results are cached ~15 min in `client_context.intelligence_cache` (a deployed fix may be invisible for up to 15 min — force a cache miss with a never-used date range).

Prompt-honesty rules baked in: connected-but-empty platforms emit an explicit empty-state header (never silently dropped); grounding/constraint text lives in code comments, not in user-rendered prompt text (Lesson 11 — prompt-as-mirror).

### Historical Data Engine

- **Forward capture:** nightly cron `/api/cron/sync` writes per-day rows for all 5 platforms into the `metrics_daily` Supabase table.
- **Backfill:** shared platform-agnostic engine in `src/lib/backfill/` (`run-backfill.ts` + `adapters.ts`). Adding a platform = daily fetch + shared row builder (must write byte-identical rows to forward capture, same conflict key) + adapter registration (optional V3 hooks: `resolveContext`, `buildRows`, `floorDate`) + thin CRON GET wrapper under `/api/backfill/<platform>` + `<BackfillControl>` mount on `/clients`. Backfills run in ONE invocation with an in-memory loop — never control the loop from a DB cursor re-read across requests (Lesson 26).
- **Query layer:** `src/lib/metrics-query.ts` (`queryMetrics`) reads `metrics_daily`; exposed to Claude as the `query_metrics` tool in `src/lib/claude-tools.ts`. Two mutually exclusive modes: `baseRange`/`offsetsMonths` presets, or explicit `windows` (`{label, startDate, endDate}[]`) for arbitrary periods like "Q4 2024". Headless proving route: `/api/query-metrics`.

### Other key pieces

- `src/app/dashboard/page.tsx` — the main dashboard, the largest file in the repo and the heart of the legacy UI. ⛔ NO LINE COUNT: it read "3000+ lines" while the file held 4,208 — a count in prose is a fact with a shelf life. For diagnosis in this file, investigate-only first, then write a tight fix.
- `src/lib/date-range.ts` — `resolveDateWindow()` is the ONLY date-window resolver. Never roll per-platform date math (Lesson 19). Some legacy Google paths are still being migrated to it.
- Platform OAuth/connector routes under `src/app/api/{meta,ga,shopify,woocommerce}/`; token helpers `src/lib/{shopify,ga}-token.ts`, `src/lib/meta-ads.ts`, `src/lib/google-ads.ts`.
- `src/app/api/chat`, `/api/insight`, `/api/conversations` (unified conversation storage), `/api/memory` (per-client memory layer injected into prompts).
- `mcp-server.js` — standalone MCP server exposing Google Ads tools to Claude Desktop.
- Supabase tables: ⛔ **NOT LISTED HERE — the SCHEMA owns this.** Read `migrations/` in order, or `list_tables` via the Supabase MCP. This line enumerated NINE tables while the database held THIRTY-NINE: a map of the schema wrong by more than half, in the file the executor reads every session. SQL migrations live in `migrations/` and are run manually in the Supabase SQL Editor.

## Hard-won platform facts (do not relearn these)

- **Meta Insights API:** dimensional fields (publisher_platform, age, gender, …) go in `breakdowns=`, never `fields=` — wrong placement returns HTTP 400 that `.catch(() => [])` will silently swallow. Meta CTR is already a percentage — do not ×100. Read `effective_status`, not `status`.
- **GAQL:** there is no `LAST_90_DAYS` enum — use explicit `BETWEEN 'YYYY-MM-DD' AND 'YYYY-MM-DD'` via `resolveDateWindow`. Google Ads API (major owned by `package.json`): per-asset performance labels are UI-only; `asset_group_top_combination_view` is the API path.
- **Shopify:** revenue = NET via `currentSubtotalPriceSet`, never gross `totalPriceSet`. GraphQL Admin API version is owned by `GRAPHQL_API_VERSION` in `src/lib/intelligence/shopify-intelligence.ts` and enforced across its pin sites by `shopify-api-version-pin.guard.mjs` — ⛔ not restated here; this line read `'2025-01'` long after the pin moved, and `'2025-01'` was itself fiction because Shopify was silently serving 2025-10. REST is migrated away.
- **Shopify QUERY-COST CEILING (LORAMER_SHOPIFY_QUERY_COST_CEILING_V1, measured live 2026-07-19 — this bounds every future capture family):** a single GraphQL query may not exceed **1,000 points**, enforced **before execution** on the *requested* cost; over it, Shopify returns `MAX_COST_EXCEEDED` ("Query cost is N, which exceeds the single query max cost limit (1000)") — a hard refusal, not a throttle or a degradation. **`OrdersInRange` already runs at 651 requested / 134 actual — ~349 points of headroom.** Scalar fields cost **0** (which is why the sales_channel / city / productType / vendor / tags / status / createdAt widens were all free); a **connection costs 2 + 1 per item and MULTIPLIES through nesting** (`first × (1 + nested)`). MEASURED: adding `product { collections(first:5) }` to that query takes it to **1,036 → rejected**, and because that one call also produces base/product/variant/geo/sales_channel/discount/order_time/status/cohort rows, the field would take the ENTIRE Shopify capture down for every client. **RULE: scalars may be widened onto `OrdersInRange`; anything NESTED gets its own id-batched call** (25/batch measured at 6 requested / 1 actual), soft + split-on-failure — see `fetchProductCollections`. Shopify's own guidance for anything bigger is bulk operations, not a fatter query.
- **Silent `.catch(() => [])` is the house pathology** — instrument with `console.error` before concluding data is unavailable. Vercel free-tier logs expire in 1 hour; the surviving diagnostic is temporarily surfacing raw HTTP status/body into Claude's prompt (always with a planned cleanup patch).
- localStorage keys use the legacy `advar-` prefix. Platform type union is `'google' | 'meta' | 'combined'` (no Shopify/Woo member). JSX child comments must be `{/* */}` — `/* */` renders as visible text and tsc won't catch it.
