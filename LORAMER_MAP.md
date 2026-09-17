# LORAMER_MAP.md — what LoraMer is, how it works today, and what Russ has ruled
<!-- LORAMER_MAP_V1 -->

> ⛔ **READ THIS FIRST, BEFORE ANY OTHER DOCUMENT, EVERY MORNING.** It is short on purpose. The other docs
> hold law, decisions, the queue and the session narrative; this one holds the PICTURE — what the app is, how
> it actually works right now, and what Russ has already settled. It exists because a session can obey every
> rule in the repo and still propose work that contradicts how the product functions.
>
> ⛔ **EVERY FACTUAL LINE HERE IS VERIFIED AGAINST THE CODE, and is dated.** If a line and the code disagree,
> THE CODE IS RIGHT and this file is stale — say so and fix it the same day.
> Last verified against the code: **2026-09-17**

---

## 1. WHAT IT IS FOR

LoraMer is a commercial product for **paying customers we do not have yet**. Russ's seventeen accounts are the
**test rig**, not the goal. A customer who connects should have usable data in **hours, not weeks**.

Work that only makes Russ's own accounts better is maintenance. It is not progress.

---

## 2. WHAT A REAL USER SEES

**Real users land on the new surface**, and have since **2026-07-14**. Signing in takes anyone who is not a
test fixture straight there; the client list, the client profile, the store and analytics views and the
assistant all live on it.

**Two old screens still exist** — the old dashboard and the old client list. **Only two kinds of account can
reach them**: the Shopify reviewer's login, and the demo fixtures. Everybody else is redirected to the new
surface automatically. Those old screens are the only place the Shopify reviewer has ever seen, which is why
they cannot simply be deleted.

---

## 3. WHERE THE DATA LIVES

**One database. One main table of daily numbers**, holding roughly 184 million rows across every platform and
every level of detail. There is no second database and no old database. Nothing in this product reads
"old data" — old and new rows sit in the same table.

**Two sets of writers fill it:**

- **The engine** — the new capture system. It writes **Google Ads only** today. It is built to be
  platform-neutral: its core does not know which platform it is serving, and each platform's quirks arrive
  through that platform's own adapter. Google is the only platform with an adapter so far.
- **The old writers** — the original capture code. They write **all five platforms**: Google Ads, Meta,
  Shopify, WooCommerce and Google Analytics.

**The two sets spell Google's rows differently, and this is the single most important fact on this page.**
For Google, the old writers label an account-level row "account"; the engine labels the same thing
"customer", because it uses the platform's own vocabulary. Campaign, ad group and ad rows are spelled the
same by both.

**Every screen and the assistant currently read the OLD spelling.** Nine files, twenty-five separate reads.
So for Google, **the screens and the assistant are reading only what the old writers produced.** The engine's
Google rows are in the same table and no screen looks at them yet.

⛔ **THIS IS WHY THE OLD WRITERS CANNOT STOP FIRST.** Stop them before the screens are switched over and a
newly connected client would show nothing at all, while the engine quietly captured everything.

**Names and parents** live in a separate small table, one row per campaign, ad group or ad, holding that
entity's **current name** and its real parent. The screens look the name up there rather than reading a name
frozen onto a dated row. Only one client is populated so far; the daily refresh fills the rest.

---

## 4. WHAT EACH ACTION STARTS TODAY

| When someone does this | What actually happens today |
| --- | --- |
| Signs in with Google | They are signed in, and the same prompt also asks for Google Ads permission, whether or not they will ever use Google Ads |
| Connects Google Ads on the client profile | Their permission is stored; choosing which ad account it is **starts the OLD deep backfill**, not the engine |
| Connects Shopify, Analytics or WooCommerce | Starts the OLD deep backfill for that platform |
| Presses Backfill | **One button covering every connected platform.** It starts the old deep backfill for each of them, plus **a single burst of the engine** for Google |
| Nothing — the schedule | Daily capture of yesterday for all five platforms · repair of gaps in recent history for all five · the old deep backfill for all five · the engine's Google rotation, every five minutes · the engine's Google daily sweep · a Shopify order job |

**The engine's rotation serves one client per turn**, so a client waits roughly **eighty-five minutes**
between turns. A Backfill press buys one turn, then the wait resumes.

**New, not yet connected to a button:** a continuous run exists that drives one client on one platform step
after step with no wait between steps instead of eighty-five minutes. It is driven by a **pump** the schedule
invokes every minute: the pump takes the active run and runs step after step inside its own invocation (about
eight minutes of stepping, then the next minute's pump resumes). **The run never calls its own web address.**
This project's Vercel deployment addresses sit behind Vercel's login wall (the custom domain does not), and an
automated call to one is answered with a login page, not an error; so the run calls the capture code directly
inside the same process (ruled 2026-09-17). Nothing starts a run yet except an operator — no button.

---

## 5. THE JOURNEY RUSS DESIGNED, AND WHERE IT STANDS

| The step Russ designed | Where it stands today |
| --- | --- |
| Someone signs up, not necessarily with Google | Google sign-in works and stays. Other ways in come after the data work |
| They connect a platform from inside the app | Works on the new surface, for every platform |
| Connecting starts everyday capture on its own | **Happens** — the daily jobs pick up a new connection with no prompting, within hours at worst |
| Each connected platform has its own Backfill button | **Not yet.** There is one button for all of them |
| A press runs without interruption to the account's first day | **Not yet.** A press buys one turn of a rotation. The continuous run that fixes this exists but is not connected |
| The screens and the assistant show what the engine captured | **Not yet.** They read the old writers' rows for Google |
| A customer's own Google Ads account, outside Russ's manager account, works | **Works.** Proven against five real accounts |
| Names on screen are the entity's current name | **Works** for the client whose names have been collected |

---

## 6. WORDS THAT HAVE ONE MEANING HERE

- **Legacy** — the **old capture code** and the **old screens**. It never means old data. There is no old
  data and no old database.
- **The engine** — the new capture system. Platform-neutral core, one adapter per platform.
- **Backfill** — reaching backwards through history towards the account's first day.
- **Forward capture** — picking up yesterday, every day, for everything already connected.
- **Restatement re-check** — re-reading recent days because the platform revises its own numbers after the
  fact.
- **Floor / inception** — the oldest day that can exist for an account: either the platform's retention limit
  or the day the account itself began, whichever is later.
- **Surface** — one combination of a thing and a way of slicing it, for example campaigns broken down by
  device. Google has 349 of them per account.

---

## 7. WHAT RUSS HAS RULED

**2026-09-15 and 2026-09-16**

- LoraMer is for paying customers we do not have yet. Russ's accounts are the test rig. Customers wait hours,
  not weeks.
- **Google Ads is proven end to end and finished before any other platform is started.** Nothing outside data
  completeness until then.
- The engine is platform-agnostic; each platform's quirks are handled per platform.
- Connecting a platform starts everyday capture automatically.
- **Each connected platform has its own Backfill button.** A press runs uninterrupted from the press to the
  account's first day. When it is done, it is done. Backfill does not take turns.
- When this work is finished, **no Backfill button starts anything old**, and any client connected on the new
  surface always shows on screen — so nothing that feeds the screens stops before the screens and the
  assistant read the engine's rows.
- **Engine first, then wiring the screens and the assistant to its rows.** They are entwined but different.
- Screens show an entity's **current name, looked up** — never a name frozen onto a dated row.
- Many customers pressing Backfill at once is a future concern. Build for one now.
- A customer's own Google Ads account, **not under Russ's manager account**, must work. Russ has one reserved
  for the proof.
- The existing Google sign-in stays as one way in. More sign-up options come after data completeness.
- **Legacy means old capture code and old screens.** Everything valuable moves to the new code, nothing is
  repaired on the old, then the old is retired. **The Shopify reviewer's access must be handled before the old
  screens go.**
- Deleting and re-running any of Russ's own clients is authorised.

**2026-09-17**

- **Pressing a platform's Backfill button while that platform's backfill is already running does NOTHING.**
  The button shows an accurate progress meter instead, tied to the capture families and to REAL progress —
  **days no longer owed**, never rows written and never requests spent.
  The meter counts **349 surfaces** per Google account, and that number is measured rather than chosen: the
  daily sweep owns 319 of them (50 heavy + 269 rest) and the capture route keeps the other 30, and the data
  check counts 349 for a real account. Russ said 347; that number appears nowhere in the code or the ledgers,
  so 349 is what the meter uses.
- **Daily capture and a backfill always run alongside each other, and neither waits for the other.** Measured:
  a continuous run and the rotation's own turns interleaved cleanly, both healthy, no collision.
- Unnamed ads: Claude recommends showing the ad's **first headline**, falling back to its number only when an
  ad has no text at all — the platform sets no name on most ads and identifies them by their headlines.
  **Awaiting Russ's yes.**
- The Shopify reviewer's access is **deferred until the data work is finished**, under the
  data-completeness-only ruling.

**Earlier, still standing**

- Capture everything, from everywhere, and keep it forever. A thin slice is unfinished work, never a design.
- Right beats fast, always.
- Getting it right the first time matters more than getting it done today.

---

## 8. THE ORDER OF WORK, AND WHAT EACH STEP MUST NOT BREAK

1. **Finish the engine for Google.** Must not break: the daily capture every other client depends on.
2. **Wire the screens and the assistant to the engine's rows**, and give each platform its own Backfill
   button, in the same piece of work. Must not break: **a connected client must never show an empty screen.**
   This is why the old writers keep running until this lands.
3. **Retire the old capture code for Google.** Must not break: the Shopify reviewer's access, and the other
   four platforms, which still depend on the old writers entirely.
4. **Everything else** — other platforms, other ways to sign up, many customers at once.

---

## OPEN QUESTIONS FOR RUSS

1. **Which account is reserved for the outside-the-manager proof?** OPEN — Russ picks tomorrow. Five
   reachable accounts outside the manager account were found and read successfully.
2. **Should an unnamed ad show its first headline or its number?** ANSWERED IN PRINCIPLE, awaiting Russ's
   yes: first headline, number only when an ad has no text.
3. **How does the Shopify reviewer get in once the old screens go?** DEFERRED until data completeness is
   finished, by Russ's ruling.
4. **Should a second Backfill press restart a running backfill?** ANSWERED 2026-09-17: it does nothing, and
   the button shows a progress meter instead.
5. **May a customer's backfill hold up other customers' daily capture?** ANSWERED 2026-09-17: no — they run
   alongside each other and neither waits.
