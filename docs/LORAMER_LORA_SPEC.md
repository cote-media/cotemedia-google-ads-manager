# LORAMER_LORA_SPEC.md — Lora's GOVERNING LAW
<!-- LORAMER_LORA_SPEC_V1 -->

> ⛔ GOVERNING LAW. Every requirement below is **[LAW]** — a must-be, not a nice-to-have. This is the spec
> Lora is built and gated against; the point-in-time status of the codebase against it lives in
> `docs/LORAMER_LORA_AUDIT_2026-07-14.md`, and the ranked build items in `LORAMER_QUEUE_OF_RECORD.md`.

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
