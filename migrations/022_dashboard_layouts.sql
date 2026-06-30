-- LORAMER_NEXT_CARD_ENGINE_V1 — dashboard_layouts: named saved views for the -next card engine.
-- VIEWER-keyed (user_email = the signed-in person customizing their view; a shared viewer gets THEIR own layout,
-- not the owner's). Per user_email + page_key + client_id (nullable: portfolio/page-level views = null).
-- Additive: no existing table altered. Postgres 15+ → UNIQUE NULLS NOT DISTINCT makes the nullable client_id
-- behave in the unique key (so the route's onConflict 'user_email,page_key,client_id,name' works for null + non-null).
CREATE TABLE IF NOT EXISTS public.dashboard_layouts (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_email  text NOT NULL,
  page_key    text NOT NULL,
  client_id   uuid NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name        text NOT NULL,
  view        jsonb NOT NULL,
  is_default  boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dashboard_layouts_key UNIQUE NULLS NOT DISTINCT (user_email, page_key, client_id, name)
);
CREATE INDEX IF NOT EXISTS dashboard_layouts_lookup ON public.dashboard_layouts (user_email, page_key);
-- RLS = defense-in-depth (mirrors every other table). App access is via the service role in the owner/viewer-gated
-- /api/next/layouts route; no Supabase JWT is issued (NextAuth ≠ Supabase auth) → RLS is inert for app paths; the
-- route's auth IS the wall. No anon/authenticated policy.
ALTER TABLE public.dashboard_layouts ENABLE ROW LEVEL SECURITY;
