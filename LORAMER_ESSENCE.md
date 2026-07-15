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
- LORAMER_CADENCE_V1 — HOW WE WORK (full spec: LORAMER_HANDOFF.md ## ⛔ LORAMER_CADENCE_V1). DELIBERATE SPEED / right-the-first-time: speed = NOT redoing work; verification ENABLES speed, never traded against it. COMMS: no commentary AFTER a code block (the block is LAST in the turn); exactly ONE code block per turn, newest in the message; ONE change in flight (no new paste while a report is outstanding — "logged, holding"); plain English + HALF THE WORDS for anything Russ reads/does; NO option-menus for a decision that is Claude's ROUTE. OWNERSHIP: Claude owns ROUTE (sequencing / build-order / blast-radius) and DECIDES + proceeds with a one-line reason — asks ONLY for (a) live-path/destructive/deploy/migration approval, (b) a real product fork the docs don't answer, (c) a real-world action only Russ can take. CADENCE: resume→freshness→restate→next→go, then Gate-A→ship→Gate-B auto-advancing down the queue; verify load-bearing claims via Claude Code BEFORE building (CHECK FIRST, don't ask what the repo answers); blast-radius one line per flight; live-path = graduated care, not a freeze and not a permission-gate for its own sake. KILL: narrating instead of executing · piecemeal plans (audit the WHOLE finish-line, then execute top-down BLOCKS-first) · over-cautious framing that gates low-stakes changes · post-code commentary. TIEBREAK between "PROACTIVELY SURFACE risks" (:24) and "no editorializing": SURFACE A RISK ONLY WHEN IT CHANGES RUSS'S NEXT ACTION. Otherwise it goes in the docs, not in his face.
- [LAW] VERIFY THE INSTRUMENT BEFORE TRUSTING THE MEASUREMENT. A test, scorer, benchmark, or proof is only evidence if the thing producing it has itself been verified THIS SESSION. A number from an unverified instrument is not a finding — it is a guess wearing a lab coat. This law would have prevented every correction of 2026-07-14/15.
- [LAW] EVERY DECISIONS ENTRY CARRIES A CONFIDENCE TIER + ITS EVIDENCE: VERIFIED (with the command/query/proof that produced it, named inline) · DERIVED (reasoned from verified facts; say which) · ASSUMED (not checked — never load-bearing). A [PROVEN] with no attached instrument is INADMISSIBLE: downgrade it or delete it. THE TIER CUTS BOTH WAYS: VERIFIED is stated at FULL CONFIDENCE. Stakes rising is not license to assert; proof landing is not license to hedge. (2026-07-15: loud and WRONG twice on the biggest call of the day — claimed sign-in risked being disabled, recommended deferring the GA submission — then HEDGED a fix proven 23/23. Calibrate to the evidence, not to the stakes.) NEVER STATE A DECISION RUSS DID NOT STATE. Accepting a risk is NOT making a decision. Inferring a decision from Russ's TOLERANCE for an outcome is a violation. (2026-07-15: Claude banked "launch moved off July 22" from Russ saying he would accept a delay — and did it in the same commit that added this law. Caught by RUSS, not by Claude.)
- [LAW] LORA SEES EVERYTHING (Russ, verbatim, non-negotiable): Lora must SEE, KNOW, UNDERSTAND, and SAY what everything is. There is NO acceptable situation where Lora "can't see" a user's own data. The ONLY legitimate limits: (1) another org's data, (2) a member's granted scope (RBAC), (3) secrets/OAuth tokens, (4) the cross-agency LoraMer brain = ANONYMIZED PATTERNS, never raw data. Anything else claiming Lora "can't see it" IS A BUG. Every honesty failure of 2026-07-14/15 was Lora denied HER OWN USER'S OWN DATA by our code or our prompt — never a boundary.
- [LAW] THE MODEL IS ALMOST NEVER THE PROBLEM. Seven diagnoses in 2026-07-14/15 blamed the model; the code was at fault every time. Before writing "Lora inferred / hallucinated / ignored / confabulated," READ THE CODE THAT BUILT HER CONTEXT. The seven, so they are never re-inherited: (1) "regex scorer said 74.1%" — the SCORER was lying (false-failed D1, false-PASSED B5/C1); replaced by an LLM-judge validated over banked answers (117×3 passes, zero flips). (2) "C1 is a real fail / B6 predates the floor" — FICTIONAL RUBRICS never verified against metrics_daily; C1 was real (verified), B6 was fiction (Google's account-range backfill NEVER RAN, so 2020-01-27 is where OUR capture starts). (3) "B2's prompt over-reached / prompt-only fails B=3/8" — VOID: harness ran NEXTAUTH_URL=:3000 while the server was :3111, so /api/chat's internal fetch threw and buildClaudeContext was NEVER CALLED; no rule reached her. (4) "D2: she overrode the captured number" — FALSE: OBJECTIVE_RULES told her verbatim "Traffic — do NOT expect or evaluate conversions"; she OBEYED our prompt. (5) "readiness RPC renders CONNECTED as NOT_CONNECTED" — FALSE: connections fetched separately; the meter SILENTLY BLANKS (`{readiness && ...}`) on heavy clients. (6) "readiness RPC is index-mismatched (the A6 story)" — FALSIFIED by EXPLAIN: the index existed and was used for light clients; the defect was QUERY SHAPE (SELECT DISTINCT is O(client-rows); PG15 has no skip-scan). (7) "A6's timeout was the 8s ceiling / cron isn't 8s-bound" — both FALSE (A6 = missing partial index; cron IS 8s-bound). PATTERN: Claude wrote [PROVEN] on things it had DERIVED; Russ's insistence on verification caught all seven, not the resume protocol.
- [LAW] LIVE STATEMENT_TIMEOUT IS 8 SECONDS, NOT 120. supabaseAdmin → PostgREST connects as `authenticator` (statement_timeout=8s); role GUCs do NOT re-apply on SET ROLE, so 8s persists through service_role. The 120s cluster default is visible ONLY to MCP/superuser sessions — EXPLAIN ANALYZE in MCP measures against a limit real users NEVER get; any query benchmarked only via MCP is UNVERIFIED for production. Raising the ceiling is NOT the fix: every timeout found this session read millions of rows to return dozens; written correctly they run 30–72ms. The 8s limit is a SMOKE ALARM, and it protects the pooler — a slow query holds a connection, and a handful stall the whole app.
- [LAW] THERE IS NO STAGING DATABASE. An RPC/migration can only be proven where it is applied. CREATE OR REPLACE is the revert path. State this before every migration.

## ⛔ DETERMINISM OF JUDGMENT [LAW]
Given the same question over the same finite data, Lora must reach the same conclusion 100% of the time. Her answer may change ONLY when new or different information exists — and when it does, she must be able to say WHY it changed (attribution, not silent drift). This holds across model upgrades: Opus 4.8 → 4.9 → any successor must not change a conclusion.
MECHANISM (the model is never the thing that decides):
- NUMBERS: computed in code via ONE canonical settle. Lora REPORTS, never derives. (Fix #1 Part B is the first brick.)
- RECOMMENDATIONS: derived from deterministic, versioned, testable RULES. The model's job is to EXPLAIN the rule's output in English, never to originate the judgment.
- PROSE: not bitwise stable and does not need to be. If literal repeatability is ever required: hash (question + data fingerprint + memory state + prompt version + corpus version + model ID) → return the cached answer.
- MEMORY is INSIDE the exception: a stored correction IS new information. Requirement is ATTRIBUTION — Lora must cite which correction changed her answer.
- MODEL UPGRADES are gated by the eval. No model reaches users until the golden set passes with CONCLUSIONS unchanged. Precedent: Sonnet→Opus flipped B1 and D2 with identical code; the eval caught both.

[VERIFIED 2026-07-14, Anthropic docs — platform.claude.com/docs/en/about-claude/models/model-ids-and-versions + /overview]
- claude-opus-4-8 is a PINNED SNAPSHOT, not an alias. From the 4.6 generation on, the dateless ID IS the snapshot; Anthropic does not update weights or config under an existing ID. New versions ship under new IDs. LoraMer is correctly pinned.
- CAVEAT: weights are fixed per ID, but SERVING INFRASTRUCTURE (request router, safety classifiers, sampling logic) can change under the same ID. So bitwise output stability is NOT guaranteed even on a pinned ID. This is why determinism must live in code, not in the model.
- CAVEAT: every model ID has its own deprecation/retirement schedule. Migration is eventually mandatory; the eval gate is what makes it safe.
- CAVEAT: Opus 4.8 uses adaptive thinking with effort defaulting to HIGH on all surfaces — a live variance source today.

## ⛔ GROUNDED RECOMMENDATIONS / THE CORPUS [LAW]
- Lora's recommendations are grounded in a FROZEN, VERSIONED best-practice corpus — NEVER a live web search. Live search is a determinism bomb: same data, different day, different answer, no new information from the user. A corpus VERSION BUMP is new information: dated, attributable, eval-gated, roll-back-able.
- The corpus feeds the RULES, not the prose. Every recommendation CITES its source (corpus / the user's own correction / the platform's own doc). "Argue with her" is the product: she shows her sources, the user can dispute them. Same moat as multi-source metric provenance — explaining WHY, applied to judgment.
- POSITIONING (true, defensible): Google's and Meta's recommendation engines are structurally conflicted — their revenue IS the advertiser's spend. LoraMer's revenue is a subscription. Frame as INCENTIVE ASYMMETRY, never "they lie" — some of their advice is good, and overclaiming hands a skeptic an easy win.
- HONESTY BOUND: much of marketing canon is contested (brand vs. performance, attribution, incrementality). Never claim Lora knows THE truth. The claim is that she shows her sources and can be argued with.
- RISK FLAGGED, UNRESOLVED: ingesting third-party copyrighted marketing material into a corpus whose output is resold is real IP exposure, distinct from a human reading it. Public-domain / licensed / primary sources / Russ's own writing are clean. NOT legal advice — needs a real lawyer before the corpus scales.

## ⛔ "MAKE LORA YOUR OWN" — WHAT THE PROMISE CAN AND CANNOT CASH [LAW]
CAN: her name/voice/tone; the org's definitions (net sales, value model, ROAS basis); their documents; their retained corrections; their guardrails. All config, all real.
CANNOT: "a different mind" (weights are shared and rented); "she knows everything about us" (the librarian SELECTS — omission is the mechanism, not a bug); "exclusively yours" (direct tension with the cross-agency LoraMer tier — a POSITIONING FORK, unresolved: exclusive-yours vs compounding-across-agencies cannot both be headlined); "you own her" (implies portability/export — a moat hole if yes, marketing if no; decide knowingly).
COST LAW: per-org memory grows the briefing packet forever → input tokens rise per turn, per customer, permanently. Cost scales with ENGAGEMENT; best customers cost most. Must be budgeted before memory ships.
COPY GUARD: "she learns YOUR WAY OF WORKING" is true and defensible. "She BECOMES yours" is the check that bounces.

## HOMEPAGE / BOTTOM-OF-PAGE MESSAGE (banked for the two-door homepage item)
"The model is rented. The memory isn't." Every tool in the category runs on the same frontier AI anyone can rent — that's the starting line, not an edge. LoraMer's edge is what it KEEPS: every platform captured at full grain from the day you connect. So when Shopify and GA disagree, Lora shows BOTH, labeled by source, and explains why — the question every other tool hides from. A competitor can rent the same model tomorrow. They can't rent your history.
GUARDS: (a) "from the day you connect" is load-bearing — backfill is bounded by platform retention; never let it be edited into "all your history." (b) The cross-agency brain is ANONYMIZED PATTERNS, not data — any line implying Lora learns across agencies must read that way, or it reads as "your client data feeds your competitor."

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
