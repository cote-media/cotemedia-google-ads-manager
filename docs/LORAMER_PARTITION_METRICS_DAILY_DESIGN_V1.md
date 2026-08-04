# LORAMER_PARTITION_METRICS_DAILY_DESIGN_V1 — PHASE 1: ESTABLISHED FACTS + MIGRATION DESIGN

> ⛔ **DESIGN ONLY. NOTHING IN THIS DOC HAS BEEN EXECUTED.** No table created, no data copied, no
> migration run, no extension enabled, no schema changed. Phase 2 executes, after Russ confirms.
>
> ⛔ **NEW-DOC GATE (CLAUDE.md) — OVERRIDDEN EXPLICITLY, NOT BYPASSED.** The default is to refuse a new
> doc and name an existing owner. Russ's instruction said "write it as a doc in the same commit",
> which is the one-line override the gate provides for. Recorded so the gate is not read as ignored.
>
> Authored 2026-08-03. Every number below was READ from the live database on that date and is
> tense-locked; re-read before acting, never trust a figure in a doc (LORAMER_DOCS_NEVER_RESTATE_LIVE_STATE_V1).

---

## 0. WHY — the measured case, not a hunch

All measured 2026-08-03 during the universe-walk flights:

- **16× write-side read amplification** — 45.3 GB physically read to write 2.81 GB of heap, on ONE
  30-day window of ONE account.
- **28,257 ms COLD / ~1,570 ms warm** on the worst geo family, re-measured minutes apart. The cache
  does not retain the working set at all.
- **The unique conflict-key index is 17 GB** and took 87% of all index growth during that write.
- The walk multiplies this by ~50 windows × N clients.

⛔ **AND THE CAUSE IS NOW ARITHMETIC RATHER THAN MYSTERY: `shared_buffers` is 512 MB** (65,536 × 8 kB)
**against a 55 GB table.** The unique index alone is **34× shared_buffers**. Partitioning is the fix
because it lets a query touch one month's index instead of one 17 GB index.

---

## 1. ESTABLISHED FACTS — read from the catalog, 2026-08-03

### 1a. PostgreSQL version
```
PostgreSQL 17.6 on aarch64-unknown-linux-gnu, compiled by gcc (GCC) 15.2.0, 64-bit
server_version 17.6 · server_version_num 170006
```

### 1b. ⛔ THE CONSTRAINTS — AND THE ONE THAT BLOCKS A NAIVE PARTITIONING
```
metrics_daily_pkey                                    PRIMARY KEY (id)
metrics_daily_client_id_platform_entity_level_..._key UNIQUE (client_id, platform, entity_level,
                                                              entity_id, date, breakdown_type,
                                                              breakdown_value)
```
**THE GOOD NEWS: `date` IS in the UNIQUE conflict key, at position 5.** That is the key every writer
conflicts on (`upsertMetricsChunked`), so the write path survives partitioning on `date` unchanged.

⛔ **THE BLOCKER: `PRIMARY KEY (id)` DOES NOT CONTAIN `date`, AND POSTGRES WILL REFUSE IT.** A
partitioned table requires the partition key to be a subset of EVERY unique constraint — there are no
global indexes in PostgreSQL 17. `CREATE TABLE … PARTITION BY RANGE (date)` with `PRIMARY KEY (id)`
fails outright. This is not a performance note; it is a hard error at DDL time.

**THE RESOLUTION, and it is a real decision rather than a formality:**
- **Option A — `PRIMARY KEY (id, date)`.** Keeps `id` unique-per-date rather than globally unique.
  Safe here **only because nothing depends on `id`** (see 1d: zero incoming foreign keys). Costs a
  second index column; the pkey index is 2,123 MB today.
- **Option B — drop the surrogate `id` primary key entirely** and let the natural 7-column UNIQUE be
  the primary key. Removes 2,123 MB of index outright.
- ⚠ **NEITHER IS FREE AND THE CHOICE IS RUSS'S.** `id` is `bigint GENERATED … IDENTITY`-shaped and is
  currently globally unique; both options end that. **PHASE 2 MUST FIRST GREP THE CODEBASE for any
  read of `metrics_daily.id`** — this doc does not assume there is none, it only establishes that the
  DATABASE does not depend on it.

### 1c. Every index, with size
| index | size | definition |
|---|---:|---|
| `metrics_daily_client_id_platform_entity_level_entity_id_dat_key` | **17 GB** | UNIQUE btree (client_id, platform, entity_level, entity_id, date, breakdown_type, breakdown_value) |
| `idx_metrics_daily_client_platform_level_date` | 2,187 MB | btree (client_id, platform, entity_level, date) |
| `metrics_daily_pkey` | 2,123 MB | UNIQUE btree (id) |
| `idx_metrics_daily_client_platform_date` | 2,115 MB | btree (client_id, platform, date) |
| `idx_metrics_daily_client_platform_bt_level_date` | 2,104 MB | btree (client_id, platform, breakdown_type, entity_level, date) |
| `idx_metrics_daily_account_canonical` | 3,072 kB | btree (client_id, date) INCLUDE (platform, spend, revenue) WHERE entity_level='account' AND breakdown_type='' AND breakdown_value='' |

⛔ **NOT ONE INDEX LEADS WITH `date`.** Every one leads with `client_id`. So today there is no way to
scan or prune by date at all — which is exactly the win partitioning delivers, and it is why the
by-month census in 1e needed a statistical sample instead of an index scan.

### 1d. Dependencies — ⛔ THE SWAP SURFACE IS CLEAN, WITH ONE EXCEPTION THAT MUST BE REPRODUCED
| object class | result |
|---|---|
| incoming foreign keys (anything referencing metrics_daily) | **NONE** |
| outgoing foreign keys | **NONE** |
| views / materialized views | **NONE** |
| triggers (non-internal) | **NONE** |
| RLS policies | **NONE** |
| logical-replication publications | **NONE** (0) |
| replica identity | `d` (default) |

⚠ **BUT `relrowsecurity = true`: RLS IS ENABLED WITH ZERO POLICIES.** That is not "RLS off" — it is
deny-all to every role except `service_role` / `BYPASSRLS`. **A new table created without
`ENABLE ROW LEVEL SECURITY` would silently become readable by roles that cannot read it today.** This
is the single most dangerous detail in the swap and it is invisible unless you look for it.

### 1e. Size distribution by month — sampled, and severely lopsided
`TABLESAMPLE SYSTEM (0.5)`, scaled ×200. Exact counts need a full scan (no date index exists).

| era | est. rows | est. size @832 B | note |
|---|---:|---:|---|
| 2016-05 … 2021-12 | ~70,000 total | ~57 MB | 32 sparse months, most under 5k rows |
| 2022 | ~300,000 | ~244 MB | Google's vendor floor is 2022-03-05 |
| 2023 | ~3.1 M | ~2.4 GB | |
| 2024 | ~8.4 M | ~6.6 GB | |
| 2025 | ~28.6 M | ~22 GB | capture broadens from 2025-06 |
| 2026-01 … 2026-08 | ~34.0 M | ~26 GB | **2026-03 alone ≈ 13.6 M rows / 11 GB** |

⛔ **2026-03 IS ~20% OF THE ENTIRE TABLE IN ONE MONTH** — that is the measured universe window written
today. **Monthly granularity is therefore correct and not merely conventional:** a yearly partition
for 2026 would already be a 26 GB partition, i.e. the problem we are solving. ~123 monthly partitions
from 2016-05 to date; most are trivially small, which PostgreSQL 17 handles without difficulty.

### 1f. ⛔ DISK — THE BLOCKER, AND THE ONE NUMBER I CANNOT READ
```
metrics_daily total   58,974,437,376 B  =  55 GB   (heap 30 GB + indexes 25 GB)
whole database        59,041,139,859 B  =  55 GB   (metrics_daily is 99.9% of it; 41 public tables)
copy-and-swap PEAK    ~110 GB for the table alone, before WAL
```
⛔ **PROVISIONED DISK IS NOT READABLE FROM SQL. It is a Supabase dashboard read and it is a HUMAN
STEP — it must be done before Phase 2 begins.**

**THE ARITHMETIC, stated so the answer is not a matter of opinion:**
- copy-and-swap holds BOTH tables at once → **~110 GB** for `metrics_daily` alone
- plus WAL: `max_wal_size` is 4 GB, and a bulk copy will hold at or above it → **~115 GB**
- plus index builds, which need scratch space beyond the final index size → **~120–130 GB realistic**

⛔ **AT 90 GB PROVISIONED THIS IS NOT ENOUGH AND PHASE 2 MUST NOT START.** 55 GB is already 61% of
90 GB; the copy alone would exhaust it and **wedge the database with a full disk mid-migration, at
night, unattended.** That is precisely the 3am failure this design exists to avoid.
**REQUIRED BEFORE PHASE 2: either grow the disk to ≥130 GB, or adopt the batch-move variant in §2.6
which does not hold two full copies.** Disk can be increased but never decreased, and Supabase allows
**four disk modifications per rolling 24 hours**.

### 1g. pg_partman 5.3.1 vs PostgreSQL 17 — compatible, with the evidence stated
```
pg_partman  default_version 5.3.1  installed_version NULL   (available, NOT installed)
pg_cron     default_version 1.6.4  installed_version NULL   (available, NOT installed)
```
**VERDICT: COMPATIBLE.** Three independent signals, strongest first:
1. **Supabase itself offers 5.3.1 as the default_version ON THIS PostgreSQL 17.6 server.** The
   platform pairs the two; it would not ship an incompatible default. This is a fact read from our
   own catalog, not a claim from a webpage.
2. pg_partman 5.x declares a **minimum of PostgreSQL 14** ("The minimum required version of
   PostgreSQL is now 14", 5.0.0 changelog). 17 is inside the band.
3. The 5.3.0 and 5.3.1 release notes discuss **PostgreSQL 17 and 18 specific behaviour**, so 17 is
   actively contemplated by that release line.
⚠ **HONEST LIMIT: I did not find a single sentence saying "5.3.1 supports PostgreSQL 17."** The
verdict is inferred from the three signals above rather than quoted. Signal 1 is what makes it safe.
Sources: `github.com/pgpartman/pg_partman` releases + CHANGELOG.

### 1h. ⛔ COMPUTE RESIZE vs IN-FLIGHT TRANSACTIONS — **UNVERIFIED**, and stated as such
Supabase documents that a compute change **"[is] usually applied with less than 2 minutes of
downtime, but can take longer depending on the underlying Cloud Provider"**, that compute is not
auto-upgraded *because* of that downtime, and that a resize **can fail and roll back**, or **stick for
hours** with the dashboard inaccessible.

⛔ **WHAT THE DOCS DO NOT SAY — and I will not guess: they never state what happens to an in-flight
transaction or a long-running query during the resize.** Marked **UNVERIFIED**.

**WHAT IS NOT IN DOUBT is the PostgreSQL-side mechanism:** downtime of that kind implies the backend
process terminates. A terminated backend **aborts and rolls back any uncommitted transaction**. A
multi-hour `COPY`/`INSERT … SELECT` in a single transaction would therefore be **lost entirely** —
hours of work, no partial credit.
⇒ **DESIGN CONSEQUENCE, and it is why §2.3 is shaped the way it is: NEVER run the backfill as one
long transaction, and NEVER resize compute while a batch is in flight.** The batch design makes the
question mostly moot, which is the right way to handle an unverified risk.

---

## 2. THE DESIGN

### 2.1 Shape
```
metrics_daily_p  PARTITION BY RANGE (date)          -- monthly partitions, p_YYYY_MM
```
- **Partition key: `date`.** Legal because `date` is already in the 7-column UNIQUE key (1b).
- **`client_id` leads the index WITHIN each partition** — the existing indexes are recreated per
  partition, unchanged in shape. Partition pruning replaces the leading-date index we never had.
- **Primary key becomes `(id, date)` or is dropped** — see 1b, Russ decides, Phase 2 greps first.
- **`ENABLE ROW LEVEL SECURITY` on the parent, with zero policies**, reproducing 1d exactly.
- **Default partition** to catch any out-of-range date rather than rejecting a write.

### 2.2 pg_partman or hand-rolled
Use **pg_partman 5.3.1** for ongoing partition creation and retention, **not** for the initial move.
Its `create_parent()` + background worker removes the standing risk of "nobody created next month's
partition and inserts started failing". ⛔ It requires `CREATE EXTENSION` (Phase 2, on approval).
The one-time historical move is `partition_data_proc`-shaped but is specified explicitly in §2.3 so
its resumability is OURS and observable, not the extension's.

### 2.3 ⛔ THE BACKFILL — RESUMABLE, OBSERVABLE, AND INCAPABLE OF CLAIMING FALSE SUCCESS
This runs unattended overnight. Its failure mode must never be silent partial completion.

**A durable ledger table, written OUTSIDE the moving transaction:**
```
migration_partition_progress(
  month date primary key,          -- the partition being moved
  src_rows bigint,                 -- counted BEFORE the move, from the source
  moved_rows bigint,               -- written by the batch, per commit
  state text,                      -- pending | in_progress | verified | failed
  started_at, finished_at, last_error, free_bytes_at_start
)
```
**Per month, in this order, each step committing separately:**
1. `state='in_progress'`, record `src_rows` = exact `count(*)` for that month from the source.
2. Move in batches of ~50,000 rows, **each batch its own transaction**, `moved_rows` incremented in
   the same commit as the data. A kill loses at most one batch.
3. **VERIFY BEFORE CLAIMING**: `count(*)` on the new partition must equal `src_rows` **and** a
   checksum (`sum(spend), sum(impressions), sum(clicks), count(*)`) must match the source for that
   month. Only then `state='verified'`.
4. ⛔ **ANY mismatch → `state='failed'`, record the numbers, STOP THE WHOLE RUN.** Do not continue to
   the next month. A migration that skips a bad month and finishes "successfully" is the exact
   defect class this project exists to prevent.

**RESUME** = start at the first month whose state is not `verified`; `in_progress` months restart from
`moved_rows`. **The run is complete only when EVERY month reads `verified`** — never when the loop
ends. The final swap (§2.4) refuses to proceed unless that is true.

**OBSERVABLE**: the ledger is a plain table, so progress is a `SELECT` from anywhere at any time —
no log scraping, no guessing whether it is alive.

### 2.4 ⛔ THE DISK-HEADROOM CHECK — BEFORE, AND AGAIN EVERY BATCH
```
FLOOR = 15 GB free, or 20% of provisioned, whichever is LARGER
```
- Checked **before the run starts** — refuse to begin below the floor, and say by how much.
- Re-checked **before every batch**. Below the floor → stop cleanly, mark `state='in_progress'`,
  record free bytes and the month, exit non-zero. It resumes after disk is added; nothing is lost.
- ⛔ **NEVER "just one more batch".** A full disk on Postgres is not a slow query, it is an outage
  that also blocks the vacuum that would recover it.
- ⚠ Free space is not readable from SQL. Phase 2 must obtain it from the Supabase Management API or
  a human dashboard read at start, and re-check on a stated cadence. **If it cannot be read
  programmatically, the run is ATTENDED, not unattended** — that is a Phase-2 decision, not a
  detail to discover at 3am.

### 2.5 The swap
```
BEGIN;
  LOCK TABLE metrics_daily IN ACCESS EXCLUSIVE MODE;
  -- refuse unless every ledger month reads 'verified'
  ALTER TABLE metrics_daily   RENAME TO metrics_daily_old;
  ALTER TABLE metrics_daily_p RENAME TO metrics_daily;
COMMIT;
```
Two renames in one transaction; readers block for milliseconds. ⛔ **`metrics_daily_old` is KEPT, not
dropped** — it is the rollback, and dropping it is a separate decision on a separate day.

### 2.6 ⛔ THE VARIANT IF DISK IS TIGHT — batch-move-and-delete
If the disk cannot reach ~130 GB, do not run the copy at all. Instead, per month: copy the month into
its partition, verify (§2.3 step 3), then `DELETE` that month from the source and `VACUUM` it. Peak
usage stays near 1× plus one month rather than 2×.
⚠ **IT IS SLOWER AND STRICTLY MORE DANGEROUS** — it destroys source rows as it goes, so the rollback
in §2.7 stops being free after the first delete. **Prefer growing the disk.** This variant exists so
that "no disk" produces a stated trade-off rather than an improvised one at 3am.

### 2.7 Rollback, by stage
| stage | how to get back | cost |
|---|---|---|
| before the swap | drop `metrics_daily_p`; source never touched | zero |
| mid-backfill (killed) | same — the source is untouched by the copy path | zero |
| after the swap, before dropping old | rename back: `metrics_daily` → `_p`, `_old` → `metrics_daily` | seconds; writes since the swap land in `_p` and must be replayed |
| after `_old` is dropped | ⛔ **NO ROLLBACK — PITR ONLY** | do not drop `_old` until a stated soak has passed |
⛔ **The §2.6 variant voids rows 1–2 the moment the first DELETE commits.**

### 2.8 Iceberg later — design for it, build nothing
Monthly partitions make cold storage a `DETACH PARTITION`, which is a catalog operation, not a copy.
A future path: `DETACH` a month → export to Parquet → land in Iceberg → drop the detached table.
Nothing here builds it; the only requirement it places on Phase 2 is **monthly granularity and
per-partition indexes**, which §2.1 already specifies. No extra work is incurred by leaving room.

### 2.9 Runtime estimate — DERIVED, inputs shown, a CEILING
| input | value | source |
|---|---:|---|
| rows to move | ~69.3 M | `pg_class.reltuples` |
| batch size | 50,000 | design |
| batches | ~1,386 | derived |
| observed sustained write rate | ~2,160 rows/s | measured today: 6,048,263 rows in 2,797 s |
| **move time at that rate** | **~8.9 hours** | derived |
| index build, 5 indexes × 123 partitions | **UNMEASURED** | see below |

⛔ **THE INDEX BUILD IS THE UNKNOWN AND IT MAY DOMINATE.** `maintenance_work_mem` is **128 MB** and
`max_parallel_maintenance_workers` is **1** — building a 17 GB unique index in 128 MB chunks is slow.
**MITIGATION: create each partition's indexes AFTER its data lands, not before** — bulk-loading into
an unindexed partition then indexing it is materially faster than maintaining indexes per row.
⇒ **PLAN FOR 12–24 HOURS AND DO NOT PROMISE A NUMBER.** The 8.9 h is the floor, not the estimate.
⚠ The 2,160 rows/s came from a workload that also spent time on GAQL round-trips, so the pure-copy
rate is probably higher — which is a reason the figure is a ceiling, not a reason to trust it.

---

## 3. ⛔ WHAT MUST BE TRUE BEFORE PHASE 2 — the named blockers

1. ⛔ **DISK.** Read provisioned vs used from the dashboard. **≥130 GB for the copy-and-swap path.**
   At 90 GB, the copy path is FORBIDDEN — grow the disk or take §2.6 knowingly.
2. ⛔ **PRIMARY KEY DECISION.** `(id, date)` or drop `id`. Requires a codebase grep for reads of
   `metrics_daily.id` first. Russ's call.
3. ⛔ **RLS.** The new table must be created with RLS ENABLED and zero policies, matching today
   exactly. A miss here is a silent security regression, not a performance one.
4. **`CREATE EXTENSION pg_partman`** (and `pg_cron` if the background worker is wanted) — approval.
5. **Free-space readability.** If it cannot be read programmatically, the run is ATTENDED.
6. ⚠ **Do not resize compute while a batch is in flight** (1h is UNVERIFIED; the batch design already
   limits the blast radius to one batch).

---

## 3B. THE SWAP — PLAN ONLY, WRITTEN 2026-08-04, NOTHING EXECUTED

> ⛔ **THIS SECTION HAS NOT BEEN RUN. It is the sequence, written down while nobody is under time
> pressure, so that the night it runs it is a reading exercise rather than a design exercise.**
> Backfill state at authoring: `verified 129 / unverified 0`, runner exited after 39,721s.

### 3B.0 ⛔ THE PRECONDITION — IT REFUSES TO RUN OTHERWISE

The swap MUST abort unless the ledger reads `verified 129 / unverified 0` **at that moment**, not
when someone last looked. Wrap it so the check and the rename are in the SAME transaction — a check
that passes in a separate statement is a check that can go stale between the two.

```sql
BEGIN;
  -- ⛔ REFUSE unless every month is verified, evaluated INSIDE this transaction.
  DO $$
  DECLARE bad int;
  BEGIN
    SELECT count(*) INTO bad FROM public.partition_backfill_ledger WHERE state <> 'verified';
    IF bad <> 0 THEN
      RAISE EXCEPTION 'REFUSING TO SWAP: % month(s) not verified', bad;
    END IF;
  END $$;

  LOCK TABLE public.metrics_daily IN ACCESS EXCLUSIVE MODE;

  -- ⛔ THE TRIGGER COMES OFF FIRST, AND THE ORDER IS NOT COSMETIC. If the rename happened first, the
  -- mirror would fire on the table that is now the DESTINATION and try to insert into itself.
  DROP TRIGGER IF EXISTS metrics_daily_mirror_trg ON public.metrics_daily;

  ALTER TABLE public.metrics_daily   RENAME TO metrics_daily_old;
  ALTER TABLE public.metrics_daily_p RENAME TO metrics_daily;
COMMIT;
```

Two renames, one transaction. Readers block for milliseconds; nobody sees a missing table.
⚠ Rename the CONSTRAINTS afterwards if their names matter to anyone (`metrics_daily_p_pkey` etc. keep
their old names — harmless, but confusing later). Cosmetic; not part of the swap.

### 3B.1 WHAT HAPPENS TO DUAL-WRITE

- **Before**: the trigger sits on `metrics_daily` (old) and mirrors into `metrics_daily_p` (new).
- **At swap**: the trigger is DROPPED first, inside the same transaction, before either rename.
- **After**: there is no trigger. Writes go to the new table because it now carries the name every
  writer uses. `metrics_daily_old` stops receiving anything and freezes at the swap instant.
- ⛔ **THAT FREEZE IS WHY ROLLBACK GETS HARDER WITH EVERY MINUTE** — see 3B.2.

### 3B.2 ⛔ ROLLBACK, BY STAGE — AND WHERE IT STOPS BEING POSSIBLE

| stage | how to get back | cost |
|---|---|---|
| **Before the swap** | Do nothing. Drop `metrics_daily_p` if you want the disk back. The source was never modified by the copy. | **Zero.** |
| **Immediately after the swap (seconds/minutes)** | Reverse it: drop any new trigger, `metrics_daily` → `metrics_daily_p`, `metrics_daily_old` → `metrics_daily`, re-create the mirror trigger. | **Seconds**, and clean — almost nothing has been written to the new table yet. |
| **Hours after the swap** | Same renames, **but every row written since the swap lives ONLY in the new table** and must be carried back across before it is demoted. Mechanical, but no longer free. | **Minutes to hours**, and it needs care. |
| ⛔ **After `metrics_daily_old` is DROPPED** | **THERE IS NO ROLLBACK. Point-in-time recovery only.** | ⛔ **THIS IS THE POINT OF NO RETURN, and it is named here so nobody crosses it casually.** |

⛔ **`metrics_daily_old` IS KEPT. Dropping it is a SEPARATE DECISION ON A SEPARATE DAY**, after the new
table has carried production for a stated soak. It is ~57 GB of insurance; the disk is there for it.

### 3B.3 THE FIRST FIVE MINUTES AFTER THE SWAP — what to check, in order

1. **The table is the partitioned one.** `select count(*) from pg_inherits where inhparent =
   'public.metrics_daily'::regclass;` → expect **145**. If it returns 0 the rename did not land.
2. **RLS survived the rename.** `select relrowsecurity from pg_class where oid =
   'public.metrics_daily'::regclass;` → **true**, with zero policies. ⛔ Check this even though the
   rename cannot change it — it is the one setting whose failure is silent and security-relevant.
3. **A real read works and is FAST.** Run the dashboard's own account query for one client and a
   recent window. It should return, and it should feel instant rather than take 20+ seconds.
4. **A real WRITE works.** The next cron pass is the true test, but do not wait for it — insert and
   delete a probe row exactly as the dual-write proof did, and confirm it lands.
5. **Partition pruning is actually happening.** `EXPLAIN` any client+date query and confirm the plan
   names ONE partition, not 145. ⛔ **If it scans all of them, pruning is not working and the entire
   point of the migration is unrealised** — that is a stop-and-look, not a tune-later.
6. **Watch `cron_runs` and the Vercel logs for one full nightly cycle** before calling it done.

### 3B.4 WHAT THE SWAP DOES NOT FIX
It does not change a single row of data, and it does not make an uncached read free. **The 28s cold
read must be RE-MEASURED after the swap, on Small**, and that measurement — not tonight's — decides
the steady-state compute tier.

## 4. WHAT THIS FLIGHT DID NOT DO
No table created · no data copied · no migration run · no extension enabled · no schema changed · no
index built · no vendor quota spent · the walk not started · the 6,048,263 landed rows untouched.
