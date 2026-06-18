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
