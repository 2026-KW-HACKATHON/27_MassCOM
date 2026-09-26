# 외부 시연 API 초대 인증 경계

상태: 코드·로컬 PostgreSQL 검증과 기존 Lightsail의 [별도 시연 API/DB](evidence/showcase-internal-2026-09-27.json) `PASS`, 전용 Google Web/Android client·OAuth 테스트 사용자 2명 준비 `PASS`([근거](evidence/showcase-oauth-2026-09-26.json)). 내부 실제 초대 로그인·비초대/운영 audience 거절·STAFF 권한은 [실증](evidence/showcase-internal-auth-claim-2026-09-27.json)·[교차 검사](evidence/showcase-dns-audience-2026-09-27.json) `PASS`; [공인 HTTPS·운영 분리](evidence/showcase-public-edge-2026-09-27.json)와 [Android 시연 APK의 실제 초대 Google 로그인·STAFF 발급](evidence/showcase-android-apk-2026-09-27.json)도 `PASS`. 고객의 실제 폰 QR 촬영→수령은 `NOT_RUN`.

시연 앱은 운영 Google ID·지갑 프로젝트를 물려받지 않습니다. 시연 API도 별도 Google Web client ID 하나만 `GOOGLE_OAUTH_CLIENT_IDS`로 허용해야 합니다. Google 서명·발급자·대상·만료 검증을 통과해도 **그 사실만으로 초대된 사람은 아닙니다.**

`SHOWCASE_MODE=true` 서버는 시작할 때 다음을 모두 요구합니다.

- `DATABASE_URL`의 DB 이름이 정확히 `masscom_showcase`이고, 연결한 실제 PostgreSQL의 `current_database()`도 일치
- 형식이 올바른 Google Web client ID가 `GOOGLE_OAUTH_CLIENT_IDS`에 정확히 하나
- `SHOWCASE_INVITED_SUBJECT_SHA256`에 초대 계정의 Google `sub`를 SHA-256으로 계산한 소문자 64자리 해시가 한 개 이상, 쉼표로 구분
- `ALLOW_INSECURE_DEMO_ACCOUNT`는 `true`가 아님

값이 없거나 형식이 틀리면 서버 시작이 실패합니다. 이 초대 목록은 저장소 밖의 접근 제한된 런타임 설정에만 두고, Google `sub` 원문·ID 토큰·이메일·세션 토큰은 Git·명령 기록·증거에 남기지 않습니다. 초대 계정이 로그인할 때만 DB identity와 session이 생깁니다. 목록은 서버 시작 시 메모리에 고정되므로 초대를 철회하려면 **모든 시연 API 인스턴스의 설정을 교체하고 재시작한 뒤 이전 인스턴스를 종료**해야 기존 session의 다음 조회가 거절됩니다. 마지막 초대까지 없앨 때는 먼저 시연 API를 중지합니다. 빈 목록으로는 재시작이 거절됩니다. 운영 API는 `SHOWCASE_MODE`를 설정하지 않아 기존 로그인 정책을 유지합니다.

초대 목록은 실제 Google 로그인 token의 **검증된** `sub`에서 만들어야 합니다. 임의 이메일 문자열이나 미검증 JWT payload로 해시를 만들지 않습니다. 사용자의 신원을 구분하는 키로 이메일 대신 `sub`를 쓰는 이유는 Google의 [서버 측 ID 토큰 검증 안내](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)에 따릅니다.

내부 시연 API에서는 전용 Web OAuth 두 계정의 초대 로그인과 비초대·운영 audience 거절을 확인했습니다. 가상 A점포 STAFF 권한은 첫 계정에만 부여했고 고객 계정이 자동으로 얻지 않음을 검증했습니다. 공개 TLS·Caddy 라우팅과 운영 DB/API/웹 보존은 [공개 실측](evidence/showcase-public-edge-2026-09-27.json)으로, Android `.demo` 설치본의 초대 Google 로그인·가상 점포/도감 조회·STAFF 발급은 [폰 실기](evidence/showcase-android-apk-2026-09-27.json)로 확인했습니다. 다른 초대 계정의 실제 폰 QR 촬영→수령·외부 지갑은 `NOT_RUN`입니다. 실제 롤백은 정상 배포였으므로 실행하지 않았고 이전 Caddy 설정·Compose 백업을 서버에 보존했습니다.
