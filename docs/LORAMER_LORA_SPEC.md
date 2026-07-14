# LORAMER_LORA_SPEC.md — Lora's GOVERNING LAW
<!-- LORAMER_LORA_SPEC_V1 -->

> ⛔ GOVERNING LAW. Every requirement below is **[LAW]** — a must-be, not a nice-to-have. This is the spec
> Lora is built and gated against; the point-in-time status of the codebase against it lives in
> `docs/LORAMER_LORA_AUDIT_2026-07-14.md`, and the ranked build items in `LORAMER_QUEUE_OF_RECORD.md`.

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
