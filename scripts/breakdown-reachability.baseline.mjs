// LORAMER_BREAKDOWN_REACHABILITY_GATE_V1 — BASELINE (data, NOT a code exemption).
//
// Known CAPTURED-BUT-UNADMITTED tuples: `<platform>|<breakdown_type>|<entity_level>` present in metrics_daily and
// absent from src/lib/breakdown-registry.ts, i.e. rows we pay to store that Lora cannot read. Same shape-as-data
// contract as scripts/frozen-cursors.baseline.mjs and the manifest's KNOWN_INCOMPLETE: the gate WARNS on what is
// listed and FAILS on anything NEW.
//
// ⛔ ANTI-ROT: an entry here that no longer matches a live unadmitted tuple FAILS the gate. Wiring a tuple into the
// registry therefore makes check:data fail until its entry is deleted. That is the design — a baseline that
// survives its own justification is how "known issue" becomes "nobody looks any more".
//
// VERIFIED 2026-07-30 (node scripts/breakdown-reachability-check.mjs --gate): the live set is EMPTY. Everything
// captured is currently admitted to the registry, so the gate's job from here is to hold that line.
export const KNOWN_UNADMITTED = []
