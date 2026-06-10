# ADR-012: worktree run-root는 중앙 매니페스트 + `pando gc` 리퍼로 회수한다

- 상태: 승인 (2026-06-07)
- 근거: 로컬/스모크/소크 런이 `/tmp/pando-*`에 worktree+node_modules를 남겨 9.9GB까지 누적 (2026-06-07 관측)

## 맥락

`pando start`는 매 런마다 `/tmp/pando-local-<ts>` run-root를 만들고 그 아래 `worktrees/`에 git worktree를, 각 worktree에 node_modules를 깐다. 스모크/소크 스크립트도 같은 패턴으로 자체 run-root를 만든다. 그런데 **만드는 주체는 있어도 거둬들이는 주체가 없다.**

- 성공/실패와 무관하게 run-root가 남는다. 데몬이 정상 종료해도, kill·크래시되면 더더욱.
- worktree는 run-root가 아니라 **원본 repo의 `.git/worktrees/`에 등록**된다. 그래서 run-root를 `rm -rf`로 지우면 등록이 dangling으로 샌다 — `rm` ≠ `git worktree remove`/`prune`.
- 정리 작업이 현재는 **job 단위**(터미널 상태에서 per-job cleanup)로만 존재하고, **run-root 단위** 생명주기는 아무도 소유하지 않는다.

2026-06-07 기준 `/tmp/pando-*`가 총 9.9GB, 등록된 dangling worktree 23개까지 누적됐다. 손으로 치우려면 `git worktree remove --force` → `prune` → `rm -rf` 순서를 정확히 밟아야 해서 실수하기 쉽다.

진행 중인 `feat/pando-start-auto-cleanup`은 데몬이 정상 종료할 때 자기 worktree를 치우는 happy-path를 담당한다. 하지만 누수의 본질은 **크래시·kill·일회성 스크립트**에서 나오고, 그건 종료 훅으로 잡을 수 없다. 별도의 backstop이 필요하다.

## 결정

1. **중앙 run 매니페스트** — run-root 메타데이터를 run-root *밖*에 둔다. `${PANDO_HOME:-~/.pando}/runs.json`에 `{ id, runRoot, pid, startedAt, finishedAt?, cleanedAt? }` 레코드를 적재한다. (run-root 안에 두면 크래시 후 run-root째 사라져 추적 불가.) `pando start`가 기동 시 자기 레코드를 append 한다. 쓰기는 read-modify-write + atomic rename.

2. **순수 코어 플래너** — `src/core/run-gc.ts`의 `planRunGc({ runs, isAlive })`가 I/O 없이 회수 대상을 결정한다. 결정은 결정적 신호(`finishedAt`/`cleanedAt`/PID 생존)만 사용한다(ADR 게이트 규율과 동일 정신):
   - `cleanedAt` 있음 → keep `already-cleaned` (no-op)
   - `finishedAt` 있음 → reap `finished`
   - PID 죽음(`!isAlive`) → reap `orphaned`
   - PID 살아있음 → keep `running`

3. **`pando gc` 리퍼** — 매니페스트를 읽고 플래너에 위임한 뒤, 회수 대상마다 `rm -rf <runRoot>` → 설정된 repo들에 `git worktree prune` → 매니페스트에 `cleanedAt` 마킹. **dry-run이 기본**, 실제 삭제는 `--force`로만. `--json`으로 구조화 출력.
   - prune은 run record에 repo를 기록하지 않고 **gc 시점에 `--config-dir`의 repo 목록을 직접 로드**해 수행한다. `git worktree prune`은 *디렉터리가 사라진* 등록만 제거하므로 살아있는 run의 worktree는 건드리지 않는다 — 멱등·수술적이라 run별 repo 추적이 불필요하다(YAGNI).

4. **회수는 오직 `pando gc`로** — "run-root를 손으로 `rm -rf` 하지 말 것"을 규약으로 한다. teardown 순서(remove/prune/rm)를 코드 한 곳에 가둔다.

## 결과

- 크래시·kill로 고아가 된 run-root도 PID 생존 신호로 잡아 회수된다 — 종료 훅(`feat/pando-start-auto-cleanup`)이 놓치는 경로의 backstop.
- 살아있는 데몬의 run-root는 `running`으로 분류돼 절대 회수되지 않는다. dry-run 기본값이 추가 안전장치.
- PID 재사용(reused pid)으로 죽은 런이 `running`으로 오판될 수 있다 — 이 경우 회수가 한 사이클 지연될 뿐 데이터 손실은 없다. 보수적으로 keep 쪽으로 기운 트레이드오프다.
- 매니페스트가 단일 진실원이 되어, 추후 대시보드에 "run-root 디스크 사용량 / 고아 run 수"를 노출하는 토대가 된다(별도 작업).
- 정상 종료 시 `finishedAt` 마킹, 주기적 자동 gc는 후속 작업으로 남긴다 — 이 ADR은 매니페스트 + 수동 `pando gc` 리퍼까지만 결정한다.
