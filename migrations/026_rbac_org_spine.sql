-- 026_rbac_org_spine.sql — LORAMER_RBAC_ORG_SPINE_V1
-- RBAC Path B spine (Route A), PREVIEW-FIRST: ADDITIVE + REVERSIBLE. Creates the org entity, org-level membership,
-- per-member client grants, and clients.org_id (NULLABLE this step — NO NOT NULL lock yet). Backfills one org per
-- distinct real owner + the owner membership + clients.org_id. Touches NO read path (resolveAccess/pages unchanged).
-- RLS on / NO policies (service-role only, matching client_members [migration 018]). Idempotent (re-runnable).
-- Next flights (NOT here): NOT NULL lock on clients.org_id; resolveAccess/read swap to org-aware grants; invite UI.

-- 1) organizations — the Owner-owned org entity (drives the two UI flows via org_type).
create table if not exists organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_email text not null,
  org_type    text not null default 'agency' check (org_type in ('solo','agency')),
  created_at  timestamptz not null default now()
);
alter table organizations enable row level security;

-- 2) org_members — ORG-level membership (the Path B spine; distinct from per-client client_members [migration 018]).
create table if not exists org_members (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  member_email text not null,
  role         text not null check (role in ('owner','admin','member')),
  invited_by   text,
  created_at   timestamptz not null default now(),
  unique (org_id, member_email)
);
create index if not exists idx_org_members_member_email on org_members (member_email);
alter table org_members enable row level security;

-- 3) org_client_grants — which of an org's clients a member may see. all_clients=true = a STANDING grant to every
--    org client incl. future ones (client_id null in that case); else a specific client_id.
create table if not exists org_client_grants (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  member_email text not null,
  client_id    uuid references clients(id) on delete cascade,
  all_clients  boolean not null default false,
  created_at   timestamptz not null default now(),
  check (all_clients = true or client_id is not null),
  unique (org_id, member_email, client_id)
);
create index if not exists idx_org_client_grants_member on org_client_grants (org_id, member_email);
alter table org_client_grants enable row level security;

-- 4) clients.org_id — NULLABLE this step (NO not-null lock), indexed. FK to organizations.
alter table clients add column if not exists org_id uuid references organizations(id);
create index if not exists idx_clients_org_id on clients (org_id);

-- 5) BACKFILL (deterministic, idempotent-safe).
-- a) one org per DISTINCT owner. Cote Media (agency) for cotebrandmarketing; every other distinct owner = solo,
--    name = the email (fixtures get orgs too so org_id is universally populated — harmless). Skip owners already orged.
insert into organizations (name, owner_email, org_type)
select
  case when c.user_email = 'cotebrandmarketing@gmail.com' then 'Cote Media' else c.user_email end,
  c.user_email,
  case when c.user_email = 'cotebrandmarketing@gmail.com' then 'agency' else 'solo' end
from (select distinct user_email from clients) c
where not exists (select 1 from organizations o where o.owner_email = c.user_email);

-- b) owner membership per org.
insert into org_members (org_id, member_email, role, invited_by)
select o.id, o.owner_email, 'owner', o.owner_email
from organizations o
where not exists (
  select 1 from org_members m where m.org_id = o.id and m.member_email = o.owner_email
);

-- c) clients.org_id = the org whose owner_email = clients.user_email. Every client gets its org_id.
update clients c
set org_id = o.id
from organizations o
where o.owner_email = c.user_email
  and c.org_id is distinct from o.id;
