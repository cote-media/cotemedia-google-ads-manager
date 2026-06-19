-- 017_uploaded_docs.sql — Knowledge store (reference layer). Text-only; no originals. Per UPLOAD_FEATURE_DESIGN.md.
CREATE TABLE IF NOT EXISTS uploaded_docs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email    text NOT NULL,
  scope          text NOT NULL CHECK (scope IN ('client','agency')),
  client_id      uuid REFERENCES clients(id) ON DELETE CASCADE,
  filename       text NOT NULL,
  content_type   text,
  byte_size      bigint,
  content_hash   text,                 -- SHA-256 of original bytes (dedup/integrity; set at ingest)
  extracted_text text NOT NULL,
  word_count     integer NOT NULL DEFAULT 0,
  char_count     integer NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'ready'    CHECK (status IN ('ready','processing','error')),
  error_message  text,
  scan_status    text NOT NULL DEFAULT 'deferred' CHECK (scan_status IN ('deferred','pending','clean','infected','error')),
                 -- malware scan deferred to post-freeze; managed-API scanner flips this later (UPLOAD design decision 2)
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  CONSTRAINT uploaded_docs_scope_client_ck CHECK (
    (scope = 'client' AND client_id IS NOT NULL) OR
    (scope = 'agency' AND client_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS uploaded_docs_recall_idx ON uploaded_docs (owner_email, scope, client_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS uploaded_docs_client_idx ON uploaded_docs (client_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS upload_audit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email text NOT NULL,
  doc_id      uuid,
  client_id   uuid,
  scope       text,
  action      text NOT NULL CHECK (action IN ('upload','delete','error','rejected')),
  filename    text,
  detail      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS upload_audit_owner_idx ON upload_audit (owner_email, created_at DESC);
