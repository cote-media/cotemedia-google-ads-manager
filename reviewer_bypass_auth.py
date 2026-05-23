#!/usr/bin/env python3
import os, sys
AUTH_PATH = os.path.expanduser("~/Downloads/cotemedia-ads-manager/src/lib/auth.ts")
MARKER = "LORAMER_REVIEWER_BYPASS_V1"

def fatal(msg):
    print("FATAL:", msg); sys.exit(1)

OLD_IMPORTS = """import { NextAuthOptions, DefaultSession } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'"""
NEW_IMPORTS = """import { NextAuthOptions, DefaultSession } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import CredentialsProvider from 'next-auth/providers/credentials' // LORAMER_REVIEWER_BYPASS_V1"""

OLD_PROVIDERS_END = """    GoogleProvider({
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
  ],"""
NEW_PROVIDERS_END = """    GoogleProvider({
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
  ],"""

OLD_JWT = """    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token
        token.refreshToken = account.refresh_token
      }
      return token
    },"""
NEW_JWT = """    async jwt({ token, account, user }) {
      if (account) {
        token.accessToken = account.access_token
        token.refreshToken = account.refresh_token
      }
      if (user?.email) { token.email = user.email }
      return token
    },"""

OLD_SESSION = """    async session({ session, token }) {
      session.refreshToken = token.refreshToken as string
      return session
    },"""
NEW_SESSION = """    async session({ session, token }) {
      session.refreshToken = token.refreshToken as string
      if (session.user && token.email) { session.user.email = token.email as string }
      return session
    },"""

def safe_replace(text, old, new, label):
    if new in text: print(f"skip: {label} already applied"); return text
    c = text.count(old)
    if c == 0: fatal(f"anchor missing: {label}")
    if c > 1: fatal(f"anchor matches {c} times: {label}")
    print(f"ok: {label}")
    return text.replace(old, new, 1)

def main():
    if not os.path.exists(AUTH_PATH): fatal("auth.ts not found")
    text = open(AUTH_PATH).read()
    if MARKER in text: print("Already applied. No-op."); return
    text = safe_replace(text, OLD_IMPORTS, NEW_IMPORTS, "import CredentialsProvider")
    text = safe_replace(text, OLD_PROVIDERS_END, NEW_PROVIDERS_END, "add provider")
    text = safe_replace(text, OLD_JWT, NEW_JWT, "update jwt callback")
    text = safe_replace(text, OLD_SESSION, NEW_SESSION, "update session callback")
    open(AUTH_PATH, "w").write(text)
    print("Auth patched.")

main()
