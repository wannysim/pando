# ADR-011: base branch는 고정값이 아니라 결정적 resolver로 동적 결정한다

- 상태: 승인 (2026-06-07)
- 근거: W2 설계 입력 "base branch 동적 결정" (docs/handoff.md 남은 작업 #9), Git Flow 릴리즈 규칙 (CLAUDE.md)

## 맥락

지금까지 `RepoProfile.baseBranch`는 레포당 고정값(예: `develop`)이었고, worktree provisioner가 항상 그 값에서 분기했다(`origin/{baseBranch}`). 하지만 실제 운영에서는 한 레포 안에서도 작업마다 base branch가 달라야 한다.

- CLAUDE.md Git/릴리즈 규칙상 릴리즈는 `release/*` 브랜치에서 안정화한다. 특정 릴리즈에 들어갈 Jira 티켓은 `develop`이 아니라 해당 `release/*`에서 분기해 작업해야 한다.
- Jira 티켓은 `fixVersion`(예: `1.0`)으로 어느 릴리즈에 속하는지를 이미 들고 있다. 이 값을 base branch 결정에 쓰면 운영자가 매번 손으로 브랜치를 지정하지 않아도 된다.
- 그래도 예외는 필요하다. 핫픽스나 일회성 작업은 운영자가 base branch를 직접 못 박을 수 있어야 한다.

`baseBranch`가 고정값이라는 것은 기존 문서화된 결정(repo-structure.md §3 계약)이므로, 이를 바꾸려면 새 ADR이 필요하다.

## 결정

1. **base branch는 결정적 resolver(`src/core/base-branch.ts`)로 계산한다.** resolver는 순수 함수다 — I/O 없음. LLM 출력이 아니라 계약 필드만 읽는다(CLAUDE.md 규율 4·5).

2. **우선순위(높은 순):**

   1. `WorkItem.baseBranch` — 작업별 명시 override. 핫픽스/일회성용.
   2. Jira `fixVersion` → `RepoProfile.releaseBranchTemplate` 렌더 — 예: 템플릿 `release/{fixVersion}`, fixVersion `1.0` → `release/1.0`.
   3. `RepoProfile.baseBranch` — 기존 고정 기본값. 위 두 규칙이 비면 동작이 그대로 유지된다(하위 호환).

3. **fixVersion→release 매핑 규칙은 RepoProfile별로 설정 가능하다.** `release_branch_template`(snake_case YAML)이 없으면 fixVersion이 있어도 매핑하지 않는다. 토큰은 `{fixVersion}` 하나로 시작한다(YAGNI — 더 복잡한 표현식은 필요해질 때 추가).

4. **malformed 입력은 조용히 다음 규칙으로 떨어진다.** 비거나 공백뿐인 override/fixVersion은 무시하고 다음 우선순위를 평가한다. 비-Jira WorkItem(brief/github_issue)은 템플릿이 있어도 fixVersion 매핑을 타지 않는다. resolver는 항상 문자열 base branch 하나를 돌려준다(침묵 실패 없음).

5. **fixVersion 적재는 intake adapter의 책임이다.** Jira 티켓의 fixVersion을 `WorkItem.payload.fixVersion`으로 정규화하는 일은 `src/intake`/CLI 같은 adapter 계층에서 한다. core resolver는 이미 정규화된 계약만 본다.

6. **worktree provisioner는 resolver 결과에서 분기한다.** `worktree-provisioner.ts`는 더 이상 `profile.baseBranch`를 직접 쓰지 않고 `resolveBaseBranch({ item, profile })`를 호출해 `ensureWorktree`에 넘긴다.

## 결과

- `WorkItem`에 optional `baseBranch`가, `RepoProfile`에 optional `releaseBranchTemplate`가 추가된다. 둘 다 없으면 기존 고정 base branch 동작과 동일하다.
- `release_branch_template`을 설정하지 않은 레포는 영향이 없다 — 순수 하위 호환.
- 결정표(override / fixVersion-match / no-template / no-fixVersion / malformed / 비-Jira)는 전수 테스트한다(core 95%+, Beyoncé Rule).
- Jira fixVersion 정규화 adapter와 GitHub Issue 기반 라우팅은 필요해질 때 같은 resolver 위에 얹는다.
