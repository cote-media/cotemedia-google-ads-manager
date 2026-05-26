# Project 14 Phase 4 — Cross-Surface Attribution & Chronology

**Author:** Claude, end of May 26, 2026 session
**Status:** Brief for execution tomorrow. Do not start without re-reading this clean-headed.

---

## What we discovered today

Two tests revealed the actual state of cross-surface memory:

### Test 1 (verified working): Content recall across surfaces
- User in Ask Claude tab: "Capua is the biggest competitor"
- User in right panel: "What did I say about a competitor?"
- Claude correctly retrieved "Capua" and cross-referenced it with search-term data

**Verdict: data is reaching Claude. The pipeline works.**

### Test 2 (almost working): Cross-surface awareness
- User in Ask Claude: "the codeword is purple kangaroo 42"
- User in right panel: "Can you see the conversation in the other tab?"
- After today's fix: Claude correctly said yes and recited specifics from earlier exchanges

**Verdict: Claude now knows it has access to other surfaces.**

### Test 3 (broken — the reason for this brief): Surface-specific retrieval
- After Test 2, user asked: "what's the last thing I said in the other tab"
- Claude responded: "the last thing recorded is 'Can you see the conversation I had in the other tab?'"

**That answer is wrong in TWO ways:**

1. **Wrong attribution** — the cited message was the user's question in the right panel itself, NOT something from "the other tab"
2. **Wrong recency** — the actual most-recent statement from the Ask Claude tab was the codeword, which Claude didn't surface

---

## Root cause

Open `src/lib/intelligence/build-claude-context.ts` → `buildConversationContext`:

```ts
recent.forEach((m) => {
  const truncated = m.content.length > 800 ? m.content.slice(0, 797) + '...' : m.content
  lines.push(`  ${m.role === 'user' ? 'User' : 'Claude'}: ${truncated}`)
})
```

Each message in the prompt renders as: `User: <content>` or `Claude: <content>`. **No surface label. No timestamp.** Just a flat list.

So when the user asks "what did I say in the OTHER tab," Claude has no information at all about which message came from which surface. It guesses or fabricates. In Test 3 it picked the most recent message it could see — which happened to be the question itself.

This is the actual architectural gap. Today's instruction-only fix (`LORAMER_CROSS_SURFACE_INSTRUCTION_V1`) addressed Claude's claim of isolation. It did NOT fix attribution.

---

## Why this matters (brand)

"LoraMer = deep knowledge that accumulates" is the headline brand promise. The product needs to actually demonstrate that promise to be believable.

A LoraMer that says "yes I can see other tabs but I'm not sure which is which" is not impressive. A LoraMer that says "in the Ask Claude tab three minutes ago you set a codeword to purple kangaroo 42, and earlier in the right panel you established that Capua is the biggest competitor" IS impressive — that's the kind of memory clarity a real human analyst with notes in front of them would have.

This isn't a polish item. This IS the moat in user-facing terms.

---

## The fix — architectural sketch

### Three layers needed

**Layer 1: Surface attribution in the prompt.**
Render each message with its source surface and a coarse timestamp:

```
[ask-claude-tab · 4 min ago]   User: the codeword is purple kangaroo 42
[ask-claude-tab · 4 min ago]   Claude: Got it — purple kangaroo 42, noted.
[right-panel · just now]       User: can you see the conversation in the other tab?
```

The surface name uses internal labels we already store (`ask-claude-tab`, `right-panel`, `insight-chat`). Show them BUT instruct Claude to translate them into natural English when responding to the user — "in the Ask Claude tab" not "in ask-claude-tab".

**Layer 2: Chronology must be strict.**
Sort messages by `created_at ASC` so they read newest-at-bottom. Verify this is what the DB returns (likely yes via the existing index, but confirm).

**Layer 3: An explicit instruction explaining the labels.**
Tell Claude how the labels work: "Each message is prefixed with the surface it came from in brackets. When the user references 'the other tab' or 'that earlier conversation,' look at the surface labels to identify which thread they mean."

---

## Tradeoffs to think through tomorrow

### Token budget
- Surface labels add ~25 chars per message
- At 100 messages × 25 chars = 2.5KB extra in the prompt
- Trivial — go with it

### Surface name display
- Internal name: `ask-claude-tab`
- User-facing translation: "Ask Claude tab" or "the sidebar chat"
- Right answer: render the internal name in the prompt but instruct Claude to translate when speaking to the user
- Alternative: pre-translate in the prompt. Cleaner output but Claude has less context if user asks something specific like "what tab"

### "Just now" vs. exact timestamp
- Exact ("2026-05-26 17:48:23") is precise but ugly
- Relative ("3 min ago") reads naturally
- Hybrid ("today 5:48pm" / "yesterday 2:13pm" / "3 days ago") is best but more code
- Start with relative, iterate later

### Right-panel scope detail
- Right panel scope is currently a key like `campaign-performance:google`
- That's internal — Claude shouldn't say "in the campaign-performance:google panel"
- Need to either translate scope to natural language OR omit scope from the label and just say "right-side panel"

---

## What to do tomorrow — proposed steps

### Step 1 — Read current state (no code)
- Re-view `buildConversationContext` and `flattenConversations`
- Confirm message objects include `surface` and `created_at` fields (they should, from the migration)
- Decide format for the surface label

### Step 2 — Surface attribution patch
- Add the surface and relative-time label to each rendered message
- Add the instruction line explaining what the labels mean
- One file change, ~20 lines

### Step 3 — Verify chronology
- Confirm DB returns messages in strict ASC order
- If not, add `.order('created_at', { ascending: true })` explicitly

### Step 4 — Test
Three new tests to run (in order):
1. State A in surface X, state B in surface Y → ask in surface Z "what was the most recent thing I said in surface Y" → Claude correctly says B
2. Ask "what did I just say in the other tab" → Claude correctly identifies the most recent message from a different surface
3. Ask "what's the last 3 things I've told you" → Claude correctly lists with surface attribution

### Step 5 — Edge case sweep
- Empty surface (user has only used one tab) — Claude should handle gracefully
- Two surfaces with simultaneous activity — chronology should be obvious
- Long history (100+ messages) — surface labels shouldn't add unreasonable noise

Estimated total: 1-1.5 hours when fresh.

---

## What this is NOT

- Not a redesign of `client_conversations` table (already has the needed columns)
- Not a UI change (this is prompt-only)
- Not a memory layer change (Project 9 work is complete)
- Not deferrable — this directly damages the brand promise every time it's wrong

---

## How to know we got it right

A user with two surfaces open can ask any of:
- "What did I say in the other tab?"
- "What's the most recent thing I asked you in the right panel?"
- "Did we discuss X in the sidebar chat?"

...and Claude answers SPECIFICALLY with correct attribution to the correct surface, with correct chronology, every time.

If those three answers are right, the moat got deeper today.

---

## What I am NOT doing right now

Not writing code. Not even writing the patch script. Resting. Tomorrow when fresh, I write the patch carefully — slow, methodical, dry-run-verified, JS-syntax-double-checked.
