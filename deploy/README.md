# Docker Deployment

This is the W5 single-container skeleton. One container owns the Node daemon process, Hono API, static dashboard assets, and SQLite file.

## Mount Contract

- SQLite: `/data/pando.sqlite`
- Target repositories: `/repos`
- Worktrees: `/worktrees`
- Runtime config: `/config`
- Skills: `/skills`
- HTTP port: `3210`

The compose default keeps `PANDO_GLOBAL_CONCURRENCY=2` so first live smoke runs stay inside the W5 cap of 2-3 jobs. Raise it only after the two-job smoke evidence is recorded.

## Run

```bash
docker compose -f deploy/docker-compose.yml up --build
```

Dashboard assets are served from `/dashboard`; API routes such as `/health` and `/jobs` remain JSON routes on the same origin.
