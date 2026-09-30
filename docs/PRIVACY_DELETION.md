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

1. **접수:** 앱의 "웹에서 계정 삭제 요청"이 `https://www.masscom.kr/account-deletion`을 엽니다. 웹에서 기존 Google OIDC 웹 로그인으로 본인을 확인하고, 서버가 웹 세션에서 대상 `account_id`를 정해 접수합니다(요청 본문의 계정 값은 받지 않음). 접수하면 무작위 **접수번호**(16자, 4글자씩 하이픈)를 한 번 보여 줍니다. 서버에는 접수번호의 HMAC 해시만 저장합니다. **최근 로그인 조건:** 웹 세션 쿠키(`Path=/api/web`)는 `/app/`·`/merchant/`·`/admin/`과 함께 쓰여 브라우저에 오래 남은 로그인(최대 24시간)이 있을 수 있으므로, 접수·접수번호 다시 받기·취소는 **`web_sessions.created_at`이 10분 이내인 세션**만 받고 아니면 `401 WEB_SESSION_REAUTH_REQUIRED`로 거절해 페이지가 다시 로그인하라고 안내합니다(Google은 `prompt=login`·`max_age`를 문서화하지 않아 기대지 않고, 기존 로그인 링크의 `prompt=select_account`로 새 웹 세션을 만듭니다). 이는 D-026의 5분 서명된 `auth_time` 확인과는 다른, 이 웹 경로 자체의 조건입니다. 접수번호 조회만 로그인 없이 합니다.
2. **취소 기간:** 접수 뒤 24시간은 같은 로그인(위 10분 조건)으로 취소할 수 있고(`cancel_until`), 그 기간에는 운영자도 처리하지 못합니다. 취소하면 요청은 `CANCELLED`가 되고 계정은 그대로입니다.
3. **처리:** 취소 기간이 지난 뒤 플랫폼 관리자가 관리자 웹의 "계정 삭제 요청"에서 처리하며 처리 기한은 접수 뒤 7일(`due_at`)입니다. 처리는 아래 "구현된 로컬 처리"와 같은 한 트랜잭션(`forgetInTransaction`)에서 세션 `auth_time` 검사 없이 실행되고, 삭제 ledger에 잇고, 요청을 `PROCESSED`로 바꾸고, 원 계정 ID를 접수 표에서 지우고, `platform_admin_audit`에 `ACCOUNT_DELETION_PROCESSED`를 남깁니다. 관리자는 자기 접수를 처리·거절할 수 없습니다(그 관리자만 있다면 시연 CLI나 두 번째 관리자가 처리합니다). 처리하지 않기로 하면 사유와 함께 `REJECTED`(계정은 삭제되지 않음)로 닫고 감사 기록을 남깁니다. 사유는 요청자가 접수번호로 그대로 보므로 이메일·웹 주소·8자리 이상의 숫자열(전화번호 등)이 든 사유는 거절(`DELETION_REJECT_REASON_INVALID`)하고 관리자 화면이 "개인정보를 쓰지 마세요"를 안내합니다. 운영자의 시도가 거절되면(본인 접수·취소 기간·옛 접수) 구조화 로그 한 줄(`account_deletion.process_refused`·`account_deletion.reject_refused`와 거절 코드만이며 계정 ID·요청 번호·운영자 이름은 없음)을 남깁니다. 두 관리자가 서로의 접수를 동시에 처리해도 교착하지 않도록 관리자와 대상 계정의 잠금을 정렬된 한 순서로 잡고, 그래도 교착이 나면 `409 DELETION_BUSY`로 다시 시도하게 합니다.
4. **결과 확인:** 처리 뒤에는 계정과 로그인이 없으므로 접수번호가 결과를 확인하는 유일한 수단입니다(`POST /api/web/account-deletion-status`, 로그인 불필요, IP당 분당 30회). 상태·날짜·거절 사유·삭제 ledger 상태(진행 중/완료)와 `overdue`(아직 접수됨인데 처리 기한이 지남 → 화면에 "처리 기한이 지났어요. 문의해 주세요.")만 돌려주고 계정 ID·이메일과 mint 작업·NFT 개수(`pendingMintJobs`·`retainedFinalizedNfts`)는 없습니다. 접수번호를 아는 누구나 읽을 수 있는 응답이라 계정의 보유 현황을 내지 않습니다(개수는 운영자용 삭제 ledger 행에만 남습니다). 제출된 거래가 있으면 ledger가 `WAITING_FOR_MINT_FINALITY`로 보이고, 관리자 화면을 열 때(또는 시연 CLI `reconcile`) 다시 세어 `COMPLETED`로 진행합니다(이전에는 삭제한 계정이 다시 요청할 때만 진행돼 영원히 진행되지 않았습니다).
5. **옛 접수(접수번호 없음):** 접수번호가 생기기 전에 접수된 행은 접수한 사람이 "본인 확인이 더 필요하다"고 안내받은 요청이라 처리하지 않습니다(`409 DELETION_LEGACY_NEEDS_REFILE`, 관리자 목록·CLI에 "옛 접수: 본인이 다시 접수해야 처리할 수 있어요"). 그 사람이 다시 접수하면 접수번호를 새로 받고 그때부터 24시간 취소 기간(`cancel_until`)과 7일 처리 기한(`due_at`)이 새로 시작합니다. 운영자는 옛 접수를 사유와 함께 거절해 다시 접수하도록 안내할 수 있습니다.
6. **시연 앱:** 시연 앱은 웹 삭제 페이지가 없어 앱 안(Bearer 세션)에서 접수하고 접수번호를 봅니다. 운영자는 시연 서버의 CLI(`admin:deletion`)로 같은 서비스 코드(취소 기간·감사 기록 동일, `processed_by='cli:<운영자>'`)를 써 처리합니다.

**운영 메모:** 자동 알림이 없으므로 운영자가 관리자 목록(기한 초과 표시)을 **매일 확인**해야 처리 기한 7일이 지켜집니다. 접수한 사람이 유일한 플랫폼 관리자이면 자기 접수를 처리할 수 없으므로 CLI나 두 번째 관리자가 처리합니다. 시연 CLI(`admin:deletion:host`)는 **API 컨테이너 안에서** 실행해야 접수번호와 계정 참조에 같은 HMAC 비밀(`ACCOUNT_DELETION_HMAC_SECRET`)을 씁니다. 처리 결과에 이의가 있으면 문의 이메일로 알려 달라고 안내합니다.

접수 표에는 처리·취소·거절 뒤 원 계정 ID가 남지 않습니다(CHECK). 남는 것은 접수번호 해시, 접수·취소 마감·처리 기한·취소·처리 날짜, 결과, 접수 경로(`source`), 처리한 방식(`processed_by`: `admin-web` 또는 `cli:<운영자>`), 운영자가 처리하지 않기로 할 때 직접 적은 `reject_reason`, 삭제 ledger 연결이며, 처리·거절은 `platform_admin_audit`에 요청 번호(intake ID)와 처리한 운영자로 남습니다. 처리 기한 7일은 운영자가 직접 처리해야 지켜지는 약속이라 자동으로 보장되지 않고, 관리자 목록이 기한 초과를 표시합니다. 자세한 설계는 [설계 문서](superpowers/specs/2026-09-30-account-deletion-processing-design.md)에 있습니다.

## 구현된 로컬 처리

`POST /account-deletion-requests`는 계정 resolver와 별도 재인증 guard를 모두 통과해야 합니다. 운영 로그인은 같은 Google 계정의 최근 5분 이내 서명된 `auth_time`이 확인된 세션만 허용하며, 삭제 트랜잭션에서도 현재 bearer 세션의 계정·철회/만료·`auth_time`을 다시 확인합니다. `auth_time` 없는 token은 일반 로그인만 가능하고 삭제 권한을 갱신하지 않습니다. loopback DEMO에서만 `x-demo-reauthenticated: true`를 받습니다.

한 트랜잭션에서 다음을 수행합니다.

1. 원 account ID를 별도 32바이트 HMAC으로 잠그고 동일 요청을 하나로 수렴시킵니다.
2. 미전송 `QUEUED / PREPARED / RETRYABLE / PAUSED` mint job을 `CANCELLED`로 바꿉니다.
3. 연결된 보상권은 `CANCELED`, Outbox는 `PUBLISHED`로 닫습니다.
4. 지갑 binding을 모두 `DISCONNECTED`로 바꾸고 해당 계정의 SIWE challenge(`wallet_challenges` 또는 DEMO 메모리 저장소)를 제거합니다. 앱은 삭제 접수 직후 지갑 연결을 끊고 기기에 저장된 WalletConnect 세션을 지웁니다.
5. **로그인 세션(`auth_sessions`·`web_sessions`)은 폐기 표시가 아니라 행을 삭제합니다.** 폐기 표시만 하면 원 계정 ID가 그 행에 남기 때문입니다. 유출된 토큰은 행이 없어 `SESSION_INVALID`·`WEB_SESSION_INVALID`로 거절됩니다.
6. 점주 권한을 철회하고 customer/staff account ID를 `deleted:<HMAC>` 별칭으로 교체합니다.
7. 제출·확정 mint job, chain event, NFT asset, 수령 주소는 중복 방지와 공개 장부 대조를 위해 보존합니다. 방문 기록, 쿠폰(이미 사용한 쿠폰 포함), 캠페인 참여 기록, QR 수령 기록, 지갑 연결 주소 기록도 지우지 않고 계정 열만 `deleted:<HMAC>` 별칭으로 바꿔 남깁니다(발급 수·정원 집계와 사용 감사를 유지하기 위해서이며, 지갑 주소 자체는 별칭에 붙어 남습니다).

운영자 처리 뒤 공개 스키마의 모든 text·jsonb 열에 원 계정 ID가 남지 않는다는 것은 PostgreSQL 통합 시험(`information_schema.columns`로 만든 전수 검색)이 확인합니다. #243이 더한 계정 열(`visit_events.canceled_by_account_id`, `badge_coupons.voided_by_account_id`, `badge_coupon_audit.actor_account_id`·`previous_redeemed_by_account_id`)도 `pseudonymizeAccount`가 같은 별칭으로 바꿔야 하며, 병합 뒤 이 시험이 빠뜨린 열을 잡습니다.

임대 시간이 지났다는 이유만으로 발행 작업을 삭제 완료로 세지 않습니다. `FINALIZED`·`CANCELLED`가 아닌 모든 작업은 재정산에서 계속 대기 상태입니다. 삭제 뒤 세션이 폐기된 상태의 재정산은 관리자 목록 열기·시연 CLI `reconcile`이 진행시키고(로컬 PostgreSQL 시험 PASS), 결과는 접수번호 조회로 봅니다. 백그라운드 자동 실행과 통지(이메일 등)는 없으며 실제 운영 서버에서의 종단 실행은 `NOT_RUN`입니다.

삭제 ledger에는 원 account ID를 저장하지 않습니다. 같은 account의 동시 10요청은 같은 request ID 하나로 수렴하는 PostgreSQL 통합 시험을 통과했습니다.

## 보관 기간과 동의 기록 (D-056, Issue #253)

소유자가 2026-09-30 [Issue #253](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/253)의 추천안을 승인했다. 처리 기한 7일·취소 기간 24시간은 D-052, 아래는 D-056이다. 기간은 실제로 실행되는 것만 [개인정보처리방침](../docs/privacy.html)에 적는다.

- **동의 기록:** 새 표 `account_consents`(migration 0033)는 약관·처리방침 버전·시각·경로를 계정별로 기록한다. 계정 삭제 처리가 이 행을 **지운다**(가명으로 남기지 않는다). 삭제 시험의 원본 ID 검사에 이 표가 들어 있다(`account-deletion.postgres.integration.ts` D01). 서버는 아직 동의 없는 쓰기 요청을 막지 않는다.
- **정리 명령(API CLI `retention-command`):** 만료·해지 세션, 끝난 지 1년이 지난 삭제 접수, 기록한 지 1년이 지난 관리자 처리 기록·쿠폰 되돌리기 감사, **3년이 지난 접근권한 기록(관리자 권한 부여·회수, 직원 등록 승인·해제, 점주 지정·해제; 개인정보의 안전성 확보조치 기준 제5조 제3항)**, 만료 1일이 지난 일회용 행(고객 확인 QR 값·지갑 확인 요청·웹 로그인 상태·직원 등록 요청)을 단계별 거래로 지우고 개수만 출력한다. 활성 접수와 삭제 원장(계정 식별자의 해시·가명 별칭)은 지우지 않는다: 원장은 삭제된 계정이 되살아나지 않게 하고 제출된 발행 작업과 대조하려고 계속 보관하며 처리방침에 적었다. 롤백 복구용 `purge-deleted-consents`는 동의 기능 이전 API가 도는 동안 삭제된 계정의 동의 행을 원장 해시와 대조해 지운다.
- **호스트 작업:** 운영·시연 호스트의 매일 작업이 정리 명령과 30일 지난 DB 백업 삭제를 한다. **운영은 `scripts/deploy-lightsail.sh`가 배포마다 설치·확인하고(timer가 켜져 있지 않으면 배포를 실패로 알림), 시연은 소유자가 시연 API를 교체할 때 절차대로 설치·확인한다**(`infra/showcase-host/README.md`; 이 저장소 작업은 실행하지 않았다, `NOT_RUN`). 시연에서 설치하지 않으면 그 서버에서는 처리방침의 "서버 정리 작업" 문장이 실행되지 않는다. 30일이 지난 백업은 다음 날 정리 때 삭제되고, 백업에는 백업 시점의 계정 데이터가 있으므로 계정 삭제 처리 뒤에도 그 이전 백업에 30일이 지날 때까지 남는다(처리방침에 적음).
- **로그:** 컨테이너 로그는 용량 기준(컨테이너당 최대 30 MB)으로만 순환하고 시간 기준 삭제는 없다. 운영 Caddy는 요청별 접속 기록을 남기지 않는 구성이다. 소유자가 승인한 "접속 로그 3개월 이내"는 시간 보장으로 구현하지 못했고 처리방침에도 쓰지 않았다(D-056 (d), `PROPOSED`). DB 오류 로그는 `log_error_verbosity=terse`·`log_min_error_statement=panic`으로 오류가 난 행의 값(`DETAIL`)과 SQL 문을 남기지 않는다(운영 배포가 PostgreSQL을 필요할 때 한 번 다시 만들어 적용하고, 시연은 소유자 절차). 다만 `invalid input syntax for type uuid: "…"`처럼 메시지 본문에 입력값이 들어가는 오류는 남는다(처리방침에 적음). 소유자가 승인한 "접속 로그 3개월 이내"는 시간 보장으로 구현하지 못한 것을 `PROPOSED`(확인 대기)로 D-056에 기록했다.
- **아직 없는 것:** 환경 백업(`runtime-before-*.env.*`)의 정리(비밀이 있지만 롤백 마운트 문제로 지우지 않음), 시간 기준 로그 삭제, 설치된 서버에서의 실측, 법률 검토를 거친 법정 보존 항목 확정, 개인정보취급자 접속기록(제8조) 법률 검토([B-028](BLOCKERS.md)).

## Google Play 확인

Google Play 공식 도움말은 앱에서 계정을 만들 수 있으면 앱 안 삭제 경로와 기능하는 외부 웹 삭제 경로를 요구합니다. 웹 경로는 앱/개발자와 관련성이 분명하고 찾기 쉬워야 합니다. `https://www.masscom.kr/account-deletion`의 계정 귀속 접수([운영 HTTPS 배포 기록](evidence/operating-deletion-intake-deployment-2026-09-28.json)은 접수만 있던 이전 버전)는 D-052로 접수번호·취소·운영자 처리·조회까지 구현했지만 이 버전은 배포되지 않았고 폐기용 실계정의 접수→처리→조회 종단 실행은 미검증이므로 출시 준비 상태는 `BLOCKED`입니다. Google의 공식 OIDC 문서는 `auth_time` 요청을 설명하지만 강제 재인증 수단을 보장하지 않으므로, 서명된 최근 `auth_time`을 얻지 못하면 D-026에 따라 삭제를 거절합니다.

- [Google Play 계정 삭제 요구사항](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)

## D01~D03 판정

- D01 `PASS`: PostgreSQL에서 미전송 취소·제출/확정 보존·동시 요청·비식별화를 검증했습니다.
- D02 `NOT_RUN`: 모든 계정 화면의 remount 보호, 지갑 세션의 계정별 저장 분리와 시작 시 다른 계정 세션 제거, API 응답 `no-store`를 구현하고 자동 시험했습니다(Issue #80). 실제 운영 로그인과 Android 실기 계정 전환 환경이 없어 상태는 유지합니다.
- D03 `PASS`: 저장소 로그 인자·분석 SDK 정적 gate, 비밀 검사, API 응답 최소화를 검증했습니다. 외부 운영 로그 수집기는 `NOT_RUN`입니다.
