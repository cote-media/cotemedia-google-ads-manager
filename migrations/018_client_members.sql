-- 018_client_members.sql — LORAMER_NEXT_RBAC_FOUNDATION_V1
-- Additive. Non-owner client grants for -next membership-aware reads.
-- OWNER stays implicit = clients.user_email. Table EMPTY until first real invite.
create table if not exists client_members (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  member_email  text not null,
  role          text not null check (role in ('editor','viewer')),
  invited_by    text not null,
  created_at    timestamptz not null default now(),
  unique (client_id, member_email)
);
create index if not exists idx_client_members_member_email on client_members (member_email);
alter table client_members enable row level security;
-- No policies: service-role only (matches cron_runs / uploaded_docs house pattern).
