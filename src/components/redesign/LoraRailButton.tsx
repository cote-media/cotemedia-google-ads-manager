// LORAMER_NEXT_RAIL_LORA_TRIGGER_V1 — the rail's "Lora" entry OPENS the Ask-Lora chat instead of navigating.
// It navigated to /dashboard-next/lora, which does not exist → it fell through to [platform]/page.tsx →
// notFound() (a 404). The mobile Lora tab was already converted to dispatch 'loramer:open-chat' (MobileNav.tsx);
// this makes the rail use the SAME mechanism — the dispatch below is byte-for-byte identical to MobileNav's.
// RailContent is a server component, so the interactivity lives here in this tiny client leaf.
// Drawer close: when this button is tapped inside the mobile drawer, the tap bubbles to the drawer's onClick
// delegation in TopBar.tsx, which closes the drawer on `closest('a, button')` (widened from 'a' for this button).
'use client'

export default function LoraRailButton({ className, icon, label }: { className: string; icon: string; label: string }) {
  return (
    <button
      type="button"
      className={className}
      style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%' }}
      onClick={() => window.dispatchEvent(new Event('loramer:open-chat'))}
    >
      <i className={`ti ${icon}`} />
      {label}
    </button>
  )
}
