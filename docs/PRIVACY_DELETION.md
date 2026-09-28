# 개인정보·계정 삭제 경계

마지막 확인: 2026-09-19 KST

## 사용자에게 먼저 알릴 내용

- 앱 계정 삭제는 외부 지갑 앱의 계정·개인키를 삭제하지 않습니다.
- 이미 제출되거나 발행된 NFT와 공개 블록체인 기록은 서비스가 지울 수 없습니다.
- 미전송 NFT 작업은 취소하고 보상권을 `CANCELED`로 바꿉니다.
- 제출된 거래가 있으면 결과를 확인할 때까지 `WAITING_FOR_MINT_FINALITY`이며 삭제 완료라고 표시하지 않습니다.
- 고객지원은 지갑 비밀번호·개인키·복구 문구를 요구하지 않습니다.

## 구현된 로컬 처리

`POST /account-deletion-requests`는 계정 resolver와 별도 재인증 guard를 모두 통과해야 합니다. 운영 로그인은 같은 Google 계정의 최근 5분 이내 서명된 `auth_time`이 확인된 세션만 허용하며, 삭제 트랜잭션에서도 현재 bearer 세션의 계정·철회/만료·`auth_time`을 다시 확인합니다. `auth_time` 없는 token은 일반 로그인만 가능하고 삭제 권한을 갱신하지 않습니다. loopback DEMO에서만 `x-demo-reauthenticated: true`를 받습니다.

한 트랜잭션에서 다음을 수행합니다.

1. 원 account ID를 별도 32바이트 HMAC으로 잠그고 동일 요청을 하나로 수렴시킵니다.
2. 미전송 `QUEUED / PREPARED / RETRYABLE / PAUSED` mint job을 `CANCELLED`로 바꿉니다.
3. 연결된 보상권은 `CANCELED`, Outbox는 `PUBLISHED`로 닫습니다.
4. 지갑 binding을 모두 `DISCONNECTED`로 바꾸고 해당 계정의 SIWE challenge(`wallet_challenges` 또는 DEMO 메모리 저장소)를 제거합니다. 앱은 삭제 접수 직후 지갑 연결을 끊고 기기에 저장된 WalletConnect 세션을 지웁니다.
5. 점주 권한을 철회하고 customer/staff account ID를 `deleted:<HMAC>` 별칭으로 교체합니다.
6. 제출·확정 mint job, chain event, NFT asset, 수령 주소는 중복 방지와 공개 장부 대조를 위해 보존합니다.

삭제 ledger에는 원 account ID를 저장하지 않습니다. 같은 account의 동시 10요청은 같은 request ID 하나로 수렴하는 PostgreSQL 통합 시험을 통과했습니다.

## 아직 확정하지 않은 보관 정책

법률·보안상 보존해야 할 구체 항목과 기간, 내부 처리 목표 7일·백업 순환 30일은 운영·법률 확인 전 제안값입니다. 현재 코드는 존재하지 않는 법정 기간을 단정하지 않습니다. 외부 지갑 주소와 발행 시각이 공개돼 관계가 추정될 수 있다는 점도 Data safety·개인정보 안내에 반영해야 합니다.

## Google Play 확인

Google Play 공식 도움말은 앱에서 계정을 만들 수 있으면 앱 안 삭제 경로와 기능하는 외부 웹 삭제 경로를 요구합니다. 웹 경로는 앱/개발자와 관련성이 분명하고 찾기 쉬워야 합니다. 현재 앱 내부 로컬 흐름은 구현했지만 운영 인증이 연결된 외부 HTTPS URL은 없으므로 출시 준비 상태는 `BLOCKED`입니다.

- [Google Play 계정 삭제 요구사항](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)

## D01~D03 판정

- D01 `PASS`: PostgreSQL에서 미전송 취소·제출/확정 보존·동시 요청·비식별화를 검증했습니다.
- D02 `NOT_RUN`: 모든 계정 화면의 remount 보호, 지갑 세션의 계정별 저장 분리와 시작 시 다른 계정 세션 제거, API 응답 `no-store`를 구현하고 자동 시험했습니다(Issue #80). 실제 운영 로그인과 Android 실기 계정 전환 환경이 없어 상태는 유지합니다.
- D03 `PASS`: 저장소 로그 인자·분석 SDK 정적 gate, 비밀 검사, API 응답 최소화를 검증했습니다. 외부 운영 로그 수집기는 `NOT_RUN`입니다.
