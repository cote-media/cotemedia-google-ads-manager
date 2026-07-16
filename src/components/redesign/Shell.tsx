// LORAMER_REDESIGN_INCA — the constant app shell. Layout: full-width TopBar on top, then [ rail | main ]
// below it (the .body row), plus the mobile bottom tab bar (MobileNav). The TopBar is ONE shared component
// rendering responsively (no desktop/mobile fork). Server component; fonts/icons load via <link> as the
// mockup. Build-dark: renders only for allowlisted users (the page guards first).
import styles from './redesign.module.css'
import RailContent from './RailContent'
import MobileNav from './MobileNav'
import TopBar from './TopBar'
import ChatLauncher from './ChatLauncher' // LORAMER_NEXT_PARITY_V1 (P2-A) — real Ask-Lora chat (replaces the decorative pill)

export default function Shell({
  active,
  // LORAMER_NEXT_PORTFOLIO_METRICS_INDEX_V1 — neutral default (was a real client-name literal, which made any page
  // that omits clientName — the portfolio + empty-state fallbacks — falsely show "The Escential Group"). Portfolio
  // passes clientName="All clients" explicitly; this default keeps every other no-clientName render honest.
  clientName = 'All clients',
  clientId,
  children,
}: {
  active: string
  clientName?: string
  clientId?: string
  children: React.ReactNode
}) {
  return (
    <div className={styles.root}>
      {/* Load the same families the mockup uses (no CSP in this app; matches the mockup byte-for-byte). */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap"
        rel="stylesheet"
      />
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.34.0/dist/tabler-icons.min.css" />

      {/* Unified top bar (desktop + mobile, one component). Drawer body = the rail content, server-rendered. */}
      <TopBar clientName={clientName} clientId={clientId} drawer={<RailContent active={active} clientName={clientName} clientId={clientId} mobile />} />

      <div className={styles.body}>
        {/* Desktop rail (hidden < md). Per-client nav only — switcher + account moved to the TopBar. */}
        <aside className={`${styles.rail} ${styles.railDesktop}`}>
          <RailContent active={active} clientName={clientName} clientId={clientId} />
        </aside>

        <main className={styles.main}>
          {/* Sub-header below the TopBar. The dead static "Last 14 days" pill was REMOVED (LORAMER_NEXT_PERIOD_UI_V1):
              it looked like the date control but was inert — the real, working period picker lives in each page's
              own header (the Overview Top-stats dropdown / the all-clients center dropdown). */}
          {/* LORAMER_NEXT_CARD_ENGINE_RESHAPE_V1 — the dead static "Customize" pill was REMOVED; the single working
              Customize (+ the global date control + compare + full-screen) lives in the CardEngine page header. */}
          <div className={styles.subheader}>
            <ChatLauncher clientId={clientId} clientName={clientName} />
          </div>

          {/* LORAMER_SHELL_CLIENT_CONTEXT_V1 — THE MOUNT KEY, at SHELL level, ONE place, keyed on clientId.
              WHY: TopBar.tsx:82 switches clients with router.push(`${pathname}?clientId=`) — a SOFT nav that keeps the
              pathname, so React REUSES every component in the subtree and their useState SURVIVES the switch. That is
              how client A's data ends up displayed under client B, and — because the save handlers close over the NEW
              clientId while the state is still A's — how a single click can WRITE A's value onto B's row. Confirmed
              live on client-profile: NaicsPicker's `query` and `selected` (its `touched` ref permanently blocks
              re-hydration) and ClientPage's `gateDraft` all carried across a switch; gateDraft pre-ticked the previous
              client's answers on the next client's forced-choice value-model gate, one click from mis-configuring
              GOVERNING-LAW input for every client after the first.
              Changing this key unmounts the ENTIRE page subtree, so NO client-scoped state can outlive a switch — by
              construction, for every -next surface at once. store/page.tsx:58 solved exactly this with a per-page key
              (S-PL#1/aa357c7) and no other page ever got one; per-page is how we got here, so it lives HERE.
              It is also the product requirement: the remount IS the blink that makes the switch perceptible — today a
              client switch looks like nothing happened. Accepted tradeoff (Russ): a real remount re-fetches on switch
              and is marginally slower than the soft nav. Correctness and legibility beat the saved milliseconds. */}
          <div key={clientId || '__no_client__'} className={styles.clientScope}>
            {children}
          </div>
        </main>
      </div>

      {/* Mobile bottom tab bar (Overview · Lora · Mer). Hidden ≥ md. */}
      <MobileNav active={active} clientId={clientId} />
    </div>
  )
}
