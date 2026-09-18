# 프로젝트 상태

마지막 갱신 시각: 2026-09-18 KST

## 기준선

| 항목 | 값 |
| --- | --- |
| 저장소 | `2026-KW-HACKATHON/27_MassCOM` (`PRIVATE`) |
| 기본 브랜치 | `main` |
| 현재 작업 브랜치 | `test/25-wallet-device` |
| 현재 통합 기준 | `main@f85234f9d7d69d920fb5e942a5706b6d1611945f`, CI run `35309692169` PASS |
| 최근 merge | PR #24, `f85234f` |
| 현재 열린 Issue | #25 실제 MetaMask 연결과 주소 확인 서명 검증 |
| 현재 열린 PR | #26 실제 지갑 연결·주소 확인 안정화 |

## Phase 상태

| Phase | 상태 | 실제 근거 |
| --- | --- | --- |
| Phase 0 저장소·개발 기반 | `VERIFIED` | PR #2·#4·#6·#8, CI PASS |
| Phase 1 외부 지갑 연결 | `IN_PROGRESS` | API 15개·모바일 19개 자동화 PASS, 실제 Android·MetaMask 연결·Base Sepolia·서명·서버 확인·콜드 재시작 PASS; W04·W05·W06 잔여 실기 |
| Phase 2 지역 상권 핵심 기능 | `IN_PROGRESS` | 카탈로그·점포 권한·일회용 QR·방문·고정 보상권 merge 완료 |
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
- PR #20 merge와 main CI run `35304829656` PASS
- PostgreSQL `visit_events`·`reward_entitlements` migration
- 슬롯 소비·방문 이벤트·KST 일일 진행도·첫/3/5회 보상권 원자 트랜잭션
- Q01·R01·R03 실제 PostgreSQL 동시성·경계·중복 평가 통합 테스트
- PR #22 merge `158067c`와 main CI run `35306108718` PASS
- Samsung SM-S928N 실제 기기의 debug APK 설치·Metro 실행·홈 복귀·콜드 스타트
- 공식 MetaMask 8.11.0 설치·첫 화면 실행(지갑 생성·가져오기 미수행)
- 실제 MetaMask WalletConnect 연결·Base Sepolia 승인·읽을 수 있는 `personal_sign`·서버 주소 확인 `VERIFIED`
- 콜드 재시작에서 지갑 세션 복원과 주소 확인 상태의 안전한 `UNVERIFIED` 초기화
- UniversalProvider 2.23.5 override와 초기 체인 이벤트 경쟁 회귀 테스트

### 진행 중

- Issue #25에서 수정 후 사용자 거절 안내 실기 재확인과 PR·CI·merge 준비

### 미구현

- 점주·직원 웹, 방문 취소·오입력, 단체 QR, 도감 조회·추천
- PostgreSQL 지갑 challenge 영속화
- NFT 계약·발행 Worker·Outbox·체인 이벤트 수집
- 계정 삭제·개인정보·백업 복원·Android release AAB

### BLOCKED

- 외부 HTTPS·유료 AWS 자원: 비용·계정 승인 필요
- 저장소/포털 공개, Google Play 배포, 대회 제출: 명시 승인 필요

## 검증·배포 상태

- API 단위 테스트: `PASS` 25개
- PostgreSQL 18 통합 테스트: `PASS` 4개(카탈로그·Q01~Q03·Q05·R01·R03, 로컬 Docker와 main CI)
- v3 필수 36개: W01·W02·W03·W09·Q01·Q02·Q03·Q05·R01·R03 `PASS`, 나머지 26개 `NOT_RUN`
- Android: debug APK 빌드·Android 16 16KB AVD와 Samsung SM-S928N 설치·실행·복귀 `PASS`
- 외부 지갑 핵심 흐름: MetaMask 연결·Base Sepolia·주소 확인 서명·서버 검증·콜드 재시작 `PASS`; 주소 변경·미지원/미설치 지갑 등은 `NOT_RUN`
- 공개 HTTPS·GitHub Pages·Play: 미배포
- NFT·테스트넷: 계약·전송 모두 미실행

상세 실행 근거는 [TEST_STATUS.md](TEST_STATUS.md), 차단 사유는 [BLOCKERS.md](BLOCKERS.md), 다음 세션 명령은 [HANDOFF.md](HANDOFF.md)를 기준으로 합니다.
