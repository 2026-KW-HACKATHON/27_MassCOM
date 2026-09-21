# Issue #118 Audit Remediation Design

## 목적

직전 전체 감사에서 확정된 개선점을 정확히 세 개의 구현 PR로 나눈다.

1. 보안·출시 gate: W08 검사 신뢰성, 비밀값 비노출 로그, production 환경 차단, AAB provenance를 다룬다.
2. 모바일 운영 인증·복구·핵심 UX: Google ID token 로그인, 서버 Bearer 세션, SecureStore, 로그아웃·계정 전환, 파괴적 재인증의 정직한 차단, 응답 유실 복구와 사용자 동선을 다룬다.
3. 디자인·문서·발표 정합: dark mode, TalkBack, 사용자 용어, 저장소 지침과 증거 페이지의 사실 정합을 다룬다.

세 PR은 각자 자동 검증 가능한 단위여야 한다. 문서 PR은 앞선 두 PR이 `main`에 합쳐진 뒤 최종 사실과 증거를 반영한다.

## 확정 범위

### 보안·출시 gate

- `set -o pipefail` 아래에서 `grep -m1`의 조기 종료가 upstream `strings`/`cat`에 SIGPIPE를 일으켜 W08 금지 문자열을 거짓 통과시키는 경로를 회귀 시험으로 재현하고 제거한다.
- 잘못된 지갑 서명, SIWE 원문, Bearer/Google token과 오류의 `message`·`stack`·`cause`를 운영 로그에 넣지 않는다. 로그는 고정 event 이름과 allowlist된 오류 분류만 기록한다.
- `APP_VARIANT=production`은 loopback API URL과 모든 `EXPO_PUBLIC_DEMO_*` 계정·재인증 설정을 config 평가 시점에 거절한다. development variant의 loopback DEMO는 유지한다.
- AAB의 암호학적 서명 판정과 전체 출시 준비 판정을 분리한다. 빌드 결과에는 source commit, mobile tree dirty 여부, SHA-256, byte size, package/version, 공개 인증서 지문, W08 결과, 아직 수행하지 않은 device/App Links/Play gate가 구조화된 provenance JSON으로 남아야 한다.

### 모바일 운영 인증·복구·핵심 UX

- Google OAuth가 반환한 ID token을 `POST /auth/google`로 보내 서버의 `{ sessionToken, accountId, expiresAt }`를 받는다. 이후 계정 필요 API는 `Authorization: Bearer <sessionToken>`만 사용한다.
- 운영 session은 `expo-secure-store`에 하나의 versioned record로 저장한다. AsyncStorage, URL, 로그, 화면에는 token을 저장하거나 출력하지 않는다.
- 앱 시작 시 SecureStore를 복원하고 만료 session은 폐기한다. 서버 `401 SESSION_INVALID`도 동일하게 signed-out 전환한다.
- 로그아웃은 서버 session 폐기, 로컬 SecureStore 삭제, Reown disconnect/storage purge 순서로 수행한다. 계정 전환은 기존 계정 정리를 끝낸 뒤 Google `prompt=select_account`로 새 ID token을 받고, route와 wallet surface를 새 `accountId` key로 다시 만든다.
- 모바일 Google 로그인은 `react-native-nitro-google-signin@2.3.0`과 `react-native-nitro-modules@0.37.1`을 사용한다. Expo SDK 57/RN 0.86 native build에서 Android Credential Manager를 사용하며 서버 audience인 Web OAuth client와 package/SHA별 Android client가 필요하다.
- 이 Google mobile sign-in 경로의 `signIn`, `getTokens`, `presentExplicitSignIn`은 fresh `auth_time`을 신뢰성 있게 강제하지 못한다. 따라서 삭제 요청용 `POST /auth/reauthenticate` 연결을 완료 처리하거나 서버의 `auth_time` 검사를 완화하지 않는다. destructive reauthentication은 별도 승인된 passkey/server-challenge 설계 전까지 `BLOCKED`로 표시한다.
- DEMO 자격증명은 development variant에서만 유지한다. 운영 자격증명과 `x-account-id`/`x-demo-reauthenticated` 헤더를 한 요청에 함께 보내지 않는다.
- 도감 본문과 wallet binding 조회를 독립적으로 처리한다. binding 장애가 도감·방문 기록을 가리지 않고 NFT 신청 동작만 비활성화해야 한다.
- 방문 수령은 같은 account/token 재요청을 새 효과 없이 기존 결과로 응답해 응답 유실을 복구한다. preview와 redeem 결과는 점포명·캠페인명을 포함하며 성공 화면은 도감과 다음 가게 추천으로 이어진다.
- NFT polling이 연속 실패하면 작업 실패로 단정하지 않고 자동 polling을 멈춘 뒤 명시적 다시 확인 동작을 제공한다. 기존 도감과 접수 상태는 유지한다.

### 디자인·문서·발표 정합

- mobile 색상은 light/dark semantic token 쌍으로 만들고 화면은 현재 scheme의 token으로 style을 만든다. Reown modal도 system scheme을 따른다.
- 비동기 상태 변화는 `accessibilityLiveRegion="polite"` 또는 동등한 TalkBack 알림을 제공한다. 버튼 label/hint는 “도감”, “수집품”, “외부 지갑 주소 확인”, “NFT 등록”처럼 사용자 용어를 사용하고 내부 ID는 보조 정보로만 남긴다.
- `README.md`, `AGENTS.md`, `docs/HANDOFF.md`, 앱별 README의 명령은 실행 위치와 목적을 구분한다. submodule clone/update를 포함하고, 실제 PR 검사 명령과 검사기 자체 회귀 시험을 서로 바꾸어 쓰지 않는다.
- API 문서는 Bearer와 DEMO 경계를, Worker 문서는 Local Anvil unlocked signer와 Base Sepolia encrypted keystore signer를 현재 코드대로 설명한다.
- 포털·발표의 날짜, 시험 합계, 장면 수, 기준 SHA, 증거 목록은 정본에서 자동 대조한다. 현재 발표는 opening을 포함한 7개 `<section class="scene">`이므로 “아홉 장면” 표기를 유지하지 않는다.
- 정적 검사 뒤 1440px와 390px 화면을 다시 캡처하고 visual verdict JSON을 현재 화면과 수치로 갱신한다. 자동 접근성 PASS와 native TalkBack 실기 결과는 별도 증거로 기록한다.

## 범위 밖

- Base mainnet, Google Play 제출·공개, 유료 hosting, 저장소 공개 전환
- 새 Foundry/Android/운영 key 생성, key 덮어쓰기, 사용자 자산 이동
- 실제 Web OAuth client ID가 없는데 Google 로그인 실기 PASS로 전환하는 일
- Base Sepolia gas가 없는데 배포·발행 PASS로 전환하는 일
- 점주가 고객 account를 어떻게 식별하는지에 관한 새 제품 결정 또는 점주 운영 인증 전환
- 다중 minter, NFT 거래·양도, 랜덤 보상, 결제·swap·on-ramp·내장 지갑, 유료 기능

## 보안 불변조건

- 사용자 개인키·복구 문구·지갑 비밀번호를 요구하거나 저장하지 않는다.
- 지갑에는 읽을 수 있는 주소 확인 메시지 서명만 요청한다.
- 서버가 확인한 account가 모든 고객 API의 주체이며 mobile이 account ID를 운영 인증 헤더로 지정하지 않는다.
- session token은 전송 시 Bearer header와 SecureStore record에만 존재한다. 로그, 오류 메시지, query string, AsyncStorage, 증거 JSON에 남기지 않는다.
- 지갑 binding, mint recipient, binding version, idempotency 계약은 기존 동작을 유지한다.
- 방문 수령 재시도는 기존 결과 조회일 뿐 새 방문·보상 효과를 만들지 않는다.
- 서명 PASS는 release-ready 또는 Play upload/acceptance PASS를 뜻하지 않는다.

## 아키텍처

### 1. 보안 gate 경계

`scripts/check-release-wallet-surface.sh`는 DEX 문자열을 먼저 임시 파일로 완전히 materialize한 뒤 검사한다. 조기 종료 consumer가 producer를 끊는 pipeline을 금지한다. `tests/release/check_release_wallet_surface_test.sh`는 금지 문자열 뒤에 pipe buffer보다 큰 padding을 둔 DEX fixture로 기존 거짓 PASS를 고정한다.

`apps/api/src/security-log.ts`는 `safeErrorMetadata(event, error, allowedCodes)`만 노출한다. 반환값은 `{ event, errorName, errorCode? }`이며 `message`, `stack`, `cause`, request body를 포함할 수 없다. API와 wallet challenge의 fallback log는 이 helper만 사용한다. privacy scanner는 whole error, `message`, `stack`, `cause`, credential-named binding을 logger에 넘기는 형태를 실패시킨다.

`apps/mobile/src/config/build-environment.ts`의 `validateBuildEnvironment(variant, environment)`를 `app.config.ts`가 호출한다. 이 pure function은 production에서 HTTPS non-loopback API와 비어 있는 DEMO 변수를 요구하며 unit test에서 production/development 경계를 고정한다.

`scripts/assess-release-aab.sh`는 서명과 W08 결과를 모으고 `scripts/write-aab-provenance.mjs`가 JSON을 쓴다. `signature.status`와 `releaseReadiness.status`는 별도 필드다. 실제 기기·App Links·Play gate가 수행되지 않은 로컬 빌드의 `releaseReadiness.status`는 `NOT_RUN`이어야 하며 서명 성공만으로 바뀌지 않는다.

### 2. 모바일 인증 경계

모든 계정 필요 client는 다음 union만 소비한다.

```ts
export type AccountCredential =
  | { kind: 'bearer'; sessionToken: string }
  | { kind: 'demo'; accountId: string; allowInsecureReauthentication: boolean };
```

`headersForCredential`은 bearer이면 `Authorization`만, demo이면 `x-account-id`만 반환한다. 삭제 DEMO 요청만 명시적으로 `x-demo-reauthenticated`를 추가한다.

```text
Nitro Google Sign-In / Android Credential Manager
  -> ID token
  -> POST /auth/google
  -> server session token
  -> SecureStore versioned record
  -> AuthSessionProvider
  -> AccountCredential
  -> Commerce / Recommendation / Wallet / Account deletion clients
```

`AuthSessionProvider`는 `restoring | signedOut | signedIn | switchingAccount` 상태와 `signIn`, `logout`, `switchAccount` 명령을 제공한다. 운영 session에는 `destructiveReauthentication: 'BLOCKED'` capability를 노출한다. route는 provider가 복원을 끝내기 전 계정 API를 만들지 않는다. 새 account로 전환할 때 screen key와 wallet surface key가 달라져 이전 local state가 재사용되지 않는다.

Google adapter는 `react-native-nitro-google-signin@2.3.0`의 `configure`, `signIn`, `signOut`을 감싸며 server audience Web client ID로 ID token을 요청한다. 계정 전환은 기존 server/local/wallet session을 정리한 뒤 `signOut`과 새 `signIn`을 수행한다. 실제 OAuth client가 없는 자동 시험은 adapter fake를 사용하며 실계정 결과를 만들지 않는다. `getTokens`나 `presentExplicitSignIn`을 destructive reauthentication 근거로 사용하지 않는다.

### 3. 복구와 사용자 동선

도감 load는 collection과 binding을 `Promise.allSettled` 또는 동등한 독립 상태로 처리한다. collection 성공/binding 실패 결과는 도감 render + wallet action 비활성화 + retry 안내다.

수령 endpoint는 token hash와 account가 일치하는 이미 `CLAIMED` slot을 찾고 기존 visit/reward 결과를 읽어 `replayed: true`로 반환한다. 신규 원자 처리 결과는 `replayed: false`다. 같은 token의 다른 account는 계속 `CLAIM_TOKEN_UNAVAILABLE`이다.

preview/redeem response는 `merchantName`, `campaignId`, `campaignTitle`을 포함한다. mobile은 raw `merchantId` 대신 이름을 우선 표시하고 성공 뒤 `/collection`과 `/recommendations` 두 경로를 제공한다.

NFT polling은 consecutive failure count를 가진다. 3회 연속 network/5xx 실패 시 자동 timer를 멈추고 “작업 결과를 확인하지 못함” 상태를 표시한다. 수동 refresh는 collection을 다시 읽고 성공 시 count를 0으로 되돌린다. `REVIEW_REQUIRED`는 network 오류와 구분된 서버 상태로 계속 표시한다.

## PR 및 의존 순서

1. `fix/118-security-release-gates`: release 검증 자체를 먼저 신뢰할 수 있게 만든다.
2. `feat/118-mobile-auth-recovery`: auth client와 복구 UX를 구현한다. production config gate는 1번 PR의 계약을 따른다.
3. `docs/118-design-evidence`: 1·2번 merge SHA와 실제 검증 결과를 정본 문서·포털·발표·증거에 반영한다.

각 PR은 한국어 제목·본문, 독립 코드 리뷰, CI PASS 후 merge한다. 외부 입력이 없는 실기는 `BLOCKED` 또는 `NOT_RUN`으로 유지한다.

## 수용 기준

### 보안 PR

- 대형 DEX fixture의 금지 SDK가 W08에서 결정적으로 실패하고 clean fixture는 통과한다.
- malformed signature 값을 포함한 요청과 그 값을 포함한 Error가 발생해도 capture된 로그 문자열에 signature/message/stack/cause가 없다.
- production config는 loopback URL 또는 DEMO 변수 하나만 있어도 실패하고 development loopback은 통과한다.
- 서명된 AAB fixture도 provenance에서 signature PASS와 release readiness NOT_RUN을 동시에 기록한다.

### 모바일 PR

- Bearer client test에서 `Authorization`은 있고 `x-account-id`는 없다. DEMO client test는 그 반대다.
- SecureStore restore, expiry, write/read failure, logout, account switch가 token을 fail-closed로 처리한다.
- 삭제 화면은 운영 session에서 destructive reauthentication이 아직 `BLOCKED`임을 표시하고 계정 삭제 API를 호출하지 않는다. DEMO의 기존 명시적 재인증 시험만 개발 범위로 유지한다.
- binding 조회 실패에도 도감이 보인다.
- 수령 응답 유실 뒤 같은 token 재요청은 같은 visit ID를 `replayed: true`로 돌려주며 DB count를 늘리지 않는다.
- polling 3회 실패 뒤 자동 요청이 멈추고 사용자가 수동 재확인할 수 있다.
- preview/success 화면이 점포명·캠페인명을 표시하고 다음 가게 추천으로 이동한다.
- OAuth client가 없으면 실제 Google 계정 전환은 `NOT_RUN`이다.

### 문서·디자인 PR

- README clone 절차로 submodule이 초기화되고 actual PR checker 명령이 title/body를 받는다.
- HANDOFF의 branch/SHA/open PR와 API/Worker signer 설명이 merge 시점 실제 상태와 일치한다.
- dark/light semantic token unit test와 TalkBack live-region static test가 통과한다.
- presentation verifier가 catalog/ledger/manifest/portal/presentation 합계와 section/nav 장면 수를 동적으로 대조한다.
- 1440x900 또는 1440x1000, 390x844 새 screenshot과 verdict가 현재 화면을 설명한다.

## 증거 경계

- unit/integration/CI PASS는 실제 Google 로그인, TalkBack 기기 사용성, upload-key AAB 설치, App Links, Play 제출을 대신하지 않는다.
- development package MetaMask 증거는 production package 지갑 복귀 증거가 아니다.
- provenance JSON은 빌드 입력과 자동 gate 결과의 기록이지 artifact 백업이나 Play 승인 기록이 아니다.
- 화면 screenshot은 그 화면의 시각 상태만 증명하며 서버 인증·체인 결과를 단독으로 증명하지 않는다.
