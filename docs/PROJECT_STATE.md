# 프로젝트 상태

마지막 갱신 시각: 2026-09-22 KST

## 기준선

| 항목 | 값 |
| --- | --- |
| 저장소 | `2026-KW-HACKATHON/27_MassCOM` (`PRIVATE`) |
| 기본 브랜치 | `main` |
| 기준 커밋 | 이 문서는 SHA를 고정하지 않는다. 실제 기준은 `git log origin/main -1`, 직전 검증 기준은 `docs/HANDOFF.md` 머리말 |
| 현재 작업·열린 PR | `gh pr list`, `gh issue list`가 기준. 인수인계 요약은 `docs/HANDOFF.md` |
| 현재 검증 기준 | API 80·PostgreSQL 37·Worker 45/PG 23·모바일 141·Foundry 8/fuzz128·Anvil PASS |

## Issue #122 중단 체크포인트

- 브랜치 `test/122-oauth-testnet-device-closeout`, Google 로그인 수정 `e84a7a8`, upload-key AAB 자동 gate 기준 `f13a283`.
- AWS Lightsail 서울 2GB 인스턴스에 커밋 `73e07c8`의 PostgreSQL·API·Caddy를 배포했고 세 컨테이너 상태를 healthy/running으로 확인했다. DB 5432·API 3000은 인터넷에 publish하지 않았다.
- Vercel 정적 포털 `https://masscom.kr`과 `/privacy`, `/account-deletion`은 HTTPS 200 `VERIFIED`다.
- `api.masscom.kr` DNS·Let’s Encrypt와 외부 `/health` 200을 확인했다. Samsung Android 16에서 실제 Google 동의·session 발급·콜드 스타트 복원·logout revoke가 PASS했다. 두 번째 계정 전환 D02는 `NOT_RUN`이다.
- Google Cloud `masscom-wolgye-2026`에 Web·개발 Android·upload-key Android client를 만들고 잘못된 DailyCoding MassCOM client 3개를 삭제했다. Play 앱 서명 인증서 client는 Play Console 키가 생긴 뒤 별도로 만든다.
- 상세 값과 재개 순서는 [`docs/evidence/external-oauth-hosting-2026-09-22.json`](evidence/external-oauth-hosting-2026-09-22.json), [`docs/HANDOFF.md`](HANDOFF.md)를 따른다.

## 검증 수준별 현황

필수 36개: 30 PASS / 2 BLOCKED / 4 NOT_RUN. 아래 네 묶음은 서로 다른 상태이며 섞어 말하지 않는다.

| 수준 | 해당 항목 |
| --- | --- |
| 로컬 검증 완료 | 탐색·발급·수령·도감·추천, 지갑 주소 확인(SIWE), 발행 요청·Outbox·Worker·계약(Local Anvil), 계정 삭제, 백업·복원 drill, upload-key 운영 AAB 서명·W08·source marker·16KB 정적 검사 |
| 시험망 미검증 | Base Sepolia 계약 배포와 그 계약에 대한 Worker 발행. 배포자·역할 keystore 계정 4개와 faucet gas는 준비됐고 Worker 서비스 민터 경로는 로컬 검증됨. 실제 시험망 전송은 아직 없음 |
| 운영 실기 미검증 | 외부 HTTPS·첫 Google 로그인·upload-key 운영 package 설치/콜드 실행은 PASS. 두 번째 계정 전환 D02, fresh reauthentication 삭제, O01, 16KB 기기 실행·App Links·Play는 `NOT_RUN` |
| 사용자 승인·입력 대기 | Foundry keystore 숨김 비밀번호, D-023 수령 시 캠페인 등록 요구 여부, W04·W05용 지갑 환경(B-010·B-011), Play App Signing 인증서 client. 호스팅·도메인·OAuth·faucet·upload AAB는 해소 |

## 열린 Issue·PR과 최근 병합

실시간 목록은 `gh pr list --state all --limit 20`이 기준이다. 2026-09-22 확인한 최근 기준선은 PR #119 merge `48aa435`와 PR #120 merge `a50f678`이며 두 main CI가 PASS했다. Issue #118의 문서·디자인 브랜치는 별도 PR로 검증한다.

## Phase 상태

| Phase | 상태 | 실제 근거 |
| --- | --- | --- |
| Phase 0 저장소·개발 기반 | `VERIFIED` | README·프로젝트 포털·한국어 PR 검사·CI |
| Phase 1 외부 지갑 연결 | `IN_PROGRESS` | 개발 package MetaMask 연결→Base Sepolia→`personal_sign`→서버 `VERIFIED`→콜드 스타트 binding 복원, W06 PASS; 운영 release package·W04·W05는 `NOT_RUN/BLOCKED` |
| Phase 2 지역 상권 핵심 기능 | `VERIFIED` | loopback DEMO 탐색→점주 발급→고객 수령→도감→추천→상세 순환 PASS |
| Phase 3 NFT | `VERIFIED` | Local Anvil 계약→원자 job/Outbox→Worker→이벤트 대조→Android 등록 완료·복구 PASS; Base Sepolia `NOT_RUN` |
| Phase 4 출시 기반 | `IN_PROGRESS` | 외부 HTTPS·첫 Google 로그인·삭제 페이지·upload-key AAB 자동 gate·Samsung 운영 package 설치/콜드 실행 PASS. D02·fresh reauth·16KB 기기·App Links·Play는 미완료 |
| Phase 5 대회 검증·발표 | `IN_PROGRESS` | 발표 웹·3/5분 원고·시연 runbook·빈 현장 기록지·증거 manifest 구현; 현장·리허설·영상·제출은 NOT_RUN |
| Phase 6 후속 기능 | `PLANNED` | 별도 승인 전 미착수 |

## 구현·검증 완료

- Expo Android 앱, Reown 외부 지갑 전용 연결, 금지 RPC 메서드 차단
- Reown 새 개발 package 허용 목록 실기, MetaMask 자동 복귀, 서버 binding과 현재 주소·체인을 대조한 콜드 스타트 `VERIFIED` 복원
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
- 단체 인원·금액 한도 정책(v3 제안값, 미승인). 사람별 슬롯 독립성 Q04는 PASS
- W04 동일 세션 서명 중 주소 변경, W05 미지원 스마트 지갑 실기
- 실제 운영 계정 전환·캐시 복원 D02
- 16KB 기기에서 upload-key AAB 실행·App Links, 운영 권한 O01
- Base Sepolia·운영 signer·mainnet·Google Play 제품 배포
- 실제 현장 참여·발표 리허설·영상 촬영·저장소 공개·대회 최종 제출

## 영역별 현재 상태

| 영역 | 상태 | 내용 |
| --- | --- | --- |
| 배포 | `VERIFIED` | Vercel 포털·법적 페이지와 AWS Lightsail `api.masscom.kr` DNS·Let’s Encrypt·외부 `/health` 200·보안 헤더 확인. Worker·운영 복원은 별도 `NOT_RUN` |
| Android 빌드 | `IN_PROGRESS` | upload key AAB 승인 인증서·package·source marker·W08·16KB 정렬과 Samsung Android 16(4KB) 설치·콜드 실행 PASS. 16KB 기기·App Links·Play 업로드는 `NOT_RUN` |
| NFT·시험망 | `IN_PROGRESS` | Local Anvil 계약·Worker·이벤트 대조 PASS. Base Sepolia faucet gas는 준비됐고 keystore 배포 스크립트·실체인 시뮬레이션 PASS, 실제 배포는 `NOT_RUN`. mainnet 범위 밖 |
| 외부 지갑 연동 | `IN_PROGRESS` | `kr.masscom.wolgye.dev` MetaMask 연결·Base Sepolia·`personal_sign`·서버 검증·자동 복귀·콜드 스타트 복원과 W06 실기 PASS(B-014 해소). 운영 `kr.masscom.wolgye` release 복귀는 `NOT_RUN`; W04·W05는 `BLOCKED`(B-010·B-011) |

## 검증 상태

- 필수 36개: 30 PASS / 2 BLOCKED / 4 NOT_RUN
- API 단위: `80/80 PASS`; PostgreSQL: `37/37 PASS`
- Worker 단위: `45/45 PASS`; PostgreSQL: `23/23 PASS`; Anvil W07/M01~M08: `PASS`
- 모바일: `141/141 PASS`; typecheck·lint·Android export·Nitro Google/SecureStore development native compile `PASS`; 첫 Google 로그인·콜드 복원·logout 실기 PASS
- Foundry: `8/8 PASS`, fuzz 128, fmt·build·lint `PASS`
- 비밀 검사·부트스트랩·프로젝트 포털 접근성/구조: `PASS`
- production dependency audit: API·Worker high 이상 0; 모바일 high 이상 0, Expo 전이 moderate 14건은 B-008

## BLOCKED

- B-002 저장소 공개 전환과 심사 public 준비: 명시 승인 필요
- B-004 Google Play 정책: 공식 확인 필요. B-007 package ID는 `kr.masscom.wolgye`로 해소(D-022)
- B-008 Expo 전이 moderate advisory: 2026-09-20 Expo 57.0.24·expo-router 57.0.22 patch 적용 뒤 재평가에서도 14건 유지. 근원은 `xcode`→`uuid`(iOS 설정 도구, 빌드 시점)와 `expo-router`→`query-string`→`decode-uri-component`이며 npm이 제시하는 수정은 expo 46 다운그레이드뿐이라 호환되는 upstream 수정 필요
- B-010/B-011 W04·W05용 실제 지갑 환경 부재
- Base Sepolia broadcast는 차단이 아니라 Foundry 숨김 비밀번호 입력 전 `NOT_RUN`; upload-key AAB 자동 gate는 PASS

상세 실행 근거는 [TEST_STATUS.md](TEST_STATUS.md), Phase 3 증거는 [phase3-worker-anvil-android.json](evidence/phase3-worker-anvil-android.json), 차단 사유는 [BLOCKERS.md](BLOCKERS.md), 다음 세션 상태는 [HANDOFF.md](HANDOFF.md)를 기준으로 합니다.
