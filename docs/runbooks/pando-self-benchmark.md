# Pando self-benchmark inspection

Use this note after a local daemon self-benchmark run to find the run artifacts,
read stage durations, and confirm whether the PR stage produced a Draft PR.

## Artifact locations

Local daemon run roots, structured evidence JSON, temporary databases, and
worktree evidence are commonly written under `/tmp`. Typical paths include
`/tmp/pando-local-<timestamp>/`, `/tmp/pando-full-daemon-smoke-<run-id>/`, and
per-job evidence directories under those roots.

Keep these files outside the repository. They are local inspection evidence, not
source artifacts.

## Stage durations

Read stage duration data from daemon event payloads. The source of truth is the
payload on `stage-completed` and `stage-failed` events recorded in the local
evidence JSON or daemon database.

Do not use worker log prose or LLM output text as duration evidence. Those
streams are useful for human debugging context, but duration inspection must use
the structured daemon event payloads.

## Draft PR check

After the PR stage, check the branch directly:

```bash
gh pr list --head <branch>
```

If the command returns a PR, inspect that PR to confirm its Draft state. If it
returns no rows, the PR stage did not leave a visible PR for that branch.
