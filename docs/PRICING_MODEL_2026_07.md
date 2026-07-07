# LoraMer — PROPOSED Pricing Model (2026-07)
<!-- LORAMER_PRICING_MODEL_2026_07_V1 -->

> ⚠️ **STATUS: PROPOSED — soft-locked 2026-07-05, PENDING Phase-5 enforcement.** This is NOT the enforced pricing.
> The **enforced, live matrix** is the canonical one in **LORAMER_DECISIONS.md** (§LOCKED PRODUCT/POLICY/DATA
> DECISIONS → "Entitlement matrix LOCKED" line), mirrored for context in STRIPE_BILLING_PLAN.md. Nothing in this
> file changes billing until it is (a) Russ-approved as the new locked matrix, (b) reflected in `plan_entitlements`,
> and (c) enforced by Phase-5 gating. Until then the locked matrix governs and every founding client is
> `beta_unlimited` (uncapped, gating bypassed). Do NOT enforce this doc.

## Why a proposal doc (not an edit to the locked matrix)
Per STRIPE Design-decision 4, dollar PRICES change deliberately and never silently re-price existing subscribers;
caps/quotas/flags are DB-driven. This successor matrix reworks tiers, quotas, and the flag ladder — a deliberate
change that must be reviewed as a whole before it replaces the locked matrix. It lives here so the locked billing
docs stay truthful about what is ENFORCED today.

## Universal on EVERY PAID tier (the floor that makes the value legible)
- Full **permanent history** (no view-window cap on any paid tier — a change from the locked matrix, where Business = 365d).
- Full **uploads** (~20–25k words/client).
- **All platforms** connected (no per-tier platform cap on paid).
- **Value models** (online-purchase / offline-sales / lead) — per-client, always on.
- **Multi-source metric provenance** — every source's value, labeled and reconciled.
- **Lora on Opus 4.8** (see the model/margin caveats below — the switch is GATED, not shipped).

## Proposed tiers
Monthly / Annual (annual = 20% off) · questions/month (Q) · workspaces (ws) · view window · flags.

- **Free** — $0 · 20 Q · **1 platform** · 30-day window · ~5k-word uploads · no flags.
- **Starter** — $49/mo · $470/yr · 250 Q · 1 ws · full history · uploads floor · no flags.
- **Business** — $99/mo · $950/yr · 750 Q · 1 ws · full history · **+WYWS**.
- **Pro** — $299/mo · $2,870/yr · 2,500 Q · 1 ws · full history · **+priority_support, +bulk_export** (inherits WYWS).
- **Agency** — $199/mo · $1,900/yr · 500 Q · 10 ws · full history · **wyws, priority_support**.
- **Scale** — $999/mo · $9,500/yr · 2,500 Q · 50 ws · full history · **+automations, +white_label, +bulk_export, +sla** (on top of wyws + priority_support).
- **Enterprise** — custom (manual invoice, no self-serve) · unlimited · full history · all flags.

### Flag ladder (proposed remap)
- `wyws` → **Business+** (was Agency+).
- `priority_support` → **Pro+** in the business column; **Agency+** in the agency column.
- `bulk_export` → **Pro+** in the business column; **Scale+** in the agency column.
- `automations` / `white_label` / `sla` → **Scale+** (unchanged, agency column only).

## Page layout — two columns
- **"For your business"** — Free · Starter · Business · Pro (single-workspace ladder; power scales by Q + flags).
- **"For your agency"** — Agency · Scale · Enterprise (multi-workspace ladder).
- Annual toggle default (save 20%).

## Margins (at Lora on Opus 4.8)
- **80%+ realistic**, **47%+ worst-case** — per Russ's model.
- Basis: real per-Lora-message token shape measured 2026-07 (endpoint='chat', 160 turns): input avg ~9.9k /
  p90 ~18.9k; output avg ~516 / p90 ~1,000; prompt-prefix is cache-hit on multi-turn sessions (logged cost
  over-states real cost because the spend logger bills all input at the full rate). See CONV-ACTION/spend recon
  session notes.
- ⚠ The margin figures ASSUME Lora runs on Opus 4.8 at the correct Opus-4.8 token rate (per Russ's model,
  ~$5/M input · ~$25/M output — VERIFY against Anthropic's published rate before wiring). The current
  `src/lib/spend-logger.ts` MODEL_PRICING has NO opus-4-8 entry (legacy $15/$75 only) → until the correct rate is
  added, any Opus call logs **cost_usd = 0** (silent undercount). Add the rate BEFORE any model switch.

## Enterprise trigger
- Enterprise is reached by **either** a spend ceiling **or** an enterprise CAPABILITY need (SSO / SLA / custom
  retention / security review) — **either one trips** the self-serve → Enterprise line.
- **Spend ceiling = CONFIRMED (soft), 2026-07-05: ~$250,000/mo managed ad spend** is the self-serve → Enterprise
  trip line. This is a soft anchor — revisit-able, **not a hard commitment** — but treat it as the working
  threshold (no longer an open decision).

## Deltas from the LOCKED matrix (what actually changes)
- **Business**: price $79 → **$99**; quota 100 → **750 Q**.
- **Starter** ($49/250Q) and **Pro** ($299/2500Q): **NEW** tiers.
- **Free**: quota 5 → **20 Q**; adds an uploads allowance (~5k words); keeps 1-platform + 30-day window.
- **View window**: **full history on ALL paid tiers** (was: Business 365d; Agency/Scale already full).
- **Flag remap**: `wyws` → Business+; `bulk_export` + `priority_support` → Pro (business column); `white_label` /
  `automations` / `sla` stay Agency+/Scale+.
- **Breaks no one**: there are **0 paid Stripe subscribers today**; every current client is `beta_unlimited`
  (founding, gating bypassed). This can be adopted without re-pricing anyone.

## Design notes / things to resolve before locking (surfaced, not blocking)
- **Column price cross-over**: Pro ($299, 1 ws) prices above Agency ($199, 10 ws). Intentional (business column
  = single-workspace power; agency column = multi-workspace), but the pricing page must make the two ladders
  read as distinct products so a solo buyer isn't confused into the agency column.
- **Pro vs Scale quota parity**: Pro 2,500 Q == Scale 2,500 Q; Pro also gets `bulk_export`. The differentiator is
  workspaces (1 vs 50) + `automations`/`white_label`/`sla`. Confirm that's the intended ladder.
- **Uploads as an enforced dimension is NEW**: the locked matrix has no upload quota; uploads today are governed
  by the 25MB/file + magic-byte rules (UPLOAD_FEATURE_DESIGN). A per-tier word allowance needs an enforcement
  mechanism (Phase-5 scope).
- **Opus-on-chat is gated**: do NOT move paid self-serve tiers to Opus until Phase-5 gating is live AND the
  Sonnet-vs-Opus A/B settles (banner stays Haiku regardless). The margins above are modeling, not a committed
  model choice.

## Cross-links
- Enforced source of truth: **LORAMER_DECISIONS.md** (canonical Entitlement-matrix line).
- Billing architecture + phases: **STRIPE_BILLING_PLAN.md** (Phase 5 gating = PENDING).
- Real per-client spend + token shape that grounds the margins: CONV-ACTION-FLOOR / spend recon session (2026-07-05).
- Queue: **LORAMER_QUEUE_OF_RECORD.md** — "PROPOSED pricing model (2026-07)" carry-forward + the spend-logger
  Opus-rate prerequisite.
