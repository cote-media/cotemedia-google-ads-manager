// LORAMER_ONE_CLICK_RUN_V1 — THE BROWSER GATE-A'S SESSION, IN ONE PLACE. Extracted verbatim from unknown-renders.gate-a.mjs
// (the reconnect law's own Gate-A, 2026-08-23): a next-auth JWT minted AT RUN TIME with the LOCAL NEXTAUTH_SECRET from
// .env.local, set as the `next-auth.session-token` cookie on localhost, and a phone-shaped chromium context.
//
// ⛔ WHAT THIS NEVER DOES: no credentials in the repo (the secret is read from the local env when the script runs and
// written nowhere); no saved storageState file (Playwright: "The browser state file may contain sensitive cookies … We
// strongly discourage checking them into repositories" — we mint instead of saving); no production bypass — the mint
// only works with the deployment's secret, which is Vercel's, not the repo's. Never wired into `npm run guard`.
import { readFileSync } from 'node:fs'
import { encode } from 'next-auth/jwt'

/** Load .env.local into process.env (only keys not already set). */
export function loadLocalEnv(path = '.env.local') {
  for (const l of readFileSync(path, 'utf8').split('\n')) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

/** A next-auth session JWT for `email`, minted with the local secret. Throws when the secret is absent. */
export async function sessionTokenFor(email, name = 'Gate-A') {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('NEXTAUTH_SECRET is not set — load .env.local first; the mint never ships a secret of its own')
  return encode({ token: { name, email, sub: name.toLowerCase().replace(/\s+/g, '-') }, secret })
}

export const PHONE_VIEWPORT = { width: 390, height: 844 } // iPhone 14/15 CSS pixels

/** A phone-shaped, signed-in browser context against the local dev server. */
export async function phoneContext(browser, token, domain = 'localhost') {
  const ctx = await browser.newContext({
    viewport: PHONE_VIEWPORT,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  })
  await ctx.addCookies([{ name: 'next-auth.session-token', value: token, domain, path: '/', httpOnly: true, sameSite: 'Lax' }])
  return ctx
}
