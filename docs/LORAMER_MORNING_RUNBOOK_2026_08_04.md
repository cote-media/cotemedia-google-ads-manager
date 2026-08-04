# MORNING RUNBOOK — Tuesday 2026-08-04

> ⛔ **NEW-DOC GATE (CLAUDE.md) — OVERRIDDEN EXPLICITLY, NOT BYPASSED.** The default is to refuse a new
> doc and name an existing owner. Russ's instruction said to create this file. Recorded so the gate is
> never read as ignored.
>
> Written for Russ, who does not touch code. Plain English. Every command is in its own block — copy
> it, paste it into the terminal, press enter. After each one, what the answer MEANS.
>
> **Last night (2026-08-03) a big database migration was started. It was still running when the
> session ended. This morning is about checking whether it finished, and nothing more.**

---

## What happened last night, in one paragraph

The main data table (`metrics_daily`) had grown to 55 GB and had become slow — reads that should take
a second were taking 28 seconds. The fix is to split it into one piece per month, which lets the
database look at one month instead of all of it. **A new table was built, and a copy of the old data
into it was started.** Both tables exist right now. Nothing has been switched over. Live data is being
written to **both** tables automatically, so nothing is behind or lost either way.

---

## STEP 1 — IS IT DONE?

Run this:

```
cd ~/Downloads/cotemedia-google-ads-manager && node scripts/partition-backfill.mjs --status
```

You will get a small table with a `state` column. Here is what to look for:

⛔ **IT IS FINISHED ONLY IF `verified` SHOWS 129 MONTHS AND THERE ARE NO OTHER ROWS.**
**129 is the number. Write it down.**

- **`verified`** — done and double-checked. This is the only state that counts.
- **`pending`** — not started yet.
- **`in_progress`** — currently being copied.
- **`failed`** — something did not match. See STEP 2.

⛔ **"THE PROCESS EXITED" IS NOT THE SAME AS "IT FINISHED."** The program stops for several reasons,
only one of which is success. **Do not read a quiet terminal as a finished job.** The only thing that
means finished is `verified 129`.

⛔ **AND DO NOT JUDGE IT BY THE MONTH COUNT ALONE.** The early months are nearly empty — the first 90+
months hold barely 1% of the data. Most of the rows live in 2025 and 2026. **Seeing "verified 92" does
not mean it is 71% done; by rows it is only a few percent.** The `moved_rows` number is the honest one.

If you would rather see it as a plain database query, this is the same thing (Supabase SQL Editor):

```
select state, count(*) as months, sum(src_rows) as src_rows, sum(moved_rows) as moved_rows
from public.partition_backfill_ledger group by state order by state;
```

---

## STEP 2 — IF IT STOPPED EARLY

Find out why. In the terminal where it was running, or by re-running STEP 1, the reason will be one of
three. **The number the program exits with tells you which.**

### Exit 2 — it just did not get through everything
Normal. Nothing is wrong. Run it again:

```
cd ~/Downloads/cotemedia-google-ads-manager && node scripts/partition-backfill.mjs --run
```

### Exit 3 — it stopped because the disk was getting full
This is the program protecting the database, on purpose. **Add disk in the Supabase dashboard first**
(see STEP 3), then run the same command as above.

### Exit 4 — ⛔ A MONTH DID NOT MATCH. STOP. DO NOT RE-RUN.
The program checks every month twice — the number of rows AND a total of the money and click figures.
If either disagrees between the old and new table, **it stops the entire run rather than moving on.**
That is deliberate: a migration that skips a bad month and then says "finished" is the exact kind of
quiet failure this project exists to prevent.

Find out which month and what the two numbers were (Supabase SQL Editor):

```
select month, src_rows, moved_rows, src_checksum, dst_checksum, last_error
from public.partition_backfill_ledger where state = 'failed';
```

⛔ **Then stop and send that to Claude.** Do not re-run it. A mismatch means something needs looking
at, not retrying.

### Is re-running safe?
**Yes, always** — for exit 2 and exit 3. The program starts again at the first month that is not
`verified`, so it never redoes finished work. And when it copies a row that is already there, it
leaves the existing one alone — so a fresher live figure is never overwritten by an older copy.

---

## STEP 3 — CHECK THE DISK

The `--status` command from STEP 1 prints a disk line at the bottom. You can also see it in the
Supabase dashboard: **Project Settings → Compute and Disk**.

- **Above 60 GB free — fine.** Nothing to do.
- **40–60 GB free — watch it.** The copy needs room for a second copy of the data.
- **⛔ Below 40 GB free — the program will stop itself and refuse to continue.** That is the safety
  floor and it is deliberate.

**To add disk:** Supabase dashboard → Project Settings → Compute and Disk → increase the disk size.

⚠ **Two things to know before you do:**
- **You can only change disk 4 times in any 24 hours.** That limit was already used up last night, so
  it may still be blocked this morning. It clears on a rolling basis.
- **Disk can only go UP, never down.** Adding it is permanent, so add a sensible amount once rather
  than nibbling at it.

---

## STEP 4 — ⛔ DO NOT DROP COMPUTE BACK TO SMALL YET

The database was moved up to a bigger, faster machine (XL) last night to make the copy quick. It is
tempting to move it back down to save money.

⛔ **DO NOT CHANGE THE COMPUTE SIZE UNTIL EVERY MONTH READS `verified`.**

**A resize RESTARTS the database. A restart KILLS the running copy.** Work in progress is rolled back.
Nothing is corrupted — the design survives it — but you lose the time, and it has to start again from
the last finished month.

**Wait until STEP 1 shows `verified 129`. Then it is safe.**

---

## STEP 5 — THE SWITCH-OVER IS A SEPARATE DECISION

⛔ **NOTHING HAS BEEN SWITCHED OVER. THIS DOES NOT EXPIRE. There is no rush and no deadline.**

Right now both tables exist side by side, and every live write goes into both. The old one is still
the one the app reads.

**What the switch does:** renames the old table out of the way and the new one into its place. It
takes a fraction of a second. From the app's point of view nothing changes except that it gets fast.

**Rollback — what happens if we want to undo it:**
- **Before the switch** — nothing to undo. Delete the new table and you are exactly where you started.
- **After the switch, while the old table still exists** — rename them back. Seconds. The only care
  needed is that anything written in between has to be carried across.
- **After the old table is deleted** — ⛔ **no undo.** Which is why **the old table will not be deleted
  for a good while after the switch**, and deleting it is its own separate decision on its own day.

⛔ **Do this with Claude, awake and watching. Not overnight, and not alone.**

---

## STEP 6 — WHAT COMES AFTER, IN ORDER

Open the day knowing the order, so nothing jumps the queue:

**a. Verify the backfill** — STEP 1. Everything below waits on `verified 129`.

**b. The switch-over** — STEP 5. Quick, but with Claude watching.

**c. ⛔ DROP COMPUTE TO SMALL AND RE-MEASURE — AND THIS IS THE STEP THAT DECIDES THE MONTHLY BILL.**
After the switch, put the database back on the small machine and re-run two measurements: the CPU
load, and the geo read that took **28 seconds cold** last night.
⛔ **DO NOT DECIDE THE PERMANENT MACHINE SIZE FROM LAST NIGHT'S NUMBERS.** Those were measured on the
big machine against the OLD unsplit table — the worst possible combination. The whole point of
splitting the table is that the small machine may now be plenty. **Measure it, then decide.** Choosing
the tier from last night's figures would mean paying for XL forever to solve a problem that no longer
exists.

**d. Fire the walk** — the Google data collection that has been built and held back all week. It is
ready, it is 36% cheaper per pass than when the week started, and it is waiting on nothing but this.

**e. Meta / Shopify / GA4 sizing probes for Foam OH** — ⚠ **the largest remaining unknown, and it is
completely unmeasured.** Everything measured this week was Google. We do not know what the other three
platforms cost in rows or in disk. That gap should not be discovered after the walk fills the table.

---

## RUSS'S OWN LIST — none of this is code, none of it can be done by Claude

1. **Google Standard Access** — the website-clarification reply is still owed. This is the only thing
   that lifts the daily Google limit. ⚠ Claude owes you the website spec first — ask for it.
2. ⛔ **CORRECTION — I TOLD YOU TO SET A SUPABASE BILLING ALERT. THAT FEATURE DOES NOT EXIST.** You
   went looking twice; there was nothing to find, and that is my error, not your search. Supabase's
   own cost-control doc says the Spend Cap offers **no per-item budgets and no notifications at a
   cost threshold**. What actually exists: the Spend Cap is **binary** (block everything over quota,
   or allow usage-based billing) and is **currently OFF, deliberately**; ⛔ **even switched ON it
   would NOT have capped last night's XL upgrade, because add-ons including compute are always
   billed**; and the only monitoring is the **org usage page, read by hand, refreshing about hourly**.
   ⛔ **THE REAL RISK IS NOT A BILL — IT IS THAT PRO CAN GO READ-ONLY** if the disk-expansion limit
   (4 changes per rolling 24h) is hit. That is an outage, not an invoice, and it is exactly why the
   40 GB disk floor in the backfill is a hard stop rather than a warning.
   **What IS worth doing:** an alarm on the ANTHROPIC account balance — separate system, and it is
   the thing that prevents Lora silently going blank. Related: there is still **no usage cap anywhere
   in the product**, newly banked as ★USAGE-CAP-ABSENT.
3. **Shopify reviewer login** — one question only you can answer from the Partner dashboard: does the
   obligation bind the LOGIN, the STORE, or both?
4. **`shopify app deploy`** — registers the `bulk_operations/finish` webhook. Declared, not landed.
5. **`LORA_CHAT_STREAMING=1`** in Vercel Production — streaming shipped with the flag off.
6. **Value models owed** — Cozy Foam Factory · Tri-Copy Office Equipment · skinregimen.com.
7. **Ennis Exterminating** — no GA4↔Google Ads link. Fix in GA4 Admin → Product Links.
8. **Meta token re-arm** — due around **2026-08-25**. Hard expiry ~2026-08-30. Twelve ad accounts ride
   it, so this one has a real deadline.
