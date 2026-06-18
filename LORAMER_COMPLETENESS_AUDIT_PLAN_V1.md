# LORAMER_COMPLETENESS_AUDIT_PLAN_V1

## Purpose
Map exactly what is missing or wrong — per real test client, per source — BEFORE fixing anything, so "get everything" becomes a finite, prioritized punch-list rather than a guess. This audit MAPS; it changes nothing. Every fix it surfaces (capture-cap removal, search-terms capture, historical re-fetch, etc.) is its own gated workstream afterward.

## Why this matters
Completeness is the precondition for LoraMer's core value: cross-source, cross-time synthesis (e.g. "what worked/failed last BFCM, vs surprise movers in Q1–Q3 this year → what to promote/advertise this BFCM"). A synthesis fails silently if any one input has a hole. Completeness is therefore a correctness requirement, not a backlog item.

## Scope
Real test clients only (real connected platforms, real cohort owners — not demo/test rows). Step 0 = enumerate the real clients and their connections from the data, do not assume.

Run order (decided): Phase 1 runs on Shelley Kyle first (client_id 23c697bb-5255-4289-9329-659544ba8e6e) to validate the gap-map format, confirm it's useful, then fan out to the remaining real clients.

## Two questions per (client × source)
1. PRESENT? — is every day and entity that should exist actually captured (coverage + depth)?
2. RIGHT? — does what's captured reconcile to the platform's own totals (correctness; e.g. the order-total $1,587.80 vs net $1,475.30 basis gap)?

## Per-source "complete" definition + checks
- WooCommerce (self-hosted, fully retained): missing-day holes; product-days at the 10-cap (suspect-truncated); earliest captured vs the store's earliest order; sample-period net/orders/items reconciled to WC Analytics. -> recoverable.
- Shopify: holes; whether product capture uses the same 10/day cap (UNVERIFIED — check); token health (dead-token reconnects); earliest captured vs Shopify history; sample reconcile to admin. -> recoverable within Shopify's API window.
- Google Analytics: holes; metric completeness; depth vs GA4 retention. -> recoverable within retention, bounded beyond.
- Google Ads: spend/clicks/conv holes; SEARCH TERMS — captured at all? (if not, this is the bleed); keyword-level completeness; depth vs Google retention. -> metrics recoverable within Google's floor (accepted); search terms BLEEDING if uncaptured.
- Meta: holes (transient failures); breakdowns present or not (held item); token-expiry risk (~July 13); depth vs Meta retention. -> bounded-lost beyond retention (accepted); forward capture must be airtight.

## Classification (every gap gets one tag)
- BLEEDING — short source-retention + not captured continuously, so each day is permanent loss. Act now.
- RECOVERABLE — still at the source, re-fetchable whenever. Owed, not urgent.
- BOUNDED-LOST — beyond the platform's retention/API window. Accepted floor (Google/Meta old history).

## Method
- Phase 1 — pure DB read, ZERO API: ranges, holes, capped days, uncaptured data types, sample reconciliation where the data allows. Cross-reference existing AUDIT_FINDINGS / handoff lessons to verify and extend known gaps, not rediscover them.
- Phase 2 — targeted source probes ONLY where the DB cannot establish "what should exist" (earliest-available, reconciliation). Bounded and gentle, especially the self-hosted Woo store, per the live-source rule.

## Output — the gap map
A per-client x per-source table: connected · captured range (earliest->latest) · missing-days · completeness flags (capped days / missing metrics / uncaptured types) · reconciliation Y/N/? · classification · recommended action + priority.
Topped by a "BLEEDS — act now" section; then the recoverable backlog (prioritized by value + age); then the acknowledged bounded-lost floors.

## Gate
Read-only; no edits. The output map is the gate for everything downstream — fixes are picked and sequenced from it, one workstream at a time. The audit itself ships/fixes nothing.

## Out of scope
All fixes (cap removal, search-terms capture, re-fetch, SKU reader, basis reconciliation) — each becomes its own gated workstream driven by the map.
