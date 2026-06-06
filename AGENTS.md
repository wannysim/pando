# pando — agent instructions

See [CLAUDE.md](./CLAUDE.md) for the shared rules for all agents (enforced TDD, `pnpm verify`, layering boundaries, gate determinism, YAGNI). Note: CLAUDE.md and docs/ are written in Korean.

Critical workflow rules:

- Use the pinned package manager from `package.json` (`packageManager`) and run `pnpm verify` before every commit.
- Start all work from `develop` on a topic branch. Do not push directly to `main` or `develop`.
- Squash-merge feature and bugfix PRs into `develop`.
- Merge release PRs with merge commits when promoting `release/*` into `main`, then merge the release changes back into `develop`.
- Write git commit messages, PR titles, PR descriptions, and GitHub Release notes in English.
