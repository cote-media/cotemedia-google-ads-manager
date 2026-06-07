// LORAMER_META_COMPLIANCE_ENDPOINTS_V1
// Public status page for Meta data-deletion requests. Meta's required
// { url } response points here; Meta reviewers (and users) open it to check
// progress. No auth by design; renders only status + received date — never
// emails or detail contents.

import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const STATUS_COPY: Record<string, string> = {
  processing: 'Your deletion request is being processed.',
  complete: 'Your data has been deleted.',
  partial: 'Your deletion request is being finalized. If this persists, contact support@loramer.com.',
  no_data: 'We held no data for this account. Nothing needed to be deleted.',
}

export default async function DeletionStatusPage({
  searchParams,
}: {
  searchParams: { code?: string }
}) {
  const code = searchParams?.code?.trim() || ''

  let row: { status: string | null; received_at: string | null } | null = null
  if (code) {
    const { data } = await supabaseAdmin
      .from('meta_compliance_log')
      .select('status, received_at')
      .eq('kind', 'data_deletion')
      .eq('confirmation_code', code)
      .maybeSingle()
    row = data ?? null
  }

  return (
    <main style={{ maxWidth: 560, margin: '0 auto', padding: '4rem 1.5rem', fontFamily: 'system-ui, sans-serif', color: '#1e293b' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Data Deletion Status</h1>
      {!code ? (
        <p>No confirmation code provided. Append ?code=&lt;your confirmation code&gt; to this URL.</p>
      ) : !row ? (
        <p>No deletion request found for this confirmation code.</p>
      ) : (
        <>
          <p style={{ marginBottom: '0.5rem' }}>
            <strong>Status:</strong> {STATUS_COPY[row.status ?? ''] ?? row.status ?? 'Unknown'}
          </p>
          {row.received_at && (
            <p style={{ color: '#64748b' }}>
              Request received: {new Date(row.received_at).toUTCString()}
            </p>
          )}
        </>
      )}
      <p style={{ marginTop: '2rem', fontSize: '0.875rem', color: '#64748b' }}>
        Questions? Contact support@loramer.com.
      </p>
    </main>
  )
}
