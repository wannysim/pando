# briefs/ - 개인 프로젝트 기획 인박스

Jira가 없는 레포(`intake.sources: [brief]`)의 작업 입력. 채팅으로 구술한 기획을 intake가 이 템플릿으로 정리해 저장하면 파이프라인이 Jira 티켓과 동일하게 처리한다 (docs/design-v2-multi-repo.md §2.2, ADR-008).

## 구조

```
briefs/
└── {id}/                  # 예: personal-site-20260606-a
    ├── brief.md           # 아래 템플릿
    └── assets/            # 스크린샷, 레퍼런스 이미지 (선택)
```

## brief.md 템플릿

```markdown
# Brief Title

> repo: personal-site
> created: {ISO timestamp}

## Goal

Why this work should exist.

## User Story

As a user, I want an outcome so that I receive value.

## Acceptance Criteria

- [ ] ...

## Screens or Behavior

Visible UI, workflow, or system behavior. Reference assets when useful.

## Non-Goals

- Work that is explicitly out of scope.

## Assets

- None

## Open Questions

- None
```

원칙: 모호함 해소는 **파이프라인 진입 전**(intake 대화)에 끝낸다. `Open Questions`에 `[Blocker]`가 있으면 SPEC/PLAN 진행 전 `ESCALATED`로 보내는 결정적 신호가 된다.
