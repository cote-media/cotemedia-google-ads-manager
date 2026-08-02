// LORAMER_CHAT_STATUS_SUBJECT_V1 — the LM mark. ONE mark, TWO STATES (decided 2026-07-28).
//
// It is Lora's message avatar on EVERY assistant turn, AND the same mark animates as the working
// indicator. That is the whole point of it being one component: the thing that identifies her is the
// thing that shows she is working, so the working state reads as HER thinking rather than as a
// generic spinner bolted next to her name.
//
// ⛔ CSS/SVG ONLY — NO video, NO Lottie, NO JS frame loop. A brand mark must not carry a runtime
// dependency, and an animation driven from JS competes with the very render the user is waiting for.
// The animation lives entirely in chat.module.css as CSS keyframes on SVG geometry.
//
// ⛔ IT COMMUNICATES, IT DOES NOT DECORATE. The OFF and WORKING states are visually distinct — the
// strokes build and dissolve on a loop while working and sit still when idle. A mark that looked the
// same in both states would be decoration, and would tell the user nothing about the thing this whole
// change exists to fix: the silence.
//
// ⛔ prefers-reduced-motion — the CSS falls back to a STATIC WORKING state (dimmed, fully drawn), not
// to the idle state. The user still learns that work is happening; they just are not moved at. That
// is non-negotiable here; accessibility is a closed question in this repo.
import styles from './chat.module.css'

export function LmMark({ working = false, size = 22 }: { working?: boolean; size?: number }) {
  return (
    <svg
      className={`${styles.lmMark} ${working ? styles.lmMarkWorking : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* ⛔ NO pathLength. THE FIRST CUT HAD pathLength={1} AND THAT IS WHY THE MARK DID NOT RENDER ON THE
          DEVICE (Gate-B, Chrome iOS, 2026-08-02). WEBKIT PARSES pathLength AND IGNORES IT — it has no effect
          on rendering, and Firefox/Chrome-on-desktop scale dash values by it while WebKit/Blink do not. Every
          browser on iOS is WebKit, so on the ONLY target that matters the normalisation never happened: with
          `stroke-dasharray: 1` against real path lengths of 17.5 and 29.1 user units, the mark drew as
          1-unit dashes separated by 1-unit gaps — a faint dotted smear at 14px, which reads as nothing at all.
          The dash maths now uses REAL user units (see .lmStroke), so it depends on the geometry below. If the
          artwork changes, the dash length in chat.module.css changes with it — a stated coupling is honest;
          an attribute that silently does nothing on the target browser is not. */}
      <path className={styles.lmStroke} d="M5 4.5 V16.5 H10.5" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path className={styles.lmStroke} d="M13.5 16.5 V7.5 L16.75 12 L20 7.5 V16.5" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
