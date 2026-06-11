# ADR-009: W5 대시보드는 Vite React SPA와 Hono API를 단일 daemon 배포 단위로 시작한다

- 상태: 승인 (2026-06-06)
- 근거: W5 착수 전 운영성 재검토

## 맥락

ADR-003에서 대시보드는 웹으로 확정했다. W5 진입 시점에는 더 구체적인 선택이 필요하다.

- Next.js / Astro / Vite React 중 무엇을 쓸 것인가
- TUI를 1차 클라이언트로 지원할 것인가
- Docker에서 web과 daemon을 분리할 것인가
- 대시보드가 처음부터 많은 기능을 가져야 하는가

W5의 목표는 공개 OSS로서 보기 좋은 운영 도구를 만드는 것이지만, 당장 중요한 것은 "작업을 맡기고 안전하게 관찰/중단/복구할 수 있음"이다.

## 결정

1. W5 API는 daemon process 안의 **Hono HTTP API**로 구현한다.

   - REST JSON v1로 시작한다.
   - GraphQL은 도입하지 않는다.
   - API가 단일 진실원이며, dashboard와 `agentctl`은 같은 API client를 사용한다.

2. W5 dashboard는 **Vite + React + TypeScript SPA**로 구현한다.

   - SSR, SEO, 파일 기반 라우팅이 필요 없으므로 Next.js를 쓰지 않는다.
   - content site가 아니므로 Astro를 쓰지 않는다.
   - dashboard build 산출물은 production에서 Hono가 static asset으로 서빙한다.
   - dev 모드에서는 Vite dev server와 daemon API를 분리해도 된다.
   - UI 기본값은 **shadcn/ui를 제한적으로 채택**한다. Vite React 지원이 있고 컴포넌트 소스가 repo 안에 생성되므로 공개 OSS에서 직접 소유·수정하기 좋다.
   - W5에서 허용하는 shadcn/ui 컴포넌트는 운영 화면에 필요한 primitive로 제한한다: `Button`, `Badge`, `Table`, `Tabs`, `Dialog`/`AlertDialog`, `DropdownMenu`, `Input`, `Textarea`, `Select`, `Tooltip`, `Skeleton`, `Sonner`.
   - W5에서는 `DataTable` 풀세트, chart, command palette, sidebar-heavy layout, 복잡한 form abstraction은 도입하지 않는다.

3. W5는 full-screen TUI를 만들지 않는다.

   - terminal 사용자는 `agentctl list/show/watch/retry/cancel/cleanup`으로 지원한다.
   - TUI는 머신 앞에 붙어 있어야 하므로 홈서버+모바일 운영 요구와 맞지 않는다.
   - 나중에 필요가 증명되면 W6 이후 별도 클라이언트로 추가한다.

4. Docker 기본 배포는 **단일 컨테이너**다.

   - 한 컨테이너 안에서 Node daemon, Hono API, static dashboard를 함께 실행한다.
   - SQLite는 `/data/pando.sqlite` 같은 volume에 둔다.
   - 대상 repo는 `/repos`, worktree는 `/worktrees`, config는 `/config`, skills는 `/skills`에 mount한다.
   - web/API split container는 W6 이후 실제 필요가 확인될 때만 검토한다.

5. W5 인증은 Tailscale/private network boundary에 의존한다.

   - public internet 노출은 금지한다.
   - 토큰 기반 auth, OIDC, multi-user 권한은 별도 ADR 전까지 구현하지 않는다.

## 이유

- W5 dashboard는 내부 운영툴이다. SSR과 SEO가 없고, 첫 화면은 job table/detail/action이다.
- Hono + Vite React는 Node 22/pnpm 기반 현재 repo에 가장 작게 붙는다.
- API와 static dashboard가 same-origin이면 CORS/auth/session 복잡도를 피할 수 있다.
- `agentctl`을 API client로 만들면 CLI와 웹의 동작 차이를 줄일 수 있다.
- 단일 컨테이너는 SQLite, child process worker, worktree mount, dashboard serving을 한 lifecycle로 묶어 운영 부담을 낮춘다.
- shadcn/ui는 완성형 디자인 시스템을 강제로 끌고 오는 대신 필요한 컴포넌트 소스만 repo에 소유하게 해준다. 다만 Tailwind/shadcn 설정 비용이 생기므로 W5에서는 job 운영 UI에 직접 필요한 primitive만 추가한다.

## 결과

- W5 구현 순서는 API contract → CLI client → minimal dashboard 순서다.
- dashboard 첫 버전은 list/detail/actions/brief submit/health만 제공한다.
- Docker 작업은 single-container skeleton과 volume contract까지만 한다.
- W6 후보:
  - richer dashboard analytics
  - full-screen TUI
  - split web/API containers
  - public auth
  - notification bot
  - GitHub Issue/Jira write-back UI

## 검증 기준

- API response schema는 테스트로 고정한다.
- dashboard는 API mock 기반 component/unit test와 최소 browser smoke만 둔다.
- Vitest는 dashboard PR에서 바로 구성한다. API contract, shared API client, React component test를 Vitest로 검증한다.
- Playwright는 dashboard 화면이 실제로 생긴 PR에서 browser smoke 1개만 둔다. 대상은 jobs list 로딩, job detail 진입, retry/cancel/cleanup 중 하나의 mock action, health strip 표시까지다.
- Full Playwright regression suite와 cross-browser matrix는 W6 이후 실제 필요가 확인될 때 추가한다.
- Docker는 image build와 health endpoint smoke를 우선한다.
- 실제 Claude/Codex live smoke는 dashboard 완성 조건이 아니라 W5 운영 smoke로 별도 수행한다.
