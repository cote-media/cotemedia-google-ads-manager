-- Create table to log Shopify compliance webhook events
-- Required for audit trail during App Store review and ongoing GDPR/CCPA compliance

CREATE TABLE IF NOT EXISTS shopify_compliance_log (
  id BIGSERIAL PRIMARY KEY,
  topic TEXT NOT NULL,
  shop_domain TEXT,
  shop_id TEXT,
  payload JSONB,
  action_taken TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS shopify_compliance_log_topic_idx
  ON shopify_compliance_log (topic);

CREATE INDEX IF NOT EXISTS shopify_compliance_log_shop_domain_idx
  ON shopify_compliance_log (shop_domain);

CREATE INDEX IF NOT EXISTS shopify_compliance_log_received_at_idx
  ON shopify_compliance_log (received_at DESC);
