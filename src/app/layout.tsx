import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Providers } from './providers'

// LORAMER_NEXT_CHAT_FULLSCREEN_V1 — there was NO viewport export at all, so Next emitted only its
// default `width=device-width, initial-scale=1`. interactiveWidget tells Chromium/Android to RESIZE
// the layout viewport when the on-screen keyboard opens, instead of leaving a fixed overlay sized to
// a viewport the user can no longer see.
// ⚠ interactiveWidget is CHROMIUM/ANDROID ONLY — Safari ignores it. It is NOT the iOS keyboard-bleed
// fix and must never be reported as one; that mechanism is unidentified and blocked behind the
// measurement required by DECISIONS LORAMER_NEXT_CHAT_KEYBOARD_BLEED_V1.
// ⛔ maximumScale IS DELIBERATELY ABSENT AND MUST NOT BE ADDED (Russ, 2026-07-26). It would stop iOS
// auto-zoom on input focus, but it blocks PINCH-ZOOM for everyone — a real accessibility regression on
// a data product full of dense tables. The same result is achieved by giving the chat input a 16px
// font-size, which is Track 2 and pending its measurement. Do not re-propose maximumScale.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  interactiveWidget: 'resizes-content',
}

export const metadata: Metadata = {
  title: 'LoraMer',
  description: 'Business intelligence across every data source you use — with AI built in.',
  icons: {
    icon: '/favicon.svg',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-paper text-ink antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
