# LORAMER_LORA_INTELLIGENCE_BAR

> The analytical bar — what Lora is FOR. Read this every session. The pipeline (capture, backfill, scopes, dashboards) exists to SERVE this; do not mistake a healthy pipeline for a finished product. Every feature should move Lora closer to the bar below.

## MANDATE — the bar Lora must clear
Lora is meant to be **best-in-class**: an almost entirely **NEW / DIFFERENT class** of business-intelligence platform — **not a dashboard with a chatbot bolted on**, and **significantly better than Google AI or Meta AI** at understanding a business. Those tools answer "what are my numbers in MY platform." Lora answers **"what is actually happening across my whole business, why, and what should I do."**

The product is the *analysis*, not the data display. A correct chart that the operator has to interpret themselves is the floor, not the goal.

## Structural edge — why Lora can clear a bar Google AI / Meta AI cannot
1. **Sees every connected platform at once.** Google Ads + Meta + Shopify/Woo + GA in one reasoning context. Google AI sees only Google; Meta AI sees only Meta. Neither can reconcile spend on one platform against revenue on another. Lora can.
2. **Holds operator/business context they never will.** Promotions, the marketing calendar, product launches, pricing changes, store history, the owner's own hypotheses and uploaded docs. The platforms know their own ad metrics; they do **not** know the business. Lora does (per-client memory + context + uploads).
3. **Does rigorous variance DECOMPOSITION, not summary.** It refuses the flat headline and breaks a number down until the *driver* is exposed — by sub-period, by SKU, by basket component, by channel — concentrating a change into the specific days/products/segments that caused it.
4. **Pulls in EXTERNAL, LIVE web research and reconciles it with the user's own data.** News, blogs, industry events, platform-change announcements, comparable cases from other advertisers — fetched live and cross-checked against what the client's own numbers show. **Web research is a FIRST-CLASS capability of Lora, not an add-on.** "Your ROAS fell the same week Meta shipped Andromeda, and here's what other advertisers reported" is the kind of synthesis no single-platform AI can produce.

## WORKED EXAMPLE 1 — Shelley Kyle: the METHOD (variance decomposition)
A flat headline like **"net sales are down ~3% YoY"** is a FAILURE state for Lora — it's where Google/Meta AI stop. Lora must go further:
- **Expose the basket-size shift behind the flat top line:** orders **+19%**, items **−26%**, AOV **~$95 → ~$78**. (More orders, far fewer items each, smaller baskets — a completely different story than "−3%.")
- **Concentrate the YoY gap in time:** the entire shortfall lands in **~3 weeks**, in **9 specific days**, which account for **~33% of the YoY difference / ~$10,660**.
- **Then ask the context question the data can't answer alone:** "**What promotion ran on those 9 days last year, and which products?**" — i.e. hand the operator the precise, decomposed question instead of a vague summary.
This is the *granularity and question-quality* Lora must match or exceed on every analysis: from "down 3%" to "9 named days, $10,660, what promo, which SKUs."

## WORKED EXAMPLE 2 — Foam OH: the BREADTH (connected data + external research)
Operator hypothesis: **"Meta's Andromeda change around Labor Day 2024 destroyed our 5–7× ROAS ads and nearly killed the company."** Answering this well shows the BREADTH of inputs Lora must marshal:
- **CONNECTED data:** Meta spend / ROAS / breakdowns (including the **Sept-2024 hole** in capture), Google Ads, the **full Shopify order history** (including the 2024 revenue collapse — now reachable via read_all_orders), GA traffic/conversion.
- **EXTERNAL web research (first-class):** what **Andromeda** actually was and its **rollout timing**; industry / blog commentary on its impact; **other advertisers reporting the same 5–7× → collapse experience**; plus any **documents the owner uploads** (their own account notes, agency post-mortems).
- **HONEST CEILING:** Lora can build the **timeline**, show the **correlation**, and **rule hypotheses in or out** — but it must **label correlation vs causation explicitly** and **never claim proof**. "Your ROAS collapse begins the week Andromeda rolled out, matches what N other advertisers reported, and isn't explained by your spend or seasonality — consistent with the hypothesis, not proof of it." **That honesty is part of being best-in-class**, not a hedge that weakens it.

## THE FRAME — metric completeness vs context completeness
- **Metric completeness = WHAT happened.** Every platform, every grain, every day captured and reconciled (the EVERYTHING-GETS-EVERYTHING / Lesson 47 work). This is necessary but NOT sufficient.
- **Context completeness = WHY it happened.** The promotions, launches, price changes, calendar events, external platform changes, and operator knowledge that explain the metrics.
- **The BRIDGE = promotion / event capture.** Capturing "what the business DID and what happened in the WORLD" on a given day is what lets Lora turn "9 days, $10,660" into "the Labor Day promo on these SKUs," or "the week Andromeda shipped." Without it, Lora can find the *anomaly* but not the *reason*. Promotion/event capture (operator-entered + external-research-derived) is therefore a core product workstream, not a nicety.

## What this means for how we build
- Judge every feature by whether it raises Lora's analysis toward this bar — not just whether the pipeline is greener.
- Treat **web research** and **promotion/event/context capture** as first-class product capabilities to build toward, alongside metric completeness.
- Keep the **honesty clause** non-negotiable: decomposed, specific, sourced, and explicit about correlation vs cause. Best-in-class includes being trustworthy about the limits.

## THE AGENTIC ANALYTICS STACK — methodology LoraMer follows
**SOURCE:** Anthropic, "How Anthropic enables self-service data analytics with Claude" — https://claude.com/blog/how-anthropic-enables-self-service-data-analytics-with-claude (Russ flagged 2026-06-05; read 06-05 + 06-10). **NOT gospel** — adopted for its replicable methodology that raises agent output/accuracy for our customers.

**THESIS:** analytics accuracy is a **STRUCTURE/context problem, not a data-volume problem.** Raw access to thousands of historical queries moved accuracy **<1 point**; curated **Skills moved it ~21% → 95%+.** **DECAY WARNING:** 95%→65% in a month when the data model changed and skill docs weren't maintained → **ship doc updates in the SAME commit as schema/adapter changes.** **THREE FAILURE MODES:** **Ambiguity** (which table/column/definition), **Model staleness** (freshness), **Retrieval failure** (can't find/standardize the right query).

**FOUR LAYERS** (foundation → validation) + **LoraMer status** (verified against the repo 2026-06-19; update as we build):
- **01 DATA FOUNDATIONS** (ambiguity + staleness) — **STRONG.** `metrics_daily` is a single canonical dataset, one grain, governed; shared backfill engine + nightly cron forward-capture. Our structural advantage — Anthropic's hardest layer barely needs building here.
- **02 SOURCES OF TRUTH** (ambiguity) — **PARTLY THERE.** Reconciliation is real and shipped (revenue basis matches grain, net-after-refunds, store-else-GA precedence, account == Σ depth $0.00). `query_metrics` (the semantic layer over `metrics_daily`; modes baseRange / offsetsMonths / windows) **EXISTS, is wired into `/api/chat` + `/api/insight`, and is ownership-gated** — BUT it is **NOT yet the ENFORCED single path**: there is no `tool_choice` forcing and no prompt rule making it mandatory-first, so the model may answer from the prebuilt context without calling it. Enforcement = still to build.
- **03 SKILLS** (retrieval + staleness) — **GAP / biggest lever.** No runtime, agent-retrievable per-platform Skills (grain / scope / gotchas for Google / Meta / Shopify / Woo / GA). Hard-won platform facts currently live developer-side (CLAUDE.md + code comments); `docs/QUERY_METRICS_REFERENCE.md` is a **developer reference, NOT wired into the runtime prompt.** Needs: per-platform reference Skills + `query_metrics` MANDATORY-first + same-commit doc maintenance. **This is the layer that moved Anthropic 21% → 95%.**
- **04 VALIDATION** (all three) — **GAP (partial).** No offline evals exist (no test suite at all). Provenance is **PARTIAL**: the honesty / "gaps out loud" behavior IS a hard prompt rule today ("Data gaps and their provenance are always stated out loud"), but there is **no structured provenance FOOTER** format, and **no Q/A pinned to snapshots** with a per-domain ~90% ship-gate.

**THE 95% PATH** (in order): `query_metrics` mandatory → per-platform Skills docs → provenance footers → offline evals → same-commit doc maintenance.

**ACCURACY NORTH STAR** (calibrated): relentlessly **maximize accuracy** (95%+ and climbing) **AND never present uncertain as certain** (provenance + honest "incomplete because X"). Literal 100% is an asymptote (even Anthropic lands ~95%); the trust engine is **high accuracy + honesty about the rest.** Correct data (this stack) is the **FLOOR**; the substance/quality of the growth recommendations is the intelligence built **ON** correct data — you cannot give good advice on wrong numbers. (This operationalizes the honesty clause + the metric-vs-context frame above.)

## MULTI-SOURCE METRIC PROVENANCE (governing)
MULTI-SOURCE METRIC PROVENANCE: Any metric that can differ by source (ROAS, conversions, CPA, revenue, attribution) surfaces EVERY source's value, each labeled with its origin and basis. Never hide, blend, collapse, or silently pick one. The store is source-of-truth only for explicit store-truth questions; each platform's value stands on its own for platform questions; offline-uploaded sales enable a valid ROAS even without online purchase. Lora holds all sources at once, distinguishes them, and explains WHY they differ (web-researching the explanation when it helps). Every metric, every surface.

## THE MOAT — EXPLAIN THE WHY
THE MOAT — EXPLAIN THE WHY: Competitors compute spend ÷ revenue and stop; anyone can do that math. LoraMer's differentiator is explaining WHY a number is what it is — why platforms, the store, and GA disagree, which conversion actions drive it, where attribution overlaps. That explanation is impossible without the full conversion-action capture floor beneath it. Capture floor → provenance → the "why" nobody else gives. This is the product, not a feature.
