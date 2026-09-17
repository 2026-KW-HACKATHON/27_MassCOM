# 평가 항목 증거 연결

현재는 부트스트랩 단계이므로 존재하지 않는 PR·실증·발표 증거를 만들지 않습니다. `생성 전`, `없음`, `NOT_RUN`도 현재 상태를 추적하기 위한 명시적 값입니다.

| 단계 | 항목 | 배점 | 요구사항 | Issue | PR | 코드·문서 | 테스트 | 실증 | 발표 자료 | 상태 |
| --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| 중간 | 논리의 연결성 | 30 | `RQ-001`~`RQ-006` | [#1](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/1) | [#2](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/2) | `docs/PRD.md`, `README.md` | 핵심 흐름 시험 `NOT_RUN` | 인터뷰·행동 자료 없음 | 3분 원고 생성 전 | `IN_PROGRESS` |
| 중간 | 실현 & 상용화 가능성 | 20 | `RQ-007`~`RQ-015` | 기능 Issue 생성 전 | 생성 전 | `packages/domain/spec/INVARIANTS.md` | `W01`~`W09`, `M01`~`M08` 모두 `NOT_RUN` | 기기·점주·비용 자료 없음 | 시연 증거 생성 전 | `PLANNED` |
| 중간 | 기획 문서의 재현 가능성 | 20 | `RQ-016`~`RQ-018` | [#1](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/1) | [#2](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/2) | `README.md`, `.env.example`, `docs/TEST_REPORT.md` | 부트스트랩·비밀 검사 `PASS` | 외부 HTTPS `NOT_RUN` | 실행 화면 생성 전 | `IN_PROGRESS` |
| 중간 | 창의성 & 차별성 | 20 | `RQ-001`, `RQ-005` | 기능 Issue 생성 전 | 생성 전 | `docs/PRD.md` | 추천·도감 시험 `NOT_RUN` | 다음 점포 탐색 자료 없음 | 비교 슬라이드 생성 전 | `PLANNED` |
| 중간 | 발표 | 10 | `RQ-019` | 발표 Issue 생성 전 | 생성 전 | `docs/COMPETITION.md` | 리허설 `NOT_RUN` | 실제 화면 없음 | 3분 원고·시연 순서 생성 전 | `PLANNED` |
| 최종 | 실현 & 상용화 가능성 | 30 | `RQ-007`~`RQ-015` | 기능·운영 Issue 생성 전 | 생성 전 | `docs/BLOCKERS.md`, 배포 코드 없음 | `W01`~`O02` 관련 시험 `NOT_RUN` | 파일럿·실비 자료 없음 | 5분 시연 자료 생성 전 | `PLANNED` |
| 최종 | 구현 완성도 & 기술력 | 20 | `RQ-002`~`RQ-018` | 기능 Issue 생성 전 | 생성 전 | 앱·API·계약·Worker 코드 없음 | 36개 제품 시험 모두 `NOT_RUN` | 실제 기기·체인 증거 없음 | 기술 설명 자료 생성 전 | `PLANNED` |
| 최종 | 지역 문제 적합성 | 20 | `RQ-001`, `RQ-005`, `RQ-020` | 현장 검증 Issue 생성 전 | 생성 전 | `docs/PRD.md` | 현장 수용 기준 `NOT_RUN` | 허락받은 인터뷰·관찰 없음 | 지역 문제 슬라이드 생성 전 | `PLANNED` |
| 최종 | 창의성 & 차별성 | 20 | `RQ-005`, `RQ-006` | 기능 Issue 생성 전 | 생성 전 | 방문 도감·NFT 분리 요구만 존재 | 비교 검증 `NOT_RUN` | 비교 사용자 자료 없음 | 차별성 슬라이드 생성 전 | `PLANNED` |
| 최종 | 참여도 | 5 | `RQ-021` | [#1](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/1) | [#2](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/2) | `docs/AI_USAGE.md`, Git 이력 | 설명 가능성 점검 `NOT_RUN` | 팀원별 실제 기록 없음 | 역할 설명 자료 생성 전 | `IN_PROGRESS` |
| 최종 | 발표 | 5 | `RQ-019` | 발표 Issue 생성 전 | 생성 전 | `docs/COMPETITION.md` | 리허설·장애 대체안 `NOT_RUN` | 실제 시연·영상 없음 | 5분 원고·질의응답 생성 전 | `PLANNED` |

NFT 발행 수는 매출 증가 증거가 아닙니다. 목표 점포·인원은 실제 확보 실적과 분리하고, AI가 수행한 작업을 사람의 기여로 표시하지 않습니다.
