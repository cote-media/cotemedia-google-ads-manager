import { NextAuthOptions, DefaultSession } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import CredentialsProvider from 'next-auth/providers/credentials' // LORAMER_REVIEWER_BYPASS_V1
import { verifyInstallToken } from '@/lib/shopify-install-token' // LORAMER_SHOPIFY_INSTALL_V1
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
  ],
  callbacks: {
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
