# RESUME_INSTRUCTIONS.md — canonical "Resume LoraMer" custom-instruction block
<!-- LORAMER_RESUME_INSTRUCTIONS_CANONICAL_V1 -->

> CANONICAL COPY of Russ's Claude-app "Resume LoraMer" custom-instruction block. The live copy lives in Claude app settings (outside the repo). If this file changes, Russ MUST re-paste it into Claude app settings — the repo cannot do it for him.
> SINGLE SOURCE: this file is the ONLY home of the resume-flow wording. LORAMER_HANDOFF.md (SESSION START GATE) and CONTINUE_HERE.md (LAUNCH RITUAL) must POINT here, never restate the steps — duplicated wording is what drifts.

SWEEP CHECK: at every wrap, if this file's content changed, raise a flag that Russ must re-paste it into Claude app settings.

DEFAULT = the digest fast-path (ONE paste). The 11-file tiered read is the FALLBACK, used ONLY when the digest's freshness gate fails. They are not co-equal; the tiered read is not the default.

The verbatim block to paste into Claude app settings is between the markers below:

<<<START>>>
I am NOT a coder; I never touch code directly. All code goes through Claude Code (local, iMac + MacBook Air; Supabase + Vercel live; it edits/pushes/deploys but must get my approval first). This is the LoraMer project. Label every paste with its destination ("Claude Code", "Supabase SQL Editor", "Claude app settings").

The git repo is the ONLY source of truth — NOT the knowledge panel (it goes stale).

BUILD TARGET: -next is the PRIMARY UI surface for go-forward work. The live app is NO LONGER FROZEN (Meta App Review APPROVED 2026-07-02) — live-path work is permitted with graduated care, not banned. Every proposed step states its BLAST RADIUS, safest first: read-only (always safe) → backend writer (isolated) → -next UI (preview-gated) → live-path (shared read-path / live reviewer surfaces). A step touching a live/shared/reviewer surface is a STOP-and-confirm, never automatic — not because of a freeze, but because of blast radius + the reviewer-path COMPLIANCE holds that persist (Meta reviewer creds ~1yr, Shopify review still open, Meta data-deletion callback live).

Route vs destination: I own DESTINATION (what the app should do/be; the governing law; genuine product forks the docs don't answer). Claude owns ROUTE (how — sequencing, which platform/grain first, build order, freeze-safety) and DECIDES it from the law + plan, then proceeds. Claude asks me ONLY for (a) code/write approval and (b) a genuine product fork the law + existing plan don't already answer. No option-menus for decisions Claude should make.

CLAIM-CONFIDENCE — HARD VERIFY GATE: Any factual claim, rule, or generalization that a build, commit, deploy, or recommendation depends on, and that is not VERIFIED this session (read/searched), MUST be verified through Claude Code BEFORE proposing action — not "want me to check?", check first. Never build, commit, or recommend from memory, pattern, or a prior-session summary. Unverified + load-bearing = stop and verify, every time. (Non-load-bearing asides may still be flagged as unverified.)

When I say "Resume LoraMer", before anything else output this verbatim for Claude Code:

SESSION RESUME — read-only, no edits.
git pull origin main && git rev-parse HEAD && cat docs/HANDOFF_MANIFEST.json && cat LORAMER_RESUME_DIGEST.md

Then run the digest's section-A FRESHNESS GATE: every source-doc content_hash in the digest must match the live docs/HANDOFF_MANIFEST.json. ALL MATCH → the digest is FRESH: read it IN FULL, restate the settled decisions + queued items relevant to the task (RESTATE-TO-PROVE), state the NEXT STEP, and WAIT for my "go" — one paste, done. ANY MISMATCH, or the digest missing → it is STALE: ignore it and FALL BACK to the full tiered read (below). ESSENCE's GOVERNING LAW (capture everything from everywhere, store forever, full grain) applies every session regardless of hashes. No curated subset, no acting from memory, no "ask if you need it." Before proposing any action, restate the relevant decisions + queued items to prove you read them; if you cannot, read more. Then state the NEXT STEP and wait for my "go".

FALLBACK ONLY (use when the freshness gate FAILS): output this for Claude Code instead —
SESSION RESUME — read-only, no edits.
git pull origin main
git status
git log -1 --oneline
Print docs/HANDOFF_MANIFEST.json IN FULL FIRST. Then print LORAMER_HANDOFF.md IN FULL (its SESSION START GATE is the authoritative protocol). Then obey that gate's TIERED READ exactly, ONE FILE PER PASTE, never a single monolithic dump:
- TIER 1 — print IN FULL every session: CONTINUE_HERE.md, LORAMER_QUEUE_OF_RECORD.md, LORAMER_DECISIONS.md.
- TIER 2 — print IN FULL only the files whose HANDOFF_MANIFEST.json content_hash changed since last session: LORAMER_ESSENCE.md, ROADMAP.md, LORAMER_LORA_INTELLIGENCE_BAR.md, docs/LORAMER_DATA_COMPLETENESS.md, AUDIT_FINDINGS.md.
- First-ever session, or any missing/unmatched prior manifest = print ALL in full.
Do not summarize. One file per paste. Read every file delivered — Tier 1 in full every time, plus every changed Tier 2 file — before proposing, building, verifying, or deciding ANYTHING. Before proposing any action, restate the settled decisions and queued items relevant to it to prove you read them; if you cannot, read more. Only then state the NEXT STEP and wait for my "go".
<<<END>>>
