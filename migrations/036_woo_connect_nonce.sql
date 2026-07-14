-- LORAMER_WOO_CALLBACK_NONCE_V1 (C2) — close the unauthenticated WooCommerce callback credential-injection hole.
-- The wc-auth callback is a WordPress→server POST (no browser, no cookie), so the OAuth double-submit-cookie CSRF
-- guard the other connectors use can't reach it. This table backs a short-TTL state nonce: minted in
-- /api/woocommerce/auth under an authenticated session (keyed to client_id + user_email + shop), carried on the
-- callback_url (WordPress echoes callback_url query params), then verified + one-time-consumed by the callback —
-- binding the otherwise-unauthenticated POST to the identity that started the flow.
CREATE TABLE IF NOT EXISTS public.woo_connect_nonce (
  nonce       uuid PRIMARY KEY,
  client_id   uuid NOT NULL,
  user_email  text NOT NULL,
  shop        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_woo_connect_nonce_expires ON public.woo_connect_nonce (expires_at);
-- Match the fleet's posture: RLS ENABLED (service-role bypasses; anon/authenticated default-deny — no policy needed).
ALTER TABLE public.woo_connect_nonce ENABLE ROW LEVEL SECURITY;
