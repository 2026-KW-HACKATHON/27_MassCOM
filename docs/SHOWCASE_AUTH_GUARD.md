# 시연 고객 로그인·점주 권한 경계

**현재 배포 상태:** `demo-api.masscom.kr`은 [PR #192 병합 커밋의 새 고객 로그인 코드로 교체](evidence/showcase-open-login-api-deployment-2026-09-27.json)했고 [Preview 3 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.3)를 서명·게시했습니다. [Samsung 설치·가상 3점포·Google 취소 후 재진입](evidence/showcase-preview3-phone-2026-09-28.json)은 확인했지만, **초대 밖 실제 Google 계정의 새 로그인은 아직 `NOT_RUN`**입니다. 이전 [두 계정·STAFF·운영 audience 교차 증거](evidence/showcase-internal-auth-claim-2026-09-27.json)는 이전 설치본의 기록입니다.

## 승인된 새 정책

- `kr.masscom.wolgye.demo`의 고객은 유효한 **시연 전용** Google ID 토큰이면 모두 로그인할 수 있습니다. 앱·서버가 Google 서명·발급자·대상(audience)·만료·`sub`를 검증하고, 서버는 해시만 보관한 별도 세션을 발급합니다. 취소나 실패를 자동 반복 로그인으로 바꾸지 않습니다.
- 점주·직원은 여전히 별도 `merchant_members` 권한이 있어야 가상 A점포 코드를 발급할 수 있습니다. 첫 화면에서 ‘점주’를 고르는 행동만으로 권한이 생기지 않습니다. STAFF 부여 명령은 검증된 Google `sub` 해시·기존 활성 세션·정확한 가상 점포·별도 시연 DB를 확인합니다.
- 운영 `kr.masscom.wolgye` Android 앱은 고객 경로만 제공합니다. 운영 API·DB·Google audience·키와 시연 가상 점포·방문·보상은 섞지 않습니다. 운영 점주 API 권한을 삭제하거나 고객에게 부여하지 않습니다.
- 외부 시연 웹은 여전히 가상 예시를 읽기만 합니다. QR·방문 수령·지갑 서명·NFT 발행 요청을 웹에 추가하지 않습니다.

## 서버 설정과 과거 이름

`SHOWCASE_MODE=true`는 정확한 `masscom_showcase` DB, 전용 Google Web audience 한 개, 외부 개발 DEMO 헤더 금지를 계속 강제합니다. 기존 런타임 이름 `SHOWCASE_INVITED_SUBJECT_SHA256`은 **STAFF 부여 적격성 검사에만 남는 과거 이름**입니다. 값은 검증된 Google `sub`의 SHA-256이고 Git 밖 권한 제한 환경 파일에 둡니다. 이 값이 고객 세션 발급·조회·재인증을 제한해서는 안 됩니다. `SHOWCASE_STAFF_SUBJECT_SHA256`을 사용하는 STAFF 부여 명령은 기존 적격성 목록에 정확히 포함된 계정만 허용합니다. 운영 API는 `SHOWCASE_MODE`를 설정하지 않습니다.

해시 목록에서 계정을 제거하는 것은 **새 STAFF 부여 차단**일 뿐 기존 권한 회수가 아닙니다. 기존 STAFF를 회수할 때는 시연 DB의 해당 `merchant_members` 행을 `REVOKED`·`revoked_at` 설정으로 변경한 뒤 그 계정의 기존 세션으로 점주 API가 403인지 확인합니다. 계정·해시 원문은 문서와 명령 출력에 남기지 않습니다.

Google Cloud의 현재 시연 프로젝트는 `Testing`, 기록된 시험 사용자는 2명입니다([과거 설정 근거](evidence/showcase-oauth-2026-09-26.json)). 앱 SDK 설정에는 추가 Google API 범위 없이 기본 `openid`·`email`·`profile`만 있습니다. [Google 공식 안내](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)의 기본 신원 범위 예외상 일반 계정 접근이 가능할 것으로 예상하지만, **초대 밖 실제 Google 계정의 외부 HTTPS·Android 로그인은 직접 실행 전까지 `NOT_RUN`**입니다. Google Cloud 설정 변경·게시 상태 변경을 시험 결과로 추정하지 않습니다.

## 통합·배포 게이트

1. 로컬 실제 PostgreSQL에서 초대 목록 밖 검증된 고객의 세션 200·본인 도감, STAFF 권한 403, 명시적 STAFF 200을 확인합니다. 기록 있는 다른 고객과의 도감 격리, 잘못된/운영 Google audience 401, 로그인 제한(429), 로그아웃·계정 삭제·재인증은 각 기존 회귀 시험과 새 배포 검증에서 확인합니다.
2. 시연/운영 package·API·DB·Google client·데이터 분리 검사를 통과하고, 공통 고객 UI 오류 수정이 두 Android variant에 반영되는지 확인합니다. 운영 점포에 가상 데이터 0건을 재확인합니다.
3. 한국어 PR의 필수 CI·리뷰를 우회하지 않고 병합한 뒤, 기존 Lightsail의 시연 API **만** 검증된 커밋으로 배포합니다. 이 단계는 PR #192에서 [완료](evidence/showcase-open-login-api-deployment-2026-09-27.json)했으며 운영 컨테이너·DB·Caddy가 보존됐습니다. 실제 rollback 실행은 `NOT_RUN`이고 이전 시연 API 이미지는 유지합니다.
4. 초대 밖 실제 Google 계정으로 Android 고객 로그인→빈 도감→로그아웃을 확인하고, STAFF 진입 거절과 기존 두 계정의 기록 격리도 확인합니다. Preview 3 APK의 [서명·게시](evidence/showcase-preview3-release-2026-09-27.json)와 [폰 설치·취소 후 재진입](evidence/showcase-preview3-phone-2026-09-28.json)은 완료했지만 이 전체 새 계정 흐름은 `NOT_RUN`입니다. Preview 2는 변경 전 오류 복구 코드를 담습니다.

Google `sub`·이메일·ID 토큰·세션 토큰·QR 원문은 로그·Git·증거 파일에 기록하지 않습니다. 카메라 QR 촬영→수령·외부 지갑/NFT는 이 로그인 정책 변경만으로 완료되지 않습니다.

## 점주 체험 권한 요청·승인 (Issue #294, PR1 서버)

허용목록(`SHOWCASE_INVITED_SUBJECT_SHA256`) 기반 STAFF 부여는 그대로 남아 있습니다(위 절). 이 기능은 **같은 가상 점포 A STAFF 권한에 이르는 두 번째 경로**를 더합니다: 허용목록에 없는 시연 로그인 계정도 서버에 요청을 넣고, 승인자가 수락하면 같은 STAFF 권한을 받습니다.

- 승인자 역할은 **새 역할이 아니라 시연 DB의 `platform_admins`를 그대로 씁니다**(운영 관리자 역할과 같은 표, 다른 DB). 그래서 계정 삭제 purge(`postgres/account-deletion.ts`)와 3년 접근권한 감사(`platform_admin_role_audit`, Issue #253/D-059)를 별도 구현 없이 물려받습니다.
- 요청·결정은 `migrations/0037_showcase_access_requests.sql`의 `showcase_access_requests` 한 표(운영 DB에도 스키마만 생기고 쓰지 않음)로 기록되며 이 행 자체가 "누가 언제 무엇을 요청·승인·거절했는지"의 감사입니다(결정된 행은 다시 바꾸지 않음).
- **승인 핵심은 기존 STAFF 부여(`showcase/grant-staff.ts`)에서 떼어낸 `grantShowcaseStaffTx`**(DB 이름 재확인·계정 활성 확인·가상 점포 A인지 확인·멤버십 삽입/검증)이고, 허용목록·세션 검사는 건너뜁니다(대기 중 요청 행 자체가 자격 증명입니다). 기존 운영자 명령(`grant:showcase:staff`)의 허용목록·세션 검사 경로는 바뀌지 않습니다.
- API는 [resolveShowcaseDeployment](../apps/api/README.md#엔드포인트)가 `hosted`(SHOWCASE_MODE)나 `local`(demo + 시연 local/CI DB 이름)로 판정할 때만 열리고, 그 밖(운영 로그인)에서는 다른 시연 전용 라우트처럼 `404 NOT_FOUND`입니다.
- **부트스트랩(최초 승인자를 만드는 법, 사람이 함):** 승인자 후보가 시연 Android 앱에 **본인 계정**으로 로그인해 점주 체험 화면에서 "현재 계정으로 문의하기"로 요청을 넣고 화면에 뜬 8자 코드를 자신의 Gmail로 승인자 1·승인자 2에 메일로 보냅니다(개인 메일 주소는 문서에 적지 않습니다. 발신자 확인이 신원 증명이며, 에이전트는 그 계정으로 로그인하지 않습니다). 운영자가 코드를 받아 `npm run grant:showcase:approver -- <코드>`를 시연 DB에 돌리면 한 트랜잭션에서 `platform_admins` upsert·`platform_admin_role_audit` GRANT 행(`db_user`=세션 역할)·요청을 `decided_via='OPS'`로 승인(가상 점포 A STAFF 포함)까지 끝나고 `SHOWCASE_APPROVER_GRANTED`만 출력합니다. 그다음부터는 새 승인자가 된 계정이 앱 화면에서 다른 요청을 직접 승인·거절합니다. 절차는 [시연 호스트 안내](../infra/showcase-host/README.md)에 있습니다.
- 계정당 요청은 **시간당 5회**로 막혀 있고(`SHOWCASE_ACCESS_RATE_LIMITED`), 이미 STAFF면 새 요청을 거절합니다(`SHOWCASE_ACCESS_ALREADY_GRANTED`). 자기 요청의 자기 승인·거절은 금지합니다(`SHOWCASE_ACCESS_SELF_DECISION`).

## 로그인 없는 시연 웹 체험 (Issue #309, 서버)

시연 웹(`https://demo-api.masscom.kr/play/`, 입구 `masscom.kr/demo`)은 Google 로그인 없이 시작합니다. 이 경로는 **시연 API에만** 있고 운영 API에는 경로 자체가 없어 알 수 없는 경로와 같은 `404`입니다(실제 `server.ts`를 운영 설정으로 띄운 통합 시험). 결정은 [D-064](DECISIONS.md).

- `POST /auth/guest-trial`이 Google 신원(`auth_identities`) 없는 `acct_` 계정, 그 계정만의 체험 가게(가상 점포 A 복사, `is_demo`), 그 가게의 STAFF 권한, 24시간 `auth_sessions` 세션을 한 트랜잭션에서 만듭니다. 점주 권한은 여전히 서버 멤버십 검사로만 열리고, 체험자가 받는 STAFF는 **자기 체험 가게 하나**에만 걸립니다(가상 점포 A·B·C나 다른 체험 가게 권한은 없음).
- 체험 세션은 최근 인증 시각이 비어 있어 재인증이 필요한 동작(계정 삭제 요청 등)은 열리지 않습니다. 체험 계정은 승인자가 될 수 없습니다(`grant:showcase:approver`가 `SHOWCASE_GUEST_NOT_ELIGIBLE`로 거절, 끝난 체험 계정 포함). 앱의 권한 요청은 이미 STAFF라 `SHOWCASE_ACCESS_ALREADY_GRANTED`입니다.
- IP당 15분 20회(`429 GUEST_TRIAL_RATE_LIMITED`), 같은 IP의 끝나지 않은 체험 30개(`429 GUEST_TRIAL_IP_LIMIT`, IP는 HMAC으로만 저장하고 끝나면 지움), 끝나지 않은 동시 체험자 300명(`503 GUEST_TRIAL_BUSY`), 두 상한은 같은 advisory lock으로 직렬화. 시작할 때마다 만료 체험자 최대 20명을 끝냅니다(세션 삭제·멤버십 회수·가게 `PAUSED`·`ended_at`). 기록 행은 지우지 않고, 계정 삭제 때 체험 행의 `account_id`는 별칭으로 바뀝니다(행을 지우면 체험 가게가 목록에 다시 나온다).
- 체험 가게는 누구의 `/merchants`·추천에도, 친구 화면의 도장·메달에도 나오지 않고, AI 그림 생성 비용을 쓰지 않습니다(`403 AI_ART_TRIAL_DISABLED`, OpenAI 호출·예산 행 없음).
- 체험자는 이메일·Google `sub`가 없어 개인정보는 체험 중 직접 입력한 값(탐험가 이름 등)뿐입니다. 로컬 DEMO 배치에서는 `Authorization`이 있는 요청만 체험 세션으로 풀고 나머지는 기존 `x-account-id` 그대로입니다.
