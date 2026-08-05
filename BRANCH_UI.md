# `ui` — the permanent preview branch

⛔ **THIS BRANCH EXISTS TO HAVE A STABLE URL, AND THAT IS ITS WHOLE JOB.**

Vercel assigns every git branch a **stable alias** of the form
`{project}-git-{branch}-{user}.vercel.app` which does NOT change between deployments.
next-auth v4's deployment doc recommends exactly this for previews, because
"most OAuth providers only allow a single redirect/callback URL … you cannot use
wildcard subdomains" — so a per-deployment URL can never be registered, and a
per-branch one is registered ONCE and reused forever.

⇒ Every UI arc is developed on THIS branch, so the Google redirect URI and the
branch-scoped `NEXTAUTH_URL` are configured a single time and never touched again.

## ⛔ WHY THIS FILE EXISTS AT ALL — it is not a placeholder

Creating the branch was not enough. `ui` was first pushed at the same commit SHA that
`main` had already deployed, and **Vercel deduplicates by SHA**: *"If the SHA of a
commit was already deployed in the past, no new deployment is created."* The branch
existed on origin, Deployment Branches was correctly set to "All unassigned git
branches", nothing was misconfigured — and no preview was ever built, because there
was no NEW commit to build. This file is that commit.

**THE LESSON, worth more than the fix: a branch with no unique commit is invisible to
Vercel.** It looks like a deployment-settings problem and it is not one — the settings
were right the whole time.

## Do not merge this branch into `main`

It carries no product change. It is a permanent home for preview work.
