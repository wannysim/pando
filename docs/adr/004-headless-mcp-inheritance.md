# ADR-004: 헤드리스 MCP는 `--mcp-config` 주입이 아니라 claude.ai connector 상속을 사용한다

- 상태: 승인 (2026-06-06)
- 근거: W1 실측 (docs/w1-runbook.md, AP-1234)

## 맥락

초기 설계(repo-structure §4)는 "데몬 환경엔 대화형 세션의 MCP 설정이 없으므로 `claude -p --mcp-config`로 명시 주입"을 전제했다. W1 검증에서 이 전제가 깨졌다:

- 사용자의 Atlassian/Figma MCP는 **claude.ai managed connector** (`claude.ai config` 스코프, 이름에 공백 포함, URL/토큰 비노출)
- 동일 URL을 `--mcp-config`로 주입하면 **OAuth 미인증의 별개 서버**가 생성됨 → authenticate 도구만 노출되고 작업 불가
- `--mcp-config` 없이 실행하면 헤드리스에서도 connector가 **정상 상속**됨 (`atlassianUserInfo` 응답 확인)

## 결정

1. Claude Code 워커는 `--mcp-config`를 사용하지 않는다. **워커가 도는 머신에서 claude 대화형 로그인 1회 + connector 연결**이 배포 전제조건
2. allowedTools에 `Task`(서브에이전트)와 `mcp__claude_ai_Atlassian`(서버 단위 허용)을 포함한다
3. `config/mcp-headless.example.json`은 폐기

## 결과

- **홈서버 Docker 이전 시 제약**: 컨테이너에서 claude 로그인 + connector 인증을 1회 수행해야 하고, 토큰 갱신 수명을 운영에서 확인해야 한다. 갱신이 깨지는 패턴이면 SPEC 수집을 Jira REST 직접 호출(API 토큰)로 대체하는 fallback을 W2에서 설계
- `WorkerRunOptions.mcpConfig` 필드는 비-claude.ai MCP(로컬 stdio 서버 등)용으로만 남긴다
- Bash 화이트리스트(`Bash(git *)`)는 파이프/복합 명령을 거부해 turn 낭비 유발 — W2에서 단계별 화이트리스트 재설계 필요
