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
      {/* L and M as one continuous path pair, stroked so the dash animation can build/dissolve them.
          pathLength=1 normalises the dash maths so the keyframes do not depend on the real geometry —
          change the artwork and the animation still works. */}
      <path className={styles.lmStroke} pathLength={1} d="M5 4.5 V16.5 H10.5" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path className={styles.lmStroke} pathLength={1} d="M13.5 16.5 V7.5 L16.75 12 L20 7.5 V16.5" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
