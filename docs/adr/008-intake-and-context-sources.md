# ADR-008: RepoProfile은 intake source와 context source를 분리하고, 실제 회사 설정은 private config에 둔다

- 상태: 승인 (2026-06-06)
- 근거: W3 진입 전 사용자 운영 모델 정리

## 맥락

pando가 처리할 "할 일"은 레포마다 출처가 다르다. 회사 레포(`web`, `api`)는 Jira 티켓이 작업 단위이고, Confluence 정책 문서와 Figma 링크는 그 티켓을 해석하기 위한 맥락이다. 반면 개인 레포는 Jira/Confluence/Figma가 없을 수 있고, 사용자가 구두 설명을 주거나 GitHub Issue를 사용할 수 있다.

기존 설계의 `work_item_source: jira | brief`와 `context_providers`는 1차 구현에는 충분했지만, W3 이후에는 다음 구분이 필요하다.

- **intake source**: pando queue에 들어갈 WorkItem의 원천. 예: Jira, brief, GitHub Issue
- **context source/provider**: SPEC 단계가 WorkItem을 해석할 때 참조하는 보조 맥락. 예: Confluence 정책, Figma 디자인, brief assets

또한 이 repo는 public이므로 실제 회사 Jira project key, Confluence page id, Figma file/team 정보, 내부 URL을 커밋하면 안 된다.

## 결정

1. RepoProfile 설정은 `work_item_source` 단수에서 **복수 intake source** 구조로 확장한다.

   ```yaml
   intake:
     sources: [jira]
   ```

   개인 레포는 다음처럼 여러 source를 열 수 있다.

   ```yaml
   intake:
     sources: [brief, github_issue]
   ```

2. intake source와 context source/provider를 분리한다.

   ```yaml
   context:
     providers: [confluence, figma]
     policy_refs: []
   ```

   Jira/GitHub Issue/brief는 "무엇을 할지"를 만든다. Confluence/Figma/assets는 "어떻게 이해할지"를 보강한다.

3. W3 실제 구현 범위는 **brief only**로 제한한다. GitHub Issue는 타입/설정이 들어올 수 있는 형태로 설계하되 adapter 구현은 후순위로 둔다.

4. brief는 최소 스키마를 가진다.

   ```markdown
   # Brief

   ## Goal

   ## User Story

   ## Acceptance Criteria

   ## Screens or Behavior

   ## Non-Goals

   ## Assets

   ## Open Questions
   ```

   `Open Questions`에 `[Blocker]`가 있으면 PLAN 이전 또는 PLAN gate에서 `ESCALATED`로 보낸다.

5. pando SQLite는 실행 상태와 이벤트 로그의 source of truth다. Jira/GitHub Issue/brief는 WorkItem 원천이며, source system에 상태를 되돌려 쓰는 기능은 W4/W5로 미룬다.

6. public repo에는 실제 회사 context 설정을 커밋하지 않는다. public config에는 예시와 schema만 두고, 실제 운영값은 private local config에 둔다.

   ```text
   config/repos.yaml                  # public example/safe defaults only
   ~/.config/pando/repos.yaml         # private real repo config
   ~/.config/pando/context.yaml       # private company policy/context refs
   ```

## 결과

- W3는 `brief` intake loader/template부터 구현한다.
- `RepoProfile` 타입/loader는 하위 호환을 고려해 `work_item_source`를 읽되, 새 구조인 `intake.sources`와 `context.providers`로 이행한다.
- 회사 레포는 Jira를 intake source로, Confluence/Figma를 context source로 등록한다.
- 개인 레포는 brief를 기본 intake source로 사용하고, GitHub Issue adapter는 W3 이후 추가한다.
