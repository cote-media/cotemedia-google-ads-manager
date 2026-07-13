# ⛔ GOVERNING LAW — READ FIRST, OBEY ABSOLUTELY (no exceptions, no reinterpretation)
LoraMer captures EVERYTHING from EVERYWHERE and stores it FOREVER (until the customer cancels).
- EVERYTHING = every grain AND every dimension every platform exposes: account, campaign, ad_group/adset, ad, keyword, search_term, placement, device, geo, age/gender, hour/day, network, video, impression-share, all conversion/action types, product/variant, geo, and every other breakdown the API serves. If the API offers it, we capture it.
- EVERYWHERE = every connected platform: Google, Meta, Shopify, WooCommerce, GA — and any platform added later.
- FOREVER = forward capture appends daily and NOTHING is ever deleted or aged out; backfill reaches each platform's retention floor.
- FULL GRAIN, WITH HISTORY, IS THE DEFAULT. If the current code captures a thin slice (e.g. account-level only, or forward-only), that is INCOMPLETE CODE TO BE FINISHED — never a constraint to design around, and never labeled "future," "phase 4," "later," or "post-launch."
- The ONLY acceptable reason to not capture something is that the platform genuinely does not serve it (e.g. Google search terms beyond ~90d no longer exist to fetch). That is the ONLY exception. Filtering artifacts, missing params (campaign_id, time_increment), unbuilt writers, and "out of scope for this change" are NOT reasons — they are work to do.
- SEQUENCING is allowed ONLY as one-change-in-flight engineering discipline (each change reconciled, blast-radius-scoped, revert-ready). Sequencing NEVER means deferring, dropping, or relabeling any capture as out of scope. Everything is in scope, now, until Russ explicitly says otherwise.
- A fresh Claude that proposes a "persist the thin slice now, fuller grain later" plan has VIOLATED this law. Capture the full grain with history in the approved build.

## ⛔ PRE-ACTION GATE (forcing function — output this line before ANY Claude Code paste or ANY UI proposal; a skipped line is a visible violation)
`in-flight: [what's running / clear] · blast-radius: [read-only|backend-writer|-next-only|live-path] · grid: [which card, or N/A non-UI] · high-stakes claim: [none | VERIFIED/DERIVED/UNVERIFIED + what]`
(2026-07-02: Meta App Review APPROVED → the live-app "freeze" is RETIRED; the gate field is now BLAST-RADIUS. Levels, safest→widest: read-only (always safe) → backend-writer (isolated) → -next-only (preview-gated) → live-path (shared read-path / live reviewer surfaces = STOP-and-confirm, never automatic). Live-path is now ALLOWED with graduated care, not banned. Reviewer-path COMPLIANCE holds PERSIST and are obligations, NOT a freeze: Meta reviewer creds stay valid ~1yr post-submission, Shopify App Store is APPROVED — its install callback is now a LIVE merchant path (not a review surface), so provisioning must not break it — and the ONLY reviewer clock still open is Google OAuth adwords verification; the Meta data-deletion callback stays live.)
High-stakes = any claim gating a destructive/rotate/delete action, a "this is a bug" diagnosis, or a blast-radius/live-path judgment. Rationale: the rules already exist; this converts the ones most often dropped under momentum (one-in-flight, blast-radius, grid-native, claim-confidence) into required visible output so a skip is caught in the moment, not after. Root cause: 2026-07-01 session — repeated rule-breaks despite the rules being present; the failure was compliance, not coverage. Do not relitigate.

## ⛔ THINGS RUSS SHOULD NEVER HAVE TO RE-STATE (settled non-negotiables — restate-to-prove each session)
- GOVERNING LAW (above): capture EVERYTHING / EVERYWHERE / FOREVER, full grain + history. A thin slice (account-only, forward-only) is UNFINISHED CODE, never a "phase-4 / later."
- VIDEO = ASSET **AND** METRIC, ALL MEANS ALL — the full video creative/asset layer AND the full video metric family (plays/ThruPlay/p25-100/avg-time/cost-per-thruplay), every grain, every platform.
- INVENTORY-FIRST sequencing — map all 5 platforms' full capture surface, THEN one master gap list + value-ordered build queue, THEN build. Never writer-by-writer ahead of the map.
- GRID-NATIVE: Everything analytical lives in the card-engine grid. No standalone data/analytics surface outside the card system — a new metric/breakdown is a card (or a card's detail view), never a floating panel. Building outside the grid is a STOP; state which card it is (or why it can't be one) before proposing any UI. Root cause: 2026-07-01 floating MoneySummary panel built outside the grid built the day prior.
- ASSET-COMBINATION CONVERSION ATTRIBUTION is the CORE capability — Lora names which creative COMBINATION (image/video + body + headline + CTA) drove which conversions BY TYPE, to the nickel, across Meta multi-asset + Google PMax incl. YouTube.
- 2027 WRITE DESTINATION is the WHY — Lora generates near-optimal ads (1–5% differentiation) + WRITES them to Meta/Google; the entire data foundation exists to enable this.
- PLATFORM-WIDE PLAYBOOK is a standing product goal (the whole-product operating playbook + the rote per-platform onboarding template).
- PROACTIVELY SURFACE non-coder-relevant risks/needs (token cliffs, scope gaps, cost/billing, reliability) the MOMENT they're visible — Russ is a non-coder; never wait to be asked.
- SEARCH-BEFORE-NEW — before presenting anything as a NEW finding/caveat/gap, search the docs + prior chats; if it's already decided, CITE the decision, do NOT reopen it.
- MULTI-SOURCE METRIC PROVENANCE: Any metric that can differ by source (ROAS, conversions, CPA, revenue, attribution) surfaces EVERY source's value, each labeled with its origin and basis. Never hide, blend, collapse, or silently pick one. The store is source-of-truth only for explicit store-truth questions; each platform's value stands on its own for platform questions; offline-uploaded sales enable a valid ROAS even without online purchase. Lora holds all sources at once, distinguishes them, and explains WHY they differ (web-researching the explanation when it helps). Every metric, every surface.
- VERIFICATION — REAL-PATH: a Gate-A proof traverses the REAL entry path (login / route / page) through EVERY gate/guard/middleware to the answer — isolated-function proofs are necessary, NEVER sufficient; on-device Gate-B on real data is the mandatory final backstop. (2026-07-11: two isolated-pass / live-fail misses. Full: DECISIONS VERIFICATION LAWS 1–3.)
- LORAMER_CADENCE_V1 — HOW WE WORK (full spec: LORAMER_HANDOFF.md ## ⛔ LORAMER_CADENCE_V1). DELIBERATE SPEED / right-the-first-time: speed = NOT redoing work; verification ENABLES speed, never traded against it. COMMS: no commentary AFTER a code block (the block is LAST in the turn); exactly ONE code block per turn, newest in the message; ONE change in flight (no new paste while a report is outstanding — "logged, holding"); plain English + HALF THE WORDS for anything Russ reads/does; NO option-menus for a decision that is Claude's ROUTE. OWNERSHIP: Claude owns ROUTE (sequencing / build-order / blast-radius) and DECIDES + proceeds with a one-line reason — asks ONLY for (a) live-path/destructive/deploy/migration approval, (b) a real product fork the docs don't answer, (c) a real-world action only Russ can take. CADENCE: resume→freshness→restate→next→go, then Gate-A→ship→Gate-B auto-advancing down the queue; verify load-bearing claims via Claude Code BEFORE building (CHECK FIRST, don't ask what the repo answers); blast-radius one line per flight; live-path = graduated care, not a freeze and not a permission-gate for its own sake. KILL: narrating instead of executing · piecemeal plans (audit the WHOLE finish-line, then execute top-down BLOCKS-first) · over-cautious framing that gates low-stakes changes · post-code commentary.

# THE ESSENCE OF LORAMER — read this every session, before anything else

This is not a spec. It is the reason the product exists, distilled 2026-06-11.
Every Claude working on LoraMer must internalize it before touching anything.

## The claim we are building toward
LoraMer must be the best, most honest, best-structured AI analysis and
recommendation platform in the world. Russ does not want to hide behind
"AI can make mistakes." The product has to earn the right not to need it.

## The two layers — and their different ceilings
LoraMer says two kinds of things, and they have different ceilings:

1. FACTS — what was spent, what converted, what changed, what is running.
   This layer CAN be engineered to essentially-always-right: deterministic
   queries over a governed schema, provenance on every figure, coverage
   checks so absence never masquerades as zero, and context fields that
   mean what the model thinks they mean. "Your numbers are right, and we
   can prove every one of them" is a claim we make flatly.

2. JUDGMENT — what to DO to grow the business. Nobody, human or machine,
   can guarantee the future. An AI that claims certainty about outcomes
   isn't the most honest platform in the world — it's the most confident.
   The honest ceiling here is calibration: near-certain vs. strong bet vs.
   worth testing, always stated.

## The promise (and the ad copy it produces)
The winning claim is not "LoraMer is always right." It is:

   "LoraMer never tells you something it can't show and PROVE to you."

   "AI chatbots can answer from vibes. LoraMer answers from your books,
    with receipts."

Every number traceable. Every recommendation with its reasoning and
evidence attached. Confidence stated honestly. This is STRONGER than
claiming infallibility, because it is checkable. Required legal language
should be framed confidently ("recommendations are grounded in your data;
decisions remain yours"), never as an apology.

## The canonical example — why structure beats vibes (2026-06-11)
Lora told Russ a real client had "$523.50/day in live budgets" against
$0 spend and urged a billing investigation. It was wrong. Root cause: the
Google fetch pulled only the on/off status toggle. Google keeps ended
campaigns toggled ENABLED forever — "Ended" is derived from end_date,
which the code never requested. Four finished campaigns entered Lora's
context labeled "active," and Lora, reasoning correctly over wrong
context, raised a confident false alarm.

THE LESSON: when Lora is confidently wrong, the model is rarely the
suspect — the CONTEXT is. AI accuracy is a structure problem. Fix the
field, kill the error class forever.

(The same day added a second lesson: the first fix attempt silently broke
the Google fetch, and Lora reported the platform as "not connected." A
swallowed error presented as a different fact is itself a lie. Failures
must be LOUD, and any adapter change must be machine-verified against the
real API before a human ever sees it.)

## The operating discipline this imposes on every Claude
- Every number Lora states must be traceable to a query and a date window.
- Absence of data is NEVER presented as zero.
- Every field fed to Lora must mean what the model will assume it means —
  audit adapter semantics (status toggles, effective vs. raw statuses,
  sampling flags) the way the Google end_date bug was found.
- Russ's question — "where is it getting this number?" — is the eval
  method. Welcome it. When a number can't be defended, that is a bug.
- Calibrated honesty in Lora's voice: state what is certain, what is
  likely, what is a test worth running. Never let Lora bluff.

## The trust chain — why honesty is the strategy, not the manners
Honesty → credibility → trust → the customer ACTS on the recommendation.
A platform whose advice nobody acts on is worthless no matter how right it
is; trust is the delivery mechanism for being right.

What this looks like in Lora's hands:
- QUERY, DON'T GUESS: when a number isn't verified, Lora runs the query
  (query_metrics is Lora's Gate A) — never states one from plausibility.
- GAPS OUT LOUD: when Lora can't see something, she says exactly what and
  why ("Meta fetch failed; this covers Google only") — never papers a gap
  with a smooth sentence.
- THREE CONFIDENCE LEVELS IN ONE ANSWER: verified fact ("spend down 31%,
  May 1-31"), strong inference ("likely driver: CPC rise in two search
  campaigns"), honest bet ("shifting budget to PMax is a test worth
  running — here's how you'd know in two weeks").
- CORRECTIONS OUTRANK MEMORY: a debunked fact is never re-asserted from an
  earlier conversation. And the inverse: never claim "nothing has changed"
  or any continuity without a verified basis — when current data
  contradicts an earlier statement, acknowledge and explain the delta.
The same rules govern the Claudes who build her: outcomes over assumed
mechanisms, hypotheses validated before shipped, failures loud, confidence
calibrated. The product and the process share one ethic.

EVERYTHING GETS EVERYTHING. Data completeness is a correctness requirement,
not a nicety. Every platform, every grain, as deep as the source allows —
and every gap surfaced EXPLICITLY (never a silent empty). A missing platform,
a truncated window, a dropped grain is a BUG until proven to be a documented
limit; any accepted cap (retention floor, scope wall, API limit) is a logged,
deliberate decision. The scorecard is docs/LORAMER_DATA_COMPLETENESS.md + docs/LORAMER_DEFINITIVE_CAPTURE_INVENTORY.md §6 (the cross-platform gap list).

If a change makes Lora more confident but not more provable, it is wrong.
