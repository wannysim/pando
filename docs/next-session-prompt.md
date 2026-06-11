# Next Session Prompt

Use `docs/README.md` as the source of truth for the current work queue and docs
routing.

Do not start from this file. It is kept only so old references do not break.

Paste this instead when opening a new agent session:

```text
CLAUDE.md and docs/README.md를 읽고, docs/README.md의 Active W6 Queue에서 아직 끝나지 않은 가장 앞 항목 하나만 골라 develop 최신 상태의 topic branch에서 작게 진행해줘.

지켜야 할 규칙:
- 새 DB table 추가 금지.
- public auth/OIDC/token auth 구현 금지.
- src/core, src/pipeline, src/scheduler에는 I/O import 추가 금지.
- CLI/API/dashboard 판단에 LLM output text 사용 금지.
- gate 판정은 exit code, 파일 아티팩트, checksum, structured JSON 같은 deterministic evidence만 사용할 것.
- 비밀값 출력/커밋 금지, evidence 파일 커밋 금지.
- 커밋 메시지, PR title/body는 English.
- TDD 규칙 준수: 실패 테스트 먼저, 구현은 그 다음.

완료 기준:
1. 선택한 변경이 W6 범위에 맞는 작은 단위여야 한다.
2. `pnpm format:check` 통과.
3. 가능한 경우 `pnpm verify` 통과.
4. 실패가 있으면 실패 사유와 로그 요약을 `/tmp` 아래 structured JSON evidence로 남긴다.
```
