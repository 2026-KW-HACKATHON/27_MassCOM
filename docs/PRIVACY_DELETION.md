# 개인정보·계정 삭제 경계

마지막 확인: 2026-09-30 KST

## 사용자에게 먼저 알릴 내용

- 앱 계정 삭제는 외부 지갑 앱의 계정·개인키를 삭제하지 않습니다.
- 이미 제출되거나 발행된 NFT와 공개 블록체인 기록은 서비스가 지울 수 없습니다.
- 미전송 NFT 작업은 취소하고 보상권을 `CANCELED`로 바꿉니다.
- 제출된 거래가 있으면 결과를 확인할 때까지 `WAITING_FOR_MINT_FINALITY`이며 삭제 완료라고 표시하지 않습니다.
- 고객지원은 지갑 비밀번호·개인키·복구 문구를 요구하지 않습니다.

## 삭제 요청 접수와 운영자 처리 (D-052, Issue #194)

앱 안 직접 삭제는 위 5분 `auth_time` 조건(D-026)을 만족할 수 없어 운영 앱에서 계속 막혀 있습니다. 대신 소유자가 2026-09-30 정한 **웹 로그인 접수 + 운영자 처리** 경로로 삭제를 받습니다. 이 경로는 D-026을 바꾸지 않으며 그 조건을 대체하지도 않습니다.

1. **접수:** 앱의 "웹에서 계정 삭제 요청"이 `https://www.masscom.kr/account-deletion`을 엽니다. 웹에서 기존 Google OIDC 웹 로그인으로 본인을 확인하고, 서버가 웹 세션에서 대상 `account_id`를 정해 접수합니다(요청 본문의 계정 값은 받지 않음). 접수하면 무작위 **접수번호**(16자, 4글자씩 하이픈)를 한 번 보여 줍니다. 서버에는 접수번호의 HMAC 해시만 저장합니다.
2. **취소 기간:** 접수 뒤 24시간은 같은 로그인으로 취소할 수 있고(`cancel_until`), 그 기간에는 운영자도 처리하지 못합니다. 취소하면 요청은 `CANCELLED`가 되고 계정은 그대로입니다.
3. **처리:** 취소 기간이 지난 뒤 플랫폼 관리자가 관리자 웹의 "계정 삭제 요청"에서 처리하며 처리 기한은 접수 뒤 7일(`due_at`)입니다. 처리는 아래 "구현된 로컬 처리"와 같은 한 트랜잭션(`forgetInTransaction`)에서 세션 `auth_time` 검사 없이 실행되고, 삭제 ledger에 잇고, 요청을 `PROCESSED`로 바꾸고, 원 계정 ID를 접수 표에서 지우고, `platform_admin_audit`에 `ACCOUNT_DELETION_PROCESSED`를 남깁니다. 관리자는 자기 접수를 처리·거절할 수 없습니다. 처리하지 않기로 하면 사유와 함께 `REJECTED`(계정은 삭제되지 않음)로 닫고 감사 기록을 남깁니다.
4. **결과 확인:** 처리 뒤에는 계정과 로그인이 없으므로 접수번호가 결과를 확인하는 유일한 수단입니다(`POST /api/web/account-deletion-status`, 로그인 불필요, IP당 분당 30회). 상태·날짜·거절 사유·삭제 ledger 상태만 돌려주고 계정 ID·이메일은 없습니다. 제출된 거래가 있으면 ledger가 `WAITING_FOR_MINT_FINALITY`로 보이고, 관리자 화면을 열 때(또는 시연 CLI `reconcile`) 다시 세어 `COMPLETED`로 진행합니다(이전에는 삭제한 계정이 다시 요청할 때만 진행돼 영원히 진행되지 않았습니다).
5. **시연 앱:** 시연 앱은 웹 삭제 페이지가 없어 앱 안(Bearer 세션)에서 접수하고 접수번호를 봅니다. 운영자는 시연 서버의 CLI(`admin:deletion`)로 같은 서비스 코드(취소 기간·감사 기록 동일, `processed_by='cli:<운영자>'`)를 써 처리합니다.

접수 표에는 처리·취소·거절 뒤 원 계정 ID가 남지 않습니다(CHECK). 남는 것은 접수번호 해시, 접수·취소 마감·처리 기한·취소·처리 날짜, 결과, 접수 경로(`source`), 처리한 방식(`processed_by`: `admin-web` 또는 `cli:<운영자>`), 운영자가 처리하지 않기로 할 때 직접 적은 `reject_reason`, 삭제 ledger 연결이며, 처리·거절은 `platform_admin_audit`에 요청 번호(intake ID)와 처리한 운영자로 남습니다. 처리 기한 7일은 운영자가 직접 처리해야 지켜지는 약속이라 자동으로 보장되지 않고, 관리자 목록이 기한 초과를 표시합니다. 자세한 설계는 [설계 문서](superpowers/specs/2026-09-30-account-deletion-processing-design.md)에 있습니다.

## 구현된 로컬 처리

`POST /account-deletion-requests`는 계정 resolver와 별도 재인증 guard를 모두 통과해야 합니다. 운영 로그인은 같은 Google 계정의 최근 5분 이내 서명된 `auth_time`이 확인된 세션만 허용하며, 삭제 트랜잭션에서도 현재 bearer 세션의 계정·철회/만료·`auth_time`을 다시 확인합니다. `auth_time` 없는 token은 일반 로그인만 가능하고 삭제 권한을 갱신하지 않습니다. loopback DEMO에서만 `x-demo-reauthenticated: true`를 받습니다.

한 트랜잭션에서 다음을 수행합니다.

1. 원 account ID를 별도 32바이트 HMAC으로 잠그고 동일 요청을 하나로 수렴시킵니다.
2. 미전송 `QUEUED / PREPARED / RETRYABLE / PAUSED` mint job을 `CANCELLED`로 바꿉니다.
3. 연결된 보상권은 `CANCELED`, Outbox는 `PUBLISHED`로 닫습니다.
4. 지갑 binding을 모두 `DISCONNECTED`로 바꾸고 해당 계정의 SIWE challenge(`wallet_challenges` 또는 DEMO 메모리 저장소)를 제거합니다. 앱은 삭제 접수 직후 지갑 연결을 끊고 기기에 저장된 WalletConnect 세션을 지웁니다.
5. 점주 권한을 철회하고 customer/staff account ID를 `deleted:<HMAC>` 별칭으로 교체합니다.
6. 제출·확정 mint job, chain event, NFT asset, 수령 주소는 중복 방지와 공개 장부 대조를 위해 보존합니다.

임대 시간이 지났다는 이유만으로 발행 작업을 삭제 완료로 세지 않습니다. `FINALIZED`·`CANCELLED`가 아닌 모든 작업은 재정산에서 계속 대기 상태입니다. 삭제 뒤 세션이 폐기된 상태의 재정산은 관리자 목록 열기·시연 CLI `reconcile`이 진행시키고(로컬 PostgreSQL 시험 PASS), 결과는 접수번호 조회로 봅니다. 백그라운드 자동 실행과 통지(이메일 등)는 없으며 실제 운영 서버에서의 종단 실행은 `NOT_RUN`입니다.

삭제 ledger에는 원 account ID를 저장하지 않습니다. 같은 account의 동시 10요청은 같은 request ID 하나로 수렴하는 PostgreSQL 통합 시험을 통과했습니다.

## 아직 확정하지 않은 보관 정책

처리 기한 7일과 취소 기간 24시간은 소유자가 정한 값(D-052)입니다. 법률·보안상 보존해야 할 구체 항목과 기간, 백업 순환 30일은 운영·법률 확인 전 제안값입니다. 현재 코드는 존재하지 않는 법정 기간을 단정하지 않습니다. 외부 지갑 주소와 발행 시각이 공개돼 관계가 추정될 수 있다는 점도 Data safety·개인정보 안내에 반영해야 합니다.

## Google Play 확인

Google Play 공식 도움말은 앱에서 계정을 만들 수 있으면 앱 안 삭제 경로와 기능하는 외부 웹 삭제 경로를 요구합니다. 웹 경로는 앱/개발자와 관련성이 분명하고 찾기 쉬워야 합니다. `https://www.masscom.kr/account-deletion`의 계정 귀속 접수([운영 HTTPS 배포 기록](evidence/operating-deletion-intake-deployment-2026-09-28.json)은 접수만 있던 이전 버전)는 D-052로 접수번호·취소·운영자 처리·조회까지 구현했지만 이 버전은 배포되지 않았고 폐기용 실계정의 접수→처리→조회 종단 실행은 미검증이므로 출시 준비 상태는 `BLOCKED`입니다. Google의 공식 OIDC 문서는 `auth_time` 요청을 설명하지만 강제 재인증 수단을 보장하지 않으므로, 서명된 최근 `auth_time`을 얻지 못하면 D-026에 따라 삭제를 거절합니다.

- [Google Play 계정 삭제 요구사항](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)

## D01~D03 판정

- D01 `PASS`: PostgreSQL에서 미전송 취소·제출/확정 보존·동시 요청·비식별화를 검증했습니다.
- D02 `NOT_RUN`: 모든 계정 화면의 remount 보호, 지갑 세션의 계정별 저장 분리와 시작 시 다른 계정 세션 제거, API 응답 `no-store`를 구현하고 자동 시험했습니다(Issue #80). 실제 운영 로그인과 Android 실기 계정 전환 환경이 없어 상태는 유지합니다.
- D03 `PASS`: 저장소 로그 인자·분석 SDK 정적 gate, 비밀 검사, API 응답 최소화를 검증했습니다. 외부 운영 로그 수집기는 `NOT_RUN`입니다.
