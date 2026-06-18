// LORAMER_REDESIGN_INC1 — the Overview center, STATIC (sample values from docs/design/loramer_nav_concept.html).
// Drag-to-reorder / open-to-drill / Add section / Save view are visual-only here; the reusable engine that
// makes them real lands in Increment 2. Server component. Rendered as a fragment so its blocks become direct
// flex children of <main> (inheriting main's gap:18, matching the mockup spacing).
import Link from 'next/link'
import styles from './redesign.module.css'
import ShopifyIcon from './ShopifyIcon'

export default function OverviewStatic() {
  return (
    <>
      <h1 className={styles.title}>Overview</h1>

      {/* Top stats */}
      <div>
        <div className={styles.secHead}>
          <i className={`ti ti-grip-vertical ${styles.grip}`} />
          <span className={styles.lbl}>Top stats</span>
          <span className={styles.metaLabel}>drag to reorder</span>
        </div>
        <div className={styles.statGrid}>
          <div className={styles.stat}>
            <div className={styles.statK}><i className="ti ti-speakerphone" /> Total spend</div>
            <div className={styles.statV}>$2,799</div>
            <div className={`${styles.statD} ${styles.down}`}>↓ 12% vs prior</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statK}>Conversions</div>
            <div className={styles.statV}>68</div>
            <div className={`${styles.statD} ${styles.up}`}>↑ 9%</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statK}><i className="ti ti-brand-shopify" /> Revenue</div>
            <div className={styles.statV}>$3,002</div>
            <div className={`${styles.statD} ${styles.up}`}>↑ 4%</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statK}><i className="ti ti-chart-bar" /> Sessions</div>
            <div className={styles.statV}>10,526</div>
            <div className={`${styles.statD} ${styles.up}`}>↑ 31%</div>
          </div>
        </div>
      </div>

      {/* Channels */}
      <div>
        <div className={styles.secHead}>
          <i className={`ti ti-grip-vertical ${styles.grip}`} />
          <span className={styles.lbl}>Channels</span>
          <span className={styles.metaLabel}>open any to drill in</span>
        </div>
        <div className={styles.chanGrid}>
          <Link href="/dashboard-next/google-ads" className={styles.chan}>
            <i className={`ti ti-brand-google ${styles.chanLead}`} />
            <div><div className={styles.chanNm}>Google Ads</div><div className={styles.chanSub}>$1,665 spend · 43 campaigns</div></div>
            <i className={`ti ti-arrow-right ${styles.chanGo}`} />
          </Link>
          <Link href="/dashboard-next/meta-ads" className={styles.chan}>
            <i className={`ti ti-brand-meta ${styles.chanLead}`} />
            <div><div className={styles.chanNm}>Meta Ads</div><div className={styles.chanSub}>$1,134 spend · 8 ad sets</div></div>
            <i className={`ti ti-arrow-right ${styles.chanGo}`} />
          </Link>
          <Link href="/dashboard-next/analytics" className={styles.chan}>
            <i className={`ti ti-chart-bar ${styles.chanLead}`} />
            <div><div className={styles.chanNm}>Analytics</div><div className={styles.chanSub}>9,855 users · 10,526 sessions</div></div>
            <i className={`ti ti-arrow-right ${styles.chanGo}`} />
          </Link>
          <Link href="/dashboard-next/shopify" className={styles.chan}>
            {/* Shopify: inline SVG (Tabler v3 webfont dropped brand-shopify). */}
            <ShopifyIcon size={22} className={styles.chanLead} />
            <div><div className={styles.chanNm}>Shopify</div><div className={styles.chanSub}>9 orders · $333 AOV</div></div>
            <i className={`ti ti-arrow-right ${styles.chanGo}`} />
          </Link>
        </div>
      </div>

      {/* Foot cues (visual only) */}
      <div className={styles.footcues}>
        <span><i className="ti ti-plus" /> Add section</span>
        <span><i className="ti ti-device-floppy" /> Save view</span>
      </div>
    </>
  )
}
