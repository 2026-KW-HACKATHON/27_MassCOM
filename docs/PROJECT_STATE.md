# 프로젝트 상태

마지막 갱신 시각: 2026-09-24 KST

## 최신 작업 경계

- PR #138은 merge `d257d0b`, main CI `35879966085` PASS. 역할 선택은 개발용 미리보기이며 운영 네 탭은 유지된다. Issue #136의 원래 첫 화면 요구는 OPEN이다.
- Issue #137에서는 정적 시연 웹 PR #139, 로컬 `_test` seed PR #140, 시연 Android 빌드 경계 PR #141을 병합했다. PR #141의 `main` CI `35889398325`는 PASS다. 후속 `fix/137-demo-auth-boundary`는 개발 DEMO 인증을 정확한 `.dev` package로 제한한다(브랜치·PR 상태는 `gh pr list`로 확인). 시연 package/scheme/API 설정만 구현됐고 외부 시연 API/DB·OAuth/Reown·APK·실기와 운영 웹 개인 도감은 미완료다.
- Issue #142의 개발용 파란 시안 기준을 운영 11개 화면과 읽기 전용 시연 웹의 라이트/다크 의미색에 적용했다. 한글 PR #143의 현재 CI·병합 상태는 `gh pr view 143`과 `git log origin/main -1`로 확인한다. 모바일 자동 180/180, typecheck·lint·Android 개발 JS export, 시연 웹 19/19·접근성·정적 검사, 테스트 AVD의 로그인 화면 라이트/다크·200%는 PASS. 로그인 후 네 탭·실제 휴대전화·공개 HTTPS는 NOT_RUN([증거](evidence/design-consistency-2026-09-24/README.md)). 아래 2026-09-23 수치를 이번 작업의 최신 결과로 오인하지 않는다.

## 기준선

| 항목 | 값 |
| --- | --- |
| 저장소 | `2026-KW-HACKATHON/27_MassCOM` (`PRIVATE`) |
| 기본 브랜치 | `main` |
| 기준 커밋 | 이 문서는 SHA를 고정하지 않는다. 실제 기준은 `git log origin/main -1`, 직전 검증 기준은 `docs/HANDOFF.md` 머리말 |
| 현재 작업·열린 PR | `gh pr list`, `gh issue list`가 기준. 인수인계 요약은 `docs/HANDOFF.md` |
| 현재 검증 기준 | PR #134 merge `e9f5b58`, main CI `35809960551` PASS, 기존 Vercel 도메인 새 SVG·`/open` HTTPS PASS. API 단위 82·PostgreSQL 37·Worker 단위 47/PG 23·모바일 149. MetaMask 재연결은 지갑 잠금으로 `BLOCKED`; 검색·필터 조작과 외부 두 IP 제한은 `NOT_RUN` |

## Issue #133 공식 서비스 URL·지갑 출처 진행

- README에는 원래 `https://masscom.kr`이 있었지만 긴 목록 안에 있었고 첫 미리보기 링크는 로컬 `docs/index.html`이었다. 공개 포털·`/open`·API·private GitHub의 역할을 상단에서 구분한다.
- Reown 승인 메타데이터는 GitHub URL 대신 `https://masscom.kr`과 기존 포털 표식을 사용한다. `api.masscom.kr` SIWE 검증, native 복귀 스킴, Base Sepolia와 허용 메서드는 변경하지 않는다.
- [PR #134](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/134) 병합과 PR·main CI PASS. 모바일 149개 단위 시험·typecheck·lint·Android export 및 포털 구조·접근성·bootstrap·비밀 검사 PASS. 기존 Vercel 프로젝트 배포 후 공개 표식 HTTPS 200·`image/svg+xml`·소스 hash 일치, `/open` 200·홈 링크 확인 PASS([증거](evidence/domain-wallet-origin-2026-09-23.json)).
- 개발 앱 새 JS와 지갑 화면은 Samsung 실기에서 열림. MetaMask 8.11.0 재연결은 비밀번호 잠금으로 `BLOCKED`; 기존 세션은 앱에서 해제되어 화면은 `NOT_CONNECTED / UNVERIFIED`. 운영 test.2 APK는 변경 전 코드이므로 새 운영 빌드·재연결은 `NOT_RUN`. Issue #133은 이 실기 완료 전 열린 상태로 유지.

## Issue #129 탐색·운영 방어와 배포

- 공개 카탈로그의 실제 점포 검색·참여 가능 필터, 첫 화면 0건/검색 0건/오류 구분을 구현했다. 148개 모바일 자동 시험·typecheck·lint·Android export는 PASS. Samsung Android 16의 실제 0건 라이트·다크·상태표시줄은 PASS([증거](evidence/android-discovery-2026-09-23.json)); 점포가 없어 검색·필터 실기와 TalkBack·200% 확대는 `NOT_RUN`.
- DEMO 인증의 외부 바인드를 기동 단계에서 차단하고, Caddy가 덮어쓴 단일 IP로 운영 로그인 제한을 분리했다. API 82개 자동 시험·typecheck PASS. Caddy·API의 변경 후 운영 배포와 외부 HTTPS/401은 [실증](evidence/lightsail-api-deployment-2026-09-23.json) PASS, 외부 2-IP 제한은 `NOT_RUN`.
- Worker는 먼저 이벤트와 정식 블록 해시를 대조하고, 블록이 사라지거나 해시가 다르면 최종화하지 않고 재시도한다. Worker 47개 자동 시험·typecheck PASS; 변경 후 Anvil 재구성 통합 시험과 Base Sepolia 재실증은 `NOT_RUN`.
- 오프라인 로그아웃 시 로컬 키를 지우되 서버 세션 회수 실패를 명시한다. 이전 서버 토큰 자동 재회수는 아직 미구현이며 만료 전 유효할 수 있다.
- 개인 Codex 설정의 기본 추론은 GPT‑6 Sol medium으로 조정했고 역할별 Luna/Sol/Astra 배분을 정리했다. 저장소의 협업 기준은 [AI 모델 사용 기준](AI_MODEL_ROUTING.md)에 기록했다.
- [PR #130](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/130)을 merge `fcaa1c0`으로 통합했고 main CI `35772682920`이 PASS했다. 기존 Lightsail 인스턴스에 같은 커밋의 API·Caddy를 배포했다. Worker 운영 서비스·계정 전환·Play는 이번 배포 범위가 아니다.

## Issue #126 모바일 UI 완료

- [PR #127](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/127)을 merge commit `4437607`로 main에 통합했다. 네 기본 탭과 탐색·방문·도감·내 정보의 시각 계층을 구현했으며 기존 API·인증·지갑·NFT 상태 로직은 변경하지 않았다.
- 모바일 자동 시험 `146/146 PASS`, typecheck·lint·Android export·Android 36 arm64 개발 APK 빌드/설치 `PASS`.
- Samsung Android 16에서 네 탭·정직한 빈 상태·360dp·200% 글씨·실시간 다크 모드·뒤로 가기·개발 scheme를 PASS했다. TalkBack 서비스와 접근성 포커스는 부분 확인했으나 첫 실행 안내로 앱 콘텐츠 낭독은 `NOT_RUN`; 두 계정 marker와 cold restore는 확인했지만 데이터·지갑이 모두 비어 D02는 `NOT_RUN`; [증거](evidence/android-ui-navigation-2026-09-23.json). 필수 36개 집계는 31/2/3 그대로다.
- `RQ-001`의 ‘로그인 없이 음식점 탐색 VERIFIED’는 현재 앱 루트의 인증 게이트와 충돌한다. 공개 API의 무로그인 조회가 앱 전체 탐색을 증명하지 않으므로 요구사항 상태를 `IN_PROGRESS`로 바로잡았다. 인증 모델 변경은 이번 UI PR 범위 밖이다.

## Issue #124 중단 체크포인트

- 브랜치 `feat/124-release-closeout`, Base Sepolia Worker proof `83e1c29`, App Link APK 기준 `0d93c49`.
- AWS Lightsail 서울 2GB 인스턴스에 커밋 `73e07c8`의 PostgreSQL·API·Caddy를 배포했고 세 컨테이너 상태를 healthy/running으로 확인했다. DB 5432·API 3000은 인터넷에 publish하지 않았다.
- Vercel 정적 포털 `https://masscom.kr`과 `/privacy`, `/account-deletion`은 HTTPS 200 `VERIFIED`다.
- `api.masscom.kr` DNS·Let’s Encrypt와 외부 `/health` 200을 확인했다. Samsung Android 16에서 실제 Google 동의·session 발급·콜드 스타트 복원·logout revoke가 PASS했다. 두 번째 계정 전환 D02는 `NOT_RUN`이다.
- Google Cloud `masscom-wolgye-2026`에 Web·개발 Android·upload-key Android client를 만들고 잘못된 DailyCoding MassCOM client 3개를 삭제했다. Play 앱 서명 인증서 client는 Play Console 키가 생긴 뒤 별도로 만든다.
- 상세 값과 재개 순서는 [`docs/evidence/external-oauth-hosting-2026-09-22.json`](evidence/external-oauth-hosting-2026-09-22.json), [`docs/HANDOFF.md`](HANDOFF.md)를 따른다.

## 검증 수준별 현황

필수 36개: 31 PASS / 2 BLOCKED / 3 NOT_RUN. 아래 네 묶음은 서로 다른 상태이며 섞어 말하지 않는다.

| 수준 | 해당 항목 |
| --- | --- |
| 로컬 검증 완료 | 탐색·발급·수령·도감·추천, 지갑 주소 확인(SIWE), 발행 요청·Outbox·Worker·계약(Local Anvil), 계정 삭제, 백업·복원 drill, upload-key 운영 AAB 서명·W08·source marker·16KB 정적 검사 |
| 시험망 검증 완료 | Base Sepolia 계약 배포, admin/minter/pauser role, cap 1 series, Worker service minter 발행 1건, receipt/event/owner/locked/metadata, 재실행 무작업 PASS |
| 운영 실기 미검증 | 외부 HTTPS·첫 Google 로그인·private GitHub APK·4KB/16KB·App Links는 PASS. D02, fresh reauthentication, O01, Play는 `NOT_RUN` |
| 사용자 승인·입력 대기 | Foundry keystore 숨김 비밀번호, D-023 수령 시 캠페인 등록 요구 여부, W04·W05용 지갑 환경(B-010·B-011), Play App Signing 인증서 client. 호스팅·도메인·OAuth·faucet·upload AAB는 해소 |

## 열린 Issue·PR과 최근 병합

실시간 목록은 `gh pr list --state all --limit 20`이 기준이다. 2026-09-23 최근 기준선은 PR #127 merge `4437607`, main CI run `35763199480` PASS다. 직전 release 기준선은 PR #125 merge `de1448f`, main CI `35733488626` PASS다.

## Phase 상태

| Phase | 상태 | 실제 근거 |
| --- | --- | --- |
| Phase 0 저장소·개발 기반 | `VERIFIED` | README·프로젝트 포털·한국어 PR 검사·CI |
| Phase 1 외부 지갑 연결 | `IN_PROGRESS` | 개발 package MetaMask 연결→Base Sepolia→`personal_sign`→서버 `VERIFIED`→콜드 스타트 binding 복원, W06 PASS; 운영 release package·W04·W05는 `NOT_RUN/BLOCKED` |
| Phase 2 지역 상권 핵심 기능 | `VERIFIED` | loopback DEMO 탐색→점주 발급→고객 수령→도감→추천→상세 순환 PASS |
| Phase 3 NFT | `VERIFIED` | Local Anvil 복구 흐름과 Base Sepolia 계약→job/Outbox→암호화 service minter→이벤트·소유자·locked·중복 방지 PASS |
| Phase 4 출시 기반 | `IN_PROGRESS` | 외부 HTTPS·첫 Google 로그인·삭제 페이지·GitHub test.2 APK·4KB/16KB·verified App Link PASS. D02·fresh reauth·Play는 미완료 |
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
- 운영 권한 O01
- mainnet·Google Play 제품 배포
- 실제 현장 참여·발표 리허설·영상 촬영·저장소 공개·대회 최종 제출

## 영역별 현재 상태

| 영역 | 상태 | 내용 |
| --- | --- | --- |
| 배포 | `VERIFIED` | Vercel 포털·법적 페이지와 AWS Lightsail `api.masscom.kr` DNS·Let’s Encrypt·외부 `/health` 200·보안 헤더 확인. Worker·운영 복원은 별도 `NOT_RUN` |
| Android 빌드 | `IN_PROGRESS` | private GitHub test.2 APK, upload key AAB gate, Samsung 4KB·Android 36 16KB AVD·verified `/open` App Link PASS. Play 업로드는 `NOT_RUN` |
| NFT·시험망 | `VERIFIED` | Local Anvil 복구·장애 흐름과 Base Sepolia 실제 계약·role·series·Worker mint #1·중복 방지 PASS. mainnet 범위 밖 |
| 외부 지갑 연동 | `IN_PROGRESS` | `kr.masscom.wolgye.dev` MetaMask 연결·Base Sepolia·`personal_sign`·서버 검증·자동 복귀·콜드 스타트 복원과 W06 실기 PASS(B-014 해소). 운영 `kr.masscom.wolgye` release 복귀는 `NOT_RUN`; W04·W05는 `BLOCKED`(B-010·B-011) |

## 검증 상태

- 필수 36개: 31 PASS / 2 BLOCKED / 3 NOT_RUN
- API 단위: `82/82 PASS`; PostgreSQL: 직전 `37/37 PASS`(이번 변경 뒤 미재실행)
- Worker 단위: `47/47 PASS`; PostgreSQL: 직전 `23/23 PASS`(이번 변경 뒤 미재실행); Anvil W07/M01~M08: 직전 `PASS`
- 모바일: `148/148 PASS`; typecheck·lint·Android export `PASS`. Issue #129의 Samsung 빈 화면 라이트·다크·상태표시줄 실기 PASS. 첫 Google 로그인·콜드 복원·logout과 Issue #126 네 탭 실기는 이전 코드 기준 PASS이며, 변경 후 검색·필터·TalkBack 앱 낭독·완전한 D02는 `NOT_RUN`
- Foundry: `8/8 PASS`, fuzz 128, fmt·build·lint `PASS`
- 비밀 검사·부트스트랩·프로젝트 포털 접근성/구조: `PASS`
- production dependency audit: API·Worker high 이상 0; 모바일 high 이상 0, Expo 전이 moderate 14건은 B-008

## BLOCKED

- B-002 저장소 공개 전환과 심사 public 준비: 명시 승인 필요
- B-004 Google Play 정책: 공식 확인 필요. B-007 package ID는 `kr.masscom.wolgye`로 해소(D-022)
- B-008 Expo 전이 moderate advisory: 2026-09-20 Expo 57.0.24·expo-router 57.0.22 patch 적용 뒤 재평가에서도 14건 유지. 근원은 `xcode`→`uuid`(iOS 설정 도구, 빌드 시점)와 `expo-router`→`query-string`→`decode-uri-component`이며 npm이 제시하는 수정은 expo 46 다운그레이드뿐이라 호환되는 upstream 수정 필요
- Issue #129 재평가에서는 모바일 moderate 15건, high/critical 0건. 자동 downgrade는 적용하지 않았다. 오프라인 서버 세션 회수 재시도와 운영 프록시 실증은 남아 있다.
- B-010/B-011 W04·W05용 실제 지갑 환경 부재
- Base Sepolia Worker proof와 upload-key AAB·16KB runtime·App Links는 PASS. Play는 별도 `NOT_RUN`

상세 실행 근거는 [TEST_STATUS.md](TEST_STATUS.md), Phase 3 증거는 [phase3-worker-anvil-android.json](evidence/phase3-worker-anvil-android.json), 차단 사유는 [BLOCKERS.md](BLOCKERS.md), 다음 세션 상태는 [HANDOFF.md](HANDOFF.md)를 기준으로 합니다.
