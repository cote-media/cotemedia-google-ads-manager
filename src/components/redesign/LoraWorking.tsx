// LORAMER_LORA_WORKING_SHARED_V1 — THE MARK AND THE STATUS LINE, ONCE, FOR EVERY SURFACE.
//
// ⛔ WHY THIS FILE EXISTS. There are TWO Lora chat surfaces over the SAME useLoraChat hook:
//   · src/components/redesign/ChatLauncher.tsx        — the desktop right-docked shelf
//   · src/app/dashboard-next/lora/LoraPageClient.tsx  — the PHONE page (open-lora.ts routes ≤767px here)
// Every status-line and LM-mark change of 2026-08-02 landed in the FIRST one only. The phone — the only
// device Gate-B actually runs on — showed a plain italic line and no mark at all, while a green guard
// asserted the mark was mounted. The fix is not to copy the code across; it is to make there be one copy.
// Both surfaces now import THIS component and lora-working.module.css. A change here reaches both or
// neither, which is the only arrangement that cannot drift.
//
// ⛔ CSS/SVG ONLY — NO video, NO Lottie, NO JS frame loop. A brand mark must not carry a runtime dependency,
// and an animation driven from JS competes with the very render the user is waiting for.
import styles from './lora-working.module.css'

/** ONE MARK, TWO STATES. Lora's avatar on an assistant turn AND the working indicator — the same element,
 *  in the same place, animating or not. `working` is the only difference between them. */
/* ⛔ NO `size` PROP — LORAMER_LM_MARK_IS_TEXT_HEIGHT_V1, 2026-08-19. It defaulted to 34, which is a NUMBER
 *  SOMEBODY CHOSE, and it is why Russ's 2026-08-03 correction ("roughly TEXT-HEIGHT, not a large graphic")
 *  never reached the screen: the correction was banked in chat and the constant was never touched. The box
 *  is now DERIVED in CSS from the answer text's own font-size x line-height (`.lmMark`,
 *  lora-working.module.css), so it cannot be set to a number again without changing the text it sits on.
 *  ⛔ AND WIDTH/HEIGHT ARE NOT PRESENTATION ATTRIBUTES ANY MORE. An SVG `width=` attribute loses to any
 *  stylesheet rule, so leaving it would have meant two sources of truth with the CSS silently winning —
 *  the shape of defect that makes a UI number impossible to trace. `viewBox` stays: it is the coordinate
 *  system the paths are drawn in, not a size. */
export function LmMark({ working = false }: { working?: boolean }) {
  return (
    <svg
      className={`${styles.lmMark} ${styles.mark} ${working ? styles.lmMarkWorking : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* ⛔ NO pathLength. THAT ATTRIBUTE IS WHY THE MARK DID NOT RENDER ON THE DEVICE (Gate-B, Chrome iOS,
          2026-08-02). WEBKIT PARSES pathLength AND IGNORES IT — Firefox and Blink scale dash values by it,
          WebKit does not, and every browser on iOS is WebKit. With `stroke-dasharray: 1` against real path
          lengths of 17.5 and 29.1 user units the mark drew as 1-unit dashes separated by 1-unit gaps: a
          faint dotted smear, which reads as nothing. The dash maths now uses REAL user units (see
          .lmStroke), so it is coupled to the geometry below — a stated coupling is honest; an attribute
          that silently does nothing on the target browser is not. */}
      <path className={styles.lmStroke} d="M5 4.5 V16.5 H10.5" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <path className={styles.lmStroke} d="M13.5 16.5 V7.5 L16.75 12 L20 7.5 V16.5" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** A COMPLETED ASSISTANT TURN: the static mark, then the answer. The mark sits ABOVE the bubble and OUTSIDE
 *  it — on the page background, at the answer's own text margin. It is the same element and the same
 *  position the working state used, so nothing jumps when the answer arrives. */
export function LoraTurn({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.turn}>
      <LmMark />
      {children}
    </div>
  )
}

/** THE WORKING STATE: one animating mark, one status line, and RESERVED SPACE below.
 *  ⛔ NO CONTAINER — no pill, no bubble, no fill, no border. Both surfaces used to wrap this in
 *  .bubbleAssistant, which said "this is a message from Lora" about a thing that is not a message.
 *  ⛔ NO SKELETON — the space is simply claimed and left empty. A skeleton draws fake content in a shape
 *  nobody knows yet; empty claimed space is honest and stops the answer shoving the composer down. */
export function LoraWorking({ status }: { status?: string | null }) {
  return (
    <div className={styles.turn}>
      <LmMark working />
      {/* `status` is null only in the sliver before the first frame lands. "Working…" is the honest
          placeholder there: it claims no client, no platform, no window and no read. */}
      <div className={styles.statusText}>{status || 'Working…'}</div>
      {/* ⛔ THE RESERVE IS AN ELEMENT, AND IT IS LAST. It used to be `min-height` on this block, which says
          how TALL the block is and says NOTHING about which side the slack falls on — the surrounding flex
          chain decided, and on the device it decided BOTTOM: the mark and the line ended up hard against the
          composer with the emptiness above them. As a spacer AFTER the status line, DOM order settles it:
          mark first, line second, emptiness third, falling away underneath where the answer will grow. */}
      <div className={styles.reserve} aria-hidden="true" />
    </div>
  )
}
