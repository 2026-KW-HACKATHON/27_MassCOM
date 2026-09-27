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
