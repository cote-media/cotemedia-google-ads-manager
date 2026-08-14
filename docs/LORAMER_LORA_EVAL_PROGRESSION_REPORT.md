# Lora AI Analyst — Evaluation Progression Report

**Prepared for independent evaluation review** · Cote LLC d/b/a Cote Media

**Revised 2026-08-14** (supersedes 2026-08-01, which superseded 2026-07-24).

> **THIS FILE IS THE LIVING RECORD.** It was maintained as a `.docx` outside the repository through
> 2026-08-01 and was committed here on 2026-08-14 at Russ's instruction. Everything below §1–§7 is the
> 2026-08-01 edition transcribed without edit; §8 onward is appended per run. Prior `.docx` revisions are
> superseded by this file and are retained only as historical artifacts.
>
> **REDACTION.** Per the rule adopted 2026-07-30, no client is named anywhere in this document. Where one
> account is referred to repeatedly it appears as "the property" or "a real merchant account"; every such
> reference in §8 is the same single account. **All figures are real and unaltered** — redaction removes
> identity, never evidence.
>
> **APPEND, DO NOT REWRITE.** Where a measurement was later found unreliable, both the original and the
> correction are retained rather than the record being amended silently. §2.3 and §8.6 are both examples.

---

## 1. Overview

Lora is the AI analyst embedded in LoraMer, a business intelligence platform for agencies and merchants. Lora answers questions over each client's captured Google Ads, Meta Ads, Shopify, WooCommerce, and GA4 data — spend, revenue, conversions, cross-platform comparisons, and the provenance of every figure she reports.

This report documents measured evaluation results over time. It is a working baseline for an independent evaluator, not a claim of readiness.

What changed in this revision. The July 24 edition reported a fully-passed 28-question set. That set was saturated — it could confirm Lora was not failing those 28 cases and could surface nothing new. It has been replaced by a purpose-built 100-question set with adversarial cases deliberately oversampled roughly 5× above natural frequency. The new set was run twice on August 1, 2026. It found two distinct defect classes that the previous set could not detect.

A necessary caution on the headline number. The August 1 run reports 34.5% on 29 questions. That is not an accuracy figure and must not be read as one. It is the pass rate on the hardest, most adversarial subset of the set — questions written specifically to make Lora fabricate or misreport a boundary. The correctness axis for the remaining 68 questions is currently ungraded pending independent ground truth (§5.2). No accuracy figure for this set exists, and none is claimed.

Accuracy bar. 95% overall pass rate, no individual category below 90%, ahead of a live demonstration on September 30, 2026, at which Lora will be voice-directed in real time and her answers cross-checked live against the source platforms. §5.3 revises what that bar can support statistically at the set's current size.

## 2. Methodology

### 2.1 Set design — v1 (28 questions) and v2 (100 questions)

The v1 set drew from three sources: hand-crafted edge cases against known data-correctness rules, real usage patterns mined from production chat logs, and cases created from confirmed production bugs so every fixed failure became a permanent regression test.

The v2 set retains that sourcing and adds a deliberate structure. Five buckets of twenty questions each — advertising data at every grain from account down to individual creative asset; GA4 and site analytics; time-based comparison; organization documents; and multi-surface questions combining all four. A sixth bucket covering live web research is written but held unscored pending a product decision on Lora's corpus rule.

Adversarial cases are salted through all five buckets rather than isolated in one. They are the only questions capable of detecting a confidently wrong answer. A set built solely from questions the system can answer measures fluency, which Lora already demonstrates.

### 2.2 The four adversarial types

| Type | Meaning | Correct behaviour |
|---|---|---|
| HOLE | Window is inside vendor retention; our capture has a gap | Name the gap; never present a partial figure as complete |
| WALL | Data does not exist at source and never will | State the boundary; never fabricate, never a false zero |
| UNVERIFIED-BOUNDARY | We do not hold it; whether the vendor would serve it is unestablished | State both facts. Asserting a vendor wall we cannot prove is itself a failure |
| CALIBRATION | Data exists, but a definitional change makes a causal claim overconfident | Answer, then bound the claim |

The third type was added during construction and is worth noting to a reviewer. Three questions had been classified as vendor retention walls. Verification showed the boundary was our own backfill constant, not a documented vendor limit. Grading them as walls would have trained the system to assert a boundary it cannot prove. The distinction is now explicit in the schema.

### 2.3 Scoring, and a correction to the July edition

The v2 runner grades adversarial and calibration questions with an LLM judge (Claude Opus 4.8) against a written rubric carrying an explicit mustNotAssert clause. That clause is load-bearing: a passing and a failing answer to the same boundary question frequently both contain the phrase "we don't have that data." The difference is the confidence attached to why. No other field in the schema can express it.

Verdicts are returned as a closed three-way classification — NAMED_BOUNDARY, FABRICATED, FALSE_ZERO — assigned in the same call as the pass/fail decision, together with a seven-way failure-cause taxonomy. An unrecognised judge value becomes a parse error rather than silently defaulting to a pass.

Correction. The July 24 edition stated that categories B, C and D were LLM-judge scored. A code read on July 31 found the v1 harness scoring deterministically by regular expression, with its rubric field present but never read. The most likely explanation is that judge scoring was performed as a separate step, or that it moved into a newer harness shipped July 28. This has not been resolved and the July figures should be treated as provisional until it is. It is recorded here rather than omitted.

## 3. Results Over Time

| Run | Model | Set | Result | Notes |
|---|---|---|---|---|
| 1 — 2026-07-14 | Sonnet 4.6 | 27 q (v1) | 74.1% raw | First eval artifact in the repository. No prior measurement of any kind exists. |
| 2 — 2026-07-14 | Opus 4.8 | 27 q (v1) | 77.8% raw / 81.5% corrected | First Opus baseline, same day and same set as Run 1. |
| 3 — 2026-07-15 | Opus 4.8 | 28 q (v1) | 82.1% raw / 100% corrected | Set grown to 28; three code fixes shipped. Not comparable to Run 2 — set and code both changed. |
| 4 — 2026-07-24 | Opus 5 | 28 q (v1) | 78.6% raw / 100% corrected | Model swap only, identical set and code to Run 3. Reproduced exactly; no delta attributable to the model. |
| 5 — 2026-08-01 | Opus 5 | 100 q (v2) | See §4 — no single figure | New set. Run incomplete (credit exhaustion at question 82); completed as Run 6. |
| 6 — 2026-08-01 | Opus 5 | 100 q (v2) | 34.5% on 29 adversarial; 68 ungraded | Merged completion of Run 5. Two defect classes identified. |
| 7 — 2026-08-14 | Opus 5 | 100 q (v3) | 56.1% on 66 gradeable; 34 ungraded | New set AGAIN (15 swapped) and the first run with hand-certified ground truth. Not comparable to Run 6 — see §8.1. Zero failures attributable to reasoning; see §8.5. |

Runs 1–4 and Runs 5–6 are not comparable. Different sets, different scoring, different difficulty by design. The v1 figures measure retrieval on questions the system was known to handle. The v2 figures measure honesty on questions written to break it.

## 4. The August 1 Run — What It Found

### 4.1 Denominators, each naming its truth source

| Count | Category | Truth source | Result |
|---|---|---|---|
| 29 | Adversarial / calibration, scored | The answer itself — no external value required | 10 pass, 19 fail — 34.5% (Wilson 95% CI: 19.9–52.7%) |
| 68 | Correctness, answered and recorded | Would be the captured store — not yet applied | UNGRADED |
| 2 | Unscored by design | — | Excluded |
| 1 | Judge parse error | — | Excluded; instrument failure, not a Lora failure |

The 34.5% figure describes a hostile subset. Per-bucket results are reported internally but every confidence interval overlaps every other at these sample sizes, and no per-bucket claim is made.

### 4.2 Defect class one — enforcers miss grain-level absence

Thirteen failures in the first run resolved to a single cause. Lora does not invent numbers from nothing. She reports missing data as zero, and partial coverage as complete.

Claimed complete geographic coverage for a quarter and ranked five states, where the geographic grain begins six weeks into that quarter.

Produced a 43-region geographic breakdown for a window holding no geographic grain at all.

Described capture-start and vendor-capability boundaries as genuine zeros on four separate questions.

Delivered clean full-year revenue and cost-per-acquisition deltas while explicitly denying any gaps existed.

Diagnosis. Every honesty enforcer built to date targets the platform-level empty state — quota outages, disconnected platforms, windows predating capture. None fires on "this grain does not exist for this window." The mechanism was proven in both directions in the same run: two questions passed because a coverage signal reached the model and it scoped its claim correctly; two failed on materially identical reasoning where no signal reached it. This is a plumbing defect, not a reasoning defect.

### 4.3 Defect class two — names the boundary, then crosses it

The second run surfaced a failure the first did not, and it is the more serious of the two. In three cases the model stated the limitation correctly and then produced the answer anyway.

Asked to compare periods either side of an account restructure, it correctly stated that account change history is not a captured surface — then invented two pivot dates and built full before-and-after comparison tables from them.

Asked for a five-year comparison, it named the analytics and advertising gaps, then manufactured the comparison regardless.

Asked for a platform health summary, it described one platform as "capturing cleanly, settled" where capture stops ten months short.

Why this class matters more. The signal arrived, was stated aloud, and did not constrain the answer. Additional coverage signal cannot fix a caveat that is already present. And because the caveat is present, the answer reads as diligence — which makes it harder for a reader to catch than a flat error. Every enforcer in the system checks whether a caveat is present. None checks whether it was obeyed.

### 4.4 Failure taxonomy — all nineteen scored failures

| Cause | Count | Layer |
|---|---|---|
| Correct but miscaveated | 7 | Model / prompt |
| Data absent — capture defect | 6 | Pipeline |
| Data absent — vendor retention | 4 | Neither — correct behaviour was to say so |
| Present but unreachable | 2 | Pipeline |

Classifying by cause rather than counting failures is deliberate. Historically the majority of failures in this system have been pipeline rather than model, and an evaluation that does not separate them sends engineering effort to the wrong layer.

### 4.5 Instrument failures found during the run

Reported because an evaluation harness is itself under test, and a harness that produces a confident wrong number is the same defect class the evaluation exists to find.

Eighteen questions that never received an answer — eleven from credit exhaustion, seven from a timeout — were scored as failures, printing 22.5% against a true 9/22. No-answer is now its own bucket, explicitly neither gradeable nor a failure.

The per-question spend ledger, shipped hours earlier, compared timestamps as strings across two formats and misattributed half the run's cost on its first execution. Corrected before the cost figures below were taken.

Two questions marked unscored by design received verdicts anyway; one judge response returned prose rather than structured output and was correctly excluded rather than defaulted to a pass.

## 5. Current State and Open Gaps

### 5.1 Set status

100 questions, all answered. The adversarial subset is complete at 29 scored. The set is not saturated and has diagnostic power remaining — it found two defect classes on first contact.

### 5.2 Ground truth — the principal open gap

Sixty-eight questions require a value read from the source platform at a pinned timestamp, with a restatement tolerance recorded alongside. That work has not been done, and until it is there is no accuracy figure for this set. Ground truth derived from our own captured store would be circular: a question about a window we never captured would score as correct against an empty expected value — precisely the failure the set exists to detect.

An interim measure has been prepared. Each of the 68 questions has been repointed to a window the coverage instrument independently verifies as complete at the required grain. On such a window the store and the platform should agree, so a later disagreement is a capture finding rather than an evaluation failure. This is weaker than a platform read and is labelled as such in every case record.

### 5.3 Statistical power — a revision to the stated bar

The 95%-on-100 target does not support the claim it appears to. At n=100 with 95 correct, the Wilson 95% confidence interval runs approximately 88.8% to 97.8%. Passing that bar licenses "at least 89% with 95% confidence," not "95% accurate."

| Sample size | Observed | Approx. 95% CI lower bound |
|---|---|---|
| 100 | 95% | 88.8% |
| 200 | 98% | ~95.0% |
| 400 | 98% | ~96.1% |
| 400 | 96% | ~93.5% |

Recommendation: retain 100 as the engineering milestone — it is the right size to find defects, and it did — and treat 200 to 400 as the size required for an external accuracy claim. Report the interval, never the point estimate.

A second and more binding constraint: across five buckets, each holds twenty questions and as few as two adversarial cases. Per-bucket accuracy at that size is not reportable. Only the aggregate, with its interval, is.

### 5.4 Known limits

Determinism is not yet scored. It requires repeated sampling against a pinned data snapshot; across separate live sessions the underlying data moves, so a differing answer may be correct rather than contradictory. The harness is specified and unbuilt.

The organization-documents bucket largely fails by design at this stage. Several capabilities it tests — naming a required document that has not been uploaded, per-document freshness — are specified and not yet built. The bucket establishes a pre-build baseline.

The coverage instrument cannot yet express a family that is legitimately absent. A day with advertising spend but no search campaigns correctly returns no search-term data; the instrument counts it as a gap. This produced two false findings during set construction, both withdrawn with their evidence.

One vendor retention boundary remains unverified against vendor documentation and is the subject of a live probe. Three questions are classified as UNVERIFIED-BOUNDARY pending that result.

Two evaluation harnesses currently coexist with different scoring models. The newer resolves expected values from the database at run time, which is better engineering for retrieval questions and explicitly ruled out for this set as circular. Both are correct for different question types; the split is recorded and unresolved.

## 6. Cost and Operational Notes

Included because evaluation cost governs how much iteration is affordable before September 30.

| Measure | v1 (28 q, 2026-07-24) | v2 (100 q, 2026-08-01) |
|---|---|---|
| Cost per question | $0.093 | $0.273 |
| Total run cost | $2.70 | $27.28 |
| Input tokens per call | 6,133 | 20,582 |
| Output tokens per call | 1,068 | 3,524 |
| Prompt cache hit rate | Active | 55.9% of context served from cache |

The 2.9× increase per question is not a caching regression. Caching was active and served 55.9% of context. Input per call rose 3.4× and output per call rose 3.3× — the v2 questions are materially harder and more open-ended ("reconcile these three figures," "defend it with three independent sources"), and produce proportionally longer answers. Answer length alone accounts for 39% of total run spend, the single largest line item.

Planning figure: approximately $27 per full 100-question run. At 200 questions, roughly $55. Iteration to a target typically requires ten to twenty runs.

Latency: median response time remains a constraint for the voice-directed demonstration format. Four questions exceeded 120 seconds, the longest at 171 seconds; the harness timeout has been raised to 300 seconds on that evidence. Streaming and response-length tuning are in progress and unresolved.

A measurement gap found and closed during this run: the evaluation harnesses call the model API directly and were invisible to the application's own spend ledger. Two such call sites predated this run and a third was added during it; none was noticed until a run cost enough to prompt investigation. Per-question spend logging now runs inside the harness. Production paths were unaffected and remain fully logged.

## 7. What a Reviewer Should Press On

Offered directly rather than left to be discovered.

Ground truth (§5.2) is the weakest part of this evaluation and is stated as such. Any assessment of the correctness axis should begin there.

The July 24 scoring discrepancy (§2.3) is unresolved. Those figures are provisional.

Defect class two (§4.3) has no proposed mechanical fix. Every existing enforcer verifies caveat presence; none verifies caveat obedience, and it is not obvious that a static check can.

The LLM judge has been validated for verdict consistency but not for rubric-grading agreement with human labels. No inter-rater statistic is reported because none has been computed.

Adversarial cases are oversampled roughly 5× above natural frequency. Any weighting back to a natural distribution would need to be stated explicitly and has not been performed.

This report reflects verified data as of August 1, 2026. Figures are recorded as measured; where a measurement was later found unreliable, both the original and the correction are retained rather than the record being amended silently.

---

## 8. The August 13–14 Cycle — Set v3, a Certified Truth Pass, and the First Real Baseline

### 8.1 Another set break, and why the number moved so far

The v2 set described in §2.1 was replaced on 2026-08-13. Fifteen of its hundred questions were swapped
out and the scoring set was rebuilt as **v3** (`eval-set-v3.json`, built from HEAD `5e8997b`).

**Scores across v2 and v3 are not comparable, and no trend line should be drawn through them.** This is the
same caution §3 attaches to the v1→v2 break, for the same reason and with the same force: fifteen questions
changed, the truth basis for the correctness axis changed from *ungraded* to *hand-certified* (§8.2), and the
gradeable denominator changed with it. A reader who plots 34.5% (Aug 1) against 56.1% (Aug 14) is plotting two
different measurements of two different things. **The honest statement is that this is the first baseline of
its kind, not an improvement over the last one.**

The reason the set was broken rather than extended is recorded in §5.2 of the previous edition: sixty-eight
questions had no independent ground truth, and truth derived from our own captured store would be circular. v3
exists to close that gap.

### 8.2 The truth-certification pass — the principal open gap of §5.2, closed

The single weakest part of the previous evaluation was that most questions had no value read from a source
platform. That work was done on 2026-08-13/14, by hand, by the operator, reading each figure **in the vendor's
own interface** and returning it for reconciliation against the recipe the harness would score with.

**Fourteen hand readings were taken across all five platforms; twelve reconciled on the first pass.** Four
families disagreed and were escalated with an explicit instruction: for every miss, determine which side is
wrong — *the truth recipe or the capture* — and say why. All four were resolved with evidence rather than
assumption, and the resolutions are more interesting than the pass rate:

| Family | Disagreement | Resolution |
|---|---|---|
| Google Ads | Stored figure below the interface | **The recipe was wrong.** The vendor restates conversions after the fact; the capture was faithful to what the API served on the capture date. The recipe now anchors to the restated window. |
| Shopify net revenue | Stored month read low against the admin | **The capture is right on its own stated basis, and the basis differs from the vendor's.** We book a refund on the ORDER's date; the admin books it on the day the refund was processed. Proven by a live API read, not inferred: refunds processed after the month's close against orders created inside it are of the same order of magnitude as the entire discrepancy. Two different, defensible bases — not an error. Now declared. |
| GA4 sessions | Stored year read high against the property | **Both are right; the grain differs.** See §8.3. |
| Top keyword by cost | Stored ranking disagreed with the reading | **The verification method was the defect** — the two figures were read at different grains. Neither the recipe nor the capture was wrong. |

Two of the four "failures" were defects in how we were *checking*, not in what we hold. That is worth stating
plainly to a reviewer: an evaluation apparatus is itself a system under test, and this pass found more bugs in
the apparatus than in the product.

A rounding hypothesis and a multi-level summation hypothesis were both raised during this pass and both were
**checked and killed against the data** rather than left as plausible explanations.

### 8.3 The grain decision, and a correction to a claim made during this cycle

GA4 session counts differ between our store and the customer's property because the two answer different
questions. GA4 **deduplicates a session that spans midnight** when it reports a range; our store holds one row
per day, so summing them counts that session twice. The operator's decision, recorded 2026-08-13:

> **The RANGE TOTAL is the certified customer-facing truth.** Per-day rows stay stored and untouched. This
> decides what Lora *states*, not what we keep. Where she cannot serve the range, she **declares the per-day
> basis**.

Serving range totals requires either a live vendor call on the answer path or a stored range-total grain.
Neither is designed; the decision is recorded as a queued design question, and the second clause — declare the
basis — is what shipped (§8.5).

**Correction, made the same day it was introduced.** An earlier draft of the shipped caveat asserted that the
per-day sum always reads *high*, reasoning from the dedup mechanism alone. Three certified readings on the same
property disprove that as a rule:

| Window | Our per-day sum | Property range total | Direction |
|---|---|---|---|
| Full year, 2025 | 552,253 | 549,971 | ours **high** by 0.41% |
| Full year, 2024 | 791,628 | 799,881 | ours **low** by 1.03% |
| One recent month | 1,817 | 1,915 | ours **low** by 5.12% |

Two mechanisms push in opposite directions — dedup shrinks the vendor's range below our sum; any capture gap
shrinks our sum below theirs — and which dominates depends on the window. The shipped caveat now claims a
*difference* and explicitly refuses to claim a *direction*. Stating "slightly high" as a rule would have given
Lora a confident explanation for a discrepancy that runs the other way in two of three measured windows.

### 8.4 The August 14 baseline

Run on commit `0337a47`, model Opus 5, 01:22–03:23 UTC, 100 questions / 109 chat turns.

**37 pass · 29 fail of 66 gradeable = 56.1%.** Thirty-four questions are ungraded by design (held families and
reasoned refusals kept out of the denominator).

| Bucket | Result | vs the 90% floor |
|---|---|---|
| A — advertising data, all grains | 7/15 (47%) | fail |
| B — GA4 / site analytics | 4/8 (50%) | fail |
| C — time comparison | 7/16 (44%) | fail |
| D — organization documents | 3/3 (100%) | **pass** |
| E — cross-platform | 6/9 (67%) | fail |
| M — multi-turn | 6/8 (75%) | fail |
| V — voice-shaped phrasing | 4/7 (57%) | fail |

Judge classification across the scored adversarial cases: **NAMED_BOUNDARY 19 · FABRICATED 9 · FALSE_ZERO 8.**
Failure-cause taxonomy: PRESENT_BUT_UNREACHABLE 6 · DATA_ABSENT_CAPTURE_DEFECT 5 · CORRECT_BUT_MISCAVEATED 4 ·
DATA_ABSENT_VENDOR_RETENTION 2.

**Against the 95% bar this is far short — 26 questions short.** The per-bucket picture is worse than the
aggregate, and §5.3's caution still binds: at these bucket sizes, per-bucket rates are not reportable as
accuracy. They are reported here as *diagnosis*, which is what they are good for.

### 8.5 The finding that matters more than the number

**ZERO failures were attributable to reasoning.** Not one fail in the run traces to arithmetic, comparison, or
inference. Every numeric miss was a miss because the input never reached the model.

**The largest single failing class was PRESENT_BUT_UNREACHABLE** — questions Lora refused, fluently and
confidently, about data the platform had held for months. In her own words, on data that was in the store:

> "the captured GA metric set doesn't return sessions"
> "sessions aren't in the captured store — that's a gap in what we capture"

Both statements are false. Session counts, event counts, order counts and a dozen similar metrics are written
to a JSON column on every row, and **neither aggregation path ever read that column**: the base-row reader
selected six fixed metric columns, and both breakdown aggregation functions summed the same six. The metric was
one `SELECT` away from the answer for the entire history of the feature.

This is worse than a wrong number, and a reviewer should weigh it as such: **the system reported its own gap as
the customer's gap.** A user told their data does not exist has no way to discover that it does.

The defect was fixed on 2026-08-14 (§8.7). Six of the run's failures are attributed to it directly, and the
four hand-certified GA figures now reproduce exactly through the shipped query path.

### 8.6 What could not be done, and what it cost

**The three-pass re-judge could not be performed, so 17 boundary FAILs stand un-re-judged and are reported as
provisional.** The re-judging tool read a hardcoded question set — the *previous* one. Run against the v3
results it matched question IDs against v2 rubrics and produced a confident, entirely invalid report, grading
answers against questions that had never been asked. Its output was deleted rather than filed. Cost of the void
run: $0.33, spent and wasted.

The tool now resolves the question set from the results file's own metadata, accepts an explicit override, and
**treats any result whose ID is absent from the set as a fatal error before a single paid call is made** rather
than as a silently skipped row. Verified against the exact mistake: 78 of the 100 v3 results are absent from the
old set, and the tool now refuses the run instead of grading the other 22 against the wrong rubrics.

### 8.7 The first fix, shipped the same day

The unreachability defect (§8.5) was fixed as one change with its own build guard and a live data check:

- The summable JSON-resident metrics are **declared once** — twenty keys across four platforms, each carrying
  the argument for why summing it across days is correct. Non-summable keys are declared too, with reasons:
  deduplicated people-counts and every ratio are explicitly refused, because summing a deduplicated user count
  across a year inflates it by the return rate and looks entirely plausible on the way out.
- Both aggregation functions were replaced in place — signature frozen, so the access-control posture set six
  days earlier could not be silently reverted by a drop-and-recreate.
- Absent metrics are returned **absent, not zero**. The neighbouring failure class in the same run was
  FALSE_ZERO, counted eight times; a fix for unreachability that manufactured zeros would trade one for the other.
- Ranking by these metrics is now supported, which "top ten landing pages **by sessions**" requires. Reaching a
  number is only half of that question.

**Measured cost before shipping**, on the heaviest real slice (279,048 rows → 249,621 groups, twelve months):
query plan unchanged, execution unchanged within noise (3.21s → 3.07s), memory the real cost — the aggregate row
widens 38 → 207 bytes and the hash spill grows 74 MB → 125 MB. Every expression is gated so platforms declaring
no such metrics pay nothing.

**Verification coverage, stated as a limit:** the four certified GA figures are proven end-to-end through the
shipped path by an automated data check that fails with the numbers on its face. The twelve non-GA keys ship on
declared additivity and are **not** covered by any hand-verified figure yet.

### 8.8 Cost

| Measure | v2 (100 q, 2026-08-01) | v3 (100 q, 2026-08-14) |
|---|---|---|
| Total run cost | $27.28 | **$27.95** |
| Chat turns | 100 | 109 |
| Cost per turn | $0.273 | $0.256 |
| Context served from cache | 55.9% | 9,061,509 tokens read from cache |

The estimate before the run was ~$22; actual was $27.95, **27% over, and the projection was wrong.** A second
prompt-cache breakpoint had been added to the chat path four days earlier and was expected to cut per-question
cost materially. It did not: caching worked (roughly nine million cached tokens read, an order of magnitude
cheaper than uncached), but the v3 questions require more tool iterations, and that absorbed the gain.
Per-turn cost is essentially flat across the two runs.

**Planning figure: ~$28 per full run, unchanged.** A $500 evaluation allocation supports roughly six full
regressions plus partials — not the larger number the caching change had been expected to buy.

### 8.9 The ranked fix list this baseline bought

Ordered by leverage, and deliberately model-last:

1. **Surface the JSON-resident metrics on the query path.** One defect, the largest single scoreboard move.
   **Shipped and verified 2026-08-14** (§8.7, §8.11).
2. **Entity-name and grain selection.** Campaign names exist in the store and were reported as blank; one
   creative question was answered at the wrong grain, where every metric is legitimately zero. Query-layer work.
3. **A false-zero refusal.** A window with no completed capture cursor must be *unanswerable*, not zero. Six
   failures presented a confident zero, one of them with a full year-over-year table built on it.
4. **Fix the re-judging tool.** **Shipped 2026-08-14** (§8.6) — it blocks trusting any boundary verdict.
5. **Miscaveation.** Right shape, wrong confidence: answers asserting vendor retention boundaries that have not
   been established. Cheapest, and last.

Items 1–4 are mechanical. **None of this list is "improve the model."** That ordering is deliberate and is the
same discipline §7 asks a reviewer to press on: where a system is wrong, the burden is on establishing that
reasoning failed before anything is attributed to reasoning — and in this run, nothing was.

### 8.10 What a reviewer should press on, updated

The five items in §7 stand except where noted. Added:

- **§8.1 comparability.** The Aug 1 and Aug 14 figures measure different sets against different truth bases. No
  trend claim is made and none should be inferred.
- **§8.4 bucket sizes.** Per-bucket rates are diagnosis, not accuracy. §5.3's statistical caution is unchanged
  and unaddressed: 100 questions remains the right size to find defects and the wrong size to claim a rate.
- **§8.6.** Seventeen boundary verdicts are provisional pending a re-judge that could not be run.
- **§8.7 coverage.** Twelve of the twenty newly-served metrics have no hand-verified figure behind them.
- **The ground-truth gap of §5.2 is closed for v3 (§8.2) and remains open for anything the set does not cover.**
  A certified truth pass is a snapshot; it ages as the vendors restate.

### 8.11 Verification of the first fix

The six failures attributed to the unreachability defect were re-run against the shipped code as a partial,
same set, same model, same harness. **All six pass: 0/6 → 6/6.**

| Question | Baseline 2026-08-14 | After the fix |
|---|---|---|
| Top landing pages by sessions | FAIL — "that metric isn't in the captured landing-page family" | **PASS** — 2,742 / 2,033 / 1,315 |
| Conversion events by count | FAIL — "the per-event counts didn't come back" | **PASS** — 5,603 / 3,252 / 2,423 |
| Device split for site traffic | FAIL — "does not carry sessions or users at this grain" | **PASS** — 10,567 / 5,766 / 889 |
| Sessions by channel | FAIL — "`sessions` isn't a stored metric" | **PASS** — 1,269 / 728 |
| Multi-turn: top channel in June | FAIL — "the captured GA metric set doesn't return sessions" | **PASS** — 1,269 |
| Sessions, 2025 vs 2024 | FAIL — "sessions aren't in the captured store" | **PASS** — 552,253 / 791,628 |

Cost $1.69 against a $1.70 estimate. **The per-day basis is stated in the answers rather than merely available
to them**, and it survives across turns in the multi-turn case, unprompted: *"Same per-day-sum basis as the July
figures I gave you."* That was the point of shipping the declaration with the numbers instead of after them.

⛔ **WHAT THIS DOES NOT SHOW, and it is the more important half.** This is **6 questions of 100**. The 95%
confidence interval on 6/6 runs 61.0%–100.0%, which is another way of saying a six-question run cannot establish
a rate. **It is not an overall score, it does not supersede the 56.1% baseline, and nothing here should be
quoted as an accuracy figure.** What it establishes is narrower and sufficient for its purpose: the specific
defect is closed on the specific cases that exposed it. The next full run is what moves the scoreboard, and the
remaining items in §8.9 are what it is waiting on.
