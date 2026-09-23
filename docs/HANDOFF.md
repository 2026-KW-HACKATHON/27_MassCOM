# HANDOFF

마지막 갱신 시각: 2026-09-24 KST

## Issue #137 시연 Android 빌드 경계 (진행 중)

- 브랜치 `feat/137-showcase-android-boundary`는 main `d257d0b`에서 시작했다. 계획 `d98b228`은 독립 Astra 검토 CLEAR, URL·variant 차단 `9e378d5`, 세 Android 정체성과 지갑 복귀 `2cf97c2`를 완료했다. 실제 PR·CI·merge 상태는 `gh pr list`와 `git log origin/main -1`에서 확인한다.
- `showcase`는 `kr.masscom.wolgye.demo`/`masscom-demo`/`월계 마스코트 체험용`과 정확한 `https://demo-api.masscom.kr`만 허용한다. 운영은 `https://api.masscom.kr`만, 개발은 기존 loopback DEMO만 허용한다. 시연 빌드가 기존 Google/Reown 공개 ID를 받으면 거절한다. 163개 모바일 단위·typecheck·lint·개발 Android JS export·W08 검사 도구 회귀는 PASS.
- 아직 없는 것으로 **확인된 것**은 별도 API/DB·OAuth/Reown 프로젝트의 저장소 연결과 실제 시연 설치본 증거다. 외부 자원 자체의 존재 여부는 재확인 전 단정하지 않는다. Android 시연·운영 동시 설치, 실제 QR/지갑 복귀, 외부 HTTPS, 시연 AAB W08은 NOT_RUN. 운영 DB에는 가상 seed를 넣지 않는다.
- 다음: 한국어 PR의 CI·독립 코드 리뷰 후 이 경계만 통합한다. 이어서 #137의 별도 시연 API 인증/DB, 운영 웹 읽기 전용 개인 도감, 디자인 일관화, 외부 환경·실기 증거를 각각 진행한다. 새 유료 자원·DNS·공개 배포는 승인 경계를 확인한다.

## Issue #136 PR #138 수정 작업 (현재)

- 사용자가 최근 PR 검토 뒤 참고할 부분을 가져와 수정하도록 요청했다. [PR #138 검토 답글](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/138#issuecomment-5796835197)을 남겼다. 기존 CI `35836456584`는 `navigation/route-boundary.tsx`의 비허용 Reown import 때문에 FAIL이었다.
- `main de6f168`을 `feat/mobile-ui-foundation`에 일반 merge로 반영했다(공유 이력 force push 없음). 역할 카드·선택적 지갑 문구·다섯 공간은 개발용 `foundation-preview`로 격리하고, 실제 앱은 기존 `탐색 / 방문 인증 / 도감 / 내 정보` 네 탭과 루트 인증·지갑 제공자 경계를 유지한다. 설정의 미리보기 진입점은 `__DEV__`에서만 표시한다.
- 수정본 로컬 모바일 단위 152/152, typecheck·lint·Android JS export와 release wallet surface 회귀 PASS. 새 UI 시안 Android 실기·TalkBack·200% 글꼴·실제 외부지갑 복귀는 아직 `NOT_RUN`. Android 16 에뮬레이터에서 개발 앱은 실행됐으나 인증 화면에서 미리보기까지 진입하지 못했다. [수정 범위와 최초 캡처 구분](evidence/mobile-ui-foundation/README.md).
- 현재 브랜치의 수정·PR CI·Android 실기 상태는 작업 완료 후 `git status -sb`, `gh pr checks 138`과 아래 검증 기록으로 다시 확인한다. 원래 시안의 브라우저 캡처를 수정본 실기 증거로 사용하지 않는다. Issue #136의 최초 “첫 화면 역할 선택” 수용 기준은 현재 운영 시작 화면에 적용되지 않으므로 PR의 자동 종료 문구를 제거하고 Issue는 별도 판단 전 OPEN으로 둔다.

## Issue #136 모바일 UI 기초 PR 작업 (최초 head의 과거 기록)

- 브랜치 `feat/mobile-ui-foundation`, 당시 기준 main `60d37a7`. 기존 checkout과 분리해 최신 원격 저장소를 clone했다. 최초 요청은 PR 작성까지만이었으나 이후 사용자가 검토·수정을 다시 요청했다.
- 첫 화면 역할 선택 → 사용자 선택적 외부지갑 안내 / 점주 DEMO → 콘텐츠 없는 5면 스와이프 UI. 기존 기능 탐색은 `/explore`로 보존한다. `DESIGN.md` 상단이 이번 UI 범위의 우선 기준이다.
- 공개 화면은 데이터 없는 index/open으로 제한하고 기존 기능은 인증 경계를 유지한다. root navigator는 인증 복원 중에도 유지하고, 보호 콘텐츠만 계정에 따라 remount한다. 외부지갑 연결·서명·세션 구현은 변경하지 않는다.
- 구현 commit `0917d8e`, [PR #138](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/138) OPEN·미병합. 모바일 153개 시험·typecheck·lint·Android export, bootstrap·운영 문서·접근성·비밀·개인정보 검사 PASS. [화면 및 검증 범위](evidence/mobile-ui-foundation/README.md). GitHub CI는 생성 직후 실행 중이며 실제 최신 상태를 PR에서 확인한다.
- 다음 명령: `gh pr checks 138 --repo 2026-KW-HACKATHON/27_MassCOM`. 새 Android UI 실기·TalkBack·실제 지갑 복귀는 NOT_RUN. 과거 Android 실기 PASS를 이번 UI 실기 증거로 재사용하지 않는다. 사용자 요청대로 병합하지 않는다.

## Issue #133 공식 서비스 출처·배포 체크포인트

- [Issue #133](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/133), [PR #134](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/134) merge `e9f5b58eef219a1e0a639d2605c2bb98744f4fa1`. PR CI `35809652307`와 main CI `35809960551` 전체 PASS, 독립 코드 리뷰 APPROVE. 실기 미완료로 Issue를 다시 열었다.
- MetaMask의 `github.com` 표시는 `apps/mobile/src/wallet/appkit.ts`의 메타데이터 URL에서 왔다. 이를 공식 포털 `https://masscom.kr`과 기존 포털 표식의 HTTPS 자산으로 바꿨다. `api.masscom.kr` 서버 SIWE 검증·Android native 복귀·지갑 메서드는 그대로다.
- README 첫 웹 진입점과 포털의 Android `/open` CTA, 공개 페이지 canonical URL을 정리했다. private GitHub 코드·PR·APK 링크는 대체하지 않는다. Vercel 연결 대상은 기존 `choijunhuks-projects/masscom-wolgye`로 읽기 확인했고 새 프로젝트·유료 자원은 만들지 않았다.
- 로컬 모바일 149/149·typecheck·lint·Android export, 포털·접근성·bootstrap·비밀 검사는 PASS. 기존 Vercel 프로젝트에 `dpl_5uoWV6TVcDFRsqviVxbbe2rPuLb4`를 운영 배포했고, 공개 SVG HTTPS 200·MIME `image/svg+xml`·소스와 SHA-256 일치, `/open` 200·홈 canonical/CTA 확인까지 PASS([증거](evidence/domain-wallet-origin-2026-09-23.json)).
- Samsung Android 16 개발 앱에서 새 Metro JS와 외부 지갑 화면을 열고 기존 WalletConnect 세션을 해제했다. MetaMask 8.11.0 재연결은 지갑 비밀번호 잠금 화면 때문에 `BLOCKED`; 앱은 `NOT_CONNECTED / UNVERIFIED`로 돌아왔다. 비밀번호·복구 문구는 수집·입력하지 않았다. 기존 test.2 release APK에는 이번 JS 메타데이터가 없다.
- 다음: 소유자가 기기에서 MetaMask를 직접 잠금 해제하면 개발 앱에서 다시 연결해 승인 화면의 `masscom.kr`·표식·앱 자동 복귀를 확인한다. 새 운영 APK 빌드·설치와 Play는 별도 `NOT_RUN`이며, 실제 완료 전 Issue #133을 닫지 않는다.

## Issue #129 병합·운영 배포 체크포인트

- 기준: [Issue #129](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/129)·[PR #130](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/130) merge `fcaa1c0c096408d15d064600047bccefd7896cb6`. PR CI `35772111371`과 main CI `35772682920` PASS. 현재 main·후속 PR은 `git status -sb`, `git log -1`, `gh pr list --state all`에서 확인한다. 이전 UI 작업을 반복하지 않는다.
- 탐색: 실제 공개 점포 목록에 한정한 검색·참여 가능 필터와 정직한 0건 화면을 구현했다. 새 마스코트/점포 자산은 추가하지 않았다.
- 보안: DEMO 외부 바인드 거부, Caddy 단일 원 클라이언트 IP를 명시적으로 신뢰하는 로그인 제한, Worker 이벤트/정식 블록 해시 일치, 오프라인 로그아웃의 서버 회수 실패 표시를 추가했다.
- 자동 검증: 모바일 148/148, API 82/82, Worker 47/47, 세 패키지 typecheck와 모바일 lint·Android export·Lightsail 배포 설정 회귀·Caddy 구문 검사 PASS. Samsung에서 실제 공개 점포 0건의 라이트·다크·상태표시줄을 확인하고 원래 라이트 모드로 복원했다. [화면 증거](evidence/android-discovery-2026-09-23.json). 검색·필터 실기·TalkBack·외부 2-IP 제한·Anvil 재구성 통합은 `NOT_RUN`; 운영 API·Caddy 배포와 HTTPS 확인은 아래 증거대로 PASS.
- 모델: 개인 Codex 기본은 GPT‑6 Sol medium, 탐색은 Luna low, 고위험 독립 리뷰는 Astra medium/high로 조정했다. `docs/AI_MODEL_ROUTING.md`가 팀 가이드다. 현재 실행 중인 대화의 모델은 소급 변경되지 않는다.
- PR #130의 첫 CI `35771836501`은 운영 문서 검사에 남은 과거 자동 시험 수(API 80·모바일 146) 때문에 실패했다. 새 기준 82/47/148과 변경 검출 회귀 시험으로 수정해 PR·main CI를 통과시켰다.
- [운영 배포 증거](evidence/lightsail-api-deployment-2026-09-23.json): 기존 Lightsail에 `fcaa1c0` API·Caddy를 배포하고 PostgreSQL/API healthy, Caddy running, 외부 HTTPS health 200·DEMO 헤더만 사용한 `/collection` 401을 확인했다. 이전 release `73e07c8cf1e3`와 이미지가 되돌리기 경로로 남아 있다. 새 유료 자원·키·메인넷 전송은 없다.
- 남은 것: 실제 공개 점포 검색·필터 조작·TalkBack·200% 글꼴, 외부 두 IP 로그인 제한, Worker 운영 배포·Anvil 재구성 통합, D02·B-017·Play/공개/제출. 오프라인 서버 세션 자동 재회수는 별도 보안 설계가 필요하다.

## 2026-09-23 모바일 UI 병합 완료

- Issue #126과 [PR #127](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/127)을 merge commit `4437607`로 main에 통합했다. PR 최종 CI `35762617508`과 main CI `35763199480`은 전체 PASS했다.
- 코드 커밋 `d874502`(네 탭), `28f5c45`(강조색), `59c6eae`(탐색), `6445a2d`(방문·도감·내 정보), `9c2daac`(48dp), `e03b24d`(Samsung 반응형·live dark·DEMO 경계)와 증거 commit `29d2dcf`가 merge 이력에 보존됐다.
- 모바일 `146/146 PASS`, typecheck·lint·Android export·bootstrap PASS. Android 36 16KB AVD용 arm64 개발 APK 97MB 빌드·설치/실행과 Samsung Android 16 네 탭 실기까지 PASS. 전체 로컬 secret scan은 Git-ignored 환경 파일 2개로 BLOCKED, 깨끗한 tracked archive scan은 PASS.
- Samsung에서 네 탭·빈 상태·360dp·200% 글씨·실시간 다크 모드·추천 뒤로 가기·`masscom-dev://collection`/`open`을 확인했다. 운영 계정의 DEMO 점주 링크, 200% 탭 잘림, live dark 불일치, Link asChild 런타임 오류를 재현 후 수정했다. TalkBack 앱 낭독·현재 코드 production App Link·완전한 D02는 `NOT_RUN`; `docs/evidence/android-ui-navigation-2026-09-23.json`을 본다.
- RQ-001의 로그인 없는 탐색과 현재 앱 루트 인증 게이트가 충돌하므로 PRD 상태를 `IN_PROGRESS`로 바로잡았다(B-017). 이번 UI PR에서 인증 모델을 바꾸지 않는다.
- 다음: UI를 다시 만들거나 새 PR로 분할하지 않는다. TalkBack 앱 낭독·현재 코드 production App Link·완전한 D02는 별도 `NOT_RUN`으로 유지하고 B-017 무로그인 탐색 정책을 결정하기 전 인증 모델을 바꾸지 않는다.

## 2026-09-23 모바일 UI 설계 단계 기록(과거 상태)

- 현재 작업: Issue #126, 브랜치 `feat/126-mobile-ui-navigation`, 기준 main `de1448f`.
- 사용자는 ‘따뜻한 동네 음식 탐험 + 마스코트 수집’ 및 B안 기본 이동(`탐색 / 방문 인증 / 도감 / 내 정보`)을 승인했다.
- 루트 `DESIGN.md`와 `docs/superpowers/specs/2026-09-23-mobile-ui-navigation-design.md`의 상세 설계를 사용자가 승인했다. 당시에는 `docs/superpowers/plans/2026-09-23-mobile-ui-navigation.md`의 구현 계획이 검토 대기였고 UI 코드가 없었다. 현재 상태는 맨 위 구현 체크포인트를 따른다.
- 두 번째 Google 계정은 연결된 Samsung 기기에 있고 운영 앱 로그인 및 서버 session 발급을 확인했다. 계정 이메일은 Git·문서에 기록하지 않는다. A↔B 데이터/지갑 분리와 콜드 복원까지 확인하지 않았으므로 D02는 `NOT_RUN` 유지한다.
- 이 항목은 설계 단계의 기록이다. 새 세션은 맨 위 구현 체크포인트와 실제 `git`/`gh` 상태를 우선한다.

이전 작업 기록 갱신 시각: 2026-09-22 22:03 KST
작업 브랜치: `feat/124-release-closeout`
연결 Issue: `#124 GitHub Android 설치와 남은 출시·시험망 검증을 마감한다`
기준 main 커밋 SHA: `83e1c29`. 현재 App Link APK 기준은 `0d93c49`, Base Sepolia proof 기준선은 main `83e1c29`다. 이후 상태는 `git status`, `git log`, `gh pr list`를 우선한다.

새 세션이나 다른 계정은 Phase 0을 반복하지 말고 아래 “다음 세션이 가장 먼저 해야 할 작업”부터 이어간다. 문서와 GitHub가 다르면 실제 commit·merge 기록을 따른다.

## 2026-09-22 중단 체크포인트 — 반복 금지

- AWS Free Plan의 `$100` 크레딧 범위에서 서울 리전 Lightsail `masscom-api-seoul`(Ubuntu 24.04, 2GB, 월 최대 `$12`)을 생성했다. Paid Plan 전환은 하지 않았다.
- 고정 IP `masscom-api-ip`(`43.200.56.97`)를 연결하고 Lightsail 방화벽에 HTTP 80·HTTPS 443을 추가했다. SSH 22는 배포 마감 전 임시로 열려 있다.
- 커밋 `73e07c8`을 `/opt/masscom/releases/73e07c8cf1e3`에 배포했다. PostgreSQL·API·Caddy가 healthy이고 `/opt/masscom/DEPLOYED_COMMIT`이 해당 전체 SHA를 가리킨다. PostgreSQL 5432와 API 3000은 인터넷에 publish하지 않았다.
- `A api 43.200.56.97 TTL 600`을 가비아에 저장하고 공용 DNS 전파를 확인했다. Caddy 재시작 뒤 Let’s Encrypt 인증서, `https://api.masscom.kr/health` HTTP/2 200·`{"status":"ok"}`·`no-store`·HSTS·nosniff·frame DENY를 확인했다.
- Vercel `masscom-wolgye` production deployment `dpl_6MrwqxM8cxwoV7jSvLBiPHJhYY3Z`가 READY다. 포털·법적 페이지·`/.well-known/assetlinks.json`·`/open`을 HTTPS로 확인했다.
- Google Cloud 새 프로젝트 `MassCOM`(`masscom-wolgye-2026`, project number `172380658768`)에 아래 OAuth client를 만들었다. 다시 만들지 않는다.
  - Web server: `172380658768-n5r2vad5f2g6ndb9kh2cbcig1j9i792g.apps.googleusercontent.com`
  - 개발 Android: `172380658768-4rpku6qkj265b7p1m55tduvegks5dv91.apps.googleusercontent.com`, `kr.masscom.wolgye.dev`, debug SHA-1 `0A:15:0F:D7:20:43:47:B3:D2:D1:E1:10:36:D9:89:4C:BD:A7:0D:C7`
  - 운영 직접 설치용 Android: `172380658768-kk7r7rnhvqr6799q4thcjfjkq3flasha.apps.googleusercontent.com`, `kr.masscom.wolgye`, upload SHA-1 `06:CB:25:F6:60:11:56:57:E7:8C:75:EF:DC:1E:75:43:A1:54:2A:7D`
- 잘못 사용하던 `dailycoding-492802` 프로젝트에서 MassCOM Web·개발 Android·운영 Android client 3개를 삭제했다. 기존 `DailyCoding` Web client는 보존했다. 삭제 항목은 Google에서 30일 내 복원 가능하지만 복원하지 않는다.
- `apps/mobile/.env.local`은 Git 비추적 상태로 새 Web client ID와 `https://api.masscom.kr`을 가리킨다.
- Google OAuth 테스트 사용자 1명을 등록했다. 기본 Credential Manager flow는 Samsung Android 16에서 622,528바이트 `TransactionTooLargeException`으로 시스템 selector가 종료됐다. 커밋 `e84a7a8`이 explicit Google button flow를 우선하도록 고쳤고 실제 동의→ID token→외부 API session, 콜드 스타트 SecureStore 복원, logout과 서버 revoke를 PASS했다. 두 번째 계정 전환은 `NOT_RUN`이다.
- 중단하면서 Metro·로컬 API를 종료하고 ADB reverse를 제거했으며 개발 앱을 force-stop했다. AWS와 Vercel 서비스만 계속 실행 중이다.

### 다음 실행의 정확한 재개 순서

1. private GitHub test.2 APK와 Samsung 4KB·Android 36 16KB AVD 설치/콜드 실행·HTTPS `/open` App Links를 완료해 A02 PASS다.
2. Base Sepolia 계약·role·cap 1 series·Worker service minter mint #1·재실행 무작업을 완료했다. 다시 배포·발행하지 않는다.
3. 두 번째로 승인된 Google 테스트 계정이 생길 때만 계정 전환 D02를 실기한다.
4. 현재 문서 갱신 커밋을 push한 후 한글 PR 하나로 CI·리뷰·merge한다. Google Play 제출·저장소 공개·대회 최종 제출은 실행하지 않는다.

## 이번 세션에서 완료한 것

- Issue #118: PR #119에서 release provenance·W08·privacy·서비스 민터 fail-closed 검사를 강화하고 merge `48aa435`, main CI `35606071753` PASS
- Issue #118: PR #120에서 모바일 Bearer/DEMO 인증 배타, SecureStore 부분 실패 복구, 로그아웃·계정 전환 직렬화, mint polling 단조성을 보강하고 merge `a50f678`, main CI `35620303554` PASS
- `docs/118-design-evidence`: 라이트·다크 의미색 대조, Reown 테마 동기화, TalkBack live region·QR 설명, 새 clone/PR 검사 문서, API·Worker 운영 경계, 포털·발표·증거 일관성 검사를 추가. 포털·발표 1440px/390px 시각 판정 96점, 가로 넘침 없음
- Issue #116: Reown 허용 목록의 개발 package 실기, MetaMask 연결→Base Sepolia→`personal_sign`→서버 `VERIFIED` 자동 복귀, 콜드 스타트에서 서버 binding 주소·체인 대조 복원, 미설치 SafePal 복귀를 Samsung SM-S928N에서 PASS. 수정 전에는 DB binding이 있어도 `UNVERIFIED`로 돌아가는 결함을 재현
- 저장소 밖 upload PKCS12 키의 권한 `0600`·별칭·공개 인증서 지문을 확인하고 SHA-256만 고정. commit `f13a283`의 upload-key AAB 서명·bundletool manifest·W08·provenance·16KB 정적 검사를 PASS
- Issue #110: Google `auth_time` 최근성, JWKS 최대 stale 24시간, `/auth/google` 검증 전 요청 제한, 만료·폐기 세션 bounded cleanup(migration 0013), Play 카메라·NFT award 초안 정합
- Issue #112: EIP-1559 priority fee 관계·signed sender 대조, raw-key 이름 변형, keystore 전체 상위 경로, lock timeout·pool 설정 보강
- PR #111 merge `205d273`, main CI `35561417735` PASS. PR #114 merge `595f70f`, 최종 PR CI `35563298914`·main CI `35563583964` PASS. PR #113은 GitHub가 CI run을 만들지 않아 동일 커밋으로 대체 후 종료
- Issue #59: 체인 cursor에서 `CHAIN_REORG_MARGIN`만큼 되돌아가 조회하고, 못 찾으면 배포 기준 블록까지 다시 조회. cursor 조회 실패는 `CHAIN_CURSOR_READ_FAILED` 재시도 오류. ethers 요청 cache 때문에 Anvil에서 간헐적으로 30초 대기하던 원인 제거
- Issue #61: Worker 재시도 지수 backoff(1초→최대 5분)와 전송 시도 5회 도달 시 `MANUAL_REVIEW`(`RETRY_LIMIT_EXCEEDED`) 전환. migration 없음
- Expo 57.0.24·expo-router 57.0.22·@expo/ui 57.0.19 patch 적용. 모바일 moderate 권고 14건은 upstream 수정이 없어 B-008 유지
- Issue #66: SIWE challenge를 PostgreSQL `wallet_challenges`(migration 0008)에 저장, 원자적 claim, 만료 정리. 보안 리뷰 지적 반영: binding 기록 뒤 nonce를 되돌리지 않아 서명 재사용 차단, 계정 삭제 transaction 안에서 challenge 제거
- Base Sepolia keystore 전용 배포 스크립트와 실체인 시뮬레이션 PASS(전송 없음). 계정 삭제가 접수되면 앱이 지갑 연결을 끊고 기기의 WalletConnect 세션 제거(D-021)
- 운영 package ID `kr.masscom.wolgye`(D-022)와 개발 variant 분리, `scripts/build-release-aab.sh`, 로컬 debug 서명 운영 AAB에서 package·scheme·overlay 권한 제거·16KB 정렬 48개 PASS
- Google Play Console 제출 초안 `docs/PLAY_CONSOLE_DRAFT.md`(입력·제출 없음)
- Issue #92: 백업·복원 drill 스크립트와 회귀 시험, `docs/DEVICE_TEST_PLAN.md`(실기 시험 절차), `docs/HOSTING_LOGIN_PROPOSAL.md`(외부 HTTPS·로그인 승인 요청 묶음, 자원 미생성)
- Issue #90: 스마트 지갑(계약 계정) 서명 3가지 형태가 `SIGNER_MISMATCH`로 거절되고 binding이 생기지 않으며 challenge가 재시도 가능함을 fixture로 고정, 앱 안내에 미지원 설명 추가. W05는 실기 환경이 없어 `BLOCKED` 유지(B-011)
- Issue #88: 배포 안내의 `cast wallet import`→`cast wallet new <이름>` 정정, 배포 스크립트 사전 검사(keystore 계정·chainId·역할 주소·기존 broadcast 기록 시 `--redeploy` 요구), 빌드 스크립트 산출물 출처 출력과 debug 서명 종료 코드 3, `android.injected.signing.*` 주입을 일회용 키로 확인. 실제 전송·upload key 서명은 하지 않음
- Issue #86: 로컬 production AAB를 `scripts/check-release-wallet-surface.sh`로 정적 검사해 W08 PASS. SDK는 `features.onramp` 미지정 시 온램프를 켜고 계정 화면의 송금 버튼에는 flag가 없으므로, 명시적 false와 “`open()`은 Connect view만·SDK 버튼 미렌더링”을 CI 회귀 시험으로 고정. upload key 서명본에서 같은 명령을 다시 실행해야 함
- Issue #84: 같은 주문 참조 아래 사람별 슬롯 독립성을 PostgreSQL로 실증해 Q04 PASS(스키마 변경 없음). 단체 최대 인원·1인 최소 금액·명단 고정은 v3 제안값이라 구현하지 않음. 발표 첫 화면의 오래된 집계(26/8)를 고치고 검증기가 그 위치도 검사하게 함
- Issue #78: 연속 재시도를 `mint_jobs.retry_streak`(migration 0010)에 기록해 지연을 최대 5분까지 늘림(수동 검토 전환에는 쓰지 않음). 전송 직후 중지로 revert된 거래는 일시 조건이면 hash를 지우고 재시도. reward key 조회 실패도 인터페이스 불일치와 장애를 구분
- Issue #80: 지갑 세션 저장을 계정별 tag로 분리하고 시작 시 다른 계정 세션을 제거, 점주·지갑 화면에 remount 보호 추가. API `no-store`는 이미 구현돼 있어 회귀 시험만 추가. D02는 실기 계정 전환을 못 해 `NOT_RUN` 유지
- Issue #77: RPC 연결 불가가 작업을 `MANUAL_REVIEW`로 보내던 분류를 `RPC_UNAVAILABLE` 재시도로 수정. 계약 중지 `MINT_PAUSED`, 민터 잔액 부족 `MINTER_BALANCE_LOW`는 전송 준비 직전에 확인해 전송 시도를 소모하지 않음. code는 있지만 인터페이스가 다른 계약은 재시도하지 않고 `CONTRACT_INTERFACE_MISMATCH`로 수동 검토. 필수 테스트 O02를 Local Anvil·PostgreSQL 증거로 `NOT_RUN`→`PASS` 전환
- Issue #75: 경로 값의 잘못된 percent-encoding을 8개 라우트 공통 helper로 400 `INVALID_PATH_PARAMETER` 처리(기존 500)
- Issue #73: `POST /campaigns/:id/enrollments` 캠페인 참여 등록과 정원 원자 예약(migration 0009). 필수 테스트 R02를 실제 PostgreSQL 동시성 증거로 `NOT_RUN`→`PASS` 전환. 같은 계정의 마지막 자리 경합에서 정원 마감으로 잘못 거절하던 빈틈을 결정적 재현 시험으로 확인해 수정
- Issue #71: README·앱별 README·`.env.example`·EVALUATION_MAP·SUBMISSION_EVIDENCE·TEST_STATUS·PROJECT_STATE·HANDOFF를 실제 병합 상태에 맞춤

## 생성한 Issue

- #110 운영 로그인 재인증·요청 제한·세션 정리 (종료)
- #112 서비스 민터 서명·키 파일·lock 설정 보강 (종료)
- #61 Worker 재시도 상한과 지수 backoff (종료)
- #66 SIWE challenge PostgreSQL 공유 저장소 (종료)
- #71 9월 20일 병합분 문서 정합 (종료)
- #73 캠페인 참여 등록과 정원 원자 예약 R02 (종료)
- #75 잘못된 경로 인코딩을 400으로 거절 (종료)
- #77 RPC·발행 중지·민터 잔액 장애 복구 O02 (종료)
- #80 계정 전환 시 이전 사용자 데이터 미노출 D02 (종료)
- #78 전송 전 장애의 재시도 간격과 전송 직후 중지 처리 개선 (이 문서를 담은 PR로 종료)
- #116 Phase 1 실제 MetaMask 복귀·서명과 출시 입력 상태 검증 (이 문서를 담은 PR로 종료)
- #65·#69·#70 작업은 Issue 없이 진행했다. 이후 작업은 Issue를 먼저 만든다.

## 생성한 브랜치

- `feat/59-chain-cursor-restart`, `feat/61-worker-retry-limit`, `chore/expo-patch-advisory-recheck`, `feat/66-siwe-challenge-postgres`, `docs/66-closeout`, `feat/base-sepolia-deploy-script`, `feat/release-package-id`, `docs/71-state-sync`, `feat/73-campaign-enrollment`, `fix/75-path-param-decoding`, `fix/77-worker-outage-recovery`, `fix/80-account-switch-isolation`, `fix/78-presubmit-backoff`, `test/116-device-wallet-release-inputs`, `fix/118-security-release-gates`, `feat/118-mobile-auth-recovery`, `docs/118-design-evidence`
- 남아 있는 원격 브랜치 `feat/59-chain-cursor-read`, `feat/61-worker-retry-cap`은 같은 내용을 새 브랜치로 대체한 뒤 닫은 PR #60·#62의 것이다. main에 병합되지 않았으며 삭제 여부는 소유자가 정한다.

## 생성한 PR

- #63, #64, #65, #67, #68, #69, #70, #72 #74, #76, #79, #81, #82, #83(PragmoB), #85, #87, #89, #91, #93, #96, #98, #99, #102, #104, #105(PragmoB), #107, #108, #109, #111, #114, #115, #117, #119, #120 (모두 병합)
- #60·#62는 #63·#64로 대체했고, #113은 CI run 미생성으로 #114로 대체해 닫았다.

## merge된 PR

| PR | merge 커밋 | main CI run |
| --- | --- | --- |
| #63 체인 cursor 재시작·reorg 여유 | `6bbf58c` | `35458855491` PASS |
| #64 Worker 재시도 상한·backoff | `695210c` | `35459019638` PASS |
| #65 Expo patch·B-008 재평가 | `4c4d744` | `35459313304` PASS |
| #67 SIWE PostgreSQL 저장소 | `9c3c04a` | `35460087002` PASS |
| #68 재개 기록 마감 | `f386c84` | `35460432649` PASS |
| #69 Base Sepolia 배포 스크립트·기기 세션 정리·Play 초안 | `a83cef9` | `35486460953` PASS |
| #70 운영 package ID·release AAB 경로 | `9e670ab` | `35487020999` PASS |
| #72 문서 정합 | `761ac42` | `35487858774` PASS |
| #74 캠페인 참여 등록·R02 | `b04af56` | PASS |
| #76 경로 인코딩 400 | `640bb83` | PASS |
| #79 Worker 장애 복구·O02 | `e4e633c` | `35499451454` PASS |
| #81 계정 전환 분리·D02 | `5aafafc` | PASS |
| #82 재시도 backoff·revert 재분류 | `e4d4edb` | `35504888279` PASS |
| #85 단체 슬롯 독립·Q04 | `367f26b` | `35505367620` PASS |
| #83 하단 safe-area 여백(PragmoB, 후속 수정 포함) | `6417b0c` | PASS |
| #87 운영 AAB 지갑 진입점·W08 | `a2a0452` | PASS |
| #89 배포·빌드 사전 검사 | `fe2be9a` | PASS |
| #91 W05 fixture·미지원 안내 | `f28737b` | 병합 뒤 main CI는 `gh run list --branch main`으로 확인 |
| #111 운영 로그인 후속 보안·Play 초안 | `205d273` | `35561417735` PASS |
| #114 서비스 민터 후속 보안 | `595f70f` | `35563583964` PASS |
| #115 운영 로그인·민터 후속 문서 마감 | `edf72a5` | `35564447379` PASS |
| #119 보안·출시 gate 보강 | `48aa435` | `35606071753` PASS |
| #120 모바일 인증·복구 보강 | `a50f678` | `35620303554` PASS |

코드 PR은 서로 다른 모델의 독립 리뷰에서 CRITICAL·HIGH 0을 확인한 뒤 병합했다. #63·#67·#69는 두 모델, #64·#65·#70은 단일 모델 리뷰(지적 반영 뒤 재리뷰)로 병합했다.

## 실행한 테스트

- API 단위 `80/80`, API PostgreSQL `37/37`(운영 로그인·claim replay·R02 7개·Q04 포함)
- Worker 단위 `45/45`, Worker PostgreSQL `23/23`, Anvil `12/12`(W07 M01~M08 + O02a~e)
- 모바일 `146/146`, typecheck·lint·Android export PASS; 실제 Google 첫 로그인·SecureStore 복원·logout revoke와 새 UI Samsung 실기 PASS
- Foundry `8/8`, fuzz 128, fmt·build·lint PASS
- Base Sepolia 계약 `0x1edca95bb453d8456cfe28c6e24c4e51172e36c4`, role·Worker token #1·중복 방지 PASS
- private GitHub APK, upload-key AAB gate, Samsung 4KB와 Android 36 16KB AVD 설치·cold launch PASS
- secret·privacy·bootstrap·portal·presentation verifier PASS
- 포털·발표 1440px/390px 브라우저 검증 PASS, 가로 넘침 없음, 시각 판정 각 96/100. 발표 timing·프로젝터 가독성·공개 호스팅은 NOT_RUN
- 필수 36개 `31 PASS / 2 BLOCKED / 3 NOT_RUN`. 남은 NOT_RUN: D02·O01·A01
- `NOT_RUN`: 운영 package 지갑 복귀, 두 Google 계정 전환, 운영 fresh reauthentication 삭제, Play Console

## 현재 열린 PR

- 최종 상태는 `gh pr list`가 기준이다. PR #127은 병합됐고 이 문서 마감용 PR 외 새 기능 PR을 만들지 않는다.

## 현재 작업 중인 기능

- Issue #124의 private GitHub test.2 APK·16KB runtime·verified App Links·Base Sepolia 계약/Worker mint와 Issue #126 모바일 UI를 완료했다. D02·O01·A01과 별도 출시/현장 항목이 남았다.

## BLOCKER

- B-002 저장소 공개 전환: 명시 승인 필요
- B-004 Google Play 정책·국내 분류 공식 확인
- B-008 모바일 moderate 권고 14건: Expo upstream 수정 대기
- B-010·B-011 W04·W05용 실제 지갑 환경 부재
- Base Sepolia 계약·Worker proof와 upload-key AAB·16KB runtime·App Links는 PASS. Play는 별도 `NOT_RUN`

## 사용자 승인이 필요한 사항

승인된 것(D-019~D-022): SIWE PostgreSQL 저장소, 외부 HTTPS·Base Sepolia·release AAB·Google Play 준비, 기기 세션 저장 정책, 운영 package ID. 소유자는 Codex와 Claude 세션을 번갈아 쓰므로 어느 쪽이든 이 문서와 저장소 기록에서 상태를 복원한다.

소유자가 직접 해야 하는 것(대신 수행하지 않음):

1. upload-key AAB·provenance·APK set 로컬 보존 상태를 확인한다. 비밀번호를 다시 입력하거나 키를 다시 만들 필요는 없다.
2. Base Sepolia 계약·series·token #1은 다시 배포·발행하지 않는다. 공개 주소·tx hash만 증거로 사용하고 private key·비밀번호는 기록하지 않는다.
3. Play Console에서 App Signing SHA-1을 받은 뒤 `kr.masscom.wolgye`용 Play Android OAuth client를 별도로 만든다. 현재 upload-key client를 Play signing client로 오인하지 않는다.
4. Play Console package 등록·Data safety·금융 기능 NFT award·계정 삭제 URL은 실제 제출 직전 다시 확인하고 승인 없이 제출하지 않는다.
5. 실제 카메라 QR 촬영→수령과 오프라인 안내(A01), 두 Google 계정 전환(D02), 운영 package Reown 복귀(E02)는 별도 실기한다. A02는 PASS다.

여전히 승인 전 금지: mainnet, 사용자 자산 이동, 저장소 공개, Play 프로덕션 공개, 대회 최종 제출.

## 다음 세션이 가장 먼저 해야 할 작업

1. `git fetch && git log origin/main -3`, `gh pr list`, `gh issue list`, `gh run list --branch main --limit 3`으로 이 문서와 실제 상태를 대조한다.
2. 소유자 입력이 도착했는지 확인한다. 도착 순서대로 처리한다.
   - **App Links**: 운영 `/open` intent filter와 upload 인증서 `assetlinks.json`을 배포하고 실제 Android 복귀를 확인한다. Play App Signing 인증서는 Play Console 생성 뒤 별도 추가한다
   - **Google OAuth client ID**: 제공된 ID의 client 유형을 확인하고 Android/Web 구성이 갖춰지면 모바일의 `x-account-id` DEMO 헤더를 Bearer 세션으로 교체하는 Issue를 연다(서버 측은 Issue #106으로 완료, D-024~D-026)
   - **A02**: APK 설치·4KB/16KB 실행은 PASS. HTTPS `/open` App Link 복귀만 마감한다
3. 입력이 없으면 새 기능을 시작하지 않는다. 자동화 가능한 운영 로그인·서비스 민터·문서/디자인 후속은 모두 병합 또는 최종 PR 검증 단계다. 서비스 민터의 다중 민터 지원은 실제 두 번째 민터 요구가 생기기 전에는 추가하지 않는다.
## 실행 명령

```bash
npm test --prefix apps/api
npm run test:postgres --prefix apps/api
npm test --prefix apps/worker
npm run test:postgres --prefix apps/worker
ANVIL_RPC_URL=http://127.0.0.1:8545 npm run test:anvil --prefix apps/worker
npm test --prefix apps/mobile
npm run typecheck --prefix apps/mobile
npm run lint --prefix apps/mobile
npm run export:android --prefix apps/mobile
./scripts/forge.sh test -vvv
bash scripts/check-secrets.sh
bash scripts/check-privacy.sh
bash tests/bootstrap/verify_bootstrap_test.sh
bash tests/site/verify_presentation_test.sh
PR_TITLE='한국어 PR 제목'
PR_BODY='변경 내용과 실제 검증 결과를 설명하는 한국어 본문'
bash scripts/check-pr-korean.sh "$PR_TITLE" "$PR_BODY"
bash tests/bootstrap/check_pr_korean_test.sh                     # checker 자체 회귀 시험
./scripts/deploy-base-sepolia.sh <keystore-account>            # 시뮬레이션만
./scripts/build-release-aab.sh --restore-dev                   # 운영 AAB 빌드 뒤 개발 프로젝트 복원
```

PostgreSQL 통합·Anvil 시험은 이름이 `_test`로 끝나는 전용 `TEST_DATABASE_URL`만 사용한다. 로컬 시험 DB는 Docker 컨테이너 `masscom-postgres-test`(포트 55432)다. Anvil 시험 전에 `./scripts/anvil.sh --chain-id 31337 --silent`를 실행한다.

## 주의사항

- Worker `start:once`는 Local Anvil unlocked account와 Base Sepolia encrypted keystore signer를 모두 지원한다. 공개 체인에서는 raw key나 unlocked account를 허용하지 않는다.
- 사용자 개인키·복구 문구·지갑 비밀번호를 요청하거나 저장하지 않는다. 배포자 private key를 환경 변수·명령·저장소·증거에 남기지 않는다.
- debug key로 서명한 AAB는 업로드하지 않는다.
- 앱 수집품과 실제 NFT를 분리하고, NFT 수를 매출 증가로 표현하지 않는다. 실행하지 않은 검증을 PASS로 쓰지 않는다.
- PR 제목·본문은 한국어로 쓰고 `bash scripts/check-pr-korean.sh`를 통과시킨다. 커밋과 PR에 AI 공동 작성자 trailer나 생성 도구 문구를 넣지 않는다.
- 공유 이력 force push, 날짜·작성자 조작, 빈 커밋을 하지 않는다. 브랜치를 바꿔야 하면 새 브랜치와 새 PR로 대체한다.
- ethers v6는 `eth_call`에 대한 모든 JSON-RPC 오류(rate limit·timeout 포함)를 `CALL_EXCEPTION`으로 표시한다. 실제 revert는 반환 `data`가 있을 때만이다. 오류 코드만으로 영구 결함을 판정하지 않는다.
- 위임한 구현이 경합 시험에 `t.skip` 대체 경로를 넣은 적이 있다. 재현되지 않으면 실패해야 하므로 skip을 실패로 바꾸고 반복 실행으로 결정성을 확인한다. 병합 전 `git grep -n "\.skip("`로 확인한다.
- 이 저장소의 shell은 zsh다. `grep --include=*.ts`처럼 따옴표 없는 glob은 오류로 끝나 검색이 실행되지 않는다. 코드 검색은 `git grep`을 쓴다.
- macOS 기본 `awk`에는 `strtonum`이 없고 `keytool` 출력은 한국어로 번역된다. 검사 스크립트는 오류 없이 끝났는지까지 확인한다.
- 지갑 세션의 계정별 분리는 “한 프로세스 안에서 계정이 바뀌지 않는다”는 전제에 선다. WalletConnect Core는 저장소를 프로세스 전역 core에 cache하므로, 운영 로그인으로 실행 중 계정을 바꾸게 되면 AppKit을 계정별 `customStoragePrefix`로 다시 만들거나 앱을 재시작해야 한다(PR #81 리뷰 지적).
- 운영 로그인을 도입해 account ID를 외부에서 정할 수 있게 되면, 계정 삭제의 `campaign_enrollments` 비식별화가 `(campaign_id, 삭제 별칭)` 중복으로 막히지 않는지 먼저 확인한다(PR #74 리뷰 지적).
- npm audit endpoint가 점검 중이면 CI의 audit 단계가 503으로 실패한다. 단계를 우회하지 말고 복구 뒤 다시 실행한다.
