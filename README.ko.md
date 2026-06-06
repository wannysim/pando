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

설계 단계입니다. 자세한 설계 문서는 [docs/](./docs)를 참고하세요.

- [research-v1.md](./docs/research-v1.md) — 도구와 패턴 리서치
- [design-v2-multi-repo.md](./docs/design-v2-multi-repo.md) — 재사용 가능한 agent-skill 자산 기반 n x n 설계
- [repo-structure.md](./docs/repo-structure.md) — 레포 구조와 핵심 인터페이스
- [engineering-standards.md](./docs/engineering-standards.md) — 개발 방법론
- [adr/](./docs/adr) — 아키텍처 결정 기록

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
