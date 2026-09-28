# 운영 관리자 기반: 첫 상점 관리 구간

## 경계

- 운영 관리자 권한은 `platform_admins`에만 둔다. 상점 `OWNER`/`STAFF`, 고객 로그인, 시연 계정과 독립적이다.
- 운영자는 이미 로그인해 `auth_identities`에 기록된 Google `subject`를 동일인 확인한 뒤 명시적 CLI로 부여하거나 회수한다. 이메일, 비밀번호, 환경변수 허용 목록, 웹 자체 승격은 사용하지 않는다. 이 작업에서는 실제 권한을 부여하지 않는다.
- `/admin/`은 별도 웹 화면이다. 기존 Google OIDC와 Host에 묶인 `web_session` 쿠키를 재사용한다. 관리자 로그인 시작 경로는 반환 위치를 고정된 `/admin/`으로 저장하며 임의 URL을 받지 않는다.
- `/api/web/admin/*`은 운영 웹의 정확한 Host에서만 동작한다. 읽기는 쿠키와 현재 관리자 권한을 확인한다. 쓰기는 정확한 Origin과 JSON Content-Type을 추가로 요구한다. 모바일 Bearer 토큰과 시연 헤더로는 접근할 수 없다.
- `GET /api/web/admin/auth/start`는 Google OIDC를 시작하고 성공 시 `/admin/`으로만 돌아온다. 로그인 상태와 권한은 `GET /api/web/admin/me`에서 별도로 확인한다.
- 관리자 쓰기는 계정 삭제 잠금과 관리자 권한 행 잠금을 보유한 트랜잭션에서 수행한다. 권한 회수·삭제 후 새 쓰기는 거부한다.

## 첫 업무 구간

- `GET /api/web/admin/me` → `200 {"admin":true}`, 미로그인 `401`, 권한 없음 `403`.
- `GET /api/web/admin/merchants` → `200 {"merchants":[...]}`. 시연 상점은 제외한다.
- `POST /api/web/admin/merchants` → 이름, 소개, 도로명 주소, 최소 결제 금액을 받아 `201 {"merchant":...}`. 새 상점은 `is_demo=false`, `status=PAUSED`, 캠페인 없음으로 저장한다. 자동 공개하지 않는다.
- `PATCH /api/web/admin/merchants/:id` → 위 필드와 `expectedVersion`을 받아 `200 {"merchant":...}`. 버전 충돌은 `409`.
- `POST /api/web/admin/merchants/:id/hide` → `expectedVersion`을 받아 `200 {"merchant":...}`. 유효한 미수령 QR이 있으면 캠페인을 유지하고 `409 ADMIN_PENDING_CLAIMS`로 거부한다. 수령 완료 또는 만료 후 재시도할 수 있다. 성공 시 상점을 비공개로 만들고 활성 캠페인을 같은 트랜잭션에서 `PAUSED`, `is_public=false`로 바꿔 신규 참여를 중지한다. 이미 수령한 권리는 삭제하지 않는다.
- QR 신규 발급과 재발급은 활성 상점 행을 공유 잠금으로 확인해 숨김과 직렬화한다. 숨김 완료 후 새 발급·재발급은 `409 CLAIM_MERCHANT_INACTIVE`로 거부한다. 이미 소비한 고객 신원 토큰의 동일 요청 재시도는 새 QR을 만들지 않고 기존 `claimSlotId`만 반환한다.
- 생성·수정·숨김 감사 행은 해당 변경과 동일 트랜잭션에 기록된다. 감사 기록 실패 시 업무 변경도 롤백한다. 계정 삭제는 관리자 권한을 제거하고 감사 행의 행위자 계정을 익명 별칭으로 바꾼다.

## 운영자 권한 부여

운영 DB 접속 환경과 계정 삭제 HMAC 비밀을 설정한 운영자만 `npm run admin:role:production -- grant <검증한-Google-subject>` 또는 `revoke`를 실행한다. 명령은 기존 Google 신원과 삭제되지 않은 계정을 다시 확인하며, 시연 DB를 거부하고 subject를 출력하지 않는다. 실제 부여 전 선택한 주 계정의 subject가 운영 DB에 있는 신원과 동일한지 별도로 확인한다.

## 남은 범위

상점 공개/재개, 직원 권한 관리, 캠페인 작성·운영, 수집품 자산, 운영 상태 화면, 실제 Google 계정 권한 부여, 운영 배포 및 기기 수락은 이 구간에 포함하지 않는다.
