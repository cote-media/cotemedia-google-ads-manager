#!/usr/bin/env node
// LORAMER_GUARD_RUNALL_V1 — run every guard, collect the failures, report once, exit non-zero.
//
// WHY THIS REPLACED THE && CHAIN. `npm run guard` was 24 segments joined by `&&`, so the shell stopped at the
// FIRST non-zero exit and every later guard was never invoked. A RED build therefore reported ONE finding and
// hid an unknown number of others — and a green tail that never executed is indistinguishable, in the output,
// from a green tail that passed. That is the narrow-green class this repo has banked repeatedly, turned inward
// on the guards themselves. It was found on 2026-07-29 only because a human ran the remaining 11 by hand after
// a failure at segment 13; nothing in the tooling said they had been skipped.
//
// ADAPT-VS-AUTHOR, decided against the published option and stated (WEB-FIRST law). npm-run-all2's
// `--continue-on-error` is the maintained implementation of exactly this idea: run everything, collect, exit
// non-zero at the end. It was REJECTED, for three concrete reasons rather than taste:
//   1. It orchestrates NPM SCRIPTS, not commands. Our guards are bare `node <path>` invocations, so adopting it
//      means first inventing 24 npm script entries whose only purpose is to be named by the runner.
//   2. It treats every non-zero exit the same. It cannot give the FAILED-vs-CRASHED split, which is the whole
//      point here — verify-the-instrument applies to the guards themselves, and a guard that could not RUN is a
//      different severity from a guard that ran and found something.
//   3. It would be a new dependency ON THE BUILD PATH (`npm run build` -> `npm run guard`, executed on Vercel).
//      Same call as the Vercel-AI-SDK rejection in LORAMER_CHAT_STREAMING_V1: not worth a dependency to buy
//      framing we can write in sixty lines.
// The PATTERN is theirs (spawn, collect, report, non-zero at the end); the script is ours because the three
// requirements above are not in it.
//
// THREE BUCKETS, NOT TWO:
//   PASSED   exit 0.
//   FAILED   the guard RAN and its own assertion failed. Its output is the finding.
//   CRASHED  the guard could not run — missing file, bad import, syntax error, killed by a signal. A BROKEN
//            INSTRUMENT. It is not evidence that the code is fine and it is not evidence that it is broken; it
//            is evidence that we currently cannot tell, which is worse than either and is why it is its own bucket.
// ⚠ HONEST LIMIT of the split: Node exits 1 for an uncaught throw AND our guards exit 1 for an assertion
// failure, so the exit code alone cannot separate them. The classifier reads the stderr SHAPE (module-load
// errors, or an Error line with a stack frame) plus signals and exit codes > 1. That is a heuristic. A guard
// whose own failure text happens to print a stack-shaped string could be mislabelled CRASHED — which is the
// SAFE direction (it over-reports a broken instrument rather than hiding one), but it is a heuristic and is
// named as one rather than sold as a proof.
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const ROOT = process.env.LORAMER_GUARD_ROOT || process.cwd()

// THE ORDER IS THE OLD && CHAIN, SEGMENT FOR SEGMENT. Do not reorder casually: two positions are load-bearing
// and are asserted below.
const GUARDS = [
  'tests/guards/meta-breadth-forward.guard.mjs',
  'tests/guards/shell-client-context.guard.mjs',
  'tests/guards/fetch-errors-rendered.guard.mjs',
  'tests/guards/source-parity.guard.mjs',
  'tests/guards/chat-failure-branches.guard.mjs',
  'tests/guards/chat-turn-pair-write.guard.mjs', // LORAMER_CHAT_TURN_PAIR_WRITE_V1 — server owns both turns, atomic pair, user first
  'tests/guards/chat-stream-consumers.guard.mjs',
  'tests/guards/chat-scroll-chain.guard.mjs',
  'tests/guards/chat-timer-ordering.guard.mjs',
  'tests/guards/fetcher-swallow.guard.mjs',
  'tests/guards/shopify-api-version-pin.guard.mjs',
  'tests/guards/order-grain-writer.guard.mjs',
  'tests/guards/metrics-payload-uniformity.guard.mjs',
  'tests/guards/metrics-upsert-chunked.guard.mjs',
  'tests/guards/meta-breakdown-dedupe.guard.mjs',
  'tests/guards/canonical-client-identity.guard.mjs',
  'tests/guards/ga-dim-completion-honesty.guard.mjs',
  'tests/guards/ga-auth-honesty.guard.mjs',
  'tests/guards/token-freshness-and-validation.guard.mjs',
  'tests/guards/coverage-breakdown-grain.guard.mjs',
  'tests/guards/capture-limit-is-measured.guard.mjs',
  'tests/guards/entity-state-scd2.guard.mjs',
  'tests/guards/google-op-budget.guard.mjs',
  // LORAMER_GOOGLE_FORWARD_RESTATE_V1 — Google forward may not ask for one day. Google numbers restate
  // AFTER capture (spend and clicks, not only conversions), so a single-day fetch stores a value that is
  // already wrong the next morning and nothing ever re-asks it. Also holds the account grain to exactly
  // ONE producer with no campaign-status filter, per Russ's ruling that deleted campaigns' spend counts.
  'tests/guards/google-forward-must-restate.guard.mjs',
  'tests/guards/google-campaign-anchor-missing.guard.mjs', // LORAMER_GOOGLE_CAMPAIGN_ANCHOR_MISSING_V1 — absent account anchor refuses; present zero anchor writes

  // LORAMER_GOOGLE_RESTATE_PRUNE_V1 — the STATIC half of the only destructive write in the Google capture
  // path. Source-only, so it is safe in a Vercel build; the BEHAVIOURAL half writes to the database and
  // therefore lives in check:data as `check-restate-prune-live`, outside the deploy path.
  'tests/guards/google-restate-prune-capped.guard.mjs',
  // LORAMER_DEPLOY_POLL_UNTIL_TERMINAL_V1 — PLACEMENT guard only (the one-block-output posture): the
  // deploy-poll rule must live in CLAUDE.md's push section. Obedience is chat conduct and unenforceable
  // by construction; the guard says so on its own green line.
  'tests/guards/deploy-poll-terminal.guard.mjs',
  // LORAMER_WINDOW_PAST_CAPTURE_V1 — a window whose TAIL runs past the newest captured day may never read
  // 'covered'. THIS_MONTH and THIS_WEEK are TO-DATE (date-range.ts:81, :92) and end at TODAY, which forward
  // capture never writes — so they were verdicted COMPLETE every day with today silently absent.
  'tests/guards/window-past-capture-is-not-complete.guard.mjs',
  // LORAMER_METRIC_SET_HONOURS_REFUSAL_V1 — an entry that RECORDS a refusal may never be asked for the
  // metric it records as refused, and a measured-empty servesMetrics may never resolve to the default five.
  // `[]` meant "measured: none of our metrics work here"; buildGaql read it as "no information" and asked
  // all five, which the vendor refused, which composeWalkStop promoted into a floor, which sealed two
  // surfaces holding 4.2M impressions in one month.
  'tests/guards/metric-set-never-asks-a-refused-metric.guard.mjs',
  // LORAMER_NO_CACHED_DB_READ_V1 — a read that gates a write, or reports live state, may never be served from
  // Next's Data Cache. Enforced at the ONE source (supabaseAdmin) rather than across 105 route files.
  'tests/guards/no-cached-live-state-read.guard.mjs',
  // LORAMER_WIRE_COVERAGE_INSTRUMENT_V1 — the breakdown-grain verdict must REACH Lora, CHANGE what she is told
  // to say, and stay off query_metrics and the per-turn path.
  'tests/guards/breakdown-coverage-wired.guard.mjs',
  // LORAMER_DOC_OWNERSHIP_GUARD_V1 — a doc may POINT at a fact, never STATE a value another source owns.
  // Hermetic half only (model ids, version pins, file facts); the DB half is in check:data.
  'tests/guards/doc-ownership.guard.mjs',
  // LORAMER_QUOTA_ARM_AT_ERROR_BOUNDARY_V1 — every sentinel reader either arms it or is allowlisted with a
  // reason; every Google error boundary arms; the swallow point marks an outage so it cannot read as absence.
  'tests/guards/quota-sentinel-armed.guard.mjs',
  'tests/guards/connection-outcome-honesty.guard.mjs',
  'tests/guards/rangelap-completion-honesty.guard.mjs',
  'tests/guards/drain-fair-share-order.guard.mjs', // LORAMER_DRAIN_FAIR_SHARE_STEP_ORDER_V1
  'tests/guards/chat-status-line.guard.mjs', // LORAMER_CHAT_STATUS_SUBJECT_V1
  // LORAMER_CHAT_STATUS_FIRST_V1 — the three Gate-B device defects of 2026-08-02: status must LEAD the turn
  // (and release the route's commit gate), the LM mark must mount BOTH as working indicator and as avatar,
  // and the WebKit facts that killed the sweep and the mark (pathLength, negative dash offset, the
  // background-clip pairing) may not come back. Visual behaviour is Gate-B, not assertable here.
  'tests/guards/chat-status-visible.guard.mjs',
  'tests/guards/one-working-indicator.guard.mjs',
  'tests/guards/chat-deadline-margin.guard.mjs',
  'tests/guards/lora-thread-shared.guard.mjs',
  // LORAMER_NEXT_FOCUSABLE_16PX_V1 — the card surface's focusable controls must clear the 16px iOS auto-zoom
  // floor DECISIONS:599 banked for the chat composer and nobody ever applied here. Registered the same day it
  // was written: an unregistered guard never runs.
  'tests/guards/next-focusable-16px.guard.mjs',
  // LORAMER_COMPARE_LABEL_YEAR_V1 — a comparison chart whose two series carry the SAME name reads as broken
  // even when the data is right. Observed on device 2026-08-16; the leg lifts and DRIVES the real label fn.
  'tests/guards/compare-label-year.guard.mjs',
  // LORAMER_HYDRATED_CUSTOM_RANGE_V1 — a saved custom range restored with the select reading "Custom range…"
  // and NO date inputs on screen. Observed on device 2026-08-16; the leg lifts and DRIVES the real decision.
  'tests/guards/hydrated-custom-range.guard.mjs',
  // LORAMER_DEFAULT_CARD_PLATFORM_CLAIM_V1 — a card TITLED for a platform must REQUEST it; "Age (Meta)" did not,
  // so metrics-query's developer refusal rendered on a customer-facing card. Lifts and BUILDS the default views.
  'tests/guards/default-card-platform-claim.guard.mjs',
  // LORAMER_CARD_PLATFORM_RESOLUTION_V1 — the guard above proved the DEFAULT view and the card stayed broken for
  // every user who has a saved one. This drives the RESOLUTION with the verbatim stored card from production.
  'tests/guards/card-platform-resolution.guard.mjs',
  // LORAMER_MER_BASIS_TRUTHFUL_V1 — the MER card called a store-only numerator "blended revenue". Drives the real
  // label function against each source the settle can pick. Asserts the LABEL, never the arithmetic.
  'tests/guards/mer-basis-truthful.guard.mjs',
  'tests/guards/chat-screen-tracks-server.guard.mjs',
  'tests/guards/lora-back-parity.guard.mjs',
  'tests/guards/chat-status-truthful.guard.mjs',
  'tests/guards/chat-status-fits.guard.mjs',
  'tests/guards/chat-copy-blocks.guard.mjs', // LORAMER_CHAT_COPY_BLOCKS_V1
  'tests/guards/paste-able-output.guard.mjs', // LORAMER_CHAT_PASTE_ABLE_OUTPUT_V1
  'tests/guards/chat-cache-and-recovery.guard.mjs', // LORAMER_CHAT_COST_AND_RECOVERY_V1
  'tests/guards/chat-merge-not-replace.guard.mjs', // LORAMER_CHAT_MERGE_NOT_REPLACE_V1
  'tests/guards/chat-in-flight-and-back.guard.mjs', // LORAMER_CHAT_IN_FLIGHT_SURVIVES_REMOUNT_V1 + LORAMER_LORA_BACK_LANDS_ON_THE_CLIENT_V1
  'tests/guards/landing-scroll.guard.mjs', // LORAMER_NEXT_LANDING_SCROLL_V1
  'tests/guards/router-scroll-off.guard.mjs', // LORAMER_NEXT_ROUTER_SCROLL_OFF_V1
  'tests/guards/google-quota-read-fails-open.guard.mjs',
  'tests/guards/next-step-obeys-ranking.guard.mjs',
  'tests/guards/breakdown-registry-drift.guard.mjs',
  'tests/guards/digest-queue-coverage.guard.mjs',
  'tests/guards/docs-queue-coverage.guard.mjs',
  // LORAMER_DECISION_TOPIC_INDEX_V1 — §L must be GENERATED (recompute + diff), must agree with §H on every
  // token's status, and must keep reporting its own untokened backlog.
  'tests/guards/decision-topic-index.guard.mjs',
  // LORAMER_ONE_BLOCK_OUTPUT_V1 — PLACEMENT ONLY. No guard can observe chat output; this asserts the rule is
  // at the TOP of CLAUDE.md / ESSENCE governing law / RESUME_INSTRUCTIONS and reached the generated digest.
  'tests/guards/one-block-output.guard.mjs',
  // LORAMER_THREE_SOURCE_PRECONDITION_V1 — every DECIDED/DECISION/SHIPPED/LAW entry banked on or after
  // 2026-08-02 must carry a THREE-SOURCE header (PRIOR CHATS · WEB · REPO), all three legs non-empty.
  // Enforces the ARTIFACT only — no guard can see whether a chat or web search actually happened.
  'tests/guards/three-source-header.guard.mjs',
  // LORAMER_GOOGLE_ADS_UNIVERSE_WRITER_V1 — no clock may seal a walk (vendor-exhausted only), no per-surface
  // branching (the surface list comes ONLY from docs/google-ads-capture-universe.json), and an unsatisfiable
  // structural requirement is RECORDED rather than silently dropped.
  'tests/guards/google-ads-universe-writer.guard.mjs',
  // LORAMER_GOOGLE_ADS_UNIVERSE_RUNNER_V1 — a redelivered message must land on identical conflict keys
  // (Queues is at-least-once), the governor must reserve headroom for forward+drain and stop BEFORE the
  // cap, completion may come only from the writer's vendor-exhausted proof, and NO cron may fire the path.
  'tests/guards/universe-runner.guard.mjs',
  'tests/guards/universe-entity-axis.guard.mjs',
  'tests/guards/universe-artifact-slots.guard.mjs',
  'tests/guards/universe-derived-time.guard.mjs',
  'tests/guards/universe-window-log.guard.mjs',
  'tests/guards/universe-failure-is-durable.guard.mjs',
  // LORAMER_UNIVERSE_SURFACE_LABELS_V1 — the walk writes the VENDOR's names; a completeness statement has to
  // be in the CLIENT's. An unlabelled delivering resource or segment cannot appear in that sentence, so it
  // vanishes from the report while still being incomplete — silence, arriving through the vocabulary gap.
  'tests/guards/universe-surface-labels.guard.mjs',
  // LORAMER_UNIVERSE_ATTEMPT_LOG_V1 — the append-only property, statically. The DB half of this guard
  // (--db: catalog unique-index and grant checks) runs in `check:data`, same posture as
  // universe-failure-is-durable — DB work stays off the Vercel build path.
  'tests/guards/universe-attempt-append-only.guard.mjs',
  // LORAMER_UNIVERSE_CONSUMER_V2_V1 — the streaming consumer's four properties: a charged attempt_started
  // before every vendor call · a day is covered only when a later day closes it (synthetic mid-day kill) ·
  // the coverage module never reaches the attempt-log module · the bound is judged at the MINIMUM span.
  'tests/guards/universe-stream-consumer.guard.mjs',
  // LORAMER_DRAIN_FITS_THE_INTERVAL_V1 — the pair identity (bite × WALK_BUDGET_MS ÷ maxConcurrency ≤ cron
  // interval) EXECUTED rather than described. It lived in three comments across two deploys and nothing
  // asserted it; a cadence change alone passed all 133 guards on 2026-08-19. Hermetic — file reads only.
  // LORAMER_QUEUE_REMOVED_INLINE_WALK_V1: queue-drain-fits-the-interval RETIRED with the queue;
  // its successor asserts the inline fire's time identity + the lease TTL relationship.
  'tests/guards/inline-fire-fits-the-ceiling.guard.mjs',
  'tests/guards/one-delivery-lane-per-topic.guard.mjs',
  // LORAMER_TOP_EDGE_ATTESTS_BY_MESSAGE_V1 — every writer of universe_attempt_log must NAME the lane. The
  // column has a DEFAULT ('descend'), so an omitting writer lands a mis-stamped row that looks correct:
  // measured 2026-08-19, three terminal writers omitted it and a top-edge zero attested 12 surface-days.
  // Hermetic — source reads only.
  'tests/guards/attempt-writers-carry-the-lane.guard.mjs',
  // LORAMER_LM_MARK_IS_TEXT_HEIGHT_V1 — the LM mark is the answer's LINE BOX, derived from the same two
  // tokens the text uses, on both axes, with identical portal-fallbacks. It shipped as `size = 34` — a free
  // constant — for sixteen days while Russ's "roughly TEXT-HEIGHT" correction sat banked in chat with nothing
  // able to go red about it. Hermetic — CSS/TSX source reads only.
  'tests/guards/lm-mark-is-text-height.guard.mjs',
  // LORAMER_MISSIZE_REOWES_THE_UPPER_HALF_V1 — a narrowed window must be SPLIT, never TRUNCATED. Drives the
  // real `planMisSizedSplit` for the invariant (no day of the window belongs to neither half) and reads the
  // consumer for the ORDER (the endangered upper half is published FIRST, and a refusal holds the whole
  // window). It belongs in the BUILD, not check:data: it needs no database and it is GREEN, so a red here is
  // a regression someone just wrote rather than history waiting on a re-walk.
  'tests/guards/mis-size-must-re-owe.guard.mjs',
  // LORAMER_COMPLETION_SIGNAL_V1 — the terminal row must be UNAVOIDABLE, not remembered. The consumer has
  // nine exits and one of them is an uncaught throw, so a per-return write covers eight; this checks the
  // STRUCTURE (named body · one try/catch/finally · the write inside the finally · the catch rethrows · no
  // exit above the try). RED-PROVEN against 7cd2f13, which fails four of its legs.
  'tests/guards/completion-signal-on-every-exit.guard.mjs',
  // LORAMER_COMPLETION_SIGNAL_V1 — one ceiling, declared once, read in three places, written in none. Pro
  // permits 800s/1800s, so `maxDuration` moving is legal and a hard-coded 300 elsewhere would go silently
  // wrong. RED-PROVEN against 7cd2f13, which fails all seven legs.
  'tests/guards/drive-ceiling-pin.guard.mjs',
  // ⛔ LORAMER_COMPLETION_SIGNAL_V1 — AND THIS ONE IS THE STRUCTURAL FIX. `drive-one-surface.mjs` had its
  // numbers quoted in FIVE governance documents and sat in no guard suite at all; five of 2026-08-18's six
  // defects were instruments, and an ungraded instrument is why. It drives the script's own --selftest and
  // requires a real-recorded-data fixture for every sized constant, named rather than counted.
  'tests/guards/drive-constants-have-fixtures.guard.mjs',
  // ⛔ LORAMER_NO_DANGLING_REFERENCE_V1 — AND THIS IS THE ONE THAT CAUGHT THE PAIR ABOVE BEING WRONG. The
  // two guards immediately preceding were written to police three deleted constants and asked only whether
  // the DECLARATIONS were gone; two READS survived — `PASS_TIMEOUT_MS` in the publish call and `FLOOR` in the
  // every-50-passes progress block — so the drive would have halted on pass 1 blaming the route, and crashed
  // at pass 50 after ~50 passes of real vendor spend. `npm run build` never parses .mjs. Acorn does.
  'tests/guards/no-dangling-reference.guard.mjs',
  // ⛔ LORAMER_PROVENANCE_ON_EVERY_APPEND_V1 — AN OPTIONAL PARAMETER IS ONE NOBODY PASSES. migrations/083
  // added two identifier columns and threaded `prov?` through four append helpers; three were wired and the
  // fourth was missed at ALL NINE of its exits. The first live fire said so in one read: attempt_started
  // 38/38 stamped, day_committed 66/66, message_finished 33/33, **attempt_finished 39/39 NULL on both** —
  // and that is precisely the row `drive-one-surface.mjs` joins on to learn what a pass walked. Uses the
  // TypeScript compiler, because these calls span six lines and carry parenthesised template literals.
  'tests/guards/provenance-on-every-append.guard.mjs',
  // ⛔ LORAMER_DIGEST_MISSED_THE_SECTION_FORMAT_V1 — a decision the next session cannot GREP is one
  // re-derivation away from having lived only in chat. §G of the digest selected on the BULLET trailer and
  // matched ZERO `## ` section entries: MEASURED 2026-08-19, 10 of 20 section decisions were absent from the
  // digest, two of them governing rules banked by Russ hours earlier. Same class as three-source-header's
  // format hole one day before, one consumer over — widen the READER, never retype the decisions.
  'tests/guards/banked-decision-reaches-the-digest.guard.mjs',
  // LORAMER_CAPTURE_ADAPTER_CONTRACT_V1 — the seam: the core may not name a platform, an ordering
  // entitlement needs a MECHANISM, a null-floor adapter cannot claim exhaustion, the meter refuses a
  // bare cap-and-spend constant, and the sizer obeys the cost DIRECTION instead of always sizing up.
  'tests/guards/capture-adapter-seam.guard.mjs',
  // LORAMER_UNIVERSE_RESUMER_V1 — the scheduler REFUSES: implausible coverage, a BROKEN entry, an entry
  // whose owed set did not shrink after a SUCCESSFUL attempt (June BackfillControl.tsx:81-83), an
  // unreadable meter, and its own bound. It also may not be scheduled without changing its own header.
  'tests/guards/universe-resumer.guard.mjs',
  'tests/guards/refused-ratio-is-null.guard.mjs',
  'tests/guards/backfill-yields-to-product.guard.mjs',
  // LORAMER_EVAL_SPEND_LEDGER_V1 — the harness price table may not drift from production MODEL_PRICING, an
  // unknown model may not be priced at zero, and a run that cannot cost itself must exit non-zero.
  'tests/guards/eval-spend-ledger.guard.mjs',
  // LORAMER_DRAIN_EXTENDED_DURATION_V1 — the drain runs above the 800s GA ceiling on Vercel's BETA extended
  // duration. Asserts the parts that are mechanically checkable (value ≤ 1800, scoped to this one route, no
  // vercel.json project default above 800, eligibility marker intact, BUDGET_MS able to actually use the ceiling)
  // and states on its own face that the runtime version and Secure-Compute/Static-IP status are Vercel project
  // settings it cannot see.
  'tests/guards/drain-extended-duration.guard.mjs',
  // LORAMER_CAPTURE_FACTS_V1 — every platform in DRAIN_REGISTRY must have a section in
  // docs/LORAMER_CAPTURE_FACTS.md, so a new platform cannot ship without its retention walls,
  // forward-only families and capability limits written down. COVERAGE check only — it cannot
  // verify a wall is true or current, and says so on its own face.
  'tests/guards/capture-facts-cover-platforms.guard.mjs',
  // LORAMER_CAPTURE_FACTS_V1 — the capture-boundaries block must STAY in the cache_control prefix and keep
  // all five boundary kinds, its vendor numbers and its UNESTABLISHED carriers. Structural ordering check
  // against the prefixLines/suffixLines swap, so a context refactor cannot silently move it.
  'tests/guards/capture-facts-in-prefix.guard.mjs',
  // LORAMER_COMPLETION_CLAIM_DENOMINATOR_V1 — every DRAIN_REGISTRY step must be visible to the completion
  // gate. It iterated required-steps (27) while the drain runs 34; 60 sealed claims were never checked.
  'tests/guards/completion-gate-covers-drain.guard.mjs',
  // LORAMER_CAMPAIGN_TYPE_MATRIX_V1 — the campaign backfill must keep SELECTING and STORING channel type,
  // and the entity_state_history precedence rule must stay attached. Dropping the field breaks nothing
  // and throws nothing — it just silently restores the criteria-vs-account-spend misclassification.
  'tests/guards/campaign-channel-type-captured.guard.mjs',
  // LORAMER_CHANNEL_TYPE_ENUM_V1 — every AdvertisingChannelType ordinal must render as a NAME. Lora was
  // being shown [10] and [2], and the old map called MULTI_CHANNEL (App) 'Performance Max'.
  'tests/guards/channel-type-enum-mapped.guard.mjs',
  // LORAMER_CAPABILITY_DENOMINATOR_V1 — no family may be judged against account spend by default. Every
  // row-checkable step must DECLARE its capability; silence is the defect that produced 43 false violations.
  'tests/guards/capability-denominator.guard.mjs',
  // LORAMER_UNIVERSE_DISK_CEILING_V1 — the walk's disk governor must live in migrations/, carry an ABSOLUTE
  // 500 GiB ceiling (never a percentage — provisioned disk is invisible to Postgres), and bound free_bytes
  // by it. Its body existed only in the live database until 2026-08-07.
  'tests/guards/universe-disk-ceiling.guard.mjs',
  // LORAMER_CHAT_ASSISTANT_FULL_BLEED_V1 + LORAMER_CHAT_COMPOSER_AUTOGROW_V1 — CSS FACTS ONLY. It cannot
  // see a pixel (★CHAT-RENDER-MEASUREMENT-MISSING); layout is Gate-B on device.
  'tests/guards/chat-composer-and-bleed.guard.mjs',
  // LORAMER_LORA_HEADER_VISUAL_VIEWPORT_V1 + LORAMER_CHAT_COMPOSER_CLIP_V1 — visualViewport wiring and
  // the derived composer cap. CSS/JS FACTS ONLY; the keyboard cases are Gate-B on device.
  'tests/guards/chat-visual-viewport.guard.mjs',
  'scripts/check-capture-completeness.mjs',
  'scripts/check-lora-grounding.mjs',
  'scripts/check-connection-failure-recording.mjs',
  'scripts/check-connection-degraded-readers.mjs',
  'scripts/check-query-completeness.mjs',
  // ── LORAMER_A_LAW_IS_NOT_BANKED_UNTIL_IT_CAN_FAIL_A_BUILD_V1, 2026-08-09 — the three enforcers banked with
  //    the law that says a law without one has never held in this repo. Each was SEEN RED before it was
  //    allowed to pass, and each ships a REMOVE-ONLY baseline freeze of today's known violations.
  // ONE FILE OWNS EACH VENDOR FACT. The cap was declared in two non-importing files with its derived
  // allowance restated as a bare literal in a third; the ops-per-request ratio was settled at 1 in one file
  // while 1.5 stayed live in another.
  // LORAMER_V2_QUOTA_SENTINEL_WIRED_V1 — the walk may not reach a vendor call without passing the sentinel,
  // and its single vendor boundary (the FIFTH) must arm it. The meter is our accounting; the sentinel is the
  // vendor's refusal, and neither substitutes for the other.
  // LORAMER_CANONICAL_KEY_SPELLING_V1 — one spelling per fact, in the KEY. The walk and the drain wrote the
  // same fact as two rows because they disagreed on entity_id and breakdown_value; the unique index cannot
  // collapse that. Legs (p)(q)(r) are static; the data leg (s) runs under --db in check:data.
  'tests/guards/canonical-key-spelling.guard.mjs',
  // LORAMER_DRAIN_ALIAS_COVERAGE_V1 — a surface the drain already stores is not owed, even under another key.
  // Static legs (t)(u); the LIVE alias demonstration (v) runs under --db in check:data, because an alias is a
  // claim that another key counts as coverage and a wrong one skips real history permanently.
  'tests/guards/drain-alias-coverage.guard.mjs',
  'tests/guards/v2-quota-sentinel-wired.guard.mjs',
  // LORAMER_V2_WALK_BUDGET_RESERVATION_V1 — the walk may not start a range it cannot finish inside
  // maxDuration, using the SHIPPED shouldStartAnotherLap rather than a fork.
  'tests/guards/v2-walk-budget-reservation.guard.mjs',
  'tests/guards/single-owner-vendor-facts.guard.mjs',
  // A BANNED EXPRESSION AND A FALSIFIED MECHANISM STAY DEAD, INCLUDING IN COMMENTS — which is where the
  // API-Center-UI mechanism came back, in a file written AFTER it was falsified.
  'tests/guards/banned-expressions.guard.mjs',
  // A STEP MAY NOT BE MARKED BUILT WITHOUT NAMING THE PRODUCTION CODE THAT ALREADY DOES IT, AT file:line.
  // Steps 0-7 shipped ahead of the sweep that then found three already-live capabilities they had re-derived.
  'tests/guards/pre-step-read.guard.mjs',
  // LORAMER_UNIVERSE_DISCOVERED_FLOOR_V1 — the floor is the VENDOR'S ANSWER, never a clock and never a
  // constant. ⛔ THE LIST IS THE REGISTRATION: this runner discovers nothing, so a guard file that is not
  // named here NEVER RUNS. All three of these were written, driven green by hand, and were invisible to
  // `npm run guard` until this line existed — an unregistered guard is the purest form of a green check
  // answering a narrower question than the reader assumes.
  //   · a global DATE LITERAL may not be an account floor on the Google v2 path
  'tests/guards/google-account-floor.guard.mjs',
  //   · the floor is evaluated at EXECUTE time, never frozen onto a queue message by the publisher
  'tests/guards/universe-floor-execute-time.guard.mjs',
  // LORAMER_WALK_HORIZON_RECEDES_V1 + LORAMER_RESUMER_SCAN_ROTATES_V1 — the anchor must RECEDE over answered
  // ground and HOLD over unanswered; the scan must ROTATE across all 346 surfaces; sizing.maxDays ≤
  // MAX_REQUESTS_PER_RUN keeps the bite bound EXACT; and the resumer may carry no global floor. Driven, not
  // grepped. Seen RED against the pre-change tree with six findings.
  'tests/guards/universe-horizon-recedes.guard.mjs',
  // LORAMER_RPC_GRANT_POSTURE_V1 — a function added to `public` may not be born anon-callable.
  // `revoke … from public` does NOT remove anon/authenticated (Supabase grants them by name), which is how
  // 15 of 21 public functions came to be anon-callable — including a SECURITY DEFINER writer into the walk's
  // own spend ledger. SOURCE half here; the live-ACL half is check-rpc-grant-posture in check:data.
  'tests/guards/rpc-grant-posture.guard.mjs',
  // LORAMER_CHAT_HISTORY_CACHE_V1 — the conversation breakpoint (final user message, ttl 5m), the vendor
  // ordering law (1h prefix before 5m messages), the 4-breakpoint ceiling, and the DRIVEN ledger proof
  // that 1h cache writes price at 2x base. Seen RED against the pre-change tree with 11 findings.
  'tests/guards/chat-history-cache.guard.mjs',
  //   · a SUCCESSFUL ZERO is NO_DATA_OBSERVED; only a vendor DateRangeError refusal is a wall
  'tests/guards/universe-zero-is-not-a-wall.guard.mjs',
  // LORAMER_SURFACE_SCOPED_WALL_V1 — a wall is scoped account × resource × segment and NEVER account-wide.
  // One resource's refusal becoming an account seal is floor36's exact shape, one level in.
  'tests/guards/wall-is-surface-scoped.guard.mjs',
  // LORAMER_EMPTY_STRETCH_VISIBILITY_V1 — a long empty stretch is REPORTED at 400 windows (above the
  // measured 2,267-day dormancy) and NEVER stopped on; the counter is chain-local, increments, resets.
  'tests/guards/empty-stretch-visibility.guard.mjs',
  // LORAMER_INCEPTION_STOP_V1 — the account inception stop: unfiltered one-op discovery, per-account scope
  // with provenance, ONE composition site, and UNKNOWN refuses an unbounded walk rather than defaulting.
  'tests/guards/inception-stop.guard.mjs',
  // LORAMER_EXTRA_METRIC_REACHABILITY_V1 — the `extra` JSONB reaches Lora: one declared additive key list,
  // mirrored into migration 067's SQL and pinned against it, summed on all three breakdown paths AND the base
  // path, rankable, and labelled with its per-day basis. Guards the largest failing class of the 2026-08-14
  // baseline (PRESENT_BUT_UNREACHABLE), where Lora denied capturing data we had held for months.
  'tests/guards/extra-metrics-reachable.guard.mjs',
  // LORAMER_ATTESTED_EMPTY_SEGMENT_SCOPE_V1 — a zero attests exactly its OWN (resource, segment) surface;
  // found by the first wet run, where one sibling's zero sealed 17 of 20 surfaces "already covered".
  'tests/guards/attested-empty-segment-scope.guard.mjs',
  // LORAMER_FIVE_STEP_ROUNDS_V1 — placement of the framework law in ESSENCE; obedience lives in chat.
  'tests/guards/five-step-rounds.guard.mjs',
  // LORAMER_GOOGLE_CLIENT_CHOKE_POINT_V1 — client construction is a ratchet: factory + 14 frozen sites.
  'tests/guards/google-client-choke-point.guard.mjs',
  // LORAMER_CHECKDATA_VERDICT_LINE_V1 — check:data's machine-final VERDICT line: runner pinned, roster
  // pinned (13 checks), flush-safe exit, crash speaks, verdict LAST — the tail-truncation class enforcer.
  'tests/guards/checkdata-verdict-line.guard.mjs',
  // LORAMER_QUEUE_TAG_MATCHES_TEXT_V1 — an item's TAG and an item's PROSE must not disagree. Reads the queue
  // through the SHARED walk (scripts/lib/queue-walk.mjs), so it grades against the same statusIsDone the
  // digest's §H/§L use. Also ratchets the untokened-item count (§L can only find what carries a token).
  'tests/guards/queue-tag-matches-text.guard.mjs',
  'tests/guards/protocol-gate.guard.mjs',
  'tests/guards/failure-is-not-a-fact.guard.mjs',
  'tests/guards/unknown-renders-honestly.guard.mjs',
  'tests/guards/shopify-cancelled-excluded.guard.mjs', // LORAMER_SHOPIFY_CANCELLED_EXCLUDED_V1 — every Shopify order aggregation excludes cancelled orders
  'tests/guards/fixture-query-gate.guard.mjs', // LORAMER_FIXTURE_QUERY_GATE_V1 — the PreToolUse hook that names a fixture row at the moment a query is issued stays wired // LORAMER_UNKNOWN_RENDERS_HONESTLY_V1 — part 2: the third state must survive the trip to the screen // LORAMER_FAILURE_IS_NOT_A_FACT_V1 — a failed read must never become a negative fact // LORAMER_PROTOCOL_GATE_ENFORCER_V1 — the paste-receipt gate's own failure must fail the BUILD, because Claude Code hooks fail OPEN
  // LORAMER_DB_ENUM_MIRRORS_TS_V1 — a TS union and the CHECK constraint behind it must not diverge. Red-first
  // against the 2026-08-17 incident shape: 'nongrain' in the union, absent from the constraint, every write
  // rejected 23514 while build + 124 guards + check:data all read green.
  'tests/guards/db-enum-mirrors-ts.guard.mjs',
  // LORAMER_SEAMS_PROOF_INCLUDES_THE_DATABASE_V1 — the DISCOVERY half: every string-literal union in a file
  // that writes to supabase must be REGISTERED as a pair or ALLOWLISTED with a reason naming where the value
  // goes. db-enum-mirrors-ts can only check pairs somebody remembered to register; this is what makes
  // "somebody remembered" mechanical.
  'tests/guards/seams-proof-includes-the-database.guard.mjs',
  // LORAMER_RMF_REPORTING_DEFAULTS_V1 — the legacy /dashboard reporting surface is what a Google Ads API reviewer
  // is given, so its DEFAULT columns are a compliance artifact under Required Minimum Functionality. Asserts the
  // RMF fields are selected, carried through their mappers, default-on, null-preserving, immune to a stale
  // localStorage column preference, and pinned to the live adapter gate. Static; the live half is
  // scripts/rmf-adapter-gate.mjs, which spends real quota and stays off the build path.
  'tests/guards/rmf-reporting-defaults.guard.mjs',
  // LORAMER_GAQL_DATE_WINDOW_V1 — no GAQL query may interpolate a preset into DURING (LAST_90_DAYS/CUSTOM are
  // not GAQL enums; the error renders as 0 rows). Tree-wide zero + the eight fixed files stay on the ONE
  // resolver + the resolver's CUSTOM guard + /api/campaigns forwards customs. Shipped 8 times before this.
  'tests/guards/gaql-date-window.guard.mjs',
  // LORAMER_WALK_UNWEDGE_AND_HEARTBEAT_V1 — nothing-owed must ADVANCE (the started+finished pair, because
  // 064's rotation reads attempt_started only), covered-skips never count as vendor attestation, every fire
  // writes a heartbeat on all four return paths, and the wedge signal goes RED on 24h-no-progress while
  // staying GREEN at the all-surfaces-at-inception-floor DONE state.
  'tests/guards/walk-unwedge-heartbeat.guard.mjs',
  // LORAMER_NONPUBLISH_ADVANCES_ROTATION_V1 — CLASS-LEVEL sibling of the unwedge: EVERY non-publishing
  // decision branch (floor-reached, implausible, nothing-owed, broken/no-progress) must advance the rotation
  // or be excluded once-sealed; bookkeeping rows stay invisible to decideRepublish; the floor seal re-admits
  // on any stop change. ★WALK-WEDGES-AT-FLOOR-REACHED, measured 2026-08-24: top-60 = 60/60 floor-reached,
  // 268 owing surfaces starved, descend silent ~15h.
  'tests/guards/nonpublishing-branch-must-advance-rotation.guard.mjs',
  // LORAMER_LORA_NAMED_ENTITY_READ_V1 — every grain Lora is OFFERED must have a path that returns its NAME,
  // the tool must be dispatched and attached to BOTH loops, the writer/reader column disagreement must stay
  // DECLARED, and the description must keep teaching THINGS-vs-DIMENSION-VALUES + the Meta asset trap.
  'tests/guards/lora-named-entity-read.guard.mjs',
  // LORAMER_BINDING_COVERAGE_V1 — a not-COMPLETE window may not hand back a bare `totals`. The verdict gates
  // the payload STRUCTURALLY (the key is gone, not merely annotated), at every grain, with no silent catch —
  // and a COMPLETE zero stays answerable so the fix cannot over-refuse a genuine zero.
  'tests/guards/binding-coverage.guard.mjs',
  // LORAMER_COVERAGE_DENSITY_V1 — the leg that makes the binding BITE: "capture reaches back this far" is not
  // "every day in the window is present". Frontier (capture is T+1) · a >=7-day missing run is a hole while
  // shorter runs read as no-activity · an empty window below a funded floor is a hole · ONE constant carrying
  // its own calibration and both failure directions.
  'tests/guards/coverage-density.guard.mjs',
  // LORAMER_FLEET_METER_SEES_THE_WALK_V1 — the fleet spend reader must sum EVERY ledger the walk bills into.
  // Shape only; the number is witnessed by check-fleet-meter-visibility against universe_fire_log.
  'tests/guards/fleet-meter-sees-the-walk.guard.mjs',
  // LORAMER_POSTGREST_AGGREGATE_BAN_V1 — aggregates are disabled on this project; a select=col.sum() read
  // 400s and the idiomatic fallback turns that into a silent zero. Ban the class, pin the repaired instance.
  'tests/guards/postgrest-aggregate-ban.guard.mjs',
  // LORAMER_BREAKDOWN_MONEY_BINDING_V1 + LORAMER_UNATTESTED_ABSENCE_V1 — absence may not masquerade as
  // inactivity (attestation is the one door), and every ranking/money tool binds structurally.
  'tests/guards/breakdown-money-binding.guard.mjs',
  // LORAMER_EVENT_ATTRIBUTION_V1 + LORAMER_PERIOD_RESOLUTION_NAMED_V1 — events need attestation, hedges are
  // the same claim, discontinuities stay describable, ambiguous periods get named. Prefix-placement pinned.
  'tests/guards/event-attribution-in-prefix.guard.mjs',
  // LORAMER_GOOGLE_AD_NAME_COMPOSE_V1 — one composition home, junk-loses/vendor-wins precedence, the writer's
  // GAQL carries the material, the repair script stays double-gated, the live check stays rostered.
  'tests/guards/google-ad-name-compose.guard.mjs',
  // LORAMER_TOOL_LOOP_EXHAUSTION_V1 — a capped tool loop may not return the model's PREAMBLE as the answer.
  // Both loops driven against a model that never stops asking for tools; forced tools-free final answer, the
  // clock gate, and unconditional `truncated` telemetry on both route paths.
  'tests/guards/tool-loop-exhaustion.guard.mjs',
  'tests/guards/resume-digest-freshness.guard.mjs',
]

// A guard whose GREEN means nothing when its prerequisite is red. breakdown-registry-drift asserts that the
// claude-tools query_breakdown enums are GENERATED from breakdown-registry; the two dependents both reason over
// registry-derived sets (check-lora-grounding asserts every type in the GENERATED enum is named in hand-written
// prose). If the registry has drifted, their green is a statement about a stale artifact. They still RUN — the
// finding may be useful — but they are never printed as a bare PASS.
const UNRELIABLE_WHEN = {
  'tests/guards/breakdown-registry-drift.guard.mjs': [
    'scripts/check-capture-completeness.mjs',
    'scripts/check-lora-grounding.mjs',
  ],
}

// resume-digest-freshness compares digest -> manifest -> files, and only means something after the wrap
// sequence has run. Anywhere but last it produces a false RED.
const MUST_BE_LAST = 'tests/guards/resume-digest-freshness.guard.mjs'
if (GUARDS[GUARDS.length - 1] !== MUST_BE_LAST) {
  console.error(`[run-guards] LIST ERROR — ${MUST_BE_LAST} must be the LAST entry (it is order-locked; see header).`)
  process.exit(2)
}

const CRASH_MODULE = /ERR_MODULE_NOT_FOUND|Cannot find module|Cannot find package|ERR_UNSUPPORTED_ESM_URL_SCHEME/
const CRASH_STACK_ERR = /^\s*[A-Za-z]*Error(:|\b)/m
const CRASH_STACK_FRAME = /^\s*at\s+\S+/m

function classify(res) {
  const err = String(res.stderr || '')
  if (res.error) return 'CRASHED' // spawn itself failed
  if (res.signal) return 'CRASHED'
  if (res.status === 0) return 'PASSED'
  if (res.status !== 1) return 'CRASHED' // our guards use exit 1 for a finding; anything else is not a finding
  if (CRASH_MODULE.test(err)) return 'CRASHED'
  if (CRASH_STACK_ERR.test(err) && CRASH_STACK_FRAME.test(err)) return 'CRASHED'
  return 'FAILED'
}

const results = []
for (const rel of GUARDS) {
  const started = Date.now()
  const res = spawnSync(process.execPath, [path.join(ROOT, rel)], {
    cwd: ROOT,
    env: process.env, // carries LORAMER_GUARD_ROOT through so the seen-RED proof still works
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  results.push({
    name: rel,
    bucket: classify(res),
    status: res.status,
    signal: res.signal,
    ms: Date.now() - started,
    stdout: String(res.stdout || ''),
    stderr: String(res.stderr || ''),
    spawnError: res.error ? String(res.error.message) : null,
  })
}

// Apply UNRELIABLE after the fact — a dependent that PASSED while its prerequisite did not is downgraded.
const byName = Object.fromEntries(results.map((r) => [r.name, r]))
for (const [prereq, dependents] of Object.entries(UNRELIABLE_WHEN)) {
  const p = byName[prereq]
  if (!p || p.bucket === 'PASSED') continue
  for (const d of dependents) {
    const r = byName[d]
    if (r && r.bucket === 'PASSED') {
      r.bucket = 'UNRELIABLE'
      r.unreliableBecause = `${prereq} is ${p.bucket} — this guard reasons over registry-derived sets, so its green describes a possibly-stale artifact.`
    }
  }
}

const passed = results.filter((r) => r.bucket === 'PASSED')
const failed = results.filter((r) => r.bucket === 'FAILED')
const crashed = results.filter((r) => r.bucket === 'CRASHED')
const unreliable = results.filter((r) => r.bucket === 'UNRELIABLE')

console.log('')
console.log('════════ [run-guards] SCOREBOARD — LORAMER_GUARD_RUNALL_V1 ════════')
console.log(`  ${GUARDS.length} guards RAN (every one — this runner does not short-circuit)`)
console.log(`  PASSED ${passed.length} · FAILED ${failed.length} · CRASHED ${crashed.length} · UNRELIABLE ${unreliable.length}`)
console.log('')
for (const [i, r] of results.entries()) {
  const mark = r.bucket === 'PASSED' ? 'ok  ' : r.bucket === 'FAILED' ? 'FAIL' : r.bucket === 'CRASHED' ? 'CRASH' : 'UNREL'
  console.log(`  ${String(i + 1).padStart(2)}  ${mark.padEnd(5)} ${String(r.ms).padStart(6)}ms  ${r.name}`)
  if (r.unreliableBecause) console.log(`          ↳ UNRELIABLE: ${r.unreliableBecause}`)
}
console.log('')

function reprint(list, heading) {
  if (!list.length) return
  console.error(`════════ ${heading} — full output, verbatim, in list order ════════`)
  for (const r of list) {
    console.error('')
    console.error(`──── ${r.name}  [${r.bucket}]  exit=${r.status}${r.signal ? ` signal=${r.signal}` : ''}${r.spawnError ? ` spawnError=${r.spawnError}` : ''}`)
    if (r.stdout.trim()) console.error(r.stdout.replace(/\n$/, ''))
    if (r.stderr.trim()) console.error(r.stderr.replace(/\n$/, ''))
  }
  console.error('')
}
// CRASHED first: a broken instrument is read before a finding, because it bounds what the run can claim.
reprint(crashed, 'CRASHED — the guard could not RUN. Fix the instrument before trusting anything else in this run')
reprint(failed, 'FAILED — the guard ran and found something')

if (crashed.length || failed.length) {
  console.error(`[run-guards] EXIT 1 — ${failed.length} failed, ${crashed.length} crashed.`)
  process.exit(1)
}
console.log(`[run-guards] ALL GREEN — ${GUARDS.length}/${GUARDS.length} guards ran and passed.`)
