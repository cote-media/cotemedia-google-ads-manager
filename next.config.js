/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: true,
    // ⛔ LORAMER_GOOGLE_ADS_UNIVERSE_RUNNER_V1 — THE ARTIFACT MUST BE IN THE SERVERLESS BUNDLE.
    // `loadUniverse()` does a runtime `readFileSync(resolve(root, 'docs/google-ads-capture-universe.json'))`
    // and NEXT'S FILE TRACER CANNOT SEE A COMPUTED PATH. The file is in git, in the repo, and on disk locally,
    // so it works in dev, in `next build`, and in every guard — and it is simply ABSENT from the function.
    // MEASURED IN PRODUCTION 2026-08-03 on the first dry run:
    //   ⨯ Error: ENOENT: no such file or directory, open '/var/task/docs/google-ads-capture-universe.json'
    // ⛔ BOTH ROUTES, NOT ONE. The starter hit it first because it is the one we called; the CONSUMER calls
    // loadUniverse() on EVERY message and would have hit the identical ENOENT on every delivery — which would
    // have presented as an endless retry loop rather than as a missing file.
    // Keys are route globs; values are globs resolved from the project root (Next.js Output File Tracing).
    outputFileTracingIncludes: {
      '/api/backfill/universe-start': ['./docs/google-ads-capture-universe.json'],
      '/api/queues/google-ads-universe': ['./docs/google-ads-capture-universe.json'],
    },
  },
}

module.exports = nextConfig
