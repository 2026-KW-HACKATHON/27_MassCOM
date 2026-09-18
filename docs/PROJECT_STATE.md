# 프로젝트 상태

마지막 갱신 시각: 2026-09-18 KST

## 기준선

| 항목 | 값 |
| --- | --- |
| 저장소 | `2026-KW-HACKATHON/27_MassCOM` (`PRIVATE`) |
| 기본 브랜치 | `main` |
| 현재 작업 브랜치 | `feat/19-one-time-claim-slot` |
| 현재 통합 기준 | `main@e242c996b996dd01fa9b798c0376caedd4e8ed31`, CI run `35302502498` PASS |
| 최근 merge | PR #18, `e242c99` |
| 현재 열린 Issue | #19 1인용 일회용 QR 슬롯 기반 구현 |
| 현재 열린 PR | #20 1인용 일회용 QR 슬롯 기반 구현 |

## Phase 상태

| Phase | 상태 | 실제 근거 |
| --- | --- | --- |
| Phase 0 저장소·개발 기반 | `VERIFIED` | PR #2·#4·#6·#8, CI PASS |
| Phase 1 외부 지갑 연결 | `IMPLEMENTED` | PR #10·#12, API 15개와 모바일 11개 자동화 PASS |
| Phase 2 지역 상권 핵심 기능 | `IN_PROGRESS` | 카탈로그·점포 권한 merge 완료, 일회용 QR 슬롯 PR #20 진행 중 |
| Phase 3 NFT | `PLANNED` | 계약·Worker·테스트넷 미착수 |
| Phase 4 출시 기반 | `PLANNED` | 외부 HTTPS·AAB·탈퇴·복원 미착수 |
| Phase 5 대회 검증·발표 | `PLANNED` | 현장 검증·영상·제출 버전 미착수 |
| Phase 6 후속 기능 | `PLANNED` | 별도 승인 전 미착수 |

## 기능 상태

### 구현 완료

- 저장소 문서·CI·한국어 PR 검사와 프로젝트 포털
- Expo Android development build 기준선
- Reown 외부 지갑 전용 설정과 금지 RPC 메서드 차단
- ERC-4361 challenge·서명 복구·nonce 단일 소비 API
- 로그인·지갑 없이 조회하는 `GET /merchants`
- PostgreSQL `merchants`·`campaigns`·`campaign_goals` migration
- 활성 점포와 공개·현재 캠페인만 반환하는 실제 PostgreSQL 통합 테스트
- PostgreSQL `merchant_members` migration과 점포별 `OWNER`·`STAFF` 권한 경계
- 다른 점포·무소속·철회 계정 거절과 철회 즉시 반영 Q05 통합 테스트
- PostgreSQL `claim_slots` migration과 token SHA-256·주문 참조 HMAC-SHA-256 저장
- 1인용 슬롯 발급·버전 잠금 재발급·preview·동시 단일 소비, Q02·Q03 통합 테스트

### 진행 중

- Issue #19·PR #20에서 일회용 QR 슬롯 기반과 CI 검증

### 미구현

- 점주·직원 웹, 방문 이벤트·보상권, 단체 QR, 도감·추천
- PostgreSQL 지갑 challenge 영속화
- NFT 계약·발행 Worker·Outbox·체인 이벤트 수집
- 계정 삭제·개인정보·백업 복원·Android release AAB

### BLOCKED

- 실제 Reown·MetaMask 실기: Reown project ID와 설치 지갑 필요
- 외부 HTTPS·유료 AWS 자원: 비용·계정 승인 필요
- 저장소/포털 공개, Google Play 배포, 대회 제출: 명시 승인 필요

## 검증·배포 상태

- API 단위 테스트: `PASS` 25개
- PostgreSQL 18 통합 테스트: `PASS` 3개(카탈로그·Q02·Q03·Q05, 로컬 Docker; PR #20 CI 확인 중)
- v3 필수 36개: W02·W03·W09·Q02·Q03·Q05 `PASS`, 나머지 30개 `NOT_RUN`
- Android: debug APK 빌드·Android 16 16KB AVD 설치·설정 화면 실행 `PASS`
- 외부 지갑 실기: `BLOCKED`
- 공개 HTTPS·GitHub Pages·Play: 미배포
- NFT·테스트넷: 계약·전송 모두 미실행

상세 실행 근거는 [TEST_STATUS.md](TEST_STATUS.md), 차단 사유는 [BLOCKERS.md](BLOCKERS.md), 다음 세션 명령은 [HANDOFF.md](HANDOFF.md)를 기준으로 합니다.
