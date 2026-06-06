# ADR-010: 배포되는 CLI 이름은 `pandoctl`로 한다

- 상태: 승인 (2026-06-07)
- 근거: npm 이름 점유 (npmjs.com/package/pandoctl)

## 맥락

프로젝트 이름은 `pando`지만, npm의 `pando` 패키지명은 이미 외부에서 선점돼 있다. 사용자에게 배포할 CLI를 npm에 올리려면 다른 이름이 필요하다. 동시에:

- 내부 CLI 진입점은 `src/cli/agentctl.ts`이고, 명령/테스트(`tests/unit/agentctl.test.ts`)·docs 다수가 `agentctl` 이름에 묶여 있다.
- 진행 중 PR이 `agentctl.ts`를 대규모로 수정 중이라, 파일/명령을 즉시 리네임하면 충돌이 크다.
- 루트 `package.json`은 `private: true`라 npm에 올라가지 않는다.

## 결정

1. **배포 이름은 `pandoctl`** — `pando` + `ctl`(kubectl/systemctl 계열 데몬 컨트롤 CLI 관례). npm에 `pandoctl`을 placeholder(`packages/pandoctl`, v0.0.1)로 선점했다(#43). 배포 패키지는 private 루트와 별개 버전 라인을 가진다.
2. **로컬 진입점은 `pnpm pandoctl` script** — 루트 `package.json`에 `"pandoctl": "tsx src/cli/agentctl.ts"`를 둔다. docs/README의 CLI 예시는 모두 `pnpm pandoctl ...`로 표기한다(이름이 실제로 동작하는 것을 source of truth로).
3. **내부 `agentctl` 식별자는 당장 리네임하지 않는다** — `src/cli/agentctl.ts`/테스트/내부 명령명은 유지한다. 이름 통일은 별칭 레이어(`pnpm pandoctl` + npm bin)에서만 처리해, 진행 중인 `agentctl.ts` 작업과 충돌을 피한다.

## 결과

- 사용자/문서 표면의 명령 이름이 `pandoctl`로 단일화된다 — `pnpm pandoctl ...`이 실제로 실행된다.
- 진짜 CLI 배포 시 `packages/pandoctl`의 `bin.pandoctl`을 빌드된 `agentctl` 진입점에 연결하고 버전을 올려 publish한다(별도 작업).
- `agentctl` → `pandoctl` 내부 식별자 통일은 진행 중 작업이 정리된 뒤 별도 리네임으로 미룬다.
