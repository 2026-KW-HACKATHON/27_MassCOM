# AI 사용 기록

AI 사용은 허용되지만 결과물을 팀 전체가 이해하고 설명할 수 있어야 한다는 대회 규칙을 따릅니다. 숨은 사고 과정이나 비밀정보는 기록하지 않고, 실제 산출물과 검증 범위만 남깁니다.

| 날짜 | 도구 | 담당 작업 | 생성·수정 범위 | 실제 검증 | 사람 검토 |
| --- | --- | --- | --- | --- | --- |
| 2026-09-18 | Codex | 원본 자료·저장소·GitHub 상태 대조 | `docs/SOURCE_INDEX.md`, `docs/COMPETITION.md`, 상태·결정 초안 | SHA-256, Git·GitHub 메타데이터 확인 | PR 검토 대기 |
| 2026-09-18 | Codex | Phase 0 저장소 부트스트랩 | README, 저장소 지침, 36개 시험 카탈로그, CI·Issue/PR 형식 | `bash tests/bootstrap/verify_bootstrap_test.sh` PASS | PR 검토 대기 |
| 2026-09-18 | Codex 독립 리뷰 역할 | Phase 0 변경 검토 | 평가 추적성, 비밀 검사, 상태 일관성 검토 | 수정 후 HIGH/MEDIUM 문제 0건, 로컬 검증 재실행 PASS | 사람 리뷰를 대신하지 않음 |
| 2026-09-18 | Codex | 프로젝트 포털과 README 정보 구조 | `docs/index.html`, `docs/assets/project.css`, README 요약·진입점, 사이트·접근성 검증 | `docs/evidence/project-portal-{desktop,mobile}.png`, `project-portal-visual-verdict.json`, html-validate PASS, axe 0 violations | 독립 AI 재검토 PASS, 사람 PR 검토 대기 |

## 팀 설명 체크리스트

각 컴포넌트가 구현될 때 팀원이 다음을 설명할 수 있도록 Issue 또는 문서에 기록합니다.

- 왜 필요한가
- 입력과 출력
- 핵심 불변조건
- 실패와 복구
- 보안·개인정보 한계
- 실제 시연 방법
