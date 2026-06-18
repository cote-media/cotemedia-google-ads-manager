// LORAMER_REDESIGN_INCB — the Multi-Client Overview (agency portfolio landing), STATIC first pass. This is
// where "All clients" lands. Layout only: a proactive-Lora "needs attention" triage strip (visual placeholder
// for the real engine), a Clients header with a sort/filter stub, and a grid of sample client cards. Real
// client/connection data + real proactive analysis are the next two increments. Server component; the whole
// card routes to the per-client Overview (stays in-redesign).
import Link from 'next/link'
import styles from './redesign.module.css'
import Avatar from './Avatar'

type ClientCard = { name: string; spend: string; revenue: string; delta: string; up: boolean; warn: boolean }

// Static sample portfolio (≈6 cards). Replaced by real data in the next increment.
const CLIENTS: ClientCard[] = [
  { name: 'The Escential Group', spend: '$2,799', revenue: '$3,002', delta: '↓ 12%', up: false, warn: false },
  { name: 'Foam OH', spend: '$5,140', revenue: '$4,210', delta: '↓ 18%', up: false, warn: true },
  { name: 'Influential Drones', spend: '$1,980', revenue: '$6,540', delta: '↑ 24%', up: true, warn: false },
  { name: 'Acme Co', spend: '$3,420', revenue: '$2,990', delta: '↑ 32%', up: true, warn: true },
  { name: 'Glass Plus', spend: '$1,210', revenue: '$1,880', delta: '↑ 6%', up: true, warn: false },
  { name: 'My Vacation Network', spend: '$880', revenue: '$1,140', delta: '↓ 3%', up: false, warn: false },
]

export default function MultiClientOverview() {
  return (
    <>
      {/* 1) Needs-attention strip — proactive-Lora triage (STATIC placeholder for the real engine). */}
      <div className={styles.loraStrip}>
        <div className={styles.loraStripHead}><i className="ti ti-sparkles" /> Needs attention</div>
        <p className={styles.loraStripText}>
          2 clients need a look — <strong>Foam OH</strong> (ROAS down 18% WoW) · <strong>Acme Co</strong> (spend
          up 32%, conversions flat). <strong>Influential Drones</strong> is having its best week.
        </p>
      </div>

      {/* 2) Header + sort/filter stub (visual only). */}
      <div className={styles.clientsHeader}>
        <h1 className={styles.clientsTitle}>Clients</h1>
        <button className={styles.sortStub} type="button">
          <i className="ti ti-adjustments-horizontal" /> Sort &amp; filter
        </button>
      </div>

      {/* 3) Client card grid (desktop 2–3 cols via auto-fill; single column on mobile). */}
      <div className={styles.clientGrid}>
        {CLIENTS.map((c) => (
          <Link key={c.name} href="/dashboard-next" className={styles.clientCard}>
            <div className={styles.cardTop}>
              <Avatar name={c.name} kind="client" className={styles.cardAvatar} />
              <span className={styles.cardName}>{c.name}</span>
              <i className={`ti ti-pin ${styles.cardPin}`} aria-hidden="true" />
            </div>

            <div className={styles.cardMetrics}>
              <div className={styles.metricBox}>
                <span className={styles.metricK}>Spend</span>
                <span className={styles.metricV}>{c.spend}</span>
              </div>
              <div className={styles.metricBox}>
                <span className={styles.metricK}>Revenue</span>
                <span className={styles.metricV}>{c.revenue}</span>
              </div>
              <span className={`${styles.cardDelta} ${c.up ? styles.up : styles.down}`}>{c.delta}</span>
            </div>

            <span className={`${styles.chip} ${c.warn ? styles.chipWarn : styles.chipOk}`}>
              <i className={`ti ${c.warn ? 'ti-alert-triangle' : 'ti-circle-check'}`} />
              {c.warn ? 'needs attention' : 'working'}
            </span>
          </Link>
        ))}
      </div>
    </>
  )
}
