# 프로젝트 상태

마지막 갱신 시각: 2026-09-20 KST

## 기준선

| 항목 | 값 |
| --- | --- |
| 저장소 | `2026-KW-HACKATHON/27_MassCOM` (`PRIVATE`) |
| 기본 브랜치 | `main` |
| 기준 커밋 | 이 문서는 SHA를 고정하지 않는다. 실제 기준은 `git log origin/main -1`, 직전 검증 기준은 `docs/HANDOFF.md` 머리말 |
| 현재 작업·열린 PR | `gh pr list`, `gh issue list`가 기준. 인수인계 요약은 `docs/HANDOFF.md` |
| 현재 검증 기준 | API 43·PostgreSQL 28·Worker 33/PG 18·모바일 57·Foundry 8/fuzz128·Anvil PASS |

## 검증 수준별 현황

필수 36개: 30 PASS / 2 BLOCKED / 4 NOT_RUN. 아래 네 묶음은 서로 다른 상태이며 섞어 말하지 않는다.

| 수준 | 해당 항목 |
| --- | --- |
| 로컬 검증 완료 | 탐색·발급·수령·도감·추천, 지갑 주소 확인(SIWE), 발행 요청·Outbox·Worker·계약(Local Anvil), 계정 삭제, 백업·복원 drill, 운영 variant AAB 정적 검사(W08), 배포·서명 사전 검사 스크립트 |
| 시험망 미검증 | Base Sepolia 계약 배포와 그 계약에 대한 Worker 발행. 배포자·역할 keystore 계정 4개는 소유자가 2026-09-20 생성, 배포자 잔액 0(faucet 대기). Worker의 서비스 민터 서명 경로는 구현·로컬 검증됨(Issue #100), 실제 시험망 전송은 아직 없음 |
| 운영 코드 미구현 | 운영 로그인·서버 세션·재인증(현재는 `ALLOW_INSECURE_DEMO_ACCOUNT` DEMO resolver만), 시연/운영 환경 권한 경계(O01), 외부 HTTPS 배포·삭제 페이지 |
| 사용자 승인·입력 대기 | **Reown 허용 목록에 새 package 등록(B-014, 실기에서 지갑 연결 거절)**, 호스팅·도메인(`docs/HOSTING_LOGIN_PROPOSAL.md`. 로그인 방식·세션·재인증은 D-024~D-026으로 승인됨, 구현 전), D-023 수령 시 캠페인 등록 요구 여부, upload keystore와 인증서 지문, faucet gas, Android 기기 연결, W04·W05용 지갑 환경(B-010·B-011) |

## 열린 Issue·PR과 최근 병합

실시간 목록은 `gh pr list --state all --limit 20`이 기준이다. 2026-09-20 기준 병합: #63·#64·#65·#67·#68·#69·#70·#72·#74·#76·#79·#81·#82·#83(PragmoB)·#85·#87·#89·#91·#93.

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
- 단체 인원·금액 한도 정책(v3 제안값, 미승인). 사람별 슬롯 독립성 Q04는 PASS
- W04 동일 세션 서명 중 주소 변경, W05 미지원 스마트 지갑 실기
- 실제 운영 계정 전환·캐시 복원 D02. W08은 로컬 production AAB 정적 검사로 PASS이며 upload key 서명본에서 같은 명령을 다시 실행해야 함
- release AAB·16KB·App Link A02, 운영 권한 O01
- 외부 HTTPS·Base Sepolia·운영 signer·mainnet·Google Play·공개 데모
- 실제 현장 참여·발표 리허설·영상 촬영·저장소 공개·대회 최종 제출

## 영역별 현재 상태

| 영역 | 상태 | 내용 |
| --- | --- | --- |
| 배포 | `BLOCKED` | 외부 HTTPS·클라우드 없음(B-003). loopback DEMO와 로컬 PostgreSQL만 검증 |
| Android 빌드 | `IN_PROGRESS` | 개발 빌드 실기 PASS. 운영 variant `kr.masscom.wolgye` 로컬 debug 서명 AAB에서 package·scheme·권한·16KB 정렬 PASS. upload key 서명 AAB·16KB 기기 설치·Play 업로드는 `NOT_RUN` |
| NFT·시험망 | `IN_PROGRESS` | Local Anvil 계약·Worker·이벤트 대조 PASS. Base Sepolia는 keystore 배포 스크립트와 실체인 시뮬레이션 PASS, 실제 배포는 `NOT_RUN`(B-012). mainnet 범위 밖 |
| 외부 지갑 연동 | `IN_PROGRESS` | MetaMask 연결·Base Sepolia 전환·`personal_sign`·서버 검증·W06 실기 PASS. W04·W05는 지갑 환경 부재로 `BLOCKED`(B-010·B-011). 새 package·scheme 실기 회귀는 `NOT_RUN` |

## 검증 상태

- 필수 36개: 30 PASS / 2 BLOCKED / 4 NOT_RUN
- API 단위: `43/43 PASS`; PostgreSQL: `28/28 PASS`
- Worker 단위: `33/33 PASS`; PostgreSQL: `18/18 PASS`; Anvil W07/M01~M08: `PASS`
- 모바일: `57/57 PASS`; typecheck·lint·Android export `PASS`
- Foundry: `8/8 PASS`, fuzz 128, fmt·build·lint `PASS`
- 비밀 검사·부트스트랩·프로젝트 포털 접근성/구조: `PASS`
- production dependency audit: API·Worker high 이상 0; 모바일 high 이상 0, Expo 전이 moderate 14건은 B-008

## BLOCKED

- B-002 저장소 공개 전환과 심사 public 준비: 명시 승인 필요
- B-003 외부 HTTPS·유료 클라우드: 비용·계정 승인 필요
- B-004 Google Play 정책: 공식 확인 필요. B-007 package ID는 `kr.masscom.wolgye`로 해소(D-022)
- B-008 Expo 전이 moderate advisory: 2026-09-20 Expo 57.0.24·expo-router 57.0.22 patch 적용 뒤 재평가에서도 14건 유지. 근원은 `xcode`→`uuid`(iOS 설정 도구, 빌드 시점)와 `expo-router`→`query-string`→`decode-uri-component`이며 npm이 제시하는 수정은 expo 46 다운그레이드뿐이라 호환되는 upstream 수정 필요
- B-010/B-011 W04·W05용 실제 지갑 환경 부재
- B-012 Base Sepolia 전용 배포자·faucet gas 부재
- B-013 운영 재인증과 소유 HTTPS 외부 삭제 URL 부재

상세 실행 근거는 [TEST_STATUS.md](TEST_STATUS.md), Phase 3 증거는 [phase3-worker-anvil-android.json](evidence/phase3-worker-anvil-android.json), 차단 사유는 [BLOCKERS.md](BLOCKERS.md), 다음 세션 상태는 [HANDOFF.md](HANDOFF.md)를 기준으로 합니다.
