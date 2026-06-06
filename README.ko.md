# pando

[English](./README.md) | 한국어

> 멀티 레포 백그라운드 코딩 에이전트 오케스트레이터 — **하나의 뿌리 시스템, 여러 줄기.**

[Pando](https://en.wikipedia.org/wiki/Pando_(tree))는 약 47,000개의 줄기가 하나의 뿌리 시스템을 공유하는, 지구에서 가장 큰 단일 생명체로 알려진 사시나무 클론입니다. 이 프로젝트도 같은 구조를 따릅니다. 하나의 오케스트레이터(뿌리)가 여러 레포에 git worktree(줄기)를 만들고, 코딩 에이전트가 각 줄기에서 티켓을 구현합니다.

## 하는 일

Jira 티켓 또는 채팅에서 작성한 brief를 넣으면 다음 파이프라인을 실행합니다.

```text
SPEC -> PLAN -> TEST -> IMPL <-> REVIEW -> PR (draft)
```

각 단계는 격리된 git worktree 안에서 실행되며, Claude Code 또는 Codex 같은 코딩 에이전트 CLI가 작업합니다. 단계 사이의 게이트는 **결정적 신호만** 사용해 판정합니다. exit code, 파일 아티팩트, checksum처럼 검증 가능한 신호만 믿고, 에이전트가 "완료"라고 말하는 텍스트는 신뢰하지 않습니다.

여러 레포와 여러 티켓을 동시에 처리할 수 있으며, 레포별 profile을 통해 회사 레포(Jira/Confluence/Figma 기반)와 개인 레포(brief 기반)를 구분합니다.

## 상태

초기 구현 단계입니다. 단일 명령 로컬 실행(`pando start`)으로 daemon과 dashboard를 띄울 수 있고, dashboard/API의 인라인 자연어 brief 입력도 사용할 수 있으며, pando 자기 자신을 대상으로 한 brief 기반 self-dogfood도 동작합니다. Host worker smoke와 host full-daemon dogfood는 통과했고, Docker worker readiness는 CLI/auth/git evidence로 좁혔습니다. 남은 roadmap 항목은 실제 `pandoctl` npm 배포입니다. 자세한 설계 문서는 [docs/](./docs)를 참고하세요.

- [research-v1.md](./docs/research-v1.md) — 도구와 패턴 리서치
- [design-v2-multi-repo.md](./docs/design-v2-multi-repo.md) — 재사용 가능한 agent-skill 자산 기반 n x n 설계
- [repo-structure.md](./docs/repo-structure.md) — 레포 구조와 핵심 인터페이스
- [engineering-standards.md](./docs/engineering-standards.md) — 개발 방법론
- [adr/](./docs/adr) — 아키텍처 결정 기록

## 로컬 실행

> 전체 환경 변수와 명령 레퍼런스: [docs/runbooks/local-pando-runner.md](./docs/runbooks/local-pando-runner.md)

**현재 worker 기대값:** 기본 stage config는 Claude Code를 사용합니다. PR 생성 단계에는 `gh`가 필요합니다. evidence 파일과 임시 DB는 repo 내부가 아니라 `/tmp` 아래에 둡니다.

### 준비

```bash
pnpm install
```

필요한 CLI: `claude`(Claude Code), `gh`, `git`. `gh auth status`가 통과해야 하고 Claude auth가 준비되어 있어야 합니다.

### daemon/dashboard 시작

한 번의 명령으로 `/tmp` run root 아래에 로컬 DB, worktree root, config, dashboard, daemon을 함께 띄웁니다.

```bash
pnpm pando start            # 또는 `pnpm link --global` 후 `pando start`
```

dashboard URL(`http://127.0.0.1:3210/dashboard`), DB 경로, worktree root, 종료/정리 방법을 로그로 출력합니다. 환경 변수를 직접 제어하려면 [runbook](./docs/runbooks/local-pando-runner.md)의 "Start local pando (manual env path)" 섹션을 참고하세요.

### brief job 제출

일반 경로는 dashboard의 인라인 brief form입니다. 자연어 요청과 선택적인 spec/doc/asset reference를 입력하면 pando가 repo 밖에 canonical `brief.md`를 materialize한 뒤 queue에 넣습니다. brief 파일 경로를 직접 넘기는 방식은 advanced/operator 경로로 남아 있으며, 자세한 내용은 [runbook](./docs/runbooks/local-pando-runner.md)의 "Submit a brief" 섹션을 참고하세요.

### 상태 확인과 종료

운영 CLI 이름은 **`pandoctl`** 입니다 ([npm](https://www.npmjs.com/package/pandoctl)에 예약 — 맨 이름 `pando`는 이미 선점됨, [ADR-010](./docs/adr/010-cli-name-pandoctl.md) 참고). `pandoctl` bin은 운영 CLI에 연결되고, 위의 `pando start`는 별개의 daemon 부트스트랩 명령입니다. 아래는 모두 같은 진입점입니다.

```bash
pnpm pandoctl list          # package script (실행 중인 daemon에 붙으려면 앞에 PANDO_API_URL=... 를 붙인다)
pandoctl list               # `pnpm link --global` / `npm i -g .` 후 전역 bin
pnpm pandoctl show <id>
```

전체 env var prefix는 runbook을 참고하세요. 종료는 `pando start`(또는 `pnpm start`) 프로세스에서 **Ctrl-C**를 누릅니다. 임시 산출물은 `/tmp` 아래에 생성되며 실행 후 삭제할 수 있습니다.

## 개발

```bash
pnpm install
pnpm verify   # coverage + lint + types, every commit requires this
```

구현 코드는 실패하는 테스트를 먼저 작성한 뒤에 작성합니다(RED-GREEN-REFACTOR). 커밋은 atomic하게 유지하고, 아키텍처 결정은 ADR로 남깁니다. 자세한 규칙은 [CLAUDE.md](./CLAUDE.md)를 참고하세요.

## 브랜치와 릴리즈

이 레포는 Git Flow를 사용합니다.

- `main`: 보호된 릴리즈 브랜치
- `develop`: 통합 브랜치
- `feature/*`, `release/*`, `hotfix/*`: 작업 브랜치
- 릴리즈 태그는 `v` prefix 없이 작성합니다. 예: `0.1`

커밋 메시지는 영어로 작성합니다. 모든 커밋 전 `pnpm verify`를 실행하세요.
