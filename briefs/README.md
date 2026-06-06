# briefs/ — 개인 프로젝트 기획 인박스

Jira가 없는 레포(`work_item_source: brief`)의 작업 입력. 채팅으로 구술한 기획을 intake가 이 템플릿으로 정리해 저장하면 파이프라인이 Jira 티켓과 동일하게 처리한다 (docs/design-v2-multi-repo.md §2.2).

## 구조

```
briefs/
└── {id}/                  # 예: personal-site-20260606-a
    ├── brief.md           # 아래 템플릿
    └── assets/            # 스크린샷, 레퍼런스 이미지 (선택)
```

## brief.md 템플릿

```markdown
# {제목}

> repo: personal-site
> 생성: {ISO timestamp}

## 목표
(한 문단 — 왜 만드는가)

## 요구사항 요약
- (bullet 3~7개)

## 화면·동작 묘사
(말로 전달한 디자인. assets/ 이미지 참조 가능)

## 수용 기준
- [ ] ...

## 비범위
- (이번에 안 하는 것)

## 모호한 지점
- (intake에서 해소 못 한 것 — 파이프라인이 Open Questions로 이월)
```

원칙: 모호함 해소는 **파이프라인 진입 전**(intake 대화)에 끝낸다. brief가 엉성하면 IMPL retry budget으로 비용을 치르게 된다.
