import type { Metadata } from 'next'
import './globals.css'
import { Providers } from './providers'

export const metadata: Metadata = {
  title: 'Advar',
  description: 'AI-powered Google Ads management for agencies and businesses',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-paper text-ink antialiased" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
