# ADR-005: 레포 환경 컨텍스트는 선언적 프로파일 + 자동 감지로 격리한다

- 상태: 승인 (2026-06-06)
- 근거: W1 실측 + 아키텍처 평가 (docs/w1-runbook.md, docs/handoff.md)

## 맥락

멀티레포 오케스트레이터는 레포마다 환경이 다르다 (web = yarn@1 / jira / acme-conventions, personal-site = brief / repo-local). W1과 평가에서 두 가지 누수가 드러났다:

- `RepoProfile.setup`/`gates`에 패키지 매니저가 명령 문자열로 박혀 있고(`"pnpm install"`, `"pnpm test"`), web은 실제 yarn이라 틀렸다. `01-worktree.sh`도 pnpm 하드코딩이었다 → lockfile 감지로 고쳐서 W1 통과.
- `stages.yaml`이 전역 고정이라 SPEC 단계가 `workItemSource`(jira/brief)로 분기하지 않는다. brief 레포(personal-site)에 jira 경로(jira-context-gatherer + MCP)가 샐 수 있다.

계약(`RepoProfile`)은 scope/source/contextProviders/conventions를 레포별로 선언하지만, **런타임이 이를 강제하지 않으면 새 레포가 "web처럼" 돌아버린다.**

## 결정

1. **패키지 매니저는 lockfile 자동 감지를 1급으로 한다** — `yarn.lock` → `pnpm-lock.yaml` → `package-lock.json` 순. `RepoProfile`의 setup/gates는 PM-agnostic 동작(install/test/lint/typecheck)으로 표현하고 데몬이 감지된 PM으로 치환한다. 명시 `packageManager` 필드는 감지 실패 시 fallback으로만 둔다.
2. **SPEC 단계는 `workItemSource`로 분기한다** — jira → jira-context-gatherer(+MCP), brief → intake 산출물. `contextProviders`가 비면 MCP 경로를 타지 않는다. stages.yaml 레포별 오버라이드를 brief 경로(W3) 전에 도입.
3. **profile 미스매치는 fail-fast** — brief 레포에서 jira 스킬 호출, providers 없는데 MCP 도구 요구 등은 즉시 `{stage, reason, evidence}` 실패로 보고(침묵 금지, CLAUDE.md 규율 7). profile은 "주입만 하고 무시"하지 않는다.

## 결과

- 새 레포 추가 = `repos.yaml` 한 항목 + (필요 시) PM 명시. 환경 명령을 일일이 정확히 적을 필요가 줄어 오설정 리스크 감소.
- `config/repos.yaml`은 `install/test/lint/typecheck` 같은 PM-agnostic action으로 정리됐다.
- W2의 worktree manager / stage runner가 이 결정을 구현했고, `scripts/04-gates.sh`도 lockfile 감지 기반 게이트로 정리됐다. 계약 변경(`RepoProfile`에 `packageManager?` 추가)의 근거는 본 ADR.
