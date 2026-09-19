# 프로젝트 상태

마지막 갱신 시각: 2026-09-20 KST

## 기준선

| 항목 | 값 |
| --- | --- |
| 저장소 | `2026-KW-HACKATHON/27_MassCOM` (`PRIVATE`) |
| 기본 브랜치 | `main` |
| 현재 작업 | Issue #59 chain cursor 재시작 범위·reorg margin 구현 |
| 현재 검증 기준 | API 35·PostgreSQL 20·Worker 8/PG 6·모바일 48·Foundry 8/fuzz128·Anvil PASS |
| 최근 main 기준선 | PR #58 merge `7da97b6`, main CI run `35455903163` PASS |

## Phase 상태

| Phase | 상태 | 실제 근거 |
| --- | --- | --- |
| Phase 0 저장소·개발 기반 | `VERIFIED` | README·프로젝트 포털·한국어 PR 검사·CI |
| Phase 1 외부 지갑 연결 | `IN_PROGRESS` | MetaMask 연결→Base Sepolia→`personal_sign`→서버 `VERIFIED`, W06 PASS; W04·W05 외부 환경 `BLOCKED` |
| Phase 2 지역 상권 핵심 기능 | `VERIFIED` | loopback DEMO 탐색→점주 발급→고객 수령→도감→추천→상세 순환 PASS |
| Phase 3 NFT | `VERIFIED` | Local Anvil 계약→원자 job/Outbox→Worker→이벤트 대조→Android 등록 완료·복구 PASS; Base Sepolia `BLOCKED` |
| Phase 4 출시 기반 | `IN_PROGRESS` | 계정 삭제·HMAC 비식별화·privacy gate·출시 체크리스트·Android DEMO PASS; 외부 HTTPS·운영 재인증·release AAB 미완료 |
| Phase 5 대회 검증·발표 | `IN_PROGRESS` | 발표 웹·3/5분 원고·시연 runbook·빈 현장 기록지·증거 manifest 구현; 현장·리허설·영상·제출은 NOT_RUN |
| Phase 6 후속 기능 | `PLANNED` | 별도 승인 전 미착수 |

## 구현·검증 완료

- Expo Android 앱, Reown 외부 지갑 전용 연결, 금지 RPC 메서드 차단
- ERC-4361 주소 확인, nonce 단일 소비, 버전된 PostgreSQL wallet binding
- 공개 음식점·캠페인, 점포별 OWNER/STAFF 권한, 1인 일회용 방문 코드
- QR slot 소비·방문·KST 일일 진행·첫/3/5회 고정 보상권 원자 처리
- 방문·앱 수집품·실제 NFT를 분리한 도감과 이유가 보이는 다음 가게 추천
- OpenZeppelin ERC-721/ERC-5192 계약의 역할·누적 상한·reward key·영구 잠금
- 보상권·고정 수령인 mint job·Outbox 원자 생성과 동일 요청 20개 수렴
- Worker의 `SKIP LOCKED` lease·heartbeat, 제출 attempt, 체인 이벤트, NFT 자산, cursor 저장
- 전송 전 chain/contract/MINTER 검사와 receipt·계약·수령인·series·reward key·owner·locked 대조
- 응답 유실, 두 Worker 경쟁, lease 만료, 이벤트 반복, 확정 전 재조직, DB 자산 복구
- Samsung Android 16에서 NFT 공개 안내→접수→등록 완료와 기존 token #1 재전송 없는 복구
- 계정 삭제 동시 10요청 수렴, 미전송 mint 취소, 제출/확정 보존, 원 account ID 비식별화 D01
- 민감 로그 인자·미검토 analytics SDK CI 차단과 raw API error 로그 제거 D03
- Samsung Android 16 계정 설정·공개 장부 안내·Local DEMO 삭제 요청
- 다운로드 없이 여는 발표 페이지, 3분·5분 원고, 실제 시연/실패 대체 runbook
- 결과를 미리 채우지 않은 현장 검증 기록지와 제출 증거 manifest·허위 주장 gate
- 삭제·wallet·claim·redeem·mint request 공통 account lifecycle lock과 삭제 tombstone write 차단
- 활성 Worker lease 삭제 보호, submit 직전 lease 재검사, duplicate revert reward-key 복구
- chain cursor 기반 재시작 범위, 12블록 reorg margin, 오래된 reward 이벤트 fallback 복구
- 36개 테스트 catalog/ledger ID별 상태 동기화와 강화된 secret·PR·presentation gate

## 미완료

- Android 카메라 QR·수동 코드 대체 입력·오프라인 A01
- 단체 QR Q04, 캠페인 마지막 자리 등록 R02
- W04 동일 세션 서명 중 주소 변경, W05 미지원 스마트 지갑 실기
- 배포 빌드의 SDK 진입점 W08, 실제 운영 계정 전환·캐시 복원 D02
- release AAB·16KB·App Link A02, 운영 권한·장애 복원 O01~O02
- 외부 HTTPS·Base Sepolia·운영 signer·mainnet·Google Play·공개 데모
- 실제 현장 참여·발표 리허설·영상 촬영·저장소 공개·대회 최종 제출

## 검증 상태

- 필수 36개: `26 PASS / 2 BLOCKED / 8 NOT_RUN`
- API 단위: `35/35 PASS`; PostgreSQL: `20/20 PASS`
- Worker 단위: `8/8 PASS`; PostgreSQL: `6/6 PASS`; Anvil W07/M01~M08: `PASS`
- 모바일: `48/48 PASS`; typecheck·lint·Android export `PASS`
- Foundry: `8/8 PASS`, fuzz 128, fmt·build·lint `PASS`
- 비밀 검사·부트스트랩·프로젝트 포털 접근성/구조: `PASS`
- production dependency audit: API·Worker high 이상 0; 모바일 high 이상 0, Expo 전이 moderate 14건은 B-008

## BLOCKED

- B-002 저장소 공개 전환과 심사 public 준비: 명시 승인 필요
- B-003 외부 HTTPS·유료 클라우드: 비용·계정 승인 필요
- B-004/B-007 Google Play 정책·release package ID: 공식 확인과 결정 필요
- B-008 Expo 전이 moderate advisory: 2026-09-20 Expo 57.0.24·expo-router 57.0.22 patch 적용 뒤 재평가에서도 14건 유지. 근원은 `xcode`→`uuid`(iOS 설정 도구, 빌드 시점)와 `expo-router`→`query-string`→`decode-uri-component`이며 npm이 제시하는 수정은 expo 46 다운그레이드뿐이라 호환되는 upstream 수정 필요
- B-010/B-011 W04·W05용 실제 지갑 환경 부재
- B-012 Base Sepolia 전용 배포자·faucet gas 부재
- B-013 운영 재인증과 소유 HTTPS 외부 삭제 URL 부재

상세 실행 근거는 [TEST_STATUS.md](TEST_STATUS.md), Phase 3 증거는 [phase3-worker-anvil-android.json](evidence/phase3-worker-anvil-android.json), 차단 사유는 [BLOCKERS.md](BLOCKERS.md), 다음 세션 상태는 [HANDOFF.md](HANDOFF.md)를 기준으로 합니다.
