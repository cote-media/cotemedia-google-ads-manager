#!/usr/bin/env node
// LORAMER_GOOGLE_DELETE_JOB_V1 — DISPATCH THE DATABASE BACKUP FROM THE EXECUTOR, NEVER FROM RUSS (Russ, 2026-09-21: "never ask
// Russ to dispatch the backup: use the git credential you push with, via the GitHub API").
//   node scripts/dispatch-backup.mjs
// Needs: the push credential in the macOS keychain with the `workflow` scope (measured 2026-09-21: oauth token, scopes
// read:user, repo, user:email, workflow — dispatch HTTP 204). No gh CLI, no token file, nothing printed but HTTP status.
import { execSync } from 'node:child_process'
const out = execSync('git credential fill', { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' })
const token = (out.split('\n').find((l) => l.startsWith('password=')) || '').slice('password='.length)
if (!token) { console.log('no github credential in the keychain'); process.exit(2) }
const H = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'loramer-backup-dispatch' }
const who = await fetch('https://api.github.com/user', { headers: H })
console.log(`identity: HTTP ${who.status} · token-type: ${token.startsWith('ghp_') ? 'classic PAT' : token.startsWith('github_pat_') ? 'fine-grained PAT' : token.startsWith('gho_') ? 'oauth' : 'other'} · scopes: ${who.headers.get('x-oauth-scopes') ?? '(none reported — fine-grained or app token)'}`)
const r = await fetch('https://api.github.com/repos/cote-media/cotemedia-google-ads-manager/actions/workflows/db-backup.yml/dispatches', { method: 'POST', headers: H, body: JSON.stringify({ ref: 'main' }) })
console.log(`dispatch: HTTP ${r.status} ${r.status === 204 ? 'ACCEPTED' : (await r.text()).slice(0, 300)}`)
if (r.status === 204) {
  await new Promise((s) => setTimeout(s, 8000))
  const runs = await fetch('https://api.github.com/repos/cote-media/cotemedia-google-ads-manager/actions/workflows/db-backup.yml/runs?per_page=1', { headers: H })
  const j = await runs.json(); const run = j.workflow_runs?.[0]
  console.log(run ? `newest run: #${run.run_number} ${run.status}/${run.conclusion ?? 'pending'} ${run.html_url}` : 'no run listed yet')
}
