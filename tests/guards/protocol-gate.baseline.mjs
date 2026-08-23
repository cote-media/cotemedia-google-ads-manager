// LORAMER_PROTOCOL_GATE_ENFORCER_V1 — the OVERRIDE BURN-DOWN baseline. MONOTONIC: it may RISE freely and
// may NEVER FALL except through a dated resolution recorded below.
//
// ⛔ THIS IS THE TAMPER-EVIDENCE, AND IT EXISTS BECAUSE GIT DIFF ALONE IS NOT TAMPER-EVIDENCE ON A SOLO REPO.
// A rewritten or deleted log line is just a diff, authored by the only person who reviews diffs. So the count
// is pinned here: docs/LORAMER_PROTOCOL_OVERRIDES.jsonl must hold AT LEAST this many lines, and each line's
// `prev` must chain to the sha256 of the line before it. Deleting an override FAILS THE BUILD. Editing one
// breaks the chain and FAILS THE BUILD.
//
// ⛔ WHY A RISE IS FINE AND A FALL IS NOT. Overrides are meant to be usable — a gate you cannot get past in a
// genuine emergency gets switched off, and a switched-off gate protects nothing. What must never happen is an
// override being taken and then quietly erased, because the whole value of the break-glass pattern is that
// the emergency path is as observable as the normal one. Break-glass practice, verbatim: "If the emergency
// path is not as observable as the normal path, auditors cannot reliably reconstruct who acted, what was
// changed, and whether the exception was truly justified."
//
// ⛔ HOW TO LOWER IT — the only legal way. Add a dated line to RESOLUTIONS below saying which override was
// resolved and how, THEN lower OVERRIDE_COUNT_BASELINE by that many. The log line itself still stays: the
// resolution records that the skipped box was later satisfied, it does not un-take the override.
//
// MEASURED 2026-08-23 at the enforcer's first commit: the log is created empty by this build.
export const OVERRIDE_COUNT_BASELINE = 0

// ── RESOLUTIONS — dated, one line each, newest first ───────────────────────────────────────────────────────
// Format: 'YYYY-MM-DD · <BOX-NAME> · <what satisfied the box after the fact>'
export const RESOLUTIONS = []

// ⛔ THE STALENESS RUNG IS DECLARED HERE AND IS NOT BUILT BY THIS COMMIT, so nobody mistakes its absence for
// a clean board: an override older than N days with no RESOLUTIONS entry should fail the build, which is what
// turns the log from a record into a burn-down. It is queued as ★OVERRIDE-STALENESS-HAS-NO-CLOCK. Today the
// guard enforces only monotonicity and chain integrity — real, and less than the full idea.
export const STALENESS_DAYS = null
