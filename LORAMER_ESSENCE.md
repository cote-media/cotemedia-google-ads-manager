# ⛔ GOVERNING LAW — READ FIRST, OBEY ABSOLUTELY (no exceptions, no reinterpretation)
LoraMer captures EVERYTHING from EVERYWHERE and stores it FOREVER (until the customer cancels).
- EVERYTHING = every grain AND every dimension every platform exposes: account, campaign, ad_group/adset, ad, keyword, search_term, placement, device, geo, age/gender, hour/day, network, video, impression-share, all conversion/action types, product/variant, geo, and every other breakdown the API serves. If the API offers it, we capture it.
- EVERYWHERE = every connected platform: Google, Meta, Shopify, WooCommerce, GA — and any platform added later.
- FOREVER = forward capture appends daily and NOTHING is ever deleted or aged out; backfill reaches each platform's retention floor.
- FULL GRAIN, WITH HISTORY, IS THE DEFAULT. If the current code captures a thin slice (e.g. account-level only, or forward-only), that is INCOMPLETE CODE TO BE FINISHED — never a constraint to design around, and never labeled "future," "phase 4," "later," or "post-launch."
- The ONLY acceptable reason to not capture something is that the platform genuinely does not serve it (e.g. Google search terms beyond ~90d no longer exist to fetch). That is the ONLY exception. Filtering artifacts, missing params (campaign_id, time_increment), unbuilt writers, and "out of scope for this change" are NOT reasons — they are work to do.
- SEQUENCING is allowed ONLY as one-change-in-flight engineering discipline (each change reconciled, blast-radius-scoped, revert-ready). Sequencing NEVER means deferring, dropping, or relabeling any capture as out of scope. Everything is in scope, now, until Russ explicitly says otherwise.
- A fresh Claude that proposes a "persist the thin slice now, fuller grain later" plan has VIOLATED this law. Capture the full grain with history in the approved build.

## ⛔ RIGHT > FAST. ALWAYS. [LAW — RUSS, banked 2026-08-08]
**RIGHT > FAST. ALWAYS. If it takes 8 hours to get it right, that is fine.**
This SUPERSEDES every speed-shaped trade in this repo. ⛔ **A DEFERRAL MADE BECAUSE SOMETHING WAS SLOW IS NOT
A DECISION — IT IS AN UNEXAMINED COST.** When a plan defers, ask what the deferral was buying; if the answer
is time, RE-ARGUE IT FROM SCRATCH with speed removed from the trade, and say what changed.
PRECEDENT, 2026-08-08, the day it was banked: sub-window checkpointing was named as the only thing that
actually removes the hard-kill class and then deferred to "a later flight" — a deferral made while speed was
implicitly in the trade and never stated as its reason. With the trade corrected it moved INTO the rebuild
the same day, and the density model it had been propping up became an optimisation instead of a
load-bearing dependency. **THE DEFERRAL WAS NOT WRONG BECAUSE THE ANALYSIS WAS WRONG; IT WAS WRONG BECAUSE
THE COST WAS NEVER PRICED.**
COROLLARY, and it is the operative half: an hours estimate is never shaved to make a plan acceptable. A
number that rises when the work is understood properly is the estimate WORKING. Say the larger number.

## ⛔ ONE-BLOCK OUTPUT LAW — LORAMER_ONE_BLOCK_OUTPUT_V1 [LAW — RUSS, banked 2026-08-02, BROKEN 4× THE SAME DAY]
**EVERY substantive reply to Russ is ONE fenced code block. Nothing outside it. Ever.** Findings, code, guard
output, gate results, SHAs, sources, caveats, next steps — ALL INSIDE THE ONE BLOCK. No prose before it, no
prose after it, no "standing by" paragraph outside it, no sources line outside it, no second block.
WHY, and it is not style: **Russ reads and pastes on a phone.** Anything outside the block is content he
cannot carry — it is silently dropped the moment he moves the report. A reply split across three pastes is a
report he did not receive. ⛔ **IT WAS BANKED AND BROKEN ON THE VERY NEXT REPORT.** Per the RULE-HOME LAW,
prose is therefore not the fix and this entry is not the enforcer. **HONEST LIMIT: no repo guard can observe
Claude Code's chat output** — it never touches the filesystem, a commit or a build.
`tests/guards/one-block-output.guard.mjs` enforces the only mechanical thing there is: that this rule is
PRESENT AT THE TOP of the three docs the executor reads before acting (CLAUDE.md, here, RESUME_INSTRUCTIONS)
and reaches the generated digest. It guards PLACEMENT, never OBEDIENCE.

⛔ **AND THE SAME LAW HAS A SECOND HALF, BANKED 2026-08-04: TERSENESS IS A CORRECTNESS REQUIREMENT, NOT A STYLE PREFERENCE.** One block was always necessary and never sufficient — a single block full of padding fails for the same reason three blocks do. **THE COST, RECORDED SO IT IS NEVER MISTAKEN FOR TASTE: verbosity consumes APPROVAL BANDWIDTH, which is the scarcest resource on the 9/30 path — not compute, not quota, not typing.** Russ is the only human gate on every decision; every sentence he must read to find the decision is drawn from the one budget that cannot be topped up.
- **ANSWER, THEN STOP.** No editorialising. No summarising his own instruction back to him. He wrote it; he knows what it said.
- ⛔ **NEVER ASK FOR PERMISSION ALREADY GIVEN.** *"Say go and I'll send it"* is a wasted round trip when the go was in the message being answered. **Have the next paste READY IN THE SAME MESSAGE.** THE MOST-CORRECTED FAILURE OF 2026-08-03/04.
- ⛔ **ONE PASTE IN FLIGHT.** Never send a second while a report is outstanding. **VIOLATED THREE TIMES ON 2026-08-04, TWICE WHILE THIS VERY LAW WAS BEING WRITTEN.** If something else is ready, QUEUE it and say in one line what is queued.
- ⛔ **ANY RUNNABLE COMMAND GETS ITS OWN CODE BLOCK WITH ITS DESTINATION LABELLED** — Supabase SQL Editor, terminal, Vercel dashboard — **even if it is one word.** Prose containing a command is a DEFECT: it cannot be copied on a phone without hand-editing. Violated twice in a single exchange on 2026-08-04.
- **NO OPTION MENUS FOR DECISIONS CLAUDE OWNS.** Decide, state the decision and the reason in one line, move. Menus are for decisions that are genuinely his.
- **NO SCROLL-UP.** Anything he must DO is a plain bullet, not buried in a paragraph.

⛔ **THIS HALF HAS THE SAME HONEST LIMIT AS THE FIRST AND IT IS STATED RATHER THAN PAPERED OVER: NO GUARD CAN OBSERVE CHAT OUTPUT.** Per the RULE-HOME LAW, a rule broken repeatedly needs an ENFORCER and not another entry — and for chat there is none available, because the output never touches the filesystem, a commit or a build. `one-block-output.guard.mjs` guards PLACEMENT of this law in the three docs the executor reads; obedience has exactly one enforcer and it is Russ saying so again. **That is precisely why the cost is written down here: if the only enforcement is a human repeating himself, the law must at least tell him what it is costing him to do it.**

## ⛔ THE RESUMABLE UNIT IS THE DAY BECAUSE THE WAREHOUSE IS KEYED BY DAY [LAW — RUSS, banked 2026-08-08]
**THE RESUMABLE UNIT IS THE DAY BECAUSE THE WAREHOUSE IS KEYED BY DAY. THE VENDOR'S FETCH UNIT IS AN ADAPTER
CONCERN.**
⛔ **THIS REPLACES A WEAKER STATEMENT OF THE SAME RULE, AND THE REPLACEMENT IS THE POINT.** The streaming
walk originally justified day-granular resume with *"GAQL filters `segments.date BETWEEN`"* — a fact about
ONE VENDOR'S API. It is true of all five vendors, so the design would have worked; but the load-bearing
member was in the wrong place, and a design resting on a vendor's convenience is one API change away from
having no reason to exist.
THE DURABLE REASON: `metrics_daily` is keyed by `(client, platform, entity_level, breakdown_type, DATE)`, so
*"which days do I still owe"* is answerable for ANY platform whose rows land there — which is all of them,
measured 2026-08-08: google 5 entity_levels / 26 breakdowns, meta 4/26, ga 1/13, shopify 3/16, woocommerce
3/12. **Coverage is derived from the WAREHOUSE, not from the vendor.**
⛔ **THE PROOF IS SHOPIFY, AND IT IS THE PROOF PRECISELY BECAUSE IT DOES NOT OFFER A DAY UNIT.** Shopify's
natural object is an ORDER, paged by an OPAQUE GraphQL cursor (`pageInfo { hasNextPage endCursor }`) with no
day concept and no verifiable ordering guarantee. **It still resolves to days — because our warehouse is
date-keyed, not because Shopify hands us a date unit.** What the vendor withholds is only the ENTITLEMENT to
infer closure from ordering; the adapter falls back to an explicit commit record and the shared predicate
does not change.
COROLLARY: when a design rests on a vendor fact that happens to hold everywhere, ask whether an OWNED fact
says the same thing. If one does, that is the real load-bearing member and the vendor fact is a coincidence.

## ⛔ CHECK WHAT ALREADY WORKS BEFORE BUILDING IT AGAIN [LAW — RUSS, banked 2026-08-08]
**BEFORE REBUILDING A CAPABILITY, READ THE VERSION THAT ALREADY SHIPPED. Copying beats reinventing, and a
finding already made in this repo must not be re-derived.**
⛔ **THE PRECEDENT, AND IT IS EMBARRASSING ENOUGH TO BE USEFUL.** Russ asked THREE TIMES whether the June
backfill engine had been read against the walk rebuild. It had not — eight steps in. When it finally was:
- **WRITE-THEN-ADVANCE-PER-UNIT** was already there (`run-backfill.ts:242-260`) — rows written, THEN the
  cursor advanced, per chunk, inside the loop. Five rounds of adversarial planning re-derived it.
- **THE WAREHOUSE OVER THE CURSOR** was already there, IN A COMMENT THAT STATES THE LAW BETTER THAN THE PLAN
  DID (`status/route.ts:56-58`): *"Honest depth: the actual earliest account-level row we hold for this
  platform, REGARDLESS OF HOW FAR THE CURSOR SWEPT."* Same indexed ordered-LIMIT-1 shape the new coverage
  probe uses — not the `count(distinct)` that took 51 seconds.
- **THE NO-PROGRESS BOUND** (`BackfillControl.tsx:81-83`, *"if the lap did not move the cursor, break"*) was
  **NOT PLANNED AT ALL** and the resumer would have shipped without it. The new engine's bound fires on
  FAILURES; a lap that SUCCEEDS and covers nothing is not a failure and would have looped forever — which is
  exactly what the three 300-second poison loops were.
THE RULE: **a working predecessor is EVIDENCE, not sentiment.** Read it before the plan freezes, and say
explicitly what is carried, what is superseded, and what happens to the code. "It is old" is not a finding.

## ⛔ A LAW IS NOT BANKED UNTIL IT CAN FAIL A BUILD [LAW — RUSS, banked 2026-08-09]
**A LESSON, RULE OR FALSIFICATION WRITTEN ONLY AS PROSE HAS NEVER HELD IN THIS REPO. ONE WRITTEN AS AN
EXECUTABLE CHECK HAS NEVER BROKEN.** From now on **no law, lesson or falsification is recorded without a
paired mechanical check in the same commit** — the same rule as FIX-WITH-GUARD, applied to laws instead of
code. If a law genuinely cannot be checked mechanically, that is stated on the entry as **UNENFORCEABLE**
with the reason, so nobody mistakes prose for protection.

⛔ **THE EVIDENCE IS MEASURED, NOT ASSERTED, AND IT IS SIX FOR SIX.**
**HELD — became code:**
- **THE NO-PROGRESS BOUND** — became `decideRepublish()` and caught a success-but-zero-days republish the day
  it landed.
- **WRITE-THEN-ADVANCE-PER-UNIT** — became `flush()` in `universe-stream-capture`, guarded rather than
  asserted.
- **serializeVendorError** — became a function, so "[object Object]" cannot come back by being forgotten.

**FAILED — stayed prose:**
- **"CHECK WHAT ALREADY WORKS BEFORE BUILDING IT AGAIN"**, banked one section above on 2026-08-08 and
  **VIOLATED INSIDE 24 HOURS**: v2 walked past the between-iteration budget check, the quota sentinel AND the
  fleet-aware yield — all three already live in production (sweep C1 / C2 / C3).
- `google-op-budget.ts:20-23` bans `Math.max(conns, days)` **ANYWHERE**, in its own header, and
  `google-op-budget.ts:330` uses it.
- The **falsified API-Center-UI mechanism returned verbatim in a newer file** (sweep W4, the fifth
  LORAMER_ESSENCE_LAW_9_V1 precedent) — and the guard written to enforce this law then found a **THIRD** live
  copy the sweep had missed.
- `GOOGLE_DAILY_OP_CAP` was documented in a comment and is now **declared in three non-importing files**
  (sweep W1).
- The ops-per-request ratio was **settled at 1 in one file while 1.5 stays live in another** (sweep W3).

**PROSE HAS NO ENFORCEMENT MECHANISM IN THIS CODEBASE.** That is not a complaint about anyone's discipline; it
is a measurement of what this repo does under load. The three enforcers banked with this law —
`single-owner-vendor-facts`, `banned-expressions`, `pre-step-read` — each ship a REMOVE-ONLY baseline freeze of
today's known violations, so they land green and go red on anything new. **A baseline freeze is not
absolution; it is a burn-down under Russ's approval, one live-path fix at a time.**
⛔ AND THE LIMIT THIS LAW INHERITS RATHER THAN REPAIRS: **no guard can observe Claude Code's chat output** —
the one-block law and the terseness law remain UNENFORCEABLE by construction, and are stamped as such.

## ⛔ WHAT LORAMER IS — BUSINESS INTELLIGENCE, NOT MARKETING ANALYTICS [LAW — RUSS, banked 2026-07-31]
This is a SCOPE CORRECTION at law tier, and it governs the two laws above and every taxonomy below it.

**LoraMer is BUSINESS intelligence.** Given every grain a business will give her — advertising, store,
analytics, and whatever documents and context the owner uploads — **Lora reasons ACROSS ALL OF IT to answer any
question about how the business is actually performing and what to do about it.** Product prioritization. New
product ideas. Cost savings. Margin. Not "which campaign won" — *how is this business doing, and what should it
do next.* **And where the data cannot support an answer, she says so and names WHY** — which is the same
honesty the judgment half already demands, applied to a wider surface.

⛔ **THIS WIDENS THE EVAL TAXONOMY.** The 28-case golden set is marketing-analytics shaped — spend, ROAS,
conversions, breakdowns. A business-intelligence product is judged on questions that set never asks: which
products to cut, where margin is actually going, what to stock, what a cost line is doing to the bottom line.
The taxonomy has to grow to match the claim; a set that only asks marketing questions cannot certify a business
answer. Cross-ref ★EVAL-SET-EXPANSION — the expansion target is not just LARGER, it is a DIFFERENT SHAPE.

⛔ **AND IT WIDENS THE SEVERITY MODEL, which matters more.** A wrong ad recommendation is discovered in days
and costs a media test. **A wrong margin or inventory call moves what a business BUYS and STOCKS — higher
consequence, and far slower to discover.** Money goes out the door into physical goods on a purchasing cycle,
and the error surfaces a quarter later as dead stock or a cash-flow problem, by which point it is not
correctable by changing a bid. Severity is therefore NOT uniform across question classes, and any accuracy gate
that treats them as equal is mis-weighted. The 95% bar was set against marketing questions; it is not
automatically the right bar for a margin call.

## ⛔ THE JUDGMENT HALF OF THE GOVERNING LAW [LAW — 1-7 banked 2026-07-30, LAW 8 banked 2026-07-31, LAW 9 banked 2026-08-01, LAW 10 banked 2026-08-11 (Russ; recorded 2026-08-12 — the defining paste never reached the executing machine at first send)]
The law above says capture EVERYTHING / EVERYWHERE / FOREVER. That is the SCOPE half. The numbered laws below
are the JUDGMENT half — what "everything" means, when data counts as held, and what Lora owes when it is not.
(⛔ NO COUNT IN THIS SENTENCE, deliberately: it read "These EIGHT" while nine laws stood below it — a count in
prose is a fact with a shelf life, and this one had expired in place.)

**1. EVERYTHING MEANS EVERY INPUT THAT EXPLAINS PERFORMANCE, WHEREVER IT LIVES — not every field of the
reporting API.** Configuration (conversion window, attribution setting, whether conversion value includes
shipping/tax), change and activity history, negative-keyword lists, fee components, and off-platform
causation ARE DATA. ⛔ A family that has no `metrics_daily` row shape is NOT out of scope — it means THE
STORAGE SHAPE IS MISSING, not that the family is optional. Every past vendor-surface audit compared the
vendor's surface against "does this land in metrics_daily", which is a question that can never return a
config object, and so three whole families were structurally invisible to a process that ran repeatedly.

**2. UNWIRED IS MISSING.** Data captured but unreachable by Lora is data we DO NOT HAVE. The customer cannot
tell the difference, and neither can she. REFERENCE CASE: Shopify order-level taxes/shipping/discounts/tips
were captured 2026-07-01 (T1.5, into account `extra.money`) and on 2026-07-30 Lora told a user they were not
captured. Both facts were true at once. A capture flight is not done when the row lands; it is done when the
read path can reach it.

**3. PARTIAL DATA INVALIDATES A CONCLUSION — IT DOES NOT DEGRADE IT.** A recommendation built on 11 of 12
families is not 92% as good as one built on 12. The missing family is exactly where the counterargument
lives, and the confidence of the answer is unchanged by its absence — which is what makes it dangerous.
There is no partial credit in advice.

**4. THE PLATFORMS WILL NEVER RECOMMEND SPENDING LESS.** Google and Meta are paid when the customer spends;
their optimisation has a stake in the answer. Lora's only durable advantage is TOTAL DATA PLUS NO STAKE IN
THE ANSWER. That advantage is BINARY, not incremental: partial data with no stake is not a smaller edge, it
is no edge, because the recommendation can no longer be trusted over the platform's own.

**5. INSIDE THE WALL, "I DON'T KNOW" IS A BUG.** Outside a genuine vendor retention wall, Lora names the wall
and the date — that is a correct answer. INSIDE it, uncertainty is an INCIDENT: it means capture broke, and
it pages a human. Not a caveat, not a hedge — an alert. The distinction is mechanical, not editorial: which
side of the retention floor the window falls on.

**6. THE DANGEROUS STATE IS NOT "I DON'T KNOW" — IT IS A CONFIDENT ANSWER OVER AN UNCAPTURED WINDOW.**
An honest gap is recoverable; a confident answer over a hole is not, because nothing signals it. ⛔ THE
PREREQUISITE, and it is not optional: LORA MUST BE ABLE TO SEE HER OWN HOLES BEFORE SHE CAN BE TRUSTED TO
REPORT THEM. A coverage instrument nothing reads cannot make her hesitate.

**7. CLAIM-OF-NOVELTY GATE.** No finding, gap, or correction may be presented as NEW without first searching
the repo docs and the conversation history for it. ⛔ THIS IS NOT THE SESSION-START READ. Reading the entry
docs is INTAKE; this is a LOOKUP AT THE MOMENT OF CLAIMING, and only the second was ever missing. PRECEDENT,
2026-07-30: an entry was banked reading "A SECOND, TIGHTER GOOGLE WALL THAT NOTHING IN THIS REPO RECORDS"
when DECISIONS had recorded it months earlier, marked do-not-relitigate. The intake read had happened; the
lookup had not. A re-derived finding costs more than the thing it re-derives, because it also corrupts the
record.

**8. A NOTICED RISK IS NOT A CAVEAT. IT IS WORK.** If a risk, ambiguity, or "one thing worth knowing" is
noticed, it is RESOLVED before it is spoken — researched and fixed, or proven to be nothing. It is never handed
to Russ as a note to remember.
PRECEDENT, 2026-07-31: `entity_state_history` shipped with the observation that a zero-row table would be
indistinguishable from a broken writer. That was written into a summary AS A CAVEAT and the session moved to
wrap-up. Russ caught it without knowing any of the underlying detail, because it sounded wrong. He should not
have had to.
⛔ WHY IT RECURS: NAMING A RISK FEELS LIKE MANAGING IT. It is the same defect as a truncation warning that
fires nightly while nothing acts on it — Bath Fitter dropped its search-term tail for two months behind
exactly such a warning, and the warning was working perfectly the whole time.
THE TEST, BEFORE SPEAKING: is this resolvable from the data or the code RIGHT NOW? If yes — resolve it, do not
report it. If it genuinely cannot be resolved yet, it is NOT a caveat: it is THE NEXT ACTION, stated as an
action, with what unblocks it named.
COROLLARY (LORAMER_EMPTY_CARRIES_ITS_DENOMINATOR_V1): an empty result must carry its own denominator. No
capture pass, query or check reports zero without recording what it examined. "Check the logs before
concluding" is a human instruction, and human instructions are what fail.

**9. AN INSTRUCTION STATES THE GOAL AND THE CONSTRAINTS. IT DOES NOT STATE THE MECHANISM.** The conversation
layer reasons from REPORTS about the code; Claude Code reads the code. A report says what was EXAMINED, never
what was NOT, so the conversation layer's picture is ALWAYS A SUBSET — and writing an instruction in the voice
of someone holding the whole thing turns that subset into a FALSE PREMISE the executor must then spend the
flight disproving.
THE RULE: name what must be TRUE when the work is done, and what must not break. Where a mechanism is named,
mark it as a HYPOTHESIS TO VERIFY, never as a premise to build on. "Arm at every boundary where a Google error
is observed — establish what they are" is CORRECT. "Arm at withGoogleRetry, which every lane funnels through"
is a DEFECT, because it was not true.
PRECEDENT, 2026-07-31/08-01 — THREE false premises in ONE session, each costing a flight:
  · "withGoogleRetry, which every lane already funnels through" — 3 importers; the LIVE path bypasses it via
    withGaqlRetry + safeQuery; FORWARD calls the fetchers directly; and it did not classify quota AT ALL.
    There were FOUR boundaries.
  · "catchup's fillDays skip fires BEFORE the budget gate" — falsified; the gate at :282 is what CAUSES the
    skip at :594.
  · "the Google search-term floor is a vendor retention wall" — it is `DEFAULT_DAYS = 90` in our own backfill,
    and Google documents 37 months with NO search-term exception.
⛔ WHY IT RECURS: A MECHANISM STATED CONFIDENTLY READS AS RESEARCH ALREADY DONE, so it is built on rather than
checked. The executor then spends the flight disproving it instead of establishing the truth.
THE TELL, and it needs NO technical knowledge to spot: **if an instruction says HOW THE CODE WORKS, it is a
defect.** Whether the claim happens to be true is a SEPARATE question and not the point.
COROLLARY: a report opening "the briefed premise was false" is THIS LAW FAILING. Three in one session is a
signal, not a coincidence.
⛔ NOTE THE DIRECTION OF THIS ONE. Laws 7 and 8 bind the EXECUTOR; this one binds the INSTRUCTION. It is the
same failure all three share — treating something UNVERIFIED as SETTLED — and it is banked here rather than in
CLAUDE.md deliberately: CLAUDE.md gates what Claude Code will ACT ON, and a false mechanism is not refusable,
only checkable. The executor's obligation under this law is to VERIFY a named mechanism before building on it
and to SAY SO when it does not hold — never to assume the instruction did the research.

**10. NO UNFENCED TOOLING — LORAMER_NO_UNFENCED_TOOLING_V1 (Russ, 2026-08-11).** Inside a flight, Claude Code
may NOT install, enable, set up, or connect any NEW tool, extension, MCP server, browser integration, CLI, or
service unless the flight instruction names it explicitly. Anything novel needed mid-flight = **STOP and ask,
stating what and why.** Improvisation within already-available tools remains normal.
CONTEXT, the bite that produced the law: the Claude-in-Chrome setup attempt during Chat Flight 2 Phase A
(2026-08-11) — a browser integration reached for mid-flight without the instruction naming it; Russ declined
it. The flight then proceeded fine without it, which is the point: the need was assumed, not established.
⛔ THE MECHANICAL HALF IS QUEUED, NOT DONE: ★TOOL-INSTALL-PERMISSIONS-LOCKDOWN (/permissions on BOTH machines
so tool-install/setup actions require explicit approval) — this law is the conduct half, and prose alone is
not an enforcer (RULE-HOME LAW).


## ⛔ PRE-ACTION GATE (forcing function — output this line before ANY Claude Code paste or ANY UI proposal; a skipped line is a visible violation)
`in-flight: [what's running / clear] · blast-radius: [read-only|backend-writer|-next-only|live-path] · grid: [which card, or N/A non-UI] · high-stakes claim: [none | VERIFIED/DERIVED/UNVERIFIED + what]`
(The gate field is BLAST-RADIUS. Levels, safest→widest: read-only (always safe) → backend-writer (isolated) → -next-only (preview-gated) → live-path (shared read-path / any live surface = STOP-and-confirm, never automatic). Live-path is ALLOWED with graduated care. There is NO Meta review, no reviewer path, no reviewer-driven hold — blast radius on a shared surface is about EVERY client and EVERY live surface, never a reviewer (the Meta App Review outcome that retired the reviewer path is owned by DECISIONS, not restated here). Standing PRODUCTION obligations (not a freeze, not a review): the Meta data-deletion/deauth callback must stay live (permanent Meta prod requirement), the Shopify install callback is a LIVE merchant path provisioning must not break, and Google Ads live snapshots stay quota-capped while Standard Access is pending — the 15k/day Basic cap binds route decisions; its live status lives in DECISIONS/QUEUE, never here.)
High-stakes = any claim gating a destructive/rotate/delete action, a "this is a bug" diagnosis, or a blast-radius/live-path judgment. Rationale: the rules already exist; this converts the ones most often dropped under momentum (one-in-flight, blast-radius, grid-native, claim-confidence) into required visible output so a skip is caught in the moment, not after. Root cause: 2026-07-01 session — repeated rule-breaks despite the rules being present; the failure was compliance, not coverage. Do not relitigate.

## ⛔ QUOTE THE VERDICT BEFORE THE PUSH [LAW — RUSS, banked 2026-08-15]
**In any chain that runs a gate and then commits or pushes, the gate's MACHINE-FINAL VERDICT LINE must be QUOTED — read, and reproduced in the report — BEFORE the push/commit line may execute or be reported.**
⛔ **READING THE CHAIN'S EXIT IS NOT READING THE VERDICT.** `wrap && guard && commit && push` is not a gate: `&&` only proves each command returned 0, and a pipeline's status is its LAST command's (POSIX 2.9.2), so a `| tail` or a `| grep` silently replaces a red exit with its own green one. The verdict line is the only artifact that carries the actual finding, and it must appear in the report next to the SHA it gated.
⛔ **TWO INSTANCES, AND THE SECOND HAPPENED WITH THE FIRST'S ENFORCER ALREADY SHIPPED:**
- **2026-08-12** — `npm run check:data | tail -12` truncated the reds AND took `tail`'s exit 0. A FALSE GREEN on a data gate. Fixed by making the verdict the LAST line and the exit its own field (LORAMER_CHECKDATA_VERDICT_LINE_V1 + `checkdata-verdict-line.guard.mjs`).
- **2026-08-15** — a `wrap && guard && commit && push` chain printed **`[run-guards] EXIT 1 — 1 failed, 0 crashed`** and the push happened anyway, because the push line was read and the verdict line above it was not. The chain did not lie; the reader did not look. (The finding was real: a phantom index token in prose.)
⇒ **THE RULE GENERALISES THE 08-12 FIX FROM ONE SCRIPT TO EVERY GATED CHAIN.** `[run-guards] ALL GREEN — N/N`, `[check:data] VERDICT — …`, and `✓ Compiled successfully` are verdicts. Quote them, then push. A report whose push line has no verdict line above it is INCOMPLETE — the same standing rule CLAUDE.md already applies to check:data, now applied to every gate.
⚠ **THIS IS A READING DISCIPLINE, NOT A GUARD** — no repo check can observe whether a chain's output was read, and the honest enforcer is the report itself (a missing quoted verdict is visible to Russ in the moment). The mechanical half — a wrapper that refuses to push on a non-green verdict — is QUEUED as ★VERDICT-ENFORCER-BEFORE-PUSH, deliberately NOT built in the same breath as the law (a law banked as prose is not banked; this one says so about itself).

## ⛔ WHAT "DONE" MEANS FOR A BACKFILL — LORAMER_BACKFILL_DONE_DONE_V1 [LAW — RUSS, banked 2026-08-17]

**THE BACKFILL IS DONE ONLY WHEN a new customer connects a client on a platform (Google Ads, GA4, Meta, or
Shopify), clicks ONE Backfill button, and ALL SIX conditions below hold — proven as ONE pass/fail ACCEPTANCE
PROOF, green once on a GENUINELY COLD connection, through the REAL entry path.** Never a rehearsal that
hand-feeds the inputs which make it pass (LORAMER_REAL_INPUT_GATE_A_V1 applies at acceptance scale).

1. **ALL GRAINS.** Every resource × segment THE VENDOR SERVES. The denominator is the vendor's own field
   catalog, never our registry checked against itself (LORAMER_VENDOR_CATALOG_IS_THE_DENOMINATOR_V1).
   Anything served-but-uncaptured is a FAIL.
2. **FLOOR TO INCEPTION.** The frontier reaches the platform's data floor with NO surface pinned short, and
   every interior day is either FILLED or ATTESTED-EMPTY **with a stated reason**. No silent gap, no false
   zero.
3. **CORRECT, NOT JUST PRESENT.** No rewriting of already-committed days; restatement-aware wherever the
   vendor restates (LORAMER_RESTATEMENT_WINDOW_LAW_V1); and the numbers RECONCILE to the customer's own
   platform UI.
4. **EXPEDITIOUS.** It uses the lane it is allowed — but only AFTER correct. Speed never precedes
   correctness (RIGHT > FAST governs the trade).
5. **LORA-WIRED.** Every captured grain is READABLE BY LORA. Captured-but-dark is NOT done (JUDGMENT LAW 2 —
   unwired is missing).
6. **HONEST INSTRUMENTS.** Liveness tests **CONSUMPTION**, not publishing. No-progress tests whether the
   FRONTIER MOVED / the OWED SET SHRANK, not a proxy for it. **An instrument that reports green while the
   property it names is false is ITSELF A DEFECT**, ranked and fixed like any other.

⛔ **THE PROOF IS THE GATE, AND IT IS ONE PROOF RATHER THAN SIX GREENS.** Six separately-green checks are how
a system reads healthy while it is broken; this is a single pass/fail run end to end. Prove **Foam OH / Google
Ads FIRST** — it becomes the TEMPLATE for Meta, GA4 and Shopify, and only then the other eight clients, then
Bath Fitter. ⛔ **EVERY BACKFILL FIX IS SCORED AGAINST THIS PROOF, NOT SHIPPED AS ITS OWN GREEN.**

⛔ **STANDING, AND IT DOES NOT COMPRESS:** the FIVE-STEP (RESEARCH → ADVERSARY → TEST → RUN → VERIFY) runs on
EVERY backfill piece, uncompressed. **VERIFY is never skipped for anything that WRITES or SPENDS.**

⚠ **ENFORCEABILITY, STAMPED RATHER THAN ASSUMED (per A LAW IS NOT BANKED UNTIL IT CAN FAIL A BUILD).** The
acceptance proof itself is the enforcer — a human-run, cold-connection, real-path pass/fail — and it is the
strongest one available, because no repo guard can observe a new customer connecting a live account.
Conditions 1–5 are therefore **UNENFORCEABLE BY BUILD GUARD** and say so on their face. Condition 6 is the
exception and it is NOT theoretical: on 2026-08-17 `check-walk-liveness.mjs` reported **ALIVE for 7h35m while
the consumer had been dead since 05:32Z**, because its ALIVE branch tests `published > 0` — the PRODUCER —
and the walk's own no-progress bound tested `daysCommitted === 0` while the owed set never shrank. Both are
mechanically fixable and are the two buildable halves of this law; neither is built by this entry.

## ⛔ THE ADJACENT NUMBER — LORAMER_ADJACENT_NUMBER_V1 [LAW — banked 2026-08-17, from a session where EVERY defect was this one]

**A NUMBER THAT MEASURES SOMETHING ADJACENT TO THE THING THAT MATTERS WILL READ GREEN WHILE THE THING THAT
MATTERS IS BROKEN.** Not sometimes. Every defect found on 2026-08-17 — seven of them, in code, in instruments,
and in my own watchers — was the same species, and none of them was a lie. Each number was CORRECT about what
it measured and IRRELEVANT to what was being asked.

    rows written                  ≠ days gained
    publishing                    ≠ consuming
    days committed                ≠ the owed set shrinking
    range bounds                  ≠ window bounds
    a green build + 124 guards    ≠ a write the database will accept
    a frontier moving             ≠ a frontier that arrives
    a watcher matching a string that DESCRIBES a condition ≠ one that REPORTS it

⛔ **THE COROLLARY IS THE OPERATIVE HALF, AND IT COST THE MOST: A NUMBER MOVING IN THE RIGHT DIRECTION IS NOT
A NUMBER THAT WILL ARRIVE.** The walk's frontier moved 2026-03-09 → 2026-02-02 in four hours and I reported it
as the fix working — which it was. What I never did was convert the RATE into a TIME TO TARGET. One day of
ground per pass against 1,427 days to the floor is four years per surface, and there are 346 surfaces. The
direction was right and the arrival was impossible, and only the arithmetic could tell those apart.
⇒ **CONVERT EVERY RATE INTO TIME-TO-TARGET BEFORE REPORTING IT AS PROGRESS.** A progress report without a
distance is a vibe.

⛔ **THE DIAGNOSTIC QUESTION, TO BE ASKED OF ANY NUMBER BEFORE IT IS TRUSTED:** *what would have to be true for
this number to look exactly like this while the thing I care about is broken?* If that question has an easy
answer, the number is adjacent and the instrument is not yet built. `check-walk-liveness` read ALIVE for
eleven hours over a dead consumer because its health branch was `published > 0` — the PRODUCER's own count.
The answer to the question was one sentence long and nobody had asked it.

⚠ **THIS LAW IS UNENFORCEABLE BY GUARD AND SAYS SO** (per A LAW IS NOT BANKED UNTIL IT CAN FAIL A BUILD). No
check can know which number a human meant. What IS mechanical, and shipped the same day: `db-enum-mirrors-ts`
(the TS union and the DB constraint may not diverge) and `seams-proof-includes-the-database` (every union in a
writer file is registered or allowlisted with a reason). Those two catch ONE species of adjacency — the schema
one. The rest is the question above, asked out loud, every time.

## ⛔ THINGS RUSS SHOULD NEVER HAVE TO RE-STATE (settled non-negotiables — restate-to-prove each session)
- [LAW] A LAW IS NOT BANKED UNTIL IT CAN FAIL A BUILD. No law, lesson or falsification is recorded without a paired MECHANICAL CHECK in the same commit — FIX-WITH-GUARD applied to laws instead of code. A law that genuinely cannot be checked is stamped UNENFORCEABLE with the reason, so prose is never mistaken for protection. SIX FOR SIX, measured 2026-08-09: everything that became CODE held (the no-progress bound caught a real republish the day it landed; write-then-advance-per-unit; serializeVendorError) and everything that stayed PROSE failed — "check what already works" was violated inside 24 hours of being banked (v2 walked past the between-iteration budget check, the quota sentinel and the fleet-aware yield, all three already live in production); google-op-budget.ts:20-23 bans `Math.max(conns, days)` ANYWHERE while :330 uses it; the falsified API-Center-UI mechanism came back verbatim in a newer file and the new guard found a THIRD copy; the op cap is declared in three non-importing files; the ops-per-request ratio is settled at 1 in one file while 1.5 stays live in another. A baseline freeze of existing violations is a BURN-DOWN under Russ's approval, never absolution. INHERITED LIMIT: no guard can observe chat output, so the one-block and terseness laws stay UNENFORCEABLE by construction and are stamped as such.
- [LAW] CHECK WHAT ALREADY WORKS BEFORE BUILDING IT AGAIN. Read the version that already shipped before rebuilding a capability; a working predecessor is EVIDENCE, not sentiment. (Precedent 2026-08-08: Russ asked THREE times whether the June backfill engine had been read; it had not, eight steps in. It already held write-then-advance-per-unit and the warehouse-over-cursor rule — the latter in a comment stating the law better than the plan did — and its no-progress bound was not planned at all and would have shipped missing.)
- [LAW] THE RESUMABLE UNIT IS THE DAY BECAUSE THE WAREHOUSE IS KEYED BY DAY; the vendor's fetch unit is an adapter concern. Coverage is derived from `metrics_daily`, never from a vendor's convenience. (Proof 2026-08-08: Shopify offers only an opaque order cursor with no day concept and no ordering guarantee, and STILL resolves to days — what it withholds is only the entitlement to infer closure from ordering, which is an adapter declaration, not a second engine.)
- [LAW] RIGHT > FAST. ALWAYS. If it takes 8 hours to get it right, that is fine. A deferral made because something was slow is NOT a decision, it is an unexamined cost — re-argue it with speed removed from the trade and say what changed. An hours estimate is never shaved to make a plan acceptable; a number that RISES when the work is understood properly is the estimate working. (Precedent 2026-08-08: sub-window checkpointing deferred to "a later flight" while speed was silently in the trade; with the trade corrected it moved INTO the rebuild the same day and the density model it propped up became an optimisation rather than a dependency.)
- [LAW] LORAMER_BACKFILL_DONE_DONE_V1 — A BACKFILL IS DONE ONLY WHEN a new customer connects a client (Google Ads / GA4 / Meta / Shopify), clicks ONE Backfill button, and ALL SIX hold as ONE pass/fail acceptance proof, green once on a GENUINELY COLD connection through the REAL entry path — never a rehearsal that hand-feeds the inputs that make it pass: (1) ALL GRAINS, denominator = the vendor's own catalog, served-but-uncaptured = fail · (2) FLOOR TO INCEPTION, no surface pinned short, every interior day filled OR attested-empty WITH A STATED REASON · (3) CORRECT NOT JUST PRESENT — no rewriting committed days, restatement-aware, reconciles to the customer's own platform UI · (4) EXPEDITIOUS, but only AFTER correct · (5) LORA-WIRED — captured-but-dark is not done · (6) HONEST INSTRUMENTS — liveness tests CONSUMPTION not publishing, no-progress tests whether the frontier moved / the owed set shrank, and an instrument that reads green while its property is false is ITSELF A DEFECT. THE PROOF IS THE GATE, one proof not six greens: Foam OH / Google first, then the template to Meta/GA4/Shopify, then the other eight, then Bath Fitter — every backfill fix is SCORED AGAINST THIS PROOF, never shipped as its own green. FIVE-STEP runs uncompressed on every backfill piece; VERIFY is never skipped for anything that writes or spends. (Full text + the enforceability stamp: the section directly above.)
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
- [LAW] LORAMER_REAL_INPUT_GATE_A_V1 — REAL INPUTS (alongside REAL-PATH above / DECISIONS LAWS 1 real-entry-path · 2 full-path recon · 3 whole-surface scoping). A Gate-A that HAND-SUPPLIES the input which makes the flag fire is a REHEARSAL, not a proof. Gate-A must DERIVE its inputs from the real resolvers and real DB rows for the case under test. Stubbing is permitted ONLY for state that cannot exist without a write (e.g. a not-yet-recorded failure streak), and every stubbed input must be NAMED as stubbed in the report. AND — any Gate-A for a user-visible flag must ENUMERATE EVERY surface that could display it and state, route by route, wired / not-applicable-and-why. PROVENANCE: T0 #2 slice 2 shipped a partial-total flag that passed 13/13 Gate-A while FAILING LIVE on the single most common real shape (healthy connection + window starting in-capture + stale tail) — the harness supplied coverage.state='trailing_gap'; the real getCoverageForWindows returns 'covered'. Three proofs passed; the phone showed the bug. And money + ga-overview were missed and surfaced one screenshot at a time. COROLLARY: when a defect appears on a surface a Gate-A declared green, the GATE-A IS THE FIRST THING TO FIX — before the code.
- LORAMER_CADENCE_V1 — HOW WE WORK (full spec: LORAMER_HANDOFF.md ## ⛔ LORAMER_CADENCE_V1). DELIBERATE SPEED / right-the-first-time: speed = NOT redoing work; verification ENABLES speed, never traded against it. COMMS: no commentary AFTER a code block (the block is LAST in the turn); exactly ONE code block per turn, newest in the message; ONE change in flight (no new paste while a report is outstanding — "logged, holding"); plain English + HALF THE WORDS for anything Russ reads/does; NO option-menus for a decision that is Claude's ROUTE. OWNERSHIP: Claude owns ROUTE (sequencing / build-order / blast-radius) and DECIDES + proceeds with a one-line reason — asks ONLY for (a) live-path/destructive/deploy/migration approval, (b) a real product fork the docs don't answer, (c) a real-world action only Russ can take. CADENCE: resume→freshness→restate→next→go, then Gate-A→ship→Gate-B auto-advancing down the queue; verify load-bearing claims via Claude Code BEFORE building (CHECK FIRST, don't ask what the repo answers); blast-radius one line per flight; live-path = graduated care, not a freeze and not a permission-gate for its own sake. KILL: narrating instead of executing · piecemeal plans (audit the WHOLE finish-line, then execute top-down BLOCKS-first) · over-cautious framing that gates low-stakes changes · post-code commentary. TIEBREAK between "PROACTIVELY SURFACE risks" (:24) and "no editorializing": SURFACE A RISK ONLY WHEN IT CHANGES RUSS'S NEXT ACTION. Otherwise it goes in the docs, not in his face.
- [LAW] VERIFY THE INSTRUMENT BEFORE TRUSTING THE MEASUREMENT. A test, scorer, benchmark, or proof is only evidence if the thing producing it has itself been verified THIS SESSION. A number from an unverified instrument is not a finding — it is a guess wearing a lab coat. This law would have prevented every correction of 2026-07-14/15.
- [LAW] EVERY DECISIONS ENTRY CARRIES A CONFIDENCE TIER + ITS EVIDENCE: VERIFIED (with the command/query/proof that produced it, named inline) · DERIVED (reasoned from verified facts; say which) · ASSUMED (not checked — never load-bearing). A [PROVEN] with no attached instrument is INADMISSIBLE: downgrade it or delete it. THE TIER CUTS BOTH WAYS: VERIFIED is stated at FULL CONFIDENCE. Stakes rising is not license to assert; proof landing is not license to hedge. (2026-07-15: loud and WRONG twice on the biggest call of the day — claimed sign-in risked being disabled, recommended deferring the GA submission — then HEDGED a fix proven 23/23. Calibrate to the evidence, not to the stakes.) NEVER STATE A DECISION RUSS DID NOT STATE. Accepting a risk is NOT making a decision. Inferring a decision from Russ's TOLERANCE for an outcome is a violation. (2026-07-15: Claude banked "launch moved off July 22" from Russ saying he would accept a delay — and did it in the same commit that added this law. Caught by RUSS, not by Claude.)
- [LAW] LORA SEES EVERYTHING (Russ, verbatim, non-negotiable): Lora must SEE, KNOW, UNDERSTAND, and SAY what everything is. There is NO acceptable situation where Lora "can't see" a user's own data. The ONLY legitimate limits: (1) another org's data, (2) a member's granted scope (RBAC), (3) secrets/OAuth tokens, (4) the cross-agency LoraMer brain = ANONYMIZED PATTERNS, never raw data. Anything else claiming Lora "can't see it" IS A BUG. Every honesty failure of 2026-07-14/15 was Lora denied HER OWN USER'S OWN DATA by our code or our prompt — never a boundary.
- [LAW] THE MODEL IS ALMOST NEVER THE PROBLEM. Seven diagnoses in 2026-07-14/15 blamed the model; the code was at fault every time. Before writing "Lora inferred / hallucinated / ignored / confabulated," READ THE CODE THAT BUILT HER CONTEXT. The seven, so they are never re-inherited: (1) "regex scorer said 74.1%" — the SCORER was lying (false-failed D1, false-PASSED B5/C1); replaced by an LLM-judge validated over banked answers (117×3 passes, zero flips). (2) "C1 is a real fail / B6 predates the floor" — FICTIONAL RUBRICS never verified against metrics_daily; C1 was real (verified), B6 was fiction (Google's account-range backfill NEVER RAN, so 2020-01-27 is where OUR capture starts). (3) "B2's prompt over-reached / prompt-only fails B=3/8" — VOID: harness ran NEXTAUTH_URL=:3000 while the server was :3111, so /api/chat's internal fetch threw and buildClaudeContext was NEVER CALLED; no rule reached her. (4) "D2: she overrode the captured number" — FALSE: OBJECTIVE_RULES told her verbatim "Traffic — do NOT expect or evaluate conversions"; she OBEYED our prompt. (5) "readiness RPC renders CONNECTED as NOT_CONNECTED" — FALSE: connections fetched separately; the meter SILENTLY BLANKS (`{readiness && ...}`) on heavy clients. (6) "readiness RPC is index-mismatched (the A6 story)" — FALSIFIED by EXPLAIN: the index existed and was used for light clients; the defect was QUERY SHAPE (SELECT DISTINCT is O(client-rows); PG15 has no skip-scan). (7) "A6's timeout was the 8s ceiling / cron isn't 8s-bound" — both FALSE (A6 = missing partial index; cron IS 8s-bound). PATTERN: Claude wrote [PROVEN] on things it had DERIVED; Russ's insistence on verification caught all seven, not the resume protocol.
- [LAW] LIVE STATEMENT_TIMEOUT IS 8 SECONDS, NOT 120. supabaseAdmin → PostgREST connects as `authenticator` (statement_timeout=8s); role GUCs do NOT re-apply on SET ROLE, so 8s persists through service_role. The 120s cluster default is visible ONLY to MCP/superuser sessions — EXPLAIN ANALYZE in MCP measures against a limit real users NEVER get; any query benchmarked only via MCP is UNVERIFIED for production. Raising the ceiling is NOT the fix: every timeout found this session read millions of rows to return dozens; written correctly they run 30–72ms. The 8s limit is a SMOKE ALARM, and it protects the pooler — a slow query holds a connection, and a handful stall the whole app.
- [LAW] THERE IS NO STAGING DATABASE. An RPC/migration can only be proven where it is applied. CREATE OR REPLACE is the revert path. State this before every migration.
- [DESTINATION — RUSS, LAW TIER] **FOUNDATION FIRST.** INFRASTRUCTURE, DATA, and LORA are the indispensable three; they guide all future expansion. Everything else is built on them or waits. QUALITY GOVERNS THE CLOCK — delay is ACCEPTED where quality requires it; a date never licenses shipping a foundation we know is wrong. This is a DESTINATION (Russ owns it), not a route: it does not tell Claude what to build next, it tells Claude what may never be traded away to move faster. ⛔ RUSS DID NOT NAME A NEW LAUNCH DATE when he stated this. DO NOT RECORD ONE. The standing launch date is the LAST one Russ stated in his own words — its value lives in DECISIONS (LORAMER_SOFT_LAUNCH_JULY22_V1), never restated here — with delay accepted if quality requires it, and per the CLAIM-CONFIDENCE law, accepting a delay is a risk accepted, NOT a date change. (2026-07-15 precedent: a wrap banked "launch moved off" from Russ merely tolerating a delay; he never said it, and Russ caught it, not Claude.)
- [LAW] WEB-FIRST DIAGNOSIS (LORAMER_WEB_FIRST_DIAGNOSIS_V1, 2026-07-19; SCOPE WIDENED 2026-07-23) — BEFORE proposing or authoring ANY build, fix, detector, schema change, OR diagnosis — NOT only a platform / API / tool error — SEARCH THE WEB for (a) the KNOWN CAUSE of that exact error and (b) an EXISTING PUBLISHED FIX or implementation. Vendor docs, SDK issue trackers, community repos, MCP servers, Stack Overflow. If a usable base exists, ADAPT IT rather than authoring from scratch. THE ADAPTATION IS NOT A SHORTCUT PAST VERIFICATION: found code is read IN FULL and Gate-A-proven exactly like code we wrote — never trusted on sight, never pasted on reputation. Found code is a STARTING POINT, never an answer. WHY: 2026-07-19, the Meta code-1/subcode-99 fix was fully engineered — split the call, batch by id, split-on-failure — and only THEN searched; the search confirmed 1/99 is a DOCUMENTED payload-size 500 whose standard remedy is exactly ID-batching, and surfaced meta-ads-mcp already carrying Meta creative error-handling to adapt from. The engineering was right, and it was still the expensive way to get there: hours of live probing to re-derive a published answer, with no cross-check against how anyone else solved it. Searching first is not a substitute for thinking — it is what stops us paying twice for the same knowledge. SCOPE WIDENING, 2026-07-23 — why "error" was too narrow: T0#4 (the account-row-per-day detector) was a clean BUILD with no error to diagnose, so the LETTER of "a solution to an error" never fired while the SPIRIT plainly did — nothing was searched (history / web / repo) before the detector was engineered. The trigger is now ANY build / fix / detector / schema change / diagnosis. THE ENFORCER is the VISIBLE THREE-FIELD HEADER on every such paste — HISTORY · WEB · REPO ([[SEARCH-BEFORE-NEW]] for history; this law for web; CHECK-FIRST for repo) — spelled out in LORAMER_HANDOFF's WEB-FIRST REPORT REQUIREMENT: a paste without it is MALFORMED and rejected on sight, before its content is read. HONEST LIMIT (stated, never implied away): the header's PRESENCE is inspectable — a paste either shows the three fields or it doesn't; whether a search TRULY preceded and informed the code is NOT inspectable by any guard (no check sees the temporal order of a search vs authorship). The header makes skipping VISIBLE; it cannot make searching HAPPEN — that stays discipline.
- [LAW] A CAPTURE UNIVERSE IS NAMED FOR THE VENDOR API, NEVER THE COMPANY (LORAMER_CAPTURE_UNIVERSE_NAMED_FOR_THE_API_V1, RUSS, 2026-08-03) — **`google_ads`, `google_analytics`, `meta`, `shopify`, `woocommerce`. NOT `google`.** ⛔ **TWO VENDORS UNDER ONE COMPANY NAME MUST NEVER SHARE A NAMESPACE, OR THE SECOND ONE INHERITS THE FIRST ONE'S LIST — which is the exact failure the law below exists to end, one namespace over.** GA4 is a DIFFERENT API with a DIFFERENT catalog and a DIFFERENT metadata service (the Data API's `getMetadata`, not `GoogleAdsFieldService`); it gets its OWN artifact and its OWN reader, produced by its OWN catalog pull. A GA universe seeded from `google-ads-capture-universe.json` would be a hand-me-down list wearing a vendor's name — precisely the circularity that let 24 Google Ads surfaces go uncaptured for six weeks. The artifact marker `LORAMER_VENDOR_CATALOG_IS_THE_DENOMINATOR_V1` is deliberately VENDOR-AGNOSTIC and is the ONE thing that does not carry a vendor name: it will govern GA, Meta, Shopify and Woo too.
- [LAW] VENDOR CATALOG IS THE DENOMINATOR (LORAMER_VENDOR_CATALOG_IS_THE_DENOMINATOR_V1, 2026-08-03) — **COMPLETENESS IS MEASURED AGAINST THE VENDOR'S OWN CATALOG, NEVER AGAINST OUR REGISTRY. A FAMILY LIST THAT DID NOT COME FROM A CATALOG PULL IS NOT A LIST.** Before any capture family is declared complete, the DENOMINATOR comes from the vendor — for Google, `GoogleAdsFieldService`, whose three queries are recorded verbatim in `scripts/google-ads-capture-universe.mjs`. Our registry may only ever be the NUMERATOR. ⛔ **WHY THIS IS A LAW AND NOT A PREFERENCE: THE BEDROCK PRINCIPLE ALREADY SAID IT AND STILL FAILED FOR SIX WEEKS.** HANDOFF:82 — *"(3) The completeness gate verifies every client × platform × grain × dimension… No future session may narrow or de-scope this. When in doubt, capture more, deeper."* That gate WAS built and IS green. **IT IS CIRCULAR:** `capture-surface.manifest.mjs` is *"Seeded from docs/LORAMER_DATA_COMPLETENESS.md"* — a doc a human wrote — and `check-capture-completeness.mjs` compares our breakdown-registry against THAT. Both sides are ours, so it can only confirm we have what we already knew about. MEASURED 2026-08-03 with 594 live requests on one account: **14 of 38 surfaces captured, 19 of 53 segments on the surfaces we hold, 0 of 256 on the 24 we never asked for** — every number invisible to a green gate. A gate that never touches the vendor cannot detect a family nobody thought of, and "everything" quietly becomes "everything on our list". ARTIFACT: `docs/google-ads-capture-universe.json`, REGENERATED by `scripts/google-ads-capture-universe.mjs` and ⛔ never hand-edited — a frozen hand-list is exactly how the last one went stale. ⛔ SELECTABILITY IS UNIVERSAL; DELIVERY IS PER-ACCOUNT, and every delivery field in that artifact is stamped with the account, window and date it was observed on.
- [LAW] THREE-SOURCE PRECONDITION (LORAMER_THREE_SOURCE_PRECONDITION_V1, RUSS, 2026-08-02) — **AN AMENDMENT TO WEB-FIRST DIAGNOSIS ABOVE, NOT A SECOND LAW SAYING THE SAME THING.** WEB-FIRST already names the three fields (HISTORY · WEB · REPO) and already widened to ANY build/fix/detector/schema change/diagnosis; this amendment changes WHEN the gate sits, WHO it binds, and WHERE the answer is written down. RUSS'S WORDS: "before ANY design, spec, or build instruction is written, all three must be done — (1) search all prior chats for the topic, (2) search the web as far as needed for accepted answers or existing published approaches, (3) have Claude Code search the repo, code and docs for prior discussion and prior work. Only once all three are done can any design or spec be written or anything built." THE THREE CHANGES: **(i) THE GATE MOVES EARLIER.** WEB-FIRST binds the PASTE that answers an instruction. This binds the INSTRUCTION ITSELF — the searches are a precondition of AUTHORING a design or spec, not of reporting one. A spec written from memory has already spent the budget by the time the executor's header is due. **(ii) IT BINDS THE AUTHOR, NOT ONLY THE EXECUTOR.** WEB-FIRST's enforcer is a header on Claude Code's paste; the thing being corrected all day was upstream of that paste. **(iii) THE ANSWER BECOMES AN ARTIFACT.** The header moves off the ephemeral paste and into the DECISIONS entry, where it is committed, greppable, and enforceable. THE REASON, plainly: the recurring failure is work being designed FROM MEMORY OR PATTERN rather than from sources. On 2026-08-02 every one of the day's four corrections — `synced_at` misread as a last-written stamp, "statement timeouts stopped 07-29" (a 50-group display cap, not a fact), the wrap-docs guard-count surprise, and "neither cursor advanced at 18:20Z" (read 2m54s too early, and the instruction it would have justified was to revert a WORKING fix) — traced to a source that was available and not consulted. THE ENFORCER (RULE-HOME LAW — a repeat-offense rule needs an enforcer, not another entry): `tests/guards/three-source-header.guard.mjs`, in `npm run guard`, requires the header on every DECIDED/DECISION/SHIPPED/LAW entry dated on or after 2026-08-02, all three legs present and non-empty; "NONE FOUND" is a valid answer, silence is not. ⛔ **THE LIMIT, STATED, NEVER IMPLIED AWAY** — inherited unchanged from WEB-FIRST because the amendment does not repair it: A GUARD CANNOT OBSERVE WHETHER A CHAT SEARCH OR A WEB SEARCH HAPPENED. Those occur before any code exists, in a transcript the guard cannot read and a browser it cannot see. The guard proves the ARTIFACT — three legs, non-empty — and NOTHING about whether a search occurred, was competent, or informed the design. The named residual failure is RUBBER-STAMPING, and it is documented prior art rather than our own worry: the ADR-enforcement literature warns that one rubber-stamp record "an agent later references as prior art propagates bad reasoning forward." A presence check cannot reach that; a human reading the legs can — which is why each leg must name WHAT WAS SEARCHED, not merely report a verdict.
- [LAW] FIX-WITH-GUARD — A FIX IS NOT DONE UNTIL A MECHANICAL CHECK FAILS WHEN IT REGRESSES. The guard ships in the SAME commit as the fix; a fix without its guard is not shipped. PROSE IN A DOC IS NOT A GUARD. A guard must be SEEN TO FAIL against the pre-fix code — a guard never observed failing is not a guard, it is a comment. Build it on the CODE (the thing that cannot lie about itself), never on a doc (a doc can be honest-but-false). Guard the CLASS, not today's instance: if the next writer/page/field can reintroduce the bug and the check still passes, it guards nothing. Where a pattern lives in N files, do not guard the convention — COLLAPSE IT TO ONE SOURCE and guard that (the settleRevenue / META_BREADTH_FORWARD shape): we fix files, we do not enforce rules. PROOF THIS IS NEEDED, 2026-07-15, both from this repo: (1) ESSENCE has said capture EVERYTHING/EVERYWHERE/FOREVER since day one, and 10 Meta breadth dimensions froze at their ship dates anyway, with two cursors sealing backfill_complete=13/13 over a permanent hole — nothing failed, the cron returned 200, and ~1,900 rows/client/day silently stopped existing. The law was written, present, and read every session; it changed nothing because nothing MECHANICAL enforced it. (2) The 2026-06-20 client-context fix was real, correct, and shipped — and regressed three weeks later at team/page.tsx:22 because the pattern lived in six files and no check could see the seventh. A law you cannot fail is a wish. If a mechanical guard is genuinely not achievable for a rule, SAY SO plainly rather than shipping a check that manufactures false confidence — an unenforceable guard is worse than none: it reads green exactly like sync_state read backfill_complete=13/13 while forward capture did not exist.

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

## ⛔ THE FIVE-STEP FRAMEWORK — LORAMER_FIVE_STEP_ROUNDS_V1 (LAW — RUSS, banked 2026-08-10)

**RESEARCH → ADVERSARY → TEST → RUN → VERIFY.** Every substantive flight is one of these five, named.
- **No RUN-class step ever skips a round.** A vendor spend, a deploy, a migration, a schedule — each arrives
  only after its research was permitted to kill it and its adversary round tried to.
- **Read-only steps may compress RESEARCH/ADVERSARY into one — compression is DECLARED, never silent.**
- **VERIFY is never skipped for anything that wrote, spent, or deployed.** The 2026-08-10 precedent both
  ways: the vendor probe's VERIFY found six unledgered ops no governor could see, and a push made before
  `check:data` had to be confessed rather than verified.
- **Every Claude Code instruction carries a `ROUND:` header naming its step.**
WHY IT EARNED LAW STATUS THE DAY IT WAS NAMED: the discovered-floor arc ran the full ladder — research
(retention docs), adversary (six attacks, two designs killed), test (guards red-first), run (6 probe ops
under a declared cap), verify (the meter hole) — and every round changed the next one's content.
ENFORCEMENT, honest about its limit: `tests/guards/five-step-rounds.guard.mjs` asserts this section and the
five names stay present and intact in ESSENCE — placement, like the ONE-BLOCK law. **Instruction-level
obedience lives in chat, where no repo guard can observe it; the enforcer of the header convention is Russ.**

## ⛔ RESEARCH-BEFORE-DESIGN — LORAMER_RESEARCH_BEFORE_DESIGN_V1 (LAW — RUSS, banked 2026-08-10)

**A build brief may not contain its own research. Research is a separate flight, and it is PERMITTED TO
KILL THE BUILD.** A brief that embeds its evidence has already decided; findings bent toward a build that
is already written are not findings. PRECEDENT, same day: the zero-metrics read was commissioned ahead of
its build round with kill authority stated — "if the answer is 'the vendor publishes nothing,' that is a
complete and correct result" — and the retention research DID kill design v1's clock-derived floor before
a line of it was built.
