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
      // LORAMER_UNIVERSE_RESUMER_V1 — the resumer enumerates the CATALOG as its denominator (owed-ness is
      // derived per entry, never read from a list), so it reads the artifact at runtime. Without this entry
      // it ENOENTs on Vercel while passing every local check — which is how it shipped broken once already.
      // `universe-runner.guard.mjs` leg (d) caught this within minutes of the route existing.
      '/api/cron/universe-resume': ['./docs/google-ads-capture-universe.json'],
      // LORAMER_SINGLE_SURFACE_DRIVE_V1 — the drive resolves ONE catalog entry by (resource, segment) and so
      // reads the same artifact. Same ENOENT trap, same fix; `universe-runner.guard.mjs` leg (d) caught it
      // within minutes of this route existing, exactly as it caught the resumer.
      '/api/backfill/universe-drive': ['./docs/google-ads-capture-universe.json'],
    },
  },
}

module.exports = nextConfig
