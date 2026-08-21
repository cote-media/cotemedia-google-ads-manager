<!-- QUEUE-EXEMPT: routing doc, not new planned work. Every item here is an EXISTING queue entry and is
     tracked there — ★CHAT-RENDER-MEASUREMENT-MISSING (QUEUE:1104), ★CHAT-STATUS-INDICATOR (QUEUE:1024),
     ★G2 LORA VISIBILITY (QUEUE:886-899). This file assigns them to a session and fixes their order; it
     introduces no unbuilt unit of its own, so it has no queue entry to match. -->
# UI_SESSION_SCOPE.md — the fixed work list for the parallel UI session

<!-- LORAMER_UI_SESSION_SCOPE_V1 -->

⛔ **THIS LIST IS FIXED. THE UI SESSION MAY NOT EXTEND IT.**
Three items, in this order. When they are done the session reports and stops; it does not pick up a fourth.
Adding an item is Russ's call and takes an edit to this file by the backfill session, not by the UI session.

WHY A FILE AND NOT AN INSTRUCTION: "scope tightly" is a platitude unless something refuses. This repo's own
record is that a rule which lives only in a prompt is not a control. The file is the control; its immutability
by the session that reads it is the point.

---

## STANDING RULES FOR THIS SESSION — read before the items

**BRANCH.** Work happens on branch **`ui`** and nowhere else.
`LORAMER_QUEUE_OF_RECORD.md:211` (★UI-BRANCH-IS-PERMANENT), verbatim:
> **`ui` is a PERMANENT branch and is never merged to main.** It exists so the Google redirect URI and the
> branch-scoped Preview `NEXTAUTH_URL` are registered ONCE and reused by every future UI arc … ⛔ **DO NOT
> DELETE `ui` AND DO NOT MERGE IT** — deleting it would orphan the registered redirect URI, and merging it
> would carry `BRANCH_UI.md` into main for no reason. It carries no product change.

⛔ **A BRANCH WITH NO UNIQUE COMMIT IS INVISIBLE TO VERCEL** (`QUEUE:206`): Vercel dedupes by commit SHA, so
`ui` must always carry at least one commit `main` does not have or the preview silently never builds. It
presents exactly like a deployment-settings problem and cost a whole flight once.

**GATES.** `npx tsc --noEmit` and `npm run build` (which runs `npm run guard`). Both must be clean.

**WHAT THIS SESSION DOES NOT DO — one-writer rule, so two sessions cannot corrupt one manifest:**
- ⛔ Does **NOT** run `npm run check:data`, and does **NOT** quote its verdict. It reads the live database and
  takes >10 minutes; two sessions running it produce two different verdicts from the same repo. The backfill
  session owns it.
- ⛔ Does **NOT** run `scripts/wrap-docs.mjs`.
- ⛔ Does **NOT** write `CONTINUE_HERE.md`, `LORAMER_DECISIONS.md`, `LORAMER_QUEUE_OF_RECORD.md`, or
  `docs/HANDOFF_MANIFEST.json`. The wrap step recomputes every source-doc `content_hash` and re-stamps the
  digest; two writers produce a manifest describing one session's files and a digest built from the other's —
  **9/9 green on the freshness gate while §E carries the wrong head.**
- ⛔ Does **NOT** merge to `main`, and does not push `main`.

**HOW UI WORK IS PROVEN.** Local `npm run dev` proves engine-agnostic layout, logic, routing and copy. It has
never been what proves this UI. The proof path is: push `ui` → Vercel builds a preview → **Russ opens the
stable branch alias `cotemedia-google-ads-manager-git-ui-russell-cote-s-projects.vercel.app` on his phone** →
pass/fail. The Google redirect URI and the branch-scoped `NEXTAUTH_URL` are already registered for that exact
alias and were verified end-to-end on 2026-08-04 (`QUEUE:287`) — Google sign-in completed and Lora answered
with real data on a phone.

---

## ITEM 1 — CHROMIUM HEADLESS RENDER GATE

**Queue item:** ★CHAT-RENDER-MEASUREMENT-MISSING — `LORAMER_QUEUE_OF_RECORD.md:1104`

**What it is.** The repo has 138 guards and every one reads TEXT. The entry, verbatim:
> **GUARDS READ TEXT. NOTHING IN THIS REPO EVER RENDERS A PAGE AND MEASURES ANYTHING.** All 62–64 guards
> assert that a rule, a class, an identifier or an ordering EXISTS in a file. **Not one computes where an
> element lands.** So the entire class of *"every CSS rule is present and the layout is still wrong"* is
> invisible — and it is precisely the class that shipped twice in one night, both times with a full green board.

**The distinction that bounds it, verbatim:**
> The distinction is: **iOS-SPECIFIC behaviour → headless cannot see it, Gate-B on device is the only
> instrument. ENGINE-AGNOSTIC layout → headless sees it perfectly and is the cheap catch.**

**What to build, verbatim from the entry — build exactly this, do not re-derive it:**
> ▶ **WHAT TO BUILD:** a Chromium-headless render of `/dashboard-next/lora` asserting `composer.top > list.top`
> and `composer.bottom` within ~2px of the viewport bottom.

**⛔ THE HARD CONSTRAINT, verbatim — this is not a preference:**
> ⛔ **IT CANNOT BE WIRED INTO `npm run guard`, AND THAT IS A HARD CONSTRAINT RATHER THAN A PREFERENCE:
> `npm run build` RUNS `npm run guard`, AND THAT RUNS ON VERCEL.** Putting Playwright and a browser binary on
> the Vercel build path is the same call this repo already made and rejected once (LORAMER_GUARD_RUNALL_V1
> refused npm-run-all2 for exactly that reason). ⇒ **IT BELONGS BESIDE `check:data` AND `evals`: a MANUAL
> PRE-SHIP GATE, deliberately outside `guard`/`build`, reported in the ship report the same way.**

**⚠ THE PRECONDITION THAT KILLED THE FIRST ATTEMPT, verbatim:**
> ⚠ **AND IT NEEDS A RUNNING AUTHED APP** — `/dashboard-next/*` is behind `requirePreviewUser()` and a NextAuth
> session, which is the same wall `npm run evals` documents. That is why it was NOT built in the reverting
> flight: **it could not be RED-PROVED against the layout Russ photographed, and Russ's own instruction was
> that a render guard which cannot go red on that exact defect is worthless and should be reported rather than
> shipped.**

**DONE means.** A script (its own npm script, beside `check:data` / `evals`, NOT in `guard` or `build`) that
renders the real authed page in headless Chromium, measures the two assertions above, exits non-zero on
failure — **and has been PROVEN RED against a deliberately broken layout before it is proven green.** A gate
that has never gone red is not a gate.

**How it is proven.** Red-first: break the composer layout in the worktree, watch the script fail naming the
measurement; restore; watch it pass. Report both runs.

**Out of scope.** Any iOS-specific behaviour (keyboard, visualViewport, safe-area) — headless cannot see it and
claiming otherwise is the ★MOBILE-WIDTH-GUARD error repeated. Any wiring into `guard`/`build`. Any second page
beyond `/dashboard-next/lora`.

---

## ITEM 2 — CHAT STATUS INDICATOR

**Queue item:** ★CHAT-STATUS-INDICATOR — `LORAMER_QUEUE_OF_RECORD.md:1024`
**Rank #6(g). Dependency 5b is MET. ⛔ Explicitly on the 9/30 critical path.**

**Scope, verbatim from the entry:**
> Per-tool-call status lines DERIVED FROM ACTUAL TOOL INVOCATION, naming the real subject ("Reading 47 days of
> Google Ads keyword data"). ⛔ NEVER a canned reassurance loop on a timer — a fake progress line is a lie that
> also destroys the trust the real one buys. A degraded or failed tool call must RENDER as degraded, never as
> completed. This is what converts a 10-second wait from a hang into visible diligence
> ([[LORAMER_LATENCY_IS_DILIGENCE_V1]]).

**DONE means.** Every status line on screen during a turn is derived from a real tool invocation; a failed or
degraded call renders as degraded; there is no timer-driven text anywhere in the path.

**How it is proven.** A real turn on a real client, on a phone, through the `ui` preview — the lines that appear
match the tool calls the server actually made. Cross-check against `★CHAT-STATUS-SILENT-WINDOWS` (QUEUE:1031),
which is the frame audit of what the screen says during a long tool-using turn, in order, with literal strings.

**Out of scope.** The LM mark animation (★LM-MARK-LIVE, QUEUE:1025 — a separate #6(h) item). The desktop side
panel (★CHAT-DESKTOP-SIDE-PANEL, QUEUE:1026). Upload in composer (★CHAT-UPLOAD-IN-COMPOSER, QUEUE:1023).

---

## ITEM 3 — G2 LORA VISIBILITY

**Queue item:** ★G2 — LORA VISIBILITY — `LORAMER_QUEUE_OF_RECORD.md:886-899`

**What it is.** A governing-law violation: *"LORA SEES EVERYTHING — there is NO acceptable situation where Lora
can't see a user's own data."* Millions of rows are captured, paid for, and unreachable by the model.
Captured-but-invisible, per the entry (⚠ its own instruction: **RE-VERIFY every line number, do NOT trust
these**):
- **GOOGLE GEO FAMILY** — 19 breakdown_types × 2 entity levels (campaign + ad_group), captured to floor;
  `BREAKDOWN_PLATFORMS` (metrics-query.ts:279-289) contains none of them.
- **GA DIMENSIONAL** — all 12 types (`ga_source_medium`, `ga_channel`, `ga_campaign`, `ga_landing_page`,
  `ga_device`, `ga_geo_country`, `ga_geo_region`, `ga_geo_city`, `ga_age`, `ga_gender`, `ga_event`, `ga_item`).
- **META age_gender** — captured at 4 entity levels, absent from the breakdownType enum.
- **GOOGLE device at ad_group + keyword** — captured, but the entityLevel enum is
  `[account,campaign,ad_set,ad]`, so those two grains are unreachable even for an allowed dimension.

**⛔ THE METHOD IS BANKED AND STRICTLY ORDERED — "METHOD (do it in this order)". Verbatim:**
> **(i)** LAW-2 FULL-PATH RECON first. Re-verify every line number above against the live code. The audit is a
> claim about the code, not the code (G3's whole lesson).
> **(ii)** DERIVE TRUTH FROM THE LIVE DB. The DISTINCT (platform, breakdown_type, entity_level) tuples actually
> in metrics_daily ARE the source of truth — **NOT** docs/LORAMER_BREAKDOWN_REGISTRY.md. A doc can be
> honest-but-false: G3 is the proof (the registry said Google age/gender were "VERIFIED in-code"; zero rows
> have ever landed). Use the recursive row-value skip-scan over
> idx_metrics_daily_client_platform_bt_level_date (all 4 key cols are NOT NULL → skip-scan ≡ DISTINCT, the
> migration-037 theorem); it clears 8s where a naive GROUP BY does not.
> **(iii)** COLLAPSE TO **ONE DECLARED SOURCE** that BOTH the tool schema and the query layer read. Do NOT just
> add today's missing entries — that fixes the instance, not the class, and the instance-fix is exactly what
> regressed on 2026-06-20 → team/page.tsx:22 three weeks later. Same shape as settleRevenue /
> META_BREADTH_FORWARD / resolveShellClient.
> **(iv)** HONEST LIMITS — STATE THESE BEFORE BUILDING, they may change the design: (1) the tool schema IS part
> of Lora's prompt, so a ~40-entry enum costs input tokens on every turn and may DEGRADE tool selection (a
> longer enum is not free — measure or bound it); (2) a wider allowlist can fan a query past the **8s** live
> statement_timeout (PostgREST/authenticator — the 120s cluster default is MCP-only and lies), and the banked
> finding stands that fine-grain wide-window reads page ALL rows to JS-aggregate (search_term 12mo ≈ 37
> sequential pages ≈ 18s ROUTE) — exposing more dims widens that surface.
> **(v)** FIX-WITH-GUARD (no guard = not shipped): the guard must FAIL when a CAPTURED tuple is unreachable by
> Lora, and be **proven failing at HEAD naming Google geo + GA + age_gender BY NAME**. ⚠ HONEST PROBLEM TO
> SOLVE, NOT FAKE: a hermetic build-time guard CANNOT read the live DB (no network in CI, and the DB is prod).
> So it cannot assert "every captured tuple is reachable" at build time. If that is the case, SAY SO and
> propose what CAN be enforced — e.g. a guard asserting the tool schema is GENERATED FROM the one declared
> source (so schema and query layer can never drift), plus a SEPARATE non-build check.

**ALREADY SHIPPED, do not redo:** **STEP 2A ✅ 2026-07-16 (LORAMER_BREAKDOWN_SQL_AGG_V1, migration 038)** —
`queryBreakdown` aggregation moved into Postgres via the scoped RPC.

**DONE means.** One declared source; tool schema and query layer both read it; the guard from (v) exists and
was proven red at HEAD naming Google geo + GA + age_gender by name; the honest limits from (iv) are stated in
the ship report whether or not they changed the design.

**How it is proven.** The guard's red-first run, plus a live Lora turn asking for a previously-invisible
dimension (a Google geo breakdown, or GA source/medium) and getting real rows.

**Out of scope.** Adding today's missing enum entries as a one-off — the entry forbids it explicitly: *"that
fixes the instance, not the class."* Any change to the capture/walk path. Any migration beyond what (iii)
requires.

---

## REPORTING

One item at a time. Each finishes with: the diff, `npx tsc --noEmit` exit code, `npm run build` exit code and
guard count, the red-first proof where the item calls for one, and the preview URL for Russ's phone. Then stop
and wait — the next item does not start until the previous one is accepted.
