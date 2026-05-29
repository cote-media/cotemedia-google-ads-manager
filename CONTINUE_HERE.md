# CONTINUE_HERE — Ask Claude scroll-on-refresh (read after LORAMER_HANDOFF.md and ROADMAP.md)

*Written at end of session May 28, 2026 — after a marathon day that shipped eight production-verified features. The next Claude should read LORAMER_HANDOFF.md first (especially the new lessons 11-15 and the "Claude.ai vs Claude Code" section), then ROADMAP.md, then this file.*

---

## Day's first ship for May 29: Ask Claude scroll-on-refresh

**Marker:** `LORAMER_ROADMAP_ASKCLAUDE_SCROLL_V1`
**Priority:** Russ explicitly flagged this as the day's first task. Ship it before anything else.

**The bug:** On page refresh, the Ask Claude panel scrolls to the FIRST message in the conversation. User has to scroll all the way back down to see the latest exchange. Should default to scroll-to-bottom (latest message visible) on mount.

**Where to look:** Ask Claude panel rendering. Most likely in one of:
- `src/app/dashboard/page.tsx` — the Ask Claude tab is rendered inline here (per audit, dashboard is ~3000+ lines)
- A dedicated component if one exists for the chat UI (grep for `messages.map` and `useRef` patterns)

**Likely fix shape:**
- Add a `useRef` on the chat-scroll container
- `useEffect` on mount (and on `messages.length` change) that calls `scrollTo({ top: scrollRef.current.scrollHeight })` or `scrollIntoView` on the last message
- The mount-time effect is what fixes the "scrolled to first message on refresh" symptom

**Verification approach:**
1. Open Ask Claude tab on a client with existing conversation history → confirm latest message visible immediately
2. Send a new message → confirm auto-scrolls to new exchange
3. Refresh page → confirm latest message still visible (the regression we're fixing)

**Discipline reminders for this patch:**
- Read the current Ask Claude render code FIRST before writing the patch (lesson 5 — stale anchors)
- This is a `dashboard/page.tsx` edit which is enormous — grep for the existing render to anchor accurately
- Russ may want to see the change preview before push since it's UX-visible. Ask
- One-line change deserves single-edit patch with content-based idempotency

---

## What got shipped May 28 (so you have context)

Eight commits hit `main`, all green on Vercel, all production-verified by Russ:

1. **PMax Step 2g** (`LORAMER_PROJECT_3_STEP_2G_V1` + `PROMPT_V2`) — top combinations via `asset_group_top_combination_view`. Per-asset BEST/GOOD/LOW labels confirmed UI-only in v23. Prompt has diagnostic empty-state branches. Verified on My Vacation Network (Ad Strength branch) AND Escential Group (conversion-tracking branch).

2. **Step 3 Patches 1+2+3 — Tier 2 intelligence rollout** (Claude-context only, no UI surfaces, per Russ directive):
   - 3A/B/C: Geographic + Device + Hour (`LORAMER_PROJECT_3_STEP_3A/B/C_V1`)
   - 3D: Impression Share with rank-vs-budget decomposition (`LORAMER_PROJECT_3_STEP_3D_V1`)
   - 3E: Google Recommendations with operator-bias grounding + hotfix for enum integer→label resolution + slice bump 30→100 (`LORAMER_PROJECT_3_STEP_3E_V1` + `HOTFIX_V1` + `SLICE_BUMP_V1`)

3. **Cross-Claude consistency** (`LORAMER_CROSS_CLAUDE_FOCUS_V1`) — fixed real bug where `/api/chat` was emitting human-readable labels ("Meta Ads campaigns", "Ask Claude conversation (cross-platform)") that `normalizeFocus()` couldn't match, falling through to `row-context` mode. Insight bar passed correct mode keys. Result: same question on different surfaces gave different answers. Now all three surfaces (insight bar, right panel, Ask Claude tab) see identical context for the same question.

4. **Meta Placements** — multi-part marathon:
   - Patch 4a (`LORAMER_PROJECT_3_STEP_4A_V1`) — surfaced existing placement aggregation through the type + return + prompt section
   - **THE REAL BUG that had been silently broken for months** (`LORAMER_META_PLACEMENT_FIELDS_FIX_V1`): `placementFields` constant included `publisher_platform,platform_position` — those are breakdowns, not fields. Meta returned HTTP 400, `.catch(() => [])` swallowed it. The breakthrough was lesson 15 in action: instrumented a raw HTTP response capture directly into Claude's prompt, asked Claude to quote it verbatim, saw the exact error message in 60 seconds.
   - Final verification on a Meta client returned 186 rows of real placement data with concrete recommendations: exclude FB Reels Overlay + Audience Network + FB Instream Video ($137 wasted), scale Instagram Reels at $0.15 CPC.

## Three lessons added to LORAMER_HANDOFF.md tonight

- **Lesson 13:** Same-line comments after commas can break webpack builds even when tsc passes
- **Lesson 14:** `tsc --noEmit` is NOT `npm run build` — webpack's parser is stricter. Don't pretend the laptop's tsc-pass means Vercel will be green
- **Lesson 15:** Surface raw API responses into Claude's prompt as the diagnostic of last resort when Vercel logs unavailable
- Plus the new "Claude.ai vs Claude Code" section explaining that this Claude can't read the local repo directly — ask Russ for whole-file pastes rather than pinball-flipping sed slices

## Pending work after the scroll fix

Order of priority (all in ROADMAP.md):

1. **🔥 Ask Claude scroll-on-refresh** (this file's focus)
2. **Client-switch data refresh** (`LORAMER_ROADMAP_CLIENT_SWITCH_REFRESH_V1`) — when switching clients via left sidebar, full client data doesn't refresh consistently
3. **Patch 4b — Meta adset targeting extraction + prompt rendering** — targeting field captured in adsets but not flowing to Claude
4. **Patch 4c — Meta per-conversion-event breakdown query** (`action_breakdowns`)
5. **Step 3 continuation — Shopify deeper signals** (LTV by segment, return rate by product, abandoned cart rate)
6. **User-defined dashboard cards for Tier 2 signals** (`LORAMER_ROADMAP_DASHBOARD_CARDS_ONDEMAND_V1`) — let users optionally surface Geo/Device/Hour/IS/Recommendations/Placements as dashboard cards
7. Project 14 Phase 4 — cross-surface attribution (design doc exists at `docs/PROJECT_14_PHASE_4_DESIGN.md`)
8. Project 9 Phase 2.2 — changed circumstances detection (design doc with 3 open questions)
9. Project 8 tech debt — hardcoded Georgia font in layout.tsx (audit-flagged root cause)

## Discipline reminder before starting

Russ has been explicit:
- **Right is always better than fast.** Take the 30 minutes over the 5-minute shortcut.
- **Think hard, type less.** Internal thinking budget is unlimited. Output to Russ is rationed. Brief paragraph of insight + next command/question. No recaps, no apologies, no "here's what I'll do."
- **No same mistake twice.** Lessons 1-15 are in LORAMER_HANDOFF.md. Search them when uncertain.
- **Always dry-run multi-edit patches.** Free check, expensive omission.
- **Comments NEVER on the same line as commas or closing tokens.** Lesson 13. Burned us today.
- **`tsc --noEmit` is not a real build.** Lesson 14. Vercel is the final check. Have `git revert HEAD --no-edit && git push` ready if a push breaks.

Today was a real day — eight production-shipped features. Don't squander tomorrow by skipping the discipline.
