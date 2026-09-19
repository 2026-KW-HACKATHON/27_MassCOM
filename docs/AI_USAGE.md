# AI 사용 기록

AI 사용은 허용되지만 결과물을 팀 전체가 이해하고 설명할 수 있어야 한다는 대회 규칙을 따릅니다. 숨은 사고 과정이나 비밀정보는 기록하지 않고, 실제 산출물과 검증 범위만 남깁니다.

| 날짜 | 도구 | 담당 작업 | 생성·수정 범위 | 실제 검증 | 사람 검토 |
| --- | --- | --- | --- | --- | --- |
| 2026-09-18 | Codex | 원본 자료·저장소·GitHub 상태 대조 | `docs/SOURCE_INDEX.md`, `docs/COMPETITION.md`, 상태·결정 초안 | SHA-256, Git·GitHub 메타데이터 확인 | PR 검토 대기 |
| 2026-09-18 | Codex | Phase 0 저장소 부트스트랩 | README, 저장소 지침, 36개 시험 카탈로그, CI·Issue/PR 형식 | `bash tests/bootstrap/verify_bootstrap_test.sh` PASS | PR 검토 대기 |
| 2026-09-18 | Codex 독립 리뷰 역할 | Phase 0 변경 검토 | 평가 추적성, 비밀 검사, 상태 일관성 검토 | 수정 후 HIGH/MEDIUM 문제 0건, 로컬 검증 재실행 PASS | 사람 리뷰를 대신하지 않음 |
| 2026-09-18 | Codex | 프로젝트 포털과 README 정보 구조 | `docs/index.html`, `docs/assets/project.css`, README 요약·진입점, 사이트·접근성 검증 | `docs/evidence/project-portal-{desktop,mobile}.png`, `project-portal-visual-verdict.json`, html-validate PASS, axe 0 violations | 독립 AI 재검토 PASS, 사람 PR 검토 대기 |
| 2026-09-18 | Codex + 공식 문서 조사·독립 리뷰 에이전트 | Phase 1 Android 외부 지갑 주소 확인 | Expo/Reown session allowlist, SIWE API·AccountResolver, 테스트·문서 | API 15 + 모바일 11 tests, Expo doctor 21/21, Android 16 APK 설치·실행, PR #10 CI PASS, 독립 HIGH/MEDIUM 0건 | 사람 PR 검토 미실행 |
| 2026-09-18 | Codex | 실제 Android 기기 검증 | SM-S928N debug APK 빌드·설치, Metro 연결, 홈 복귀·콜드 스타트, MetaMask 설치 상태 확인 | 앱 화면·프로세스·logcat·APK 해시 증거 저장, W06은 자격증명·사용자 지갑 부족으로 BLOCKED | 지갑 생성·서명·사람 검토 미실행 |
| 2026-09-18 | Codex | 실제 MetaMask 연결·주소 확인 검증 | UniversalProvider 경쟁 조건 회귀, 잘못된 체인 세션 표시, 사용자 거절 정규화, SDK 체인 전환 요청 경계, 상태·증거 문서 | 모바일 19 tests, Expo doctor 21/21, Android export, 실제 연결·Base Sepolia 전환·`personal_sign`·서버 `VERIFIED`·콜드 재시작 PASS | 사용자가 지갑을 준비·잠금 해제했고 Codex가 허용된 연결·체인·서명 UI만 조작; 주소·서명·비밀 미기록 |
| 2026-09-18 | Claude Code·Astra high | PR #26 독립 검증과 PR #28 재검증 | WalletConnect 5000~5003, Reown 4001 코드 소실, 4902 오탐, SDK add-chain 미요청, 문서 상태 점검 | Claude HIGH 0·MEDIUM 1 발견, Astra 수정 후 HIGH 0·MEDIUM 0·MERGE; 모바일 19/19·typecheck·secret scan PASS | 읽기 전용 검토이며 팀원 기여로 계산하지 않음; Claude는 테스트 재실행 없이 소스·CI 근거 검토, Astra는 자동화 재실행 |
| 2026-09-18 | Codex | 실제 거절 흐름 재검증과 Reown 이벤트 연동 | 서명 거절 UI 확인, 연결 거절 `USER_REJECTED` 재현, 앱 취소 상태 구독·stale 재통지 가드와 회귀 테스트 | 실제 서명 거절 안내와 연결 거절 후 수동 앱 복귀 안내 PASS, 모바일 21/21·typecheck·lint PASS; 자동 딥링크 복귀는 NOT_RUN | 사용자는 지갑 잠금만 해제하며 비밀번호·복구 문구·개인키는 공유·기록하지 않음 |
| 2026-09-18 | Claude Code·Astra high | PR #32 독립 읽기 전용 검증 | Reown 이벤트 형태·구독 정리·동기 재통지·상태 경계·증거 상태 검토 | 최종 HIGH·MEDIUM 0; Claude MEDIUM 1과 Astra LOW 증거 시각 문제를 코드·문서로 보완 | 사람 리뷰와 실제 지갑 실기를 대체하지 않음 |
| 2026-09-19 | Codex | 미설치 지갑 W06 실기·proposal 취소 패치 | Reown `GET_WALLET` 판별, 한국어 안내, proposal ID 즉시 종료·pending rejection 소비·pairing 정리 | TDD RED, 모바일 24/24·clean npm ci·typecheck·lint·Android export PASS, SafePal 복귀 후 6분 지연 오류 없음 | 사용자 승인 범위의 최소 SDK 패치; 별도 고성능 리뷰어·지갑 설치·비밀 접근 없음 |
| 2026-09-19 | Codex | W04 계정 변경 실기와 W05 환경 확인 | MetaMask Account 1/2 연결·검증 격리, 연결 관리·스마트 지갑 준비 상태 확인 | Account 1 VERIFIED → Account 2 재연결 UNVERIFIED PASS; 동일 세션 변경·실제 스마트 지갑은 BLOCKED | 사용자가 계정 2를 준비했고 Codex는 주소·서명·복구 문구를 기록하지 않음 |

## 팀 설명 체크리스트

각 컴포넌트가 구현될 때 팀원이 다음을 설명할 수 있도록 Issue 또는 문서에 기록합니다.

- 왜 필요한가
- 입력과 출력
- 핵심 불변조건
- 실패와 복구
- 보안·개인정보 한계
- 실제 시연 방법
