# 월계 마스코트(가칭)

월계1동 음식점을 발견하고, 실제 이용 인증으로 마스코트 도감을 채우며, 원하는 수집품을 외부 지갑에 NFT로 발급받는 Android 서비스입니다.

> 현재 상태: 저장소 기준선 `VERIFIED` · Phase 1 핵심 지갑 흐름 `VERIFIED` · Phase 2 방문·보상 기반 `IN_PROGRESS` · 필수 시험 11 `PASS` / 25 `NOT_RUN`

[![월계 마스코트 프로젝트 포털 데스크톱 미리보기](docs/evidence/project-portal-desktop.png)](docs/index.html)

## 한눈에 보기

- [프로젝트 포털](docs/index.html): 흐름·아키텍처·평가 증거·결정 상태를 시각적으로 탐색
- [포털 시각 검증](docs/evidence/project-portal-visual-verdict.json): 데스크톱·모바일 뷰포트와 접근성 결과
- [현재 상태](docs/PROJECT_STATE.md): 실제 완료·미완료·BLOCKER
- [제품 요구사항](docs/PRD.md): RQ-001~RQ-021
- [결정 기록](docs/DECISIONS.md): 승인·제안·외부 확인 구분
- [테스트 원장](docs/TEST_STATUS.md): v3 19절의 36개 ID와 실행 근거
- [Phase 1 지갑 연결](docs/PHASE1_WALLET_LINK.md): Android·Reown·SIWE 구현과 실제 MetaMask 검증
- [실제 Android 기기 증거](docs/evidence/android-physical-device.json): 빌드·설치·실행·복귀·MetaMask 준비 상태
- [실제 지갑 흐름 증거](docs/evidence/android-wallet-connection.json): 연결·체인 전환·서명·서버 확인·복원 결과
- [미설치 지갑 복귀 증거](docs/evidence/android-wallet-missing.json): 스토어 이동·수동 복귀·한국어 재시도 안내
- [보안 경계](docs/SECURITY.md): 허용 메서드·nonce·의존성 위험
- [평가 대응표](docs/EVALUATION_MAP.md): 요구사항·Issue·PR·코드·시험·실증·발표 연결

### 포털 로컬 미리보기

```bash
python3 -m http.server 4173 --directory docs
```

브라우저에서 `http://127.0.0.1:4173/`을 엽니다. GitHub Pages 공개 배포는 저장소 가시성과 조직 요금제를 확인한 뒤 별도 승인으로 진행합니다.

## 핵심 사용자 흐름

`음식점 탐색 → 점주 이용 확인 → QR 인증 → 보상권 → 외부 지갑 연결 → 주소 확인 서명 → 기존 블록체인 NFT 발행 → 도감 → 다음 음식점 탐색`

지갑은 선택 기능입니다. 지갑이 없어도 탐색·방문 인증·방문 도감을 사용할 수 있어야 하며, 앱 수집품과 실제 발행 NFT를 구분합니다.

## 실제 기능 상태

| 영역 | 상태 | 증거 또는 다음 조건 |
| --- | --- | --- |
| 저장소·문서·CI 기준선 | `VERIFIED` | PR #2·#4 merge, GitHub Actions PASS |
| 프로젝트 포털 | `VERIFIED` | PR #6, CI PASS, 접근성·반응형 증거 저장 |
| Android 고객 앱 | `IMPLEMENTED` | Expo 57 dev-client, Android 16 AVD와 Samsung SM-S928N 실기기 debug APK 설치·실행·복귀 |
| 공개 점포·캠페인 API | `IMPLEMENTED` | PR #14 merge `a27d0d0`, main CI run `35300158651` PASS |
| 점주·직원 권한 API | `IMPLEMENTED` | PR #18 merge `e242c99`, main CI run `35302502498` PASS |
| 일회용 QR 슬롯 API | `IMPLEMENTED` | PR #20, 원문 미저장·버전 잠금 재발급·preview·단일 소비 기반 |
| 방문·고정 보상권 | `IMPLEMENTED` | PR #22, QR 소비·KST 일일 진행·첫/3/5회 보상권을 한 DB 트랜잭션으로 처리 |
| 점주·직원 웹 | `PLANNED` | 권한·QR API만 구현, 화면은 미구현 |
| 주소 확인 API | `IMPLEMENTED` | ERC-4361 challenge·실제 서명 복구·nonce 소비 15 tests PASS |
| PostgreSQL | `IN_PROGRESS` | 점포·캠페인·멤버십·claim slot·방문·보상권 migration 구현, 지갑 challenge 영속화는 후속 |
| Worker | `PLANNED` | Phase 3 전 |
| Reown 외부 지갑 코드 | `IMPLEMENTED` | AppKit 2.0.6, 외부 지갑 전용 기능 플래그·메서드 allowlist |
| 외부 지갑 실기 | `VERIFIED` | MetaMask 연결·Base Sepolia·`personal_sign`·서버 확인과 Trust Wallet 미설치·스토어 복귀 안내 PASS; 주소 변경·미지원 스마트지갑은 `NOT_RUN` |
| NFT 계약·발행 | `PLANNED` | D-004·D-005 승인, Phase 3 전 |
| 외부 HTTPS·Play 제출 | `BLOCKED` | 계정·비용·정책·명시 승인 필요 |

상태 정의는 `PLANNED / IN_PROGRESS / IMPLEMENTED / VERIFIED / BLOCKED`입니다. 구현 코드가 있어도 필요한 환경에서 검증하지 않았다면 `VERIFIED`로 올리지 않습니다.

## 보안·제품 경계

- 기존 블록체인을 사용하며 자체 체인·자체 사용자 지갑을 만들지 않습니다.
- 사용자 개인키·복구 문구를 요구하거나 보관하지 않습니다.
- 외부 지갑에는 주소 확인용 메시지 서명만 요청합니다.
- 송금·`approve`·`permit`·스왑·구매·내장 지갑 기능을 넣지 않습니다.
- 발행 요청의 수령 주소와 연결 버전을 고정하고 재시도로 중복 발행하지 않습니다.
- 개인정보·주문번호·정확한 식사 시각을 온체인/IPFS에 넣지 않습니다.

## 아키텍처

```text
Android 앱 ─┐
            ├─ HTTPS API ─ PostgreSQL ─ Outbox/Worker ─ 기존 블록체인
점주 웹 ────┘       │
                    └─ 외부 지갑 주소 확인 서명
```

현재 `apps/mobile`, `apps/api`, `apps/api/migrations`가 구현됐습니다. `apps/merchant-web`, `apps/worker`, `contracts`, `infra`는 후속 Phase에서 실제 실행 코드와 함께 추가합니다.

## 기술 선택 상태

| 항목 | v3 권장안 | 현재 상태 |
| --- | --- | --- |
| 고객 앱 | React Native + TypeScript + Expo development build | `USER_CONFIRMED` |
| 지갑 연결 | Reown AppKit 외부 지갑만, MetaMask 1차 실기 | `USER_CONFIRMED` |
| 체인 | Base Sepolia → 별도 승인 후 Base mainnet | `USER_CONFIRMED` |
| 서버·DB | Node.js LTS + TypeScript + PostgreSQL | `USER_CONFIRMED` |
| 배포 | AWS 서울 리전 + Docker Compose + Nginx | `USER_CONFIRMED` |

D-004~D-008은 2026-09-18 승인됐습니다. 유료 자원 생성·메인넷·공개 배포는 이 승인에 포함되지 않습니다.

## 설치·검증

저장소 기준선 검사는 추가 패키지가 필요하지 않습니다.

```bash
git clone https://github.com/2026-KW-HACKATHON/27_MassCOM.git
cd 27_MassCOM
bash tests/bootstrap/check_secrets_test.sh
bash tests/bootstrap/check_pr_korean_test.sh
bash tests/bootstrap/verify_bootstrap_test.sh
bash tests/site/check_site_accessibility_test.sh
bash tests/site/verify_project_site_test.sh
```

Phase 1 앱과 API 검증:

```bash
npm ci --prefix apps/api
npm test --prefix apps/api
npm run typecheck --prefix apps/api
npm ci --prefix apps/mobile
npm test --prefix apps/mobile
npm run typecheck --prefix apps/mobile
npm run lint --prefix apps/mobile
npm run export:android --prefix apps/mobile
```

Phase 2 점포 카탈로그, 점포별 권한, QR 수령 슬롯, 방문·보상권 검증은 실제 PostgreSQL 연결이 필요합니다.

```bash
export DATABASE_URL='postgresql://사용자@127.0.0.1:5432/masscom_dev'
read -s MERCHANT_REFERENCE_HMAC_SECRET && export MERCHANT_REFERENCE_HMAC_SECRET
read -s PGPASSWORD && export PGPASSWORD
npm run db:migrate --prefix apps/api
export TEST_DATABASE_URL='postgresql://사용자@127.0.0.1:5432/masscom_test'
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate --prefix apps/api
npm run test:postgres --prefix apps/api
```

통합 테스트는 테이블을 비우므로 DB 이름이 `_test`로 끝나는 전용 데이터베이스만 허용합니다. `GET /merchants`는 로그인·지갑 없이 활성 점포와 공개 중인 현재 캠페인만 반환합니다. 점주용 API는 활성 점포 멤버십을 매 요청 확인합니다. QR token은 SHA-256, 주문 참조는 점포 범위 HMAC-SHA-256만 저장합니다. 재발급은 직전 `tokenVersion`을 조건으로 한 요청만 성공시킵니다. 수령 POST는 슬롯 소비·방문 이벤트·한국 날짜 진행도·첫/3/5회 보상권을 한 트랜잭션으로 처리합니다. 저장소에는 실제 협약 점포 seed를 넣지 않으며 테스트 fixture는 `demo: true`로 구분합니다.

상세 development build 절차와 환경 변수는 [`apps/mobile/README.md`](apps/mobile/README.md), [`apps/api/README.md`](apps/api/README.md)를 따릅니다.

## 데모·배포·출시

- 정적 프로젝트 포털: 로컬 검증 중, 공개 URL 없음
- Android debug APK: Android 16 16KB AVD와 Samsung SM-S928N 실기기에서 빌드·설치·실행·홈 복귀·콜드 스타트 검증, 저장소에는 미포함
- Android AAB·release package ID·App Link: `NOT_RUN`
- 실제 Reown 지갑 흐름: MetaMask 연결·Base Sepolia·주소 확인·거절 복귀와 Trust Wallet 미설치·Google Play 이동·한국어 재시도 안내 `PASS`; W04 주소 변경·W05 미지원 스마트지갑은 `NOT_RUN`
- 테스트넷 계약: 배포 전
- 메인넷·Google Play·대회 제출: 명시 승인 전 실행 금지
- 저장소: 현재 `PRIVATE`; 심사 시점 public 요구는 [대회 규칙](docs/COMPETITION.md)에 기록

개인 Google Play 계정 적격성, 사업자·법률·개인정보·금융 기능 신고는 실제 기능과 Console 기준으로 다시 확인합니다.

## 대회·기여·출처

- 대회 규칙과 일정: [docs/COMPETITION.md](docs/COMPETITION.md)
- 자료명·버전·SHA-256: [docs/SOURCE_INDEX.md](docs/SOURCE_INDEX.md)
- AI 사용과 사람 검토 구분: [docs/AI_USAGE.md](docs/AI_USAGE.md)
- 외부 코드·자산·라이선스: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
- 인수인계: [docs/HANDOFF.md](docs/HANDOFF.md)

없는 협약 점포·현장 검증·Play 승인·매출 증가·사람의 기여를 만들지 않습니다. 목표 인원과 점포 수는 확보 실적과 분리합니다.
