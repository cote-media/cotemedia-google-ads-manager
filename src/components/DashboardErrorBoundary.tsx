'use client'
// Error boundary that catches client-side exceptions and shows a recoverable
// error UI instead of the blank "Application error" white screen.
//
// This protects against partial data crashes that hit us repeatedly:
//   - "Cannot read properties of undefined (reading 'spend')"
//   - Stale data from a failed API request being read as if successful
//   - Anything else that throws inside a child component
//
// User sees the error, the relevant stack info goes to the browser console
// (and Vercel logs via window.onerror), and they can refresh or reset state.

import React from 'react'

type Props = { children: React.ReactNode }
type State = { hasError: boolean; error?: Error }

export class DashboardErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log to console for dev tools / Vercel
    console.error('Dashboard error boundary caught:', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined })
  }

  handleHardReset = () => {
    // Clear localStorage state that might be the cause of the crash
    if (typeof window !== 'undefined') {
      try {
        const keys = Object.keys(localStorage).filter(k => k.startsWith('loramer-'))
        keys.forEach(k => localStorage.removeItem(k))
      } catch {}
      window.location.href = '/dashboard'
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-paper flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-border rounded-xl p-6 shadow-card">
            <p className="font-mono text-xs text-muted uppercase tracking-widest mb-2">Something went wrong</p>
            <h1 className="font-display text-2xl text-ink mb-3">We hit a snag loading your dashboard</h1>
            <p className="text-sm text-muted mb-4">
              The page ran into an unexpected error. This usually clears with a refresh.
              If it keeps happening, the &ldquo;Reset and reload&rdquo; button below clears
              saved preferences and starts fresh.
            </p>
            {this.state.error?.message && (
              <details className="mb-4">
                <summary className="text-xs font-mono text-muted cursor-pointer hover:text-ink">
                  Technical details
                </summary>
                <pre className="text-xs font-mono text-muted mt-2 p-2 bg-surface rounded overflow-auto max-h-40">
                  {this.state.error.message}
                </pre>
              </details>
            )}
            <div className="flex flex-col gap-2">
              <button
                onClick={() => window.location.reload()}
                className="btn-primary text-sm"
              >
                Refresh page
              </button>
              <button
                onClick={this.handleHardReset}
                className="btn-secondary text-sm"
              >
                Reset and reload
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
