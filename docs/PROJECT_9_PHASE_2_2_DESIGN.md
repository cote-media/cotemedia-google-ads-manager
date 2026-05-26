# Project 9 Phase 2.2 — Changed Circumstances (Memory Evolution)

**Author:** Claude (May 26, 2026, after Phase 2 shipped)
**Status:** Design pending Russ approval. Do not execute until reviewed.

---

## What this is

When a user's instructions evolve over time — "ignore ROAS" → six weeks later → "track ROAS now" — Claude should:

1. **Notice** the change rather than silently overwriting OR silently following the stale instruction
2. **Acknowledge** it in conversation ("ROAS was off the table before — did something change?")
3. **Record** the change in memory with timeline awareness — old fact superseded, not erased
4. **Reason** about patterns — if user goes back-and-forth on something, Claude understands the volatility, not just the current state

The brand-correct framing is **"changed circumstances," not "contradictions."** Two facts can both have been true at different times. Neither was wrong; the world moved. A good analyst notices the change and confirms it; a bad one just executes the latest instruction blindly.

---

## Why this matters

### Brand alignment

LoraMer = "deep knowledge that accumulates." Phase 2 made facts persist. Phase 2.2 makes the *evolution* of facts persist. That's a different and harder kind of memory — Claude isn't just remembering what's true now, it's remembering the trajectory of how the user's thinking changed.

That's what real institutional memory looks like at a real agency. "We tried Performance Max last spring, it underperformed, we paused it. Then we re-ran in Q4 with new feeds and it crushed." The history matters as much as the current state.

### Failure mode without this

Without changed-circumstances handling, two bad things happen:

1. **Stale instructions outlive their usefulness.** "Ignore ROAS" was the right call in May (no purchase pixel). In August (pixel firing, e-commerce live), Claude is still ignoring ROAS — and the user doesn't realize Claude is being held back by a stale fact.

2. **New instructions get silently applied.** User says "track ROAS now." Step 6 auto-detect adds it as a fact. Claude starts tracking ROAS. Old "Ignore ROAS" is still active. Claude has two contradictory facts in memory and either picks one (gets confused) or applies both (incoherent responses). User doesn't know any of this is happening.

Both failure modes silently degrade quality without the user noticing — exactly the opposite of "deep knowledge accumulates."

---

## Architecture

### 1. Schema additions to `client_memory`

```sql
ALTER TABLE client_memory
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS superseded_by BIGINT REFERENCES client_memory(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_client_memory_supersession
  ON client_memory(client_id, superseded_at);
```

- `superseded_at` — when this fact was replaced by a newer one (NULL if still current)
- `superseded_by` — which newer fact replaced it
- Indexed so the prompt builder can quickly filter active vs. historical facts

**Critical:** superseding is NOT archiving. Old facts stay readable, just marked as historical. Brand commitment preserved.

### 2. Conflict detection

When a new memory fact is being created (via auto-detect OR manual UI add OR bootstrap), the server checks for potential conflicts with existing ACTIVE facts.

**Phase 2.2 approach: regex-based opposite-pair detection.**

Maintain a small dictionary of opposite-meaning patterns:

```typescript
const OPPOSITE_PAIRS: Array<{ a: RegExp; b: RegExp; subject: 'ROAS' | 'CPM' | 'metric' | string }> = [
  { a: /ignore\s+roas/i,      b: /track\s+roas|use\s+roas|consider\s+roas/i,      subject: 'ROAS' },
  { a: /ignore\s+cpm/i,       b: /track\s+cpm|use\s+cpm|consider\s+cpm/i,        subject: 'CPM' },
  { a: /never\s+(\w+)/i,      b: /always\s+\1|definitely\s+\1/i,                  subject: 'verb' },
  { a: /always\s+(\w+)/i,     b: /never\s+\1|don'?t\s+\1/i,                       subject: 'verb' },
  { a: /focus\s+on\s+(\w+)/i, b: /ignore\s+\1|deprioriti[sz]e\s+\1/i,             subject: 'metric' },
  // ... extensible
]
```

The function checks each existing active fact against the incoming new fact via these patterns. Returns either `null` (no conflict) or `{ existingFact, subject }`.

**This is intentionally conservative.** Regex misses fuzzy cases ("ROAS isn't important here" wouldn't catch as conflicting with "we care about ROAS"). Phase 2.5 will add Haiku-based semantic detection. For Phase 2.2 the goal is to handle the obvious 80%.

### 3. Server response

`/api/memory` POST (and `/api/conversations` POST when auto-detect fires) checks for conflicts. If found, response includes:

```json
{
  "memory": { /* the new fact, NOT YET INSERTED if conflict detected */ },
  "supersedes": {
    "id": 42,
    "content": "Ignore ROAS as a primary performance metric",
    "subject": "ROAS"
  },
  "pendingDecision": true
}
```

The new fact is NOT inserted yet — we wait for the user to choose. Two paths after this:

- User chooses "Replace" → server inserts new fact, sets old.superseded_at + old.superseded_by
- User chooses "Keep both" → server inserts new fact, leaves old active (both facts active simultaneously, Claude sees the tension)
- User chooses "Cancel" → nothing happens

### 4. UI — toast variant for changed circumstances

The existing MemoryProposalToast gets a second mode. When `supersedes` is present in the response, the toast renders differently:

```
SAVE TO MEMORY — supersedes earlier note

"Track ROAS now that we have purchase tracking"

PREVIOUSLY:
"Ignore ROAS as a primary performance metric"

[Replace] [Keep both] [Cancel]
```

The "Replace" button is primary. "Keep both" is secondary. Cancel dismisses without saving.

After save, brief confirmation: "✓ Updated — old note is preserved in history."

### 5. Memory editor UI — historical facts visible

The ClientMemorySection adds an optional collapsed section at the bottom:

```
▾ HISTORY (3 superseded facts)
```

Expanded shows:

```
☉ Ignore ROAS as a primary performance metric
   superseded May 21 → "Track ROAS now that we have purchase tracking"
```

Read-only. Users can see what changed and when. Clicking a historical fact could (Phase 2.3+) restore it as active, but Phase 2.2 keeps this simple — view only.

### 6. Claude-side awareness

This is the biggest behavior change. The prompt builder gets a new section that fires when relevant:

```
=== RECENT CHANGES IN USER INSTRUCTIONS ===

The user has updated their instructions in the last 30 days:

  May 21: said "Ignore ROAS as a primary performance metric"
  May 26 (today): said "Track ROAS now that we have purchase tracking" — REPLACED previous

If the user's current question touches on ROAS, briefly acknowledge
the change. Example: "ROAS was off the table earlier — using it now
since the pixel is live."

If they made the change recently without context, you can ask: "Did
something change with the purchase tracking?" Don't over-do it; one
brief acknowledgment is enough.
```

This makes Claude *act* like an analyst noticing the shift, not a database silently applying the latest write.

**Cap on how much history to surface:** last 5 changes, last 30 days. Beyond that the timeline gets noisy and Claude starts narrating every old shift on every response.

---

## Phased build

Same structure as Phase 2.

### Step 1 — Migration (10 min)
Add `superseded_at` + `superseded_by` columns to `client_memory`, plus index. Same drill.

### Step 2 — Conflict detection helper (30 min)
New file `src/lib/memory-conflict.ts` with `OPPOSITE_PAIRS` array and `detectConflicts(newContent, existingFacts)` function. Returns `null` or the conflicting existing fact.

### Step 3 — API integration (45 min)
- `/api/memory` POST: if `pending: true` query param, return supersedes info instead of inserting. If `replaces: <id>` body field set, mark old as superseded after insert.
- `/api/conversations` POST: when proposeMemory is detected, also run conflict check and include `supersedes` in response.

### Step 4 — Toast UI variant (30 min)
MemoryProposalToast handles the new shape. Three buttons: Replace, Keep both, Cancel.

### Step 5 — Memory editor history section (30 min)
Add collapsed "HISTORY" section showing superseded facts with timeline.

### Step 6 — Prompt builder injection (30 min)
buildClaudeContext renders "RECENT CHANGES IN USER INSTRUCTIONS" section when superseded facts exist within the last 30 days.

### Step 7 — End-to-end test
Add "ignore ROAS" as a fact. Then through chat say "let's start tracking ROAS now." Verify:
- Toast shows the supersedes variant
- Replace correctly marks old as superseded, inserts new
- Subsequent Claude response acknowledges the change naturally
- History section in memory editor shows the chain

Estimated total: **3-4 hours across 1-2 sessions.**

---

## What's intentionally OUT of scope

- **Semantic (Haiku-based) conflict detection.** Phase 2.5 territory. Regex first.
- **Multi-step chains.** If user says "ignore X" → "track X" → "ignore X again," we record all three. Phase 2.2 doesn't try to detect that this is oscillation and special-case it. The history is just visible.
- **Bulk "review your memory" prompts.** Periodic check-ins where Claude asks "is X still relevant?" — Phase 4 (nightly learning loop) territory.
- **Cross-client supersession.** If user ignores ROAS on Client A and tracks ROAS on Client B, that's not a conflict — different clients have different rules. Each client's memory is isolated.

---

## Risks

### Risk 1: False positives — too aggressive about flagging changes
If the regex is too loose, every user message that mentions ROAS triggers a "did you change your mind?" prompt. Annoying.
**Mitigation:** OPPOSITE_PAIRS starts conservative. Only fires when both regex patterns clearly match opposite directives. Tune by watching real usage.

### Risk 2: Missing changes — too conservative
The flip side. User says "let's start using ROAS again" but the regex doesn't catch the relationship to existing "ignore ROAS." Claude proceeds without acknowledging.
**Mitigation:** Acceptable for Phase 2.2. Phase 2.5 Haiku layer fixes this.

### Risk 3: User confusion at the toast
"Replace vs. Keep both" might not be intuitive. What does Keep both even mean?
**Mitigation:** Help text under buttons:
- "Replace" → "Old note will be marked historical. Claude uses the new one only."
- "Keep both" → "Claude will see both — useful if the conditions for each are different (different campaigns, different time periods)."

### Risk 4: Old facts pile up in history and clutter the timeline
Eventually users have dozens of superseded facts. The 30-day cap on what gets surfaced in prompts handles most of this. History section in UI is collapsed by default.

### Risk 5: "Keep both" creates incoherent prompts
If both "Ignore ROAS" and "Track ROAS" are active, Claude sees two contradictory directives in HARD CONSTRAINTS and behavior becomes unpredictable.
**Mitigation:** When both are active, prompt builder renders them as:
```
The user has set TWO instructions on this topic. Use judgment:
  • Ignore ROAS (added May 21)
  • Track ROAS (added May 26)
If unclear which applies, ask the user.
```

Claude is told explicitly to ask rather than guess.

---

## Open questions for Russ

1. **When user picks "Keep both," should Claude default to the newer fact in case of unclear application, or always ask?** I'd argue "always ask" — that's the brand-correct move (analyst, not vending machine).

2. **Should the "RECENT CHANGES" section appear in EVERY Claude response or only when relevant to the topic?** I'd argue only when relevant — pattern: if the conversation/question mentions the subject (e.g. user asks about ROAS), surface the change. Otherwise stay silent. Less noisy.

3. **Should superseded facts feed Phase 2.5 extraction (learning patterns from how user changes their mind)?** Probably yes — that's the kind of pattern recognition the Scale tier promises. But out of scope for Phase 2.2 itself; just don't preclude it architecturally.

4. **Auto-promote a "Keep both" fact to "Replace" if the user goes a few weeks without referencing the old one?** Too magical, defer.

5. **Should the user see the conflict BEFORE they hit send, or only after Claude responds?** Currently the design has it appear after the assistant response (via toast). Alternative: show it inline as the user is typing if their message looks like it'll trigger a supersession. I'd argue post-response — keeps the chat experience clean.

---

## What changes for the user

Before Phase 2.2:
- User says "track ROAS now"
- Toast: "Save to memory: Track ROAS now — [Save as Directive]"
- User saves
- Now memory has both "Ignore ROAS" AND "Track ROAS" active
- Claude is confused, possibly applies both, possibly picks one randomly

After Phase 2.2:
- User says "track ROAS now"
- Toast: "Save to memory — supersedes earlier note: 'Ignore ROAS.' [Replace] [Keep both] [Cancel]"
- User picks Replace
- Memory now has "Track ROAS" active, "Ignore ROAS" preserved as history
- On next Claude response touching ROAS, Claude says something like: "ROAS was off-limits before — using it now since you've flipped that. Let me know if that's not right."
- User feels seen, not babysat.

---

## What I am NOT doing right now

Not writing code. Awaiting review.
