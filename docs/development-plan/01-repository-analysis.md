# 01 — 레포지토리 분석

> 작성일: 2026-06-12 · 분석 기준: branch `fix/plain-bun-test-dashboard`, version 0.2.0
> 이 문서는 현재 상태의 사실 기록이다. 평가는 [02-architecture-assessment.md](./02-architecture-assessment.md)에 있다.

---

## 1. 레포 목적

pando는 **멀티 레포 백그라운드 코딩 에이전트 오케스트레이터**다. 하나의 로컬 데몬이:

1. Jira 티켓(회사 레포) 또는 brief(개인 레포)를 WorkItem으로 받아,
2. 대상 레포에 `origin/{base}`에서 직접 분기한 git worktree를 만들고 (원본 작업 트리 불가침),
3. 코딩 에이전트 CLI(`codex exec --json` 기본, `claude -p` 레거시)를 헤드리스 워커로 부려,
4. `QUEUED → SPEC → PLAN → TEST → IMPL ⇄ REVIEW → PR(draft) → DONE` 파이프라인을 돌리고,
5. 모든 단계 전이를 **결정적 게이트**(exit code, 파일 아티팩트, 체크섬, 구조화 JSON — LLM 출력 텍스트 금지)로 판정한다.

사용자는 단일 운영자(저자)이며, Tailscale 사설망 안에서만 동작한다 (공개 인증 의도적 미구현).

## 2. 문서에서 추론한 제품 비전

- **루프 철학**: 모호함 해소는 파이프라인 진입 전(intake)에 끝낸다. `[Blocker]` open question은 결정적으로 `ESCALATED`. 각 단계는 파일 아티팩트(`_spec.md`, `PLAN.md`)만 읽는다 — 인메모리 컨텍스트 전달 없음.
- **reward-hacking 방어**: 테스트 파일 체크섬 불변성 게이트, diff-rules 게이트, REVIEW는 IMPL과 **다른 모델** 강제(ADR-002), null-agent e2e(아무것도 안 하는 엔진은 모든 게이트에서 떨어져야 함).
- **개인 레포 = 실험장**: 검증된 설정만 회사 레포에 적용 (design-v2 §8).
- **유보 항목** (W6 큐 종결 전 착수 금지): notifications, GitHub Issue/Jira write-back, 공개 auth, Docker egress, split containers, TUI.
- **장기**: GitHub Issue intake 어댑터(타입만 존재), Stacked PR 자동화(ADR-007), `depends_on` DAG 스케줄링(필드만 설계됨), 멀티 머신(새 ADR 필요).

## 3. 현재 사용자/개발자 워크플로우

```bash
# 운영자 (사용)
bun run pando start                 # /tmp/pando-local-<ts> run-root, API+대시보드 :3210, 데몬 on
# 대시보드 inline brief 폼 또는:
pandoctl submit brief --repo personal-site --id <id>
pandoctl show <jobId> / list / watch / retry / cancel / cleanup
pandoctl gc [--force]               # ADR-012 run-root 리퍼

# 개발자 (기여)
# develop에서 topic branch → TDD(RED-GREEN-REFACTOR) → bun run verify → squash-merge PR
bun run verify   # coverage(+check-coverage) → oxlint → tsc → dashboard verify
```

## 4. 모듈과 책임

| 모듈 | 책임 | 핵심 파일 (LOC) |
|---|---|---|
| `src/core/` (순수) | 계약 타입, 상태머신, 설정 파서, 아티팩트 스키마, base-branch resolver, run-GC 플래너 | `types.ts`(123) `state-machine.ts`(92) `config.ts`(361) `stage-config.ts`(195) `artifacts.ts`(281) `base-branch.ts`(48) `run-gc.ts`(47) |
| `src/pipeline/` (순수) | 단계 실행 루프 + 게이트들 | `runner.ts`(451), `gates/`: exit-code(79) artifact-schema(62) checksum(161) diff-rules(200) pr-draft(54) draft-pr(151) |
| `src/scheduler/` (순수) | 3계층 세마포어 admission, provider 실패 분류/백오프 | `scheduler.ts`(109) `semaphore.ts`(31) `retry-policy.ts`(124) |
| `src/engines/` | claude-code(`execFile`) / codex(`spawn`+JSONL 파서) 어댑터 | `claude-code.ts`(120) `codex.ts`(217) |
| `src/db/` | better-sqlite3/bun:sqlite 래퍼, runnable claim의 단일 진실원, events 텔레메트리 | `index.ts`(736) `schema.sql`(51) |
| `src/worktree/` | worktree 생성/재사용/정리, `.dispatch.lock`, run manifest | `manager.ts`(192) `run-manifest.ts`(65) |
| `src/daemon/` | tick 루프, 취소 처리, 텔레메트리 persistence hook, 로컬 런타임 와이어링, smoke/soak/benchmark 하니스, failure analytics | `loop.ts`(349) `local-runtime.ts`(382) `failure-analytics.ts`(374) `full-daemon-smoke.ts`(591) 외 |
| `src/api/` | Hono 라우트(`/health /jobs /analytics /briefs ...`), DTO 매퍼, 타입드 클라이언트, 정적 대시보드 서빙 | `app.ts`(528) `schema.ts`(261) `client.ts`(178) |
| `src/intake/` | brief 템플릿/파싱/검증, Jira→WorkItem 매핑(fixVersion 라우팅) | `brief.ts`(320) `jira.ts`(46) |
| `src/cli/` | `pandoctl`(라우터) / `pando start` / `agentctl`(ops) / `pando gc` | `agentctl.ts`(647) `pando.ts`(293) `pando-gc.ts`(216) |
| `src/git/` | diff/checksum 수집 (게이트에 공급) | `inspector.ts`(142) |
| `dashboard/` | Vite React 19 SPA. **`App.tsx` 단일 파일 1,267줄**, 폴링 4s, 서버 타입을 워크스페이스 경계 넘어 직접 import | `src/App.tsx` `src/styles.css`(1,185) `src/lib/timeline.ts` |
| `config/` | `repos.yaml`(RepoProfile 3개) `stages.yaml`(전 단계 codex/gpt-5.5, retry_budget 10, timeout 30m) `orchestrator.yaml`(global 6, provider caps) | |

## 5. 중요 명령·스크립트·컨벤션

- **검증**: `bun run verify` = coverage(85% 전역) → oxlint → tsc → dashboard(test:ci+types+build). CI(`ci.yml`)는 동일 명령 + self-benchmark + PR 코멘트.
- **smoke 군**: `smoke:two-job`(readiness/live/fake), `smoke:full-daemon`(contract/live, 실제 `runDaemonOnce`), `soak:nightly`, `benchmark:self`, `smoke:pandoctl-pack`. 전부 `/tmp` 아래 schemaVersion 있는 구조화 JSON 증거를 남긴다.
- **경로 규약**: worktree = `${WORKTREE_ROOT:-~/.worktrees}/{repo}/{branch-slug}` (`.ai-skills` worktree-dispatch §1 호환, ADR-006). run manifest = `~/.pando/runs.json`.
- **텔레메트리 규약**: 별도 테이블 없이 `events.payload_json`에 `{durationMs, costUsd, engine, model, failureKind, reason, evidence, gateName}` (repo-structure §3).
- **언어**: 커밋/PR/릴리즈 노트 영어, `docs/` 한글 허용. 실 회사 식별자(티켓 키 등) 커밋 금지(ADR-008).
- **Git**: develop 기점 topic branch, squash-merge; release/*→main은 merge commit; 태그 `v` 없음.

## 6. 현재 진행 상태 (docs/README.md Active W6 Queue)

7개 중 6개 완료. **유일한 미결: `pandoctl@0.1.0` npm publish** (release workflow dry-run → publish → global install smoke). 이 계획의 M0이 이 항목의 종결이다.
