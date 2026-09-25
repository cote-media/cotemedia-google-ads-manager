-- 108_google_delete_second_request.sql — LORAMER_GOOGLE_DELETE_SECOND_REQUEST_V1
--
-- ⛔ WHAT WENT WRONG, MEASURED 2026-09-25. Tri-Copy's Google data was deleted 2026-09-21 (code 5ff2f7d8…,
-- status complete). The client reconnected Google on 2026-09-23 and captured again. A press on 2026-09-25
-- returned HTTP 200, the 2026-09-21 confirmation code and the 2026-09-21 counts, and DELETED NOTHING —
-- because migration 100's google_delete_open matched on client_id alone and stopped at the first row whose
-- status was in ('processing','partial','complete'). `gen_random_uuid()` was therefore unreachable for any
-- client that had ever finished a deletion, and platform_compliance_log held one row from 09-21 while live
-- rows sat in the warehouse.
--
-- ⛔ THE BINDING RULE, AND IT IS GOOGLE'S, NOT A REGULATOR'S. LoraMer's customers are US businesses and this
-- route deletes Google user data, so the policy that governs it is the API Services User Data Policy
-- (developers.google.com/terms/api-services-user-data-policy):
--     "Do not misrepresent what data is collected or what you do with Google user data."
-- Answering a deletion request with an older request's receipt while the data is still held is exactly that
-- misrepresentation, and the consequence is stated on the same page:
--     "Google may revoke or suspend your access to Google API Services and other Google products and services
--      if you are found in violation of other product policies, terms of service, or other guidelines."
-- CONTEXT ONLY, not the rule this code answers to — California's CCPA gives a consumer a deletion right, and
-- the CPPA's FAQ (cppa.ca.gov/faq.html) states: "Businesses must confirm receipt of your request within 10
-- business days" "and must substantively respond to your request to delete, correct, or know your personal
-- information within 45 calendar days. They can extend the deadline by another 45 days (90 days total) if they
-- notify you." A clock like that cannot start on a request the system never recorded.
--
-- ⛔ WHAT STAYS. The reuse set exists because of a real incident (2026-09-21, round 6): a phone dropped an
-- 82-second request and re-sent it, two runs overlapped, and the log under-recorded 307,153 deleted rows.
-- 'processing' and 'partial' therefore KEEP reusing — the row is still the lock. Only 'complete' leaves the
-- set, and even then a completed row is reused inside a PUBLISHED window so two tabs in the same second cannot
-- open two jobs. That window is the request-scoped key we have no client to supply: Stripe prunes an
-- idempotency key after at least 24 h and then "generate[s] a new request if a key is reused after the original
-- is pruned", and draft-ietf-httpapi-idempotency-key-header says "The resource SHOULD define such expiration
-- policy and publish it in the documentation". DOUBLE_PRESS_WINDOW = 15 minutes ⇐ the route's own 800 s request
-- budget rounded up, so a retried press is still one request and anything later is a new one.
--
-- ⛔ THE LOCK, AND WHY IT IS TRANSACTION-SCOPED. There is no unique index on (platform, kind, client_id) —
-- measured: the only unique indexes on this table are platform_compliance_log_pkey (id) and
-- platform_compliance_log_confirmation_code_key (confirmation_code). Nothing stops two concurrent opens from
-- both reading "no reusable row" and both inserting, which with 'complete' removed becomes reachable for the
-- first time. pg_advisory_xact_lock is taken on the client BEFORE the read and released by the transaction;
-- a SESSION-scoped lock would be wrong here because PostgREST multiplexes its own pool, so the session is not
-- ours to hold (PostgreSQL docs, Explicit Locking).
--
-- ⛔ APPEND-ONLY IS UNTOUCHED. This function only SELECTs and INSERTs; no earlier row is updated or deleted,
-- and platform_compliance_log stays excluded from the wipe by name in src/lib/google-delete/tables.ts ("the
-- deletion log itself — the record of the request is kept, never deleted by the request it records"). After
-- this change the log gains what it should always have had: one row per request.
--
-- ⛔ SAFE TO APPLY BEFORE THE ROUTE DEPLOYS. The old route with this function opens a new processing row and
-- proceeds to hand it to the runner exactly as it would for a first press.
--
-- REVERT: re-apply migrations/100_google_delete_job.sql's definition of google_delete_open.
-- ⛔ THERE IS NO STAGING DATABASE. This can only be proven where it is applied.

create or replace function public.google_delete_open(p_client uuid, p_email text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.platform_compliance_log%rowtype;
  v_code text;
  c_double_press_window constant interval := interval '15 minutes';
begin
  -- THE LOCK FIRST: count-and-insert cannot interleave with another press for this client.
  perform pg_advisory_xact_lock(hashtext('google_delete_open:' || p_client::text));

  select * into r from public.platform_compliance_log
   where platform = 'google' and kind = 'data_deletion' and client_id = p_client
   order by received_at desc limit 1;

  -- A LIVE JOB is still the lock — a re-send, a second tab or a second press only reads its progress.
  if found and r.status in ('processing', 'partial') then
    return to_jsonb(r);
  end if;

  -- A COMPLETED job is reused only inside the published double-press window. Past it, this is a new request.
  if found and r.status = 'complete' and r.updated_at > now() - c_double_press_window then
    return to_jsonb(r);
  end if;

  v_code := gen_random_uuid()::text;
  insert into public.platform_compliance_log (platform, kind, client_id, user_email, confirmation_code, status, detail)
  values ('google', 'data_deletion', p_client, p_email, v_code, 'processing',
          jsonb_build_object('steps', '[]'::jsonb, 'counts', '{}'::jsonb, 'metrics', jsonb_build_object('months_done', '[]'::jsonb)))
  returning * into r;
  return to_jsonb(r);
end $$;

revoke all on function public.google_delete_open(uuid, text) from public;
revoke all on function public.google_delete_open(uuid, text) from anon;
revoke all on function public.google_delete_open(uuid, text) from authenticated;
grant execute on function public.google_delete_open(uuid, text) to service_role;
