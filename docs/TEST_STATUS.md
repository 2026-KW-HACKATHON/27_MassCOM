# 테스트 상태

상태는 `PASS / FAIL / BLOCKED / NOT_RUN`만 사용합니다. v3 19.1절의 36개 ID를 바꾸거나 재번호화하지 않습니다.

| ID | 구분 | 상태 | 시나리오 | 통과 조건 | 증거 |
| --- | --- | --- | --- | --- | --- |
| Q01 | PostgreSQL 동시성 | PASS | 같은 QR 동시 20요청 | 수령·방문 인정 1회 | 동일 token 20요청에서 `CLAIMED`·방문·첫 보상권 각 1건, 나머지 거절 |
| Q02 | PostgreSQL 동시성 | PASS | QR 만료와 수령 경쟁 | 하나의 최종 상태 | 정확한 만료 시각 동시 20요청에서 `EXPIRED` 한 번 확정, 나머지 거절 |
| Q03 | API 통합 | PASS | QR 재발급 후 이전 코드 사용 | 이전 코드는 거절, 권리 추가 없음 | 같은 slot token 교체, 이전 token 거절, slot 수 1 유지, 실제 HTTP+PostgreSQL 동일 버전 동시 재발급 2요청 중 `200` 1건·`409` 1건 |
| Q04 | API 통합 | NOT_RUN | 단체 일부만 수령 | 사람별 결과 독립, 다른 슬롯 유지 | 단체 슬롯 미구현 |
| Q05 | 권한 통합 | PASS | 다른 점포 직원·다른 사용자 접근 | 조회·변경 모두 거절 | PostgreSQL 18에서 다른 점포·무소속·철회 계정 조회 403, `CONFIRM_VISIT` 권한 거절, 철회 즉시 반영 |
| R01 | PostgreSQL 동시성 | PASS | 한국 날짜 경계·동시 방문 평가 | 한국 날짜당 진행 최대 1회 | `14:59:59.999Z`와 `15:00:00Z` 경계가 서로 다른 KST 날짜, 같은 날짜 추가 방문은 진행도 미증가 |
| R02 | PostgreSQL 동시성 | NOT_RUN | 마지막 캠페인 자리 동시 등록 | 약속한 공급 상한 초과 없음 | 등록·예약 미구현 |
| R03 | 도메인·DB | PASS | 같은 목표 반복 평가 | 보상권 하나 | 첫/3/5회 목표만 생성, `(계정, 캠페인, 목표)` 고유 제약과 반복 평가에서 총 3건 유지 |
| W01 | 지갑·API | PASS | 연결만 승인하고 서명 생략 | 미검증 주소, 민팅 불가 | MetaMask 연결 뒤 앱이 `CONNECTED / UNVERIFIED`를 표시했고 주소 확인 전에는 발행 상태가 없음; API 미검증 주소 거절 자동화 PASS |
| W02 | 서명 검증 | PASS | 다른 계정·도메인·체인의 서명 | 거절 | Node HTTP·ethers 실제 서명 PASS |
| W03 | 서명 검증 | PASS | 만료·사용한 nonce 재사용 | 거절 | 5분 만료·단일 소비·replay 409 PASS |
| W04 | Android·지갑 | NOT_RUN | 서명 도중 지갑 주소 변경 | 기존 원문·확인 상태 무효 | 자동화 PASS, MetaMask 실기 NOT_RUN |
| W05 | Android·지갑 | NOT_RUN | 지원하지 않는 스마트 지갑 | 무검증 우회 없이 설명·거절 | 실기 미수행 |
| W06 | Android 실기 | PASS | 지갑 미설치·서명 거절·복귀 실패 | 안내와 재시도, 보상권 유지 | 서명·연결 거절 PASS. 미설치 SafePal → Google Play → 수동 앱 복귀·한국어 안내·pending proposal 취소 후 6분 지연 오류 없음 |
| W07 | DB·Worker | NOT_RUN | 주소 연결 해제와 전송 경쟁 | 고정 수령인·명확한 작업 상태 | Worker 미구현 |
| W08 | 배포 빌드 검사 | NOT_RUN | SDK 구매·스왑·내장 지갑 기본값 | 배포 빌드에 해당 진입점 없음 | 개발 코드 경계 PASS, 배포 빌드 NOT_RUN |
| W09 | 요청 경계 | PASS | 예기치 않은 송금·approve 요청 | 앱 요청 경계에서 거절 | allowlist 외 요청 provider 호출 전 거절 PASS |
| M01 | Worker·체인 | NOT_RUN | 같은 발급 버튼·Worker 중복 실행 | 온체인 NFT 하나 | 미구현 |
| M02 | Worker·체인 | NOT_RUN | 전송 직후 응답 유실 | 기존 발행 조회, 새 보상 키 금지 | 미구현 |
| M03 | Worker·체인 | NOT_RUN | Worker 재시작·nonce 경합 | 순번 충돌·중복 효과 없음 | 미구현 |
| M04 | 설정 검증 | NOT_RUN | 잘못된 체인·계약 설정 | 전송 전에 차단 | 미구현 |
| M05 | 이벤트 검증 | NOT_RUN | receipt 성공이지만 다른 이벤트 | 완료 처리 거절 | 미구현 |
| M06 | 인덱서·체인 | NOT_RUN | 이벤트 반복 수집·재조직 | 중복 없음, 확정 전 되돌림 가능 | 미구현 |
| M07 | DB·Worker | NOT_RUN | 민팅 도중 프로필 지갑 변경 | 이미 고정한 수령인 유지 | 미구현 |
| M08 | 복원 | NOT_RUN | DB 백업 복원 후 재처리 | 기존 NFT를 다시 발행하지 않음 | 미구현 |
| C01 | Foundry 계약 | NOT_RUN | 비민터 발행·민터 권한 상승 | 계약에서 거절 | D-005 승인, 계약 미구현 |
| C02 | Foundry 속성 | NOT_RUN | 누적 상한 경계·중복 발행 키 | 상한·일회성 유지 | 계약 미구현 |
| C03 | Foundry 계약 | NOT_RUN | 모든 전송·우회 경로 | 잠긴 NFT는 이전 불가 | D-005 승인, 계약 미구현 |
| C04 | Foundry 계약 | NOT_RUN | 시리즈 활성화 후 조건 변경 | 동결된 값 변경 불가 | 계약 미구현 |
| D01 | API·Worker | NOT_RUN | 발급 중 탈퇴 | 미전송·제출됨을 구분 | 미구현 |
| D02 | Android·API | NOT_RUN | 계정 전환·캐시 복구 | 이전 사용자 데이터 미노출 | 미구현 |
| D03 | 정적·통합 검사 | NOT_RUN | 로그·분석·메타데이터 검사 | 개인키·QR·개인 식별자 누출 없음 | 미구현 범위 존재 |
| A01 | Android 실기 | NOT_RUN | 카메라 권한 거절·오프라인 | 수동 코드·정확한 상태 표시 | QR 화면 미구현 |
| A02 | Android 릴리스 | NOT_RUN | 실제 AAB·16KB·앱 링크 | 설치·실행·복귀 정상 | debug APK 부분 PASS, release NOT_RUN |
| O01 | 환경 권한 | NOT_RUN | 시연 권리로 운영 API 접근 | 환경 경계에서 거절 | 운영 환경 미구현 |
| O02 | 장애·복원 | NOT_RUN | RPC·민터 잔액·DB 장애 | 보상권 보존·중지·복구 절차 동작 | 미구현 |

## 실행 기록

| 시각 | 커밋 | 명령 | 환경 | 결과 | 재현 |
| --- | --- | --- | --- | --- | --- |
| 2026-09-18 KST | `92d8029` | GitHub Actions `bootstrap-contract` | Ubuntu | PASS | PR #2 run `35282893247` |
| 2026-09-18 KST | `5688a5d` | 포털 구조·접근성·axe | macOS·headless Chrome | PASS | PR #6 evidence |
| 2026-09-18 KST | `6ec754b` | API 15개·모바일 11개·Android debug | Node·Expo·Android 16 AVD | PASS | PR #10 evidence |
| 2026-09-18 KST | `dc87855` | GitHub Actions 전체 CI | Ubuntu·Node 24.10.0 | PASS | PR #10 run `35293207033` |
| 2026-09-18 KST | `a9aacb6` | `npm test --prefix apps/api` | macOS·Node 25.9.0 | PASS 16/16 | 같은 명령 재실행 |
| 2026-09-18 KST | `a9aacb6` | `npm run test:postgres --prefix apps/api` | PostgreSQL 18 Alpine·Docker 27.3.1 | PASS 1/1 | `_test` 전용 `TEST_DATABASE_URL`을 실제 PostgreSQL에 지정 |
| 2026-09-18 KST | `a9aacb6` | API typecheck·build·production audit | TypeScript 6·npm | PASS, production 취약점 0 | package scripts 재실행 |
| 2026-09-18 KST | `4066b95` | GitHub Actions 전체 CI | Ubuntu·Node 24.10.0·PostgreSQL 18 | PASS, 2분 3초 | PR #14 run `35299748690` |
| 2026-09-18 KST | `a27d0d0` | GitHub Actions 전체 CI | Ubuntu·Node 24.10.0·PostgreSQL 18 | PASS, 2분 1초 | main run `35300158651` |
| 2026-09-18 KST | `1549938` | `npm test --prefix apps/api` | macOS·Node 25.9.0 | PASS 19/19 | 같은 명령 재실행 |
| 2026-09-18 KST | `1549938` | `npm run test:postgres --prefix apps/api` | PostgreSQL 18 Alpine·Docker 27.3.1 | PASS 2/2, Q05 포함 | `_test` 전용 `TEST_DATABASE_URL` 지정 |
| 2026-09-18 KST | `1549938` | API typecheck·build | TypeScript 6·npm | PASS | package scripts 재실행 |
| 2026-09-18 KST | `7442cff` | `npm test --prefix apps/api` | macOS·Node 25.9.0 | PASS 25/25 | 같은 명령 재실행 |
| 2026-09-18 KST | `7442cff` | `npm run test:postgres --prefix apps/api` | PostgreSQL 18 Alpine·Docker 27.3.1 | PASS 3/3, Q02·Q03 포함 | `_test` 전용 `TEST_DATABASE_URL` 지정 |
| 2026-09-18 KST | `7442cff` | 동일 token 소비·만료 경합 각 20요청 | PostgreSQL 18 Alpine | PASS | claim slot 통합 시험 재실행 |
| 2026-09-18 KST | `6823119` | API 25개·PostgreSQL 3개·typecheck·build·production audit | Node 25.9.0·PostgreSQL 18 Alpine | PASS, production 취약점 0 | HMAC 저장과 `tokenVersion` 동시 재발급 회귀 포함 |
| 2026-09-18 KST | `3eb9e5a` | API 25개·PostgreSQL 4개·Q01·R01·R03·typecheck·build·production audit | Node 25.9.0·PostgreSQL 18 Alpine | PASS, production 취약점 0 | 슬롯·방문·보상권 원자 처리와 캠페인 부재 전체 롤백 포함 |
| 2026-09-18 KST | `158067c` | debug APK 빌드·설치·Metro 실행·홈 복귀·콜드 스타트 | Samsung SM-S928N·Android 16·MetaMask 8.11.0 | 앱 실기 부분 PASS, W06 BLOCKED | `docs/evidence/android-physical-device.json`과 스크린샷; 지갑 생성·서명 미수행 |
| 2026-09-18 KST | PR #26 HEAD | 모바일 19개·typecheck·lint·Expo doctor·Android export·실제 MetaMask 흐름 | Samsung SM-S928N·Android 16·MetaMask 8.11.0·Base Sepolia | 자동화 PASS, 연결·체인 승인·`personal_sign`·서버 `VERIFIED`·콜드 재시작 PASS, W01 PASS | `docs/evidence/android-wallet-connection.json`; 주소·서명·세션 토픽·기기 일련번호 미기록 |
| 2026-09-18 KST | `bdeade4`, main CI `35319672490` | 모바일 19개·API 25개·PostgreSQL 통합·typecheck·lint·Android export·비밀 검사 | GitHub Actions Ubuntu·PostgreSQL 18 | PASS, Claude·Astra 검토 지적 반영 | PR #26·#28 merge; W04·W05·W06 잔여 실기는 `NOT_RUN` 유지 |
| 2026-09-18 KST | `a4dc155`, PR #32 | 모바일 21개·typecheck·lint·실제 MetaMask 서명·연결 거절 | Samsung SM-S928N·Android 16·MetaMask 8.11.0, macOS | 자동화·서명 거절 PASS; 연결 거절 후 수동 앱 복귀와 보존 안내 PASS, 자동 딥링크 복귀 NOT_RUN | Issue #31·PR #32; `docs/evidence/android-wallet-connection.json` |
| 2026-09-19 KST | `1dba58f`, PR #34 | 모바일 22개·typecheck·lint·미설치 Trust Wallet·Google Play 이동·수동 앱 복귀·제안 만료 대기 | Samsung SM-S928N·Android 16, macOS | 즉시 UI PASS, 지연 `Uncaught Proposal expired`로 W06 FAIL; 같은 원인 2회 이상 재현 후 중단 | Issue #33·#35, `docs/evidence/android-wallet-missing.json` |
| 2026-09-19 KST | `bff7c68`, PR #38 | clean npm ci patch 적용·모바일 24개·typecheck·lint·Android export·미설치 SafePal·6분 만료 회귀 | Samsung SM-S928N·Android 16, macOS | W06 PASS; 추가 `Proposal expired`·`Uncaught`·자산 요청 없음 | Issue #35, `docs/evidence/android-wallet-missing.json` |

Phase 2 카탈로그 통합 테스트 자체는 QR·방문 시험과 분리되어 있습니다. Q01·Q02·Q03·Q05·R01·R03은 각각 실제 PostgreSQL 동시성·권한·원자성 증거로만 `PASS` 처리했으며 Q04·R02는 계속 `NOT_RUN`입니다.
