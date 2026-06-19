# LORAMER_NEXT_FLIP_PROGRAM

The program plan for **-next as the flip-over app**: a complete new frontend + read layer, built dark behind the
preview gate on the existing shared backend, cut over to as the default app once Meta + Google approvals land and
parity is verified. Authored from the RBAC design (this session) + `docs/LORAMER_REDESIGN_SPEC.md` §1 + §4.

Status: PLAN (approach-before-build). No code, no migration shipped by this doc. Increment 1 = the standing NEXT
STEP ("wire -next to real data"), built membership-aware from line one.

---

## 1. DECISION — adopt "-next as the flip-over app"

Build the COMPLETE new frontend + read/presentation layer (`/api/next/*`) **dark behind `requirePreviewUser`**,
on the **existing shared backend** (same Supabase data, same capture/backfill/token machinery), and **cut over**
to it as the default app once:

- Meta App Review is approved, AND
- Google Ads permissible-use is flipped to external (see CONTINUE_HERE date-gated item 3), AND
- -next **parity** is verified on desktop AND mobile.

-next is not a rewrite of the product — it is a new presentation of the same system of record. The current app
stays the live reviewer + customer app until the cutover; -next replaces it only when it is at least at parity
and the approvals are in.

---

## 2. SHARED-BACKEND BOUNDARY (the rule)

-next rebuilds **frontend + read/presentation routes (`/api/next/*`) ONLY.** It does **NOT** duplicate:

- the nightly cron / forward capture (`/api/cron/*`)
- platform adapters / intelligence fetchers (`src/lib/intelligence/*`)
- backfill engines + reconciliation (`src/lib/backfill/*`, the self-reconcile/HALT logic)
- token mint / refresh / CAS (`src/lib/{shopify,ga}-token.ts`, `meta-ads.ts`, `google-ads.ts`, the refresh races)
- Supabase schema / data (it READS the same tables; only ADDITIVE migrations, e.g. 018_client_members)

It **reads the same data** the current app writes. **Connect / OAuth flows are REUSED** (shared, untouched)
unless a -next-native connect flow is later **explicitly** scoped as its own increment. One backend, two
frontends during the window.

---

## 3. FREEZE-SAFETY INVARIANT

Never modify the frozen reviewer surfaces or their backing routes:

- Frozen UI: current `/dashboard`, `/clients`, the connect flows, the dashboard Meta tab.
- Frozen routes: the **20 owner-gate files / 58 `.eq('user_email', session.user.email)` sites**, including
  `/api/clients`, `/api/intelligence`, `/api/chat`, `/api/insight`, `/api/context`, `/api/memory`,
  `/api/clients/connections`, and the per-platform read routes.

ALL -next work = **new routes + new components + additive migrations behind the preview gate.** Because the
owner-gate files stay byte-identical and `client_members` is empty until a real invite, the system behaves
exactly as today until cutover. **Freeze-safe by construction** — no reviewer surface diverges from the
screencast.

---

## 4. PARITY SCOPE (PROPOSED — pending Russ confirm)

The surfaces -next must cover to be **flip-ready**. Each tagged **[FLIP]** (must reach parity before cutover) or
**[LATER]** (can land after cutover without blocking it).

Dashboard tabs / views:
- Overview (the front door, unified "one picture" viz) — **[FLIP]**
- Google tab — **[FLIP]**
- Meta tab — **[FLIP]**
- Combined / blended (MER) view — **[FLIP]**
- Shopify tab — **[FLIP]**
- WooCommerce tab — **[FLIP]**
- Analytics / GA4 tab — **[FLIP]**
- Channel drill-down sub-tabs (Summary / Campaigns / Keywords / Search terms / Assets) — **[FLIP]** for the
  channels that have them today; deeper per-asset views — **[LATER]**

Client list & navigation:
- Multi-Client Overview / portfolio (evolved `/clients`: card per client, headline metric + delta + status) — **[FLIP]**
- Client switcher + "All clients" paths (crumb / chip / drawer) — **[FLIP]**
- Proactive-Lora "who needs attention" strip (portfolio intelligence) — **[LATER]** (intelligence phase; static
  or basic at flip is acceptable)

Client "brain" (the sectioned client page):
- Identity / General (name, logo, website, service area, descriptor, NAICS) — **[FLIP]**
- Connections section (platform · account · health, read display) — **[FLIP]**
- Knowledge / uploads store — **[FLIP]** (shipped this session; PDF fix done)
- Rules (directives) — **[FLIP]**
- Facts (what Lora knows; source-marked) — **[FLIP]**
- Scans (client + competitor, conversational) — **[LATER]**
- Saved-chats browser — **[LATER]**

Lora / Mer:
- Lora chat (per-client, membership-aware via `/api/next/chat`) — **[FLIP]**
- Mer (per-client structured brain destination) — **[FLIP]** at read/identity level; editable-brain depth — **[LATER]**

Connect:
- **Connect a source = REUSE the existing shared OAuth flows** (no -next-native connect at flip) — **[FLIP via reuse]**

Cross-cutting (apply to every [FLIP] surface):
- Responsive desktop + mobile (standing DoD) — **[FLIP]**
- Membership-aware reads (owner + viewer/editor via resolveAccess) — **[FLIP]**

> Parity definition: a [FLIP] surface is "at parity" when it shows the same data, correctly, as the current app
> for the same client + date range, on desktop and mobile, through the membership-aware read layer.

---

## 5. CUTOVER (staged, reversible)

GATE (all three required): Meta approved **AND** Google permissible-use flipped to external **AND** -next parity
verified (every **[FLIP]** surface, desktop + mobile).

FLIP:
1. Swap the default app route to -next (the current app becomes the explicit fallback path).
2. Retire the preview gate (membership alone governs access post-flip).
3. Verify every surface live; monitor (errors, data correctness, auth).
4. THEN retire the old app — only after the monitoring window is clean.

ROLLBACK: revert the default-route swap → the old/frozen app is instantly the live app again. The old app stays
fully functional as the reviewer + customer app right up to (and after) cutover, as the safety net.

DECOUPLE FROM JULY-14 LAUNCH: the **current app is the launch vehicle and safety net** for the founding cohort.
-next flips **when ready — at or after launch**, never as a launch dependency. The soft launch must not wait on
-next, and -next must not be rushed to hit it.

---

## 6. INCREMENT 1 = the standing NEXT STEP, unified with RBAC

"Wire -next to real data," built **membership-aware from line one** = the RBAC design. Embedded here so it is
built once, never owner-only-then-rewritten:

- **Migration 018_client_members** (additive): `client_id` (FK→clients ON DELETE CASCADE), `member_email`
  (lowercased), `role` in (`editor`,`viewer`) — OWNER stays IMPLICIT via `clients.user_email`, not stored —
  `invited_by`, `created_at`, unique(`client_id`,`member_email`). RLS on, no policies (service-role only). Empty
  until the first real invite → dark/no-op by default.
- **resolveAccess / canAccess** (`src/lib/access/can-access.ts`, server-only):
  `resolveAccess(clientId, viewerEmail) → { ok, ownerEmail, role } | null`. Owner match first, then
  `client_members`, else null (caller 404s). Plus `listAccessibleClients(viewerEmail)` = owned ∪ shared.
- **`/api/next/*` read routes** (NEW namespace, none exists today): each does session → resolveAccess → 404 if
  null → read by `client_id` (+ `ownerEmail` for owner-keyed dependent rows). Reads only in Increment 1;
  role-gated writes follow.
- **The owner-identity keystone:** a share **runs on the OWNER's identity**. `viewerEmail` is used ONLY for
  authz + audit — NEVER for a token lookup or an owner-keyed row read. ALL token fetches + owner-keyed reads use
  the returned `ownerEmail`. So a read-only share works on the owner's EXISTING tokens — **no re-mint, no MCC
  change, no reconnect** — and a member never sees a blank brain / empty data.
- **Freeze proof:** new table + new helper + new `/api/next/*` routes + -next component fetch-target swaps; the
  20 owner-gate files stay byte-identical; everything renders only behind `requirePreviewUser`.

---

## 7. DECISIONS K1–K5 (recommended calls — PENDING RUSS CONFIRM)

- **K1 — knowledge route.** EDIT `/api/knowledge` in place to be resolveAccess-aware. It's new this session,
  -next-only, zero reviewer coupling → editing it avoids a needless clone. **RECOMMEND: edit-in-place.**
  *(PENDING RUSS CONFIRM)*
- **K2 — chat threads.** Per-actor member threads: a member's Lora chats are keyed to HER email; the shared
  brain (Rules/Facts/context/knowledge) stays owner-keyed and shared. Additive (no migration). **RECOMMEND:
  per-actor threads.** *(PENDING RUSS CONFIRM)*
- **K3 — roles at launch.** Viewer-only first (smallest, safest; covers the "let her see my data" case);
  editor as a fast-follow. **RECOMMEND: viewer-first.** *(PENDING RUSS CONFIRM)*
- **K4 — grant scope.** Per-client only first (the `client_members` table); agency-wide "all my clients" grant
  deferred to a later increment. **RECOMMEND: per-client.** *(PENDING RUSS CONFIRM)*
- **K5 — freeze reading.** New `/api/next/*` + a new table + the 20 owner-gate files byte-identical = freeze-safe
  by the letter (no reviewer surface changes). **AGREE; Russ to confirm acceptance.** *(PENDING RUSS CONFIRM)*

---

## 8. GUARDRAILS

- **Hold the parity scope** — no drift; new surface ideas go to [LATER] or a future increment, not into the flip
  gate.
- **Two-app maintenance tax during the window** — any backend change must keep BOTH the current app and -next
  working (shared backend; don't break the live app to advance the dark one).
- **Approach-before-build on each increment** — design printed and approved before code, per the operating model.
- **Staged-revert ready** — every increment ships behind the gate with a clean revert; cutover itself is a
  route swap with instant rollback.
- **Docs ship with code** — this program doc + ROADMAP move in the same commit as the increment they describe.
