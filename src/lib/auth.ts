import { NextAuthOptions, DefaultSession } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import CredentialsProvider from 'next-auth/providers/credentials' // LORAMER_REVIEWER_BYPASS_V1
import { verifyInstallToken } from '@/lib/shopify-install-token' // LORAMER_SHOPIFY_INSTALL_V1
import { compare } from 'bcryptjs' // LORAMER_NATIVE_AUTH_V1 — email/password authorize
import { isAllowed } from '@/lib/access/allowlist' // LORAMER_NATIVE_AUTH_ALLOWLIST_V1 — invite-only gate
import { supabaseAdmin } from '@/lib/supabase'

declare module 'next-auth' {
  interface Session extends DefaultSession {
    accessToken?: string
    refreshToken?: string
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: 'openid email profile https://www.googleapis.com/auth/adwords',
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    }),
    CredentialsProvider({
      id: 'reviewer-token',
      name: 'Reviewer Token',
      credentials: { token: { label: 'Token', type: 'password' } },
      async authorize(credentials) {
        const expected = process.env.REVIEWER_LOGIN_TOKEN
        if (!expected || !credentials?.token) return null
        if (credentials.token !== expected) return null
        return { id: 'shopify-reviewer', email: 'shopify-reviewer@loramer.app', name: 'Shopify Reviewer' }
      },
    }),
    // LORAMER_SHOPIFY_INSTALL_V1
    // Used by /install/complete after a Shopify-initiated install completes
    // server-side. The /api/shopify/callback route signs a short-lived JWT
    // and redirects to /install/complete?token=<jwt>, which calls
    // signIn('shopify-install', { token }) to create the session.
    CredentialsProvider({
      id: 'shopify-install',
      name: 'Shopify Install',
      credentials: { token: { label: 'Token', type: 'text' } },
      async authorize(credentials) {
        const payload = verifyInstallToken(credentials?.token)
        if (!payload) return null
        return {
          id: 'shopify-install:' + payload.userEmail,
          email: payload.userEmail,
          name: payload.userEmail,
        }
      },
    }),
    // LORAMER_NATIVE_AUTH_V1 — email/password login. Same {id,email,name} shape as the two providers
    // above, so a native session is byte-identical downstream (session.user.email drives everything).
    // Verify-only: it never CREATES a user (signup mints the credential); it looks up auth_credentials
    // and bcrypt-compares. Purely additive — Google/reviewer/shopify providers + callbacks are untouched.
    CredentialsProvider({
      id: 'password',
      name: 'Email and Password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = (credentials?.email || '').trim().toLowerCase()
        const password = credentials?.password || ''
        if (!email || !password) return null
        const { data, error } = await supabaseAdmin
          .from('auth_credentials')
          .select('password_hash')
          .eq('email', email)
          .maybeSingle()
        if (error || !data?.password_hash) return null
        const ok = await compare(password, data.password_hash as string)
        if (!ok) return null
        return { id: email, email, name: email }
      },
    }),
  ],
  callbacks: {
    // LORAMER_NATIVE_AUTH_ALLOWLIST_V1 — invite-only gate. ONLY Google is gated HERE, because Google's first
    // sign-in IS the signup (no separate route). reviewer-token / shopify-install / password ALWAYS pass:
    // reviewer + Shopify-install must never break, and a password login only reaches here if signup already
    // passed the same gate (/api/auth/signup). Returning a URL string blocks session issuance (the jwt/session
    // callbacks below never run for a rejected sign-in) and redirects to the invite-only screen.
    async signIn({ user, account }) {
      if (account?.provider === 'google') {
        const email = (user?.email || '').trim().toLowerCase()
        if (await isAllowed(email)) return true
        return '/request-access?email=' + encodeURIComponent(email)
      }
      return true
    },
    async jwt({ token, account, user }) {
      if (account) {
        token.accessToken = account.access_token
        token.refreshToken = account.refresh_token

        if (account.provider === 'google' && account.refresh_token && user?.email) {
          try {
            const row: Record<string, string | null> = {
              user_email: user.email,
              refresh_token: account.refresh_token,
              updated_at: new Date().toISOString(),
              expires_at: account.expires_at
                ? new Date(account.expires_at * 1000).toISOString()
                : null,
            }
            if (account.access_token) {
              row.access_token = account.access_token
            }

            const { error } = await supabaseAdmin
              .from('google_tokens')
              .upsert(row, { onConflict: 'user_email' })

            if (error) {
              console.error('[auth] failed to persist google refresh token:', error)
            }
          } catch (err) {
            console.error('[auth] failed to persist google refresh token:', err)
          }
        }
      }
      if (user?.email) { token.email = user.email }
      return token
    },
    async session({ session, token }) {
      session.refreshToken = token.refreshToken as string
      if (session.user && token.email) { session.user.email = token.email as string }
      return session
    },
  },
  pages: {
    signIn: '/',
    error: '/',
  },
}
