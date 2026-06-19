-- LORAMER_CLIENT_DESCRIPTOR_V1
-- Migration 015: free-text business descriptor + service area + website on client_context.
-- Additive, nullable, reversible. The redesign client page (General section) replaces the old
-- business_type dropdown with business_descriptor (primary classification signal). business_type /
-- primary_kpi / funnel_notes are KEPT (the legacy /clients form still reads/writes them, and the
-- prompt falls back to business_type when business_descriptor is empty).
-- Run via Supabase SQL Editor (or MCP). Idempotent.

ALTER TABLE client_context
  ADD COLUMN IF NOT EXISTS business_descriptor text,
  ADD COLUMN IF NOT EXISTS service_area text,
  ADD COLUMN IF NOT EXISTS website text;
