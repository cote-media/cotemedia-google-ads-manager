// LORAMER_DOCS_QUEUE_COVERAGE_GUARD_V1 — BASELINE (data, NOT a code exemption).
//
// The known docs→queue coverage gaps AS OF 2026-07-23: each planned-but-unbuilt doc UNIT (doc-as-whole, or a
// QUEUE-KEY sub-item) with NO matching entry in LORAMER_QUEUE_OF_RECORD.md. Mirrors the account-row-invariant
// baseline: a NEW gap FAILS; a baselined gap is grandfathered and CLEARS INDIVIDUALLY (the guard warns when a row is
// stale so it can be removed). NEVER a blanket per-doc mute — the key is `${doc}::${unit}`.
//
// This started at 23 units (first run). The 12 reference/shipped/form-answer false-positives now carry an in-doc
// `QUEUE-EXEMPT:` tag (removed here). The 3 multi-account sub-items + STRIPE-PHASE-4 are now QUEUED (removed here).
// The 7 below are the real, still-untracked units. `kind`: GENUINE = real untracked plan · VERIFY = built-vs-unbuilt
// unconfirmed (needs a code read before queuing or exempting).
export const KNOWN_DOCS_QUEUE_GAPS = [
  { doc: 'docs/LORAMER_ASSET_LAYER_SCOPE_V1.md', unit: '(whole doc)', kind: 'GENUINE', note: 'T3b asset-combination attribution flagship (post-launch); asset CAPTURE is in T3, the attribution LAYER is not a queued build' },
  { doc: 'docs/PROJECT_9_PHASE_2_2_DESIGN.md', unit: '(whole doc)', kind: 'GENUINE', note: 'memory evolution / "changed circumstances"; design-pending, no queue entry' },
  { doc: 'docs/PROJECT_14_PHASE_4_DESIGN.md', unit: '(whole doc)', kind: 'VERIFY', note: 'cross-surface attribution & chronology; no queue entry — confirm shipped or queue it' },
  { doc: 'docs/PROJECT_9_PHASE_2_DESIGN.md', unit: '(whole doc)', kind: 'VERIFY', note: 'persistent memory & learning; memory layer shipped, the learning design may be partial' },
  { doc: 'docs/PROJECT_3_DESIGN.md', unit: '(whole doc)', kind: 'VERIFY', note: 'intelligence layer depth expansion; likely superseded by the shipped intelligence layer' },
  { doc: 'docs/LAUNCH_CONSOLIDATION_DESIGN_2026_05_29.md', unit: '(whole doc)', kind: 'VERIFY', note: 'site+login+app consolidation; full clean-URL cutover is referenced in the security queue, not by this topic' },
  { doc: 'docs/LORAMER_NEXT_FLIP_PROGRAM.md', unit: '(whole doc)', kind: 'VERIFY', note: 'the -next flip-over is the active workstream (tracked as -next/flip), but the doc topic phrase is not a literal queue substring' },
]
