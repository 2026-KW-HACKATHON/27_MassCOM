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
| 2026-09-19 | Codex | Phase 2 음식점 탐색·상세 | 공용 API 설정 분리, 응답 검증, Android 목록·상세·선택적 지갑 라우트, 테스트·문서 | TDD RED 후 모바일 32/32·typecheck·lint·Android export·Samsung 실기 PASS | AI 구현·검증으로 기록하며 사람 기여나 실제 협약 점포 실적으로 표시하지 않음 |
| 2026-09-19 | Codex | Phase 2 점주 발급·고객 수령·도감 | 도감 read model, 권한·발급·preview/redeem·도감 Android 화면, 테스트·문서 | TDD RED 후 API 27/27·PostgreSQL 5/5·모바일 40/40·Samsung 전체 흐름·중복 409 PASS | 로컬 진단에 노출된 DEMO token은 즉시 재발급 폐기; 저장소·사람 기여·운영 실적으로 기록하지 않음 |
| 2026-09-19 | Codex | Phase 2 설명 가능한 추천·최종 통합 | 추천 정책·PostgreSQL 후보·Android 이유 화면·상세 복귀·문서/포털 | TDD RED 후 API 31/31·PostgreSQL 6/6·모바일 43/43·Android 추천 실기 PASS | 실제 점주·이용자 행동이나 매출 효과로 확대 해석하지 않음 |
| 2026-09-19 | Codex | Phase 3 양도 제한 NFT 계약 | Solidity 계약·Foundry/Anvil wrapper·C01~C04·CI·문서 | TDD RED 후 Foundry 8/8·fuzz 128·Anvil deploy/mint/locked/event PASS | 전문 감사·Base Sepolia·메인넷으로 표시하지 않음; private key·mnemonic 미사용 |
| 2026-09-19 | Codex | Phase 3 wallet binding·mint request·Outbox | migration·SIWE 영속화·idempotency·고정 수령인 job·API/client·문서 | TDD RED 후 API 34/34·PostgreSQL 8/8·동시 20요청·주소 변경·Android export PASS | Worker·온체인 완료로 확대하지 않고 W07/M01/M07은 NOT_RUN 유지 |
| 2026-09-19 | Codex | Phase 3 Worker·체인 대조·Android 완료 상태 | Worker lease heartbeat/attempt/event/asset, Ethers gateway, 확정 깊이·복구, 도감 접수/완료 UI, CI·증거 | Worker 6/6·PostgreSQL 1/1·Anvil W07/M01~M08·API 34/34·모바일 45/45·Samsung 접수→등록 완료·재전송 없는 복구 PASS | 로컬 Anvil 증거이며 전문 감사·Base Sepolia·운영 signer·매출 효과로 확대하지 않음 |
| 2026-09-19 | Codex | Phase 4 계정 삭제·개인정보·출시 준비 | 삭제 ledger·HMAC 비식별화·mint 상태 분리·Android 설정·privacy gate·공식 정책 체크리스트 | API 35/35·PostgreSQL 10/10·모바일 48/48·Android export·Samsung 삭제 안내/DEMO 요청 PASS | D02·외부 HTTPS 삭제 URL·운영 재인증·AAB·Play·백업 실증은 완료로 표시하지 않음 |
| 2026-09-20 | Codex | Phase 5 발표·시연·평가 증거 준비 | 발표 웹·원고·시연/현장/제출 문서·evidence manifest·truth gate | 1440×900·390×844 시각 검토, 접근성·manifest·NOT_RUN 보존 회귀 PASS | 실제 사람의 발표·현장 참여·영상·기여로 표시하지 않음; 공개·제출 미실행 |
| 2026-09-20 | Claude CLI + Codex 독립 리뷰 | 전체 코드·보안·브랜치·README 감사 | 삭제/민팅 경쟁, 계정 lock, 테스트 정본, Worker 복구, CI·의존성·브랜치 검토 | CRITICAL 0, HIGH 3 재현; code-reviewer `REQUEST CHANGES`, architect `BLOCK`; RED→GREEN 수정 | Claude·리뷰 결과를 사람 기여로 표시하지 않으며 미실행 운영 보완은 MEDIUM으로 유지 |
| 2026-09-21 | Codex + 독립 code-reviewer | 운영 로그인 후속 보안·Play 초안 정합 | Google `auth_time` 최근성, JWKS stale 상한, 로그인 제한, 세션 cleanup, 카메라·NFT award 선언 초안 | HIGH 1·MEDIUM 3 재현 후 API 72/72·PostgreSQL 37/37 RED→GREEN | 실제 Google token·모바일 로그인·외부 HTTPS·Play 입력/제출은 수행하거나 완료로 표시하지 않음 |
| 2026-09-21 | Codex + 독립 architect | 서비스 민터 후속 보안 | priority fee·signed sender·환경변수 이름·keystore 경로·lock/pool 설정·README 검토 | MEDIUM 1·LOW 1·WATCH 1 재현 후 Worker 44/44 RED→GREEN | 실제 keystore·Base Sepolia 전송은 사용하지 않았고 다중 민터 migration은 요구 전까지 추가하지 않음 |

## 팀 설명 체크리스트

각 컴포넌트가 구현될 때 팀원이 다음을 설명할 수 있도록 Issue 또는 문서에 기록합니다.

- 왜 필요한가
- 입력과 출력
- 핵심 불변조건
- 실패와 복구
- 보안·개인정보 한계
- 실제 시연 방법
