// LORAMER_SHELL_CLIENT_CONTEXT_V1
// THE ONE resolver for a -next page's active client. Every page that mounts <Shell> uses this and nothing else.
//
// WHY ONE PLACE (the whole point — do not re-scatter this):
// The rule "resolve the client from the validated URL param" was fixed once on 2026-06-20 and REGRESSED three weeks
// later at team/page.tsx:22, which resolved `(clients||[])[0]` — the first accessible client by created_at — and never
// read searchParams at all. It regressed because the pattern lived in SIX files and nothing could see the seventh:
// Ask-Lora on Team then answered about the wrong client (PROVEN in prod — the 2026-07-15 23:28:38 spend row carries
// Ennis 1b7b073f while the URL said Veterinary f5fbe7e5). Collapsing it here makes the guard trivial and strong: every
// Shell page calls resolveShellClient, and anything computing client context another way FAILS the build.
//
// VALIDATION IS NOT OPTIONAL (Lesson 53 / HANDOFF:847): a persisted/incoming selection carried into a NEW context must
// be re-checked against that context's capabilities, and land on a deterministic valid default when it isn't. Trusting
// the raw ?clientId= would be an IDOR seam that does not exist today — the param is attacker-controlled, so it is
// validated against listAccessibleClients (the org-aware access layer) before it is ever used or echoed back.
import { listAccessibleClients } from '@/lib/access/can-access'
import { supabaseAdmin } from '@/lib/supabase'

export type ShellClient = { id: string; name: string }

export type ShellClientResult = {
  /** The active client, or null when the caller has no accessible clients at all. */
  client: ShellClient | null
  /** Every client the caller may see, created_at asc — the switcher's list. */
  clients: ShellClient[]
  /** True when a ?clientId= was supplied but REJECTED (not accessible / unknown) and we fell back. */
  fellBack: boolean
}

/**
 * Resolve the active client for a Shell-mounting -next page.
 *   1. read ?clientId= from the URL (the switcher's source of truth — TopBar.tsx:82 writes it)
 *   2. VALIDATE it against listAccessibleClients (org-aware: owner → org-member-via-grant → legacy client_members)
 *   3. fall back DETERMINISTICALLY to the first accessible client when absent or invalid
 * Never throws. Never trusts the URL. Never returns a client the caller cannot access.
 */
export async function resolveShellClient(
  email: string,
  searchParams?: { clientId?: string | string[] }
): Promise<ShellClientResult> {
  const ids = await listAccessibleClients(email)
  if (!ids.length) return { client: null, clients: [], fellBack: false }

  const { data } = await supabaseAdmin
    .from('clients')
    .select('id, name')
    .in('id', ids)
    .is('deleted_at', null) // LORAMER_DELETE_CLIENT_V1 — an archived client is never selectable
    .order('created_at', { ascending: true })
  const clients = (data || []) as ShellClient[]
  if (!clients.length) return { client: null, clients: [], fellBack: false }

  const raw = searchParams?.clientId
  const requested = Array.isArray(raw) ? raw[0] : raw

  // THE VALIDATION: a requested id is honoured ONLY if it is in the caller's accessible set. An unknown or
  // inaccessible id is NOT an error the user should see — it falls back silently to a valid default (a stale
  // bookmark, a revoked grant, or a hand-typed id must never blank the page or leak another org's client).
  const match = requested ? clients.find((c) => c.id === requested) || null : null
  if (requested && !match) {
    console.warn(`[shell-client] clientId=${requested} not accessible to ${email} — falling back to the first accessible client`)
  }
  return { client: match || clients[0], clients, fellBack: Boolean(requested && !match) }
}
