# ADR-001: 큐/상태 저장소는 SQLite 단독으로 시작한다

- 상태: 승인 (2026-06-06)

## 맥락

로컬 맥에서 단일 데몬으로 시작하고, 추후 홈서버 Docker로 이전할 계획. BullMQ(Redis), Temporal 등 durable execution 도구를 검토했다 (docs/research-v1.md §3.3).

## 결정

- 상태·큐·이벤트 로그 전부 **better-sqlite3 (WAL 모드)** 단일 파일
- 동시성은 인프로세스 세마포어 3계층 (global / per-repo / per-provider)
- 워커는 `child_process.spawn` — 자식 프로세스라 이벤트 루프 부담 없음
- 크래시 복구는 단계 단위 재실행 (단계는 멱등: worktree 재사용)

## 이유

단일 머신·단일 프로세스에서 Redis는 운영 부담만 추가한다. Docker 이전의 실체는 "맥 → 리눅스 컨테이너 + 볼륨"이지 큐 교체가 아니다. YAGNI.

## 결과

- 멀티 머신 스케일아웃이 필요해지면 그때 큐 인터페이스 도입 + BullMQ 교체를 새 ADR로
- SQLite 파일은 gitignore, 볼륨 마운트 대상
