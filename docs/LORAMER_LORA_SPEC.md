# LORAMER_LORA_SPEC.md — Lora's GOVERNING LAW
<!-- LORAMER_LORA_SPEC_V1 -->

> ⛔ GOVERNING LAW. Every requirement below is **[LAW]** — a must-be, not a nice-to-have. This is the spec
> Lora is built and gated against; the point-in-time status of the codebase against it lives in
> `docs/LORAMER_LORA_AUDIT_2026-07-14.md`, and the ranked build items in `LORAMER_QUEUE_OF_RECORD.md`.

## STATE OF PLAY (2026-07-15) — READ FIRST
- **WHERE WE ARE:** the accuracy gate CLEARS at 28/28 (100%), zero 3-pass flips, instrument proven, on `claude-opus-4-8` (a PINNED SNAPSHOT — weights fixed per ID; serving infra can still change; every ID has a retirement schedule). Journey: fictional 74.1% → honest 23/27 → 28/28. Shipped this session: A6 index-match, B1 canonical settle, B2 canonical+bySource, coverage.ts, E3 XLSX + USE-the-doc, D2 objective-rule bound, readiness loose-index-scan, the LLM-judge, the harness config guard.
- **THE HONEST BOUND:** 28/28 is 28 HAND-WRITTEN questions. Industry practice is 200–500 cases built from REAL PRODUCTION FAILURES. The gate is real; the drill set is THIN. It proves Lora is right about what WE THOUGHT TO ASK — not that she is right about everything.
- **WHERE WE'RE GOING:** the gate only compounds when real failures become cases. That requires the SESSION LAYER (one-continuous-mind) + CORRECTION HARVESTING + the THREE-TIER BRAIN (Client → Agency → LoraMer). NONE are built. Every day of the cohort without them is memory and eval cases you never get back ("lossy every day delayed"). The consent flag for cross-customer learning must exist BEFORE the logging, not after: you cannot retroactively consent someone's data into a corpus.
- **THE MOAT (Russ's framing, banked):** the model is rented and identical for everyone. The edge is what we KEEP — every platform captured at full grain from the day you connect, multi-source provenance explaining WHY numbers differ, and an accumulated brain. A competitor can rent the same model tomorrow; they cannot rent your history.
- **THE METHOD THAT WORKED, in one line:** push truth into CODE, leave only judgment to the PROMPT. Every fix that stuck did this; every fix that failed asked the model to resolve an ambiguity that lived in the data.
- **KNOWN-HONEST GAPS on live surfaces:** the N/A path is unbuilt, so the completeness meter can never reach 100% for a client who legitimately doesn't run a platform (Bath Fitter reads 33%, Veterinary 44% — honest but pessimistic). The per-SKU COGS join is blocked (captured rows carry Shopify GID + title; customer sheets carry SKU; fuzzy-title matching is the model deciding — banked V2, design-partner-driven).

## LORA ARCHITECTURE — THREE-TIER NESTED BRAIN (the organizing model; every Lora item is an implementation of one tier) [LAW]
- **[LAW] CLIENT LORA** ("FoamOh Lora", "Escential Lora"): one continuous mind PER CLIENT. Accumulates that client's private Skill (COGS logic, seasonality, what conversion means to them, quirks). She IS that business's analyst. Client Skill is private + EXPORTABLE (a salable customer asset).
- **[LAW] AGENCY LORA:** the agency's own brain that CROSS-REFERENCES its client Loras (portfolio "who's up/down", pattern transfer across the agency's book) + carries an agency-level Skill (the operator's playbook/standards). Why an agency pays.
- **[LAW] LORAMER LORA:** the top brain that learns across ALL customers via HASHED, OPT-IN, DE-IDENTIFIED data, distills TRANSFERABLE patterns, and makes them learnable by every client/agency Lora WITHOUT leaking any customer's private data.
- **[LAW] DATA-FLOW DISCIPLINE** (protects the no-training promise + powers the network effect): knowledge flows UP de-identified/hashed only; generalized wisdom flows DOWN to all. Raw private business data NEVER moves sideways between customers. Three compounding loops: per-client retention · per-agency stickiness · base-wide network effect.

## ONE CONTINUOUS MIND — CROSS-SURFACE + CROSS-DEVICE [LAW]
Lora is ONE continuous analyst across every surface (chat/right-shelf · insight+alert bar · left nav · client profile) and every device. Any surface reflects, LIVE, what happened in any other — the customer picks up exactly where they left off from ANY surface on ANY device. Requires a shared per-client live SESSION/working-context layer (extends the long-term memory layer). This is a real BUILD workstream, NOT a config flag. Building any new Lora surface as its own island VIOLATES this law.

## MODEL FLOOR — OPUS 4.8 EVERYWHERE [LAW]
Opus 4.8 is the MINIMUM model on ALL Lora surfaces — chat AND the insight/alert bar. The proactive engine (insight/alerts) is a HIGH-REASONING surface BY DESIGN: it must dig and find the real cause ("spend up because X search term fired 1000x and it's wrong for this business because…"), never emit generic "spend up 2%". Cost is not a constraint (real spend ~$10 / 6 weeks; Opus = 1.67x Sonnet, pennies/client). GUARDS: (a) MODEL_PRICING now carries the VERIFIED opus-4-8 rate ($5/M in · $25/M out · cache read $0.50 · 5m write $6.25) + cache-token pricing (LORAMER_LORA_MODEL_PRICING_V1, 2026-07-14); (b) keep prompt-caching ON (biggest cost lever). The Sonnet-vs-Opus A/B is KILLED — the floor is LAW (Russ: "at least Opus 4.8"), so ship model = eval model = claude-opus-4-8 and the accuracy gate is re-measured on Opus. The chat model is env-selectable via LORA_CHAT_MODEL (LORAMER_LORA_CHAT_MODEL_ENV_V1; code default stays claude-sonnet-4-6); the production flip to Opus is a Vercel env var, pending Russ's go after the Opus eval baseline. Residuals queued (not lost): insight/route.ts cache tokens not yet threaded; cache-token counts not persisted as columns.

## SKILLS [LAW] — the 25→95 mechanism
- **[LAW] PER-PLATFORM Skills (LAUNCH-CRITICAL):** meta-ads.md / google-ads.md / shopify.md / woo.md / ga4.md — on-demand reference docs holding each platform's metric definitions + gotchas (Meta dedup, Google hour-0, store net-basis, false-zero, four-source ROAS). Pairs with evals (Skills make her right, evals prove it).
- **[LAW] PER-CLIENT + PER-AGENCY Skills (FLAGSHIP):** Lora AUTHORS these through use (see three-tier model). Client Skill = exportable salable asset.

## LORA — WHAT SHE MUST BE (governing law)
- **[LAW] LEARNING MODEL: frozen Claude + external memory.** She learns CONTINUOUSLY per-client (memory) AND cross-customer via HASHED, OPT-IN data. She is NEVER fine-tuned into base model weights — that promise is what LEGALLY ENABLES the two learning layers, not a limit on them.
- **[LAW] Quality comes from STRUCTURE (Anthropic 25→95):** semantic query layer + Skills + provenance + OFFLINE EVALS + memory.

## §1 ACCURACY FOUNDATION (she cannot be silently wrong)
- **[LAW]** Numbers COMPUTED via the semantic layer, never guessed; her figures MATCH the dashboard cards to the dollar (ONE canonical computation — no parallel `settle()`s that can disagree).
- **[LAW] FOUR-SOURCE ROAS:** hold Google / Meta / Store / GA4 at once, each labeled by provenance; store wins ONLY when store ROAS is asked for; EXPLAIN why they differ (web-research the why).
- **[LAW] Guards on every answer:** no false-zeros (pre-data → "no data", never $0); Meta dedup caveat (Meta conversions double-count — do NOT overstate); Google hour-0 catch-all; ended-vs-active status; PROVENANCE FOOTER (source + window) enforced on every answer.
- **[LAW] SKILLS:** per-platform reference docs Lora reads on demand.

## §2 MEMORY / KNOWLEDGE / DOCUMENTS
- **[LAW]** Per-client memory (rules/facts) + `value_model` injected. Uploaded docs injected prompt-injection-delimited as untrusted reference.
- **[LAW] Doc formats:** TXT / CSV / PDF / DOCX AND XLSX (COGS/margin are usually spreadsheets). Comprehend AND JOIN docs to the ad+revenue metrics (compute margin-after-COGS, apply plan targets) — not eyeball-join of dumped text.
- **[LAW] WEB SEARCH tool wired** (research the why + benchmarks).
- **[LAW] TRUE retrieval** (relevant subset), not a whole-context word-budget dump.
- **[LAW — roadmap] LOCAL FOLDER SYNC AGENT:** point an agent at a desktop folder, auto-refresh docs daily so spreadsheets never go stale.

## §3 CROSS-PLATFORM STRATEGY + BI BEYOND ADS
- **[LAW]** Reason across ALL platforms for budget reallocation (shift Meta→Google: where + why). With internal docs: cost savings, COGS analysis, new product/service suggestions.
- **[LAW] GATE:** money-moving recommendations ship ONLY after the eval program clears threshold.

## §4 PROACTIVITY (the other half of the moat)
- **[LAW] Two modes:** best-practice (anomalies, trend breaks, benchmark misses) + user-DEFINED alert rules (trigger / severity / action in memory). AttentionCard = alerts + insight unified.
- **[LAW]** Portfolio "who's up / who's down" engine. Report & Recommendations dashboard (paid) + email digest ("While You Were Sleeping", user cadence); adversarial-review the digest (latency-free = higher accuracy).

## §5 ASSET-COMBINATION ATTRIBUTION (origin-story moat)
- **[LAW]** Answer "what combination of image/video + headline + copy + CTA drove the most conversions" (PMax + Meta), by conversion type. Needs a modeling layer (APIs expose no per-combination conversions). "We are not done until she can."

## §6 AUTONOMY / AGENT LAYER (2027 north star)
- **[LAW]** Lora generates near-optimal ads and WRITES them to Meta/Google; scheduled analysis; the platform eventually runs on its own. Every layer built is a stepping stone to this.

## §7 THE EVAL SET (the gate that holds 95% — LAUNCH GATE)
- **[LAW]** A fixed golden question set with expected answers + a per-domain ~90% pass gate; a domain does not ship to customers until its eval slice clears. Correction-harvesting feeds it. This is what makes her provably right, not demo-right.
