# pandoctl release runbook

The distributed command package lives in `packages/pandoctl` and is published as
`pandoctl`. Use the GitHub Actions workflow `Release pandoctl` for package
updates so every release runs the same verification gates.

## Dry Run

Run the workflow manually with `publish=false`.

The workflow performs:

- `pnpm install --frozen-lockfile`
- `pnpm verify`
- `pnpm build:pandoctl`
- `pnpm smoke:pandoctl-pack`
- `npm publish --dry-run` from `packages/pandoctl`

## Publish

Before publishing:

- Confirm `packages/pandoctl/package.json` has the intended version.
- Confirm repository secret `NPM_TOKEN` is configured for npm publish.
- Prefer running the workflow from the release branch or `main`.

Run the same workflow with `publish=true`. The publish step uses:

```bash
npm publish --provenance --access public
```

The workflow passes only `NODE_AUTH_TOKEN` from `secrets.NPM_TOKEN`; it never
prints the token value.

## User Update Command

After publish, users with a global install update with:

```bash
npm update -g pandoctl
```
