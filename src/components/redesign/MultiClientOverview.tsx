// LORAMER_REDESIGN_INCB / LORAMER_NEXT_DATAWIRE_PORTFOLIO_V1 — the Multi-Client Overview (agency portfolio
// landing), where "All clients" lands. Client IDENTITY is now real (membership-aware list passed in from the
// server page) and each card navigates to that client's per-client page. Per-client METRICS (spend/revenue/
// delta/status) + the proactive "needs attention" engine are NOT wired yet (1B-2 via /api/next/intelligence) —
// so they render as HONEST NEUTRAL PLACEHOLDERS, never fabricated numbers/analysis beside real client names.
// Server component; the whole card routes to the per-client page (stays in-redesign).
import Link from 'next/link'
import styles from './redesign.module.css'
import Avatar from './Avatar'

type ClientLite = { id: string; name: string }

export default function MultiClientOverview({ clients }: { clients: ClientLite[] }) {
  return (
    <>
      {/* 1) Portfolio insights — NEUTRAL placeholder until the proactive engine + per-client metrics land (1B-2).
             (Was a fabricated "needs attention" strip naming specific clients — removed; not real yet.) */}
      <div className={styles.loraStrip}>
        <div className={styles.loraStripHead}><i className="ti ti-sparkles" /> Portfolio insights</div>
        <p className={styles.loraStripText}>Proactive insights across your clients are coming soon.</p>
      </div>

      {/* 2) Header + sort/filter stub (visual only). */}
      <div className={styles.clientsHeader}>
        <h1 className={styles.clientsTitle}>Clients</h1>
        <button className={styles.sortStub} type="button">
          <i className="ti ti-adjustments-horizontal" /> Sort &amp; filter
        </button>
      </div>

      {/* 3) Real client cards (identity wired; metrics = placeholders). Empty → honest empty state. */}
      {clients.length === 0 ? (
        <p style={{ color: '#64748b', fontFamily: 'monospace', fontSize: 13, padding: '8px 2px' }}>No clients yet.</p>
      ) : (
        <div className={styles.clientGrid}>
          {clients.map((c) => (
            <Link key={c.id} href={`/dashboard-next/client-profile?clientId=${c.id}`} className={styles.clientCard}>
              <div className={styles.cardTop}>
                <Avatar name={c.name} kind="client" className={styles.cardAvatar} />
                <span className={styles.cardName}>{c.name}</span>
                <i className={`ti ti-pin ${styles.cardPin}`} aria-hidden="true" />
              </div>

              <div className={styles.cardMetrics}>
                <div className={styles.metricBox}>
                  <span className={styles.metricK}>Spend</span>
                  <span className={styles.metricV}>—</span>
                </div>
                <div className={styles.metricBox}>
                  <span className={styles.metricK}>Revenue</span>
                  <span className={styles.metricV}>—</span>
                </div>
              </div>

              {/* Honest neutral status placeholder (no fabricated "working"/"needs attention"). */}
              <span className={styles.chip} style={{ background: '#eef0f3', color: '#64748b' }}>
                <i className="ti ti-clock" /> metrics coming
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
