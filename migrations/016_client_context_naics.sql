ALTER TABLE client_context ADD COLUMN IF NOT EXISTS naics_codes jsonb;
COMMENT ON COLUMN client_context.naics_codes IS 'Array of {code,title} NAICS 2022 selections chosen on the client; official definitions resolved server-side from naics-definitions.json at prompt-assembly time. Nullable; NULL/absent = none selected.';
