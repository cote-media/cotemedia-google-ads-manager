// LORAMER_UNKNOWN_RENDERS_HONESTLY_V1 — ONE component for the two states a client list can be in, because
// there are TWO and the app used to render only one.
//
// ⛔ WHY A COMPONENT AND NOT SIX EDITS: the literal "No clients yet." was hand-written in six -next pages
// (page:33 · mer:23 · client-profile:32 · [platform]:50 · analytics:23 · store:36). Six copies is why a
// seventh page will get it wrong, and it is the same copy-paste spread that put "not connected" on every
// surface in this arc. The guard ratchets the literal count down so the copies cannot come back.
//
// ⛔ AND WHY THE FAILED STATE IS NOT A THROW: resolveShellClient runs on ALL TEN Shell-mounting pages. A
// throw turns one transient database blip into a fleet-wide 500 — every -next surface dark at once, for a
// fault that today degrades to a single wrong sentence. The blast radius of the fix must not exceed the
// blast radius of the defect. (store-detect CAN throw: three -next callers, contained.)

export default function NoClients({ readFailed, reason }: { readFailed?: boolean; reason?: string | null }) {
  if (readFailed) {
    return (
      <p
        title={reason || undefined}
        style={{ color: '#b45309', fontFamily: 'monospace', fontSize: 13, padding: 24, maxWidth: 560, lineHeight: 1.5 }}
      >
        Couldn’t load your clients — this is a problem on our side, not a statement about your account. Reload to try again.
      </p>
    )
  }
  return <p style={{ color: '#64748b', fontFamily: 'monospace', fontSize: 13, padding: 24 }}>No clients yet.</p>
}
