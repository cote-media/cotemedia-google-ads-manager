# Project 9 Phase 2 — Persistent Memory & Learning, Design Doc

**Author:** Claude (May 26, 2026, after full codebase re-read)
**Status:** Design pending Russ approval. Do not execute until reviewed.

---

## What we already have (after Phase 1 of Project 14)

The plumbing for memory is already done:

- **`client_conversations` table** — every Claude message ever sent, scoped per client, queryable as rows (not blobs).
- **`/api/conversations`** — GET / POST / DELETE with surface + scope filters and soft-delete preservation.
- **`/api/intelligence`** — reads ALL conversations for a client (including hidden rows) and shapes them into the JSONB format the prompt builder expects.
- **`build-claude-context.ts`** — already does two memory-relevant things on every Claude call:
  1. `extractDirectives()` — scans user messages with regex patterns (e.g. "ignore", "focus on", "don't worry about") and pulls them into a HARD CONSTRAINTS block at the very top of the system prompt.
  2. `buildConversationContext()` — flattens last 20 messages across all surfaces into the prompt as "PREVIOUS CONVERSATIONS WITH THIS USER."

**What's missing:** structured facts. Right now Claude re-derives directives by regex on every call. Working but fragile and limited. A real memory layer means:

- Facts the user explicitly stated as durable truths
- Facts Claude observed and confirmed
- User can review, edit, delete what Claude "knows"
- Memory is queryable, weighted, durable, auditable

---

## Why this is the moat

LoraMer's brand promise is "deep knowledge that accumulates." Phase 1 made conversations accumulate. Phase 2 makes UNDERSTANDING accumulate — facts that compound across months, not just messages that pile up.

Three concrete things this unlocks:

1. **Trust.** User sees a "Memory" panel listing what Claude knows about their client. They can edit it. Wrong facts get corrected, right facts get reinforced. No more "Claude forgot what I told it three sessions ago."

2. **Cost.** Right now the prompt builder dumps last-20 raw messages into every call. Most of those messages are noise. Structured facts let us include 10 facts instead of 20 messages — same understanding, far fewer tokens, snappier Claude responses.

3. **Differentiation.** Triple Whale shows data. Northbeam shows attribution. Neither builds a model of how YOU think about YOUR client. That's defensible.

---

## Architecture

### Layer 1 — `client_memory` table (Supabase)

```sql
CREATE TABLE client_memory (
  id BIGSERIAL PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,

  -- The fact itself
  content TEXT NOT NULL,           -- "Brand campaigns drive lower CPL than Generic"
  category TEXT NOT NULL,          -- 'directive' | 'fact' | 'observation' | 'preference' | 'context'
  confidence REAL DEFAULT 1.0,     -- 0.0 to 1.0; explicit user statements default to 1.0

  -- Provenance
  source TEXT NOT NULL,            -- 'user_explicit' | 'user_conversation' | 'claude_extracted' | 'claude_observed'
  source_conversation_id BIGINT REFERENCES client_conversations(id) ON DELETE SET NULL,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,         -- soft delete (user dismissed or contradicted)
  pinned BOOLEAN DEFAULT FALSE,    -- user marked as "always include"
  last_referenced_at TIMESTAMPTZ   -- updated when Claude actually used it in a response
);

CREATE INDEX idx_client_memory_client_id ON client_memory(client_id, archived_at, pinned DESC, confidence DESC);
CREATE INDEX idx_client_memory_category ON client_memory(client_id, category, archived_at);
CREATE INDEX idx_client_memory_user_email ON client_memory(user_email);
```

**Categories:**
- `directive` — "ignore ROAS for this client" (binding, hard rule)
- `fact` — "this client only has lead-gen tracking, no purchases" (truth about the business)
- `observation` — "Brand campaigns consistently outperform Generic" (Claude noticed; needs confirmation)
- `preference` — "user prefers tables over prose" (about HOW the user wants responses)
- `context` — "client is in B2B SaaS targeting facility managers" (background)

**Confidence model:**
- User explicit statements → 1.0
- User mentioned-in-passing → 0.7
- Claude extracted from conversation → 0.5 (needs user confirm to go to 1.0)
- Claude observation from patterns → 0.3 (low confidence, needs many observations to promote)

### Layer 2 — `/api/memory` route

Standard REST surface:

- `GET /api/memory?clientId=X` — list memory facts for that client (default: non-archived, ordered by pinned → confidence → recency)
- `POST /api/memory` — `{ clientId, content, category }` — user adds a fact manually (source = `user_explicit`, confidence = 1.0)
- `PATCH /api/memory/:id` — edit content, change category, change confidence, pin/unpin, archive
- `DELETE /api/memory/:id` — soft delete (archive, not hard remove — same brand reason as conversations)
- `POST /api/memory/extract` — admin/internal: kick off extraction over recent conversations (Phase 2.5+)

Auth: same pattern as `/api/conversations` — session-scoped, user_email enforced.

### Layer 3 — Memory editor UI (client profile page)

New section on `/clients/[id]` (or wherever the client profile lives — need to confirm path during execution). Looks like:

```
What Claude knows about Glass Plus
─────────────────────────────────────────────

DIRECTIVES (3)
✓ Ignore ROAS — Glass Plus is lead-gen, no purchase tracking
   📌 pinned · added by you · May 21
✓ Primary KPI is CPL, target $35
   📌 pinned · added by you · May 21
✓ Brand campaigns are your hero (drive ~half the CPL of Generic)
   added by you · May 19

FACTS (5)
○ Leads come via phone calls and form submissions only (no e-commerce)
○ Account uses Performance Max + Search; no Display
○ Target geography: California, Arizona, Nevada
○ Seasonal pattern: Q4 is biggest quarter
○ Manager: [name redacted]

OBSERVATIONS (Claude noticed — confirm?)
? Performance Max gets a higher share of conversions despite lower spend
  [Confirm] [Dismiss]
? Cost per conversion creeps up on weekends
  [Confirm] [Dismiss]

[+ Add a fact manually]
```

Behavior:
- User can edit any fact inline
- Confirm an observation → moves to FACTS, confidence bumps to 1.0
- Dismiss an observation → archives it, won't surface again
- Pinned facts ALWAYS get included in Claude's prompt
- Archived facts still queryable for audit but not surfaced

### Layer 4 — Memory injection in prompt builder

Update `build-claude-context.ts` to:

1. Fetch memory facts for the client (already in intelligence layer or via direct query)
2. Inject them as a top-level block in the system prompt, ABOVE the existing conversation context
3. Format them grouped by category

```
=== WHAT YOU KNOW ABOUT GLASS PLUS ===

DIRECTIVES (binding rules from the user — OVERRIDE all defaults):
  • Ignore ROAS — Glass Plus is lead-gen, no purchase tracking
  • Primary KPI is CPL, target $35
  • Brand campaigns are your hero

FACTS (durable truths about this client):
  • Leads come via phone or form, no e-commerce
  • Account uses Performance Max + Search; no Display
  • Target geography: CA, AZ, NV

CONTEXT:
  • Seasonal pattern: Q4 is biggest quarter
```

The existing HARD CONSTRAINTS block (directives extracted from conversations by regex) stays as backup until Phase 2.5, then gets replaced when we trust the memory layer to capture them properly.

### Layer 5 — Extraction (Phase 2.5, not Phase 2)

The optional ambitious piece. After 2 weeks of memory layer usage, write a background job:

1. Periodically scan recent conversations for that client
2. Use Haiku to extract candidate facts ("did the user state any durable truths?")
3. Insert as `claude_extracted` with confidence 0.5
4. Surface them in the UI as "Observations" for user to confirm or dismiss

NOT in Phase 2. We ship Phase 2 first, verify it's useful, then layer extraction on top.

---

## What's intentionally OUT of scope for Phase 2

- **Cross-client patterns** (e.g. "user ignores ROAS in 4/5 clients, suggest making it a default"). That's Project 16.
- **Workspace-shared memory** (e.g. team members see same facts). That's Project 20.
- **Time-decay** (older observations weighted less). Maybe later if we observe staleness as a real problem.
- **Auto-resolved contradictions** (Claude detects "fact A contradicts fact B"). Punt to Phase 3.
- **The nightly learning loop** (Scale tier). Phase 4.
- **Memory size caps per tier** (Solo 50 facts, Agency 500, Scale unlimited). Add when we have actual users hitting limits.

---

## Tier mechanics (matches existing roadmap)

| Tier | Memory model |
|------|---|
| Free | No memory layer — only the existing regex directive extraction |
| Solo | Full memory layer, 50 facts/client max |
| Agency | 500 facts/client, plus dismissed-observation tracking |
| Scale | Unlimited + extraction (Phase 2.5) + nightly learning loop (Phase 4) |

Phase 2 ships Solo+ tier. Free stays on the regex pattern (already there).

---

## Execution plan

Six steps. Each independently verifiable. No batching.

### Step 1 — Migration (15 min, low risk)
Create `client_memory` table + indexes in Supabase. No code changes. Same drill as the other migrations.

### Step 2 — API route (1 hour)
New file `src/app/api/memory/route.ts` with GET, POST, PATCH, DELETE. Mirrors `/api/conversations` pattern.

### Step 3 — Memory injection in prompt builder (45 min)
Modify `build-claude-context.ts` to add a `=== WHAT YOU KNOW ABOUT [CLIENT] ===` section above the existing conversation context. Pull facts from the new table via a small fetch in the intelligence route (parallel to existing fetches).

Verify by adding a memory row manually in Supabase, asking Claude something, and confirming Claude references the fact.

### Step 4 — Memory editor UI (2 hours)
New section on the client profile page (probably `/clients` or a new `/clients/[id]/memory` route). React component listing facts grouped by category, with inline edit, pin/unpin, archive controls. Plus "Add a fact" form.

### Step 5 — Bootstrap from existing directives (30 min)
One-time migration: scan existing `client_context.user_notes` and the regex-extracted directives, propose them as initial memory facts. User can edit before saving.

(Or skip this — let users build memory fresh. Cleaner. But loses ~weeks of accumulated directives.)

### Step 6 — End-to-end test
Walk through with at least one real client:
- Add 3 manual facts via UI
- Verify they appear in Claude's response when relevant
- Edit one
- Archive one
- Verify only the active two appear in subsequent responses

---

## Risks I've identified

### Risk 1: Two sources of truth (regex directives + structured memory)
The existing regex directive extraction in `build-claude-context.ts` will keep working alongside the new memory layer until we explicitly retire it. Could mean Claude sees a directive twice (once as regex-extracted, once as memory fact). Mitigation: Phase 2 keeps both. In Phase 2.5 we evaluate whether regex still adds value or just adds noise.

### Risk 2: Memory and conversation history can diverge
A user says "ignore ROAS" in a conversation. Phase 1 stores the message. Phase 2 should also create a memory fact. If we DON'T auto-create, the memory layer requires explicit user input only (cleaner but more friction). If we DO auto-create via extraction, we're in Phase 2.5 territory (background job, Haiku call).

**Recommendation:** Phase 2 is user-explicit only. Users have to actively add a fact. Cleaner separation, less magic, more predictable. Phase 2.5 layers extraction on top once we know what's worth auto-extracting.

### Risk 3: Performance — extra Supabase round-trip
Every Claude call now needs to fetch facts in addition to conversations. Negligible cost (one query against a small table, indexed), but worth confirming: should we add to the parallel `Promise.all` in `/api/intelligence` rather than do it inline.

**Mitigation:** Yes, add to the parallel fetch. Same shape as the existing `conversationsResult` addition.

### Risk 4: Schema drift — `category` field could explode
If we let user UI add arbitrary categories, the dropdown becomes useless. Lock the categories in code, validate in API. Only `directive | fact | observation | preference | context`. Adding a category requires a code change. Fine for v1.

### Risk 5: Brand alignment — soft-delete archives must stay readable
Same brand commitment as conversations. Archived facts stay in the table. Don't ever hard-delete. Even if a user "removes" a fact, it's archived and the conversation history that referenced it is preserved.

---

## Open questions for Russ

1. **Should Step 5 happen?** Bootstrap from existing user_notes / directives, or start clean and let users build memory fresh?
2. **UI location.** Should the memory editor be inline on the existing client profile page, or a separate `/clients/[id]/memory` route? I'd argue inline — keeps the user in flow.
3. **Should "pin" be a real concept?** Or are all facts equally weighted in the prompt? I'd argue pin is useful for the absolute non-negotiables.
4. **Auto-fact-creation on directive-pattern detection?** When a user types "Remember: X" or "Always do X" in a chat, should we automatically propose creating a memory fact? Helpful magic vs. annoying interruption.
5. **Where does this surface in onboarding?** New client setup currently asks for business_type / primary_kpi / funnel_notes / user_notes. Should it also prompt "what's the most important thing Claude should know about this client?" → first memory fact?

---

## What I am NOT doing right now

Not writing code. Not modifying files. Waiting for Russ to read this design doc and push back.

Once aligned:
1. Run the migration
2. Add the API route
3. Wire into prompt builder
4. Build the UI
5. Test end-to-end
6. Ship

Estimated total: 4-6 hours across 2 sessions.
