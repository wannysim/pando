# pandoctl release runbook

The distributed command package lives in `packages/pandoctl` and is published as
`pandoctl`. Use the GitHub Actions workflow `Release pandoctl` for package
updates so every release runs the same verification gates.

## Dry Run

Run the workflow manually with `publish=false`.

The workflow performs:

- `bun install --frozen-lockfile`
- `bun run verify`
- `bun run build:pandoctl`
- `bun run smoke:pandoctl-pack`
- `npm publish --dry-run` from `packages/pandoctl`

## Publish

Authentication uses npm **trusted publishing (OIDC)** — no `NPM_TOKEN` secret is
involved. The npm `pandoctl` package must list this repo's
`pandoctl-release.yml` workflow as a trusted publisher (npm package → Settings →
Trusted Publisher: GitHub Actions, `wannysim/pando`, `pandoctl-release.yml`).

Before publishing:

- Confirm `packages/pandoctl/package.json` has the intended version (npm rejects
  a republish of an existing version).
- Confirm the trusted publisher is still registered on the npm package.

Run the workflow with `publish=true`. The publish step uses:

```bash
npm publish --access public
```

The job upgrades npm to a version that supports OIDC (`npm install -g
npm@latest`) and authenticates via `id-token: write`; provenance is attached
automatically. No token is read or printed.

## User Update Command

After publish, users with a global install update with:

```bash
npm update -g pandoctl
```

## Release Log

- **0.1.0** (2026-06-17) — first real publish over the reserved `0.0.1`
  placeholder. Workflow run `27707613701` (ref `ci/pandoctl-trusted-publishing`)
  green through verify → build → pack-smoke → publish via OIDC. Verified
  `npm view pandoctl version` → `0.1.0`, `dist-tags.latest` → `0.1.0`, and a
  clean temp-dir `npm i pandoctl@0.1.0` + `pandoctl --help` (exit 0).
