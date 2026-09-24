# 기존 Lightsail의 포털·운영 웹 통합 설계

상태: 사용자 제안에 따른 구현 준비 · 2026-09-24 · Issue #137. 사용자는 `masscom.kr`도 기존 AWS Lightsail에서 제공할 수 있는지 물었고, 새 유료 자원 없이 남은 작업을 끝내 달라고 요청했다. 실제 DNS 전환은 현재 서버 용량·비용과 TLS·되돌리기 검증 전에는 실행하지 않는다.

## 목적과 성공 기준

기존 Vercel 포털의 공개 페이지와 읽기 전용 운영 웹을 이미 사용 중인 Lightsail 인스턴스로 모은다. `api.masscom.kr`의 로그인·방문·지갑 API와 PostgreSQL 자료는 그대로 보존한다. 결과는 `masscom.kr`의 포털·법적 페이지·Android App Link 파일·`/app/` 운영 웹이 HTTPS에서 열리고, 공개 점포 응답은 기존 웹 서버의 `demo:false` 필터와 필드 축소를 거칠 때 성공이다. 웹 개인 도감 로그인은 별도 세션·OAuth 작업 전까지 닫힌 상태로 유지한다.

## 선택한 구성과 비교

| 구성 | 장점 | 위험·판정 |
| --- | --- | --- |
| 기존 Vercel 포털에 운영 웹 추가 | 현재 DNS·정적 배포를 유지 | 사용자가 원하는 AWS 단일 호스트가 아니며 쿠키 rewrite 검증이 추가됨. 채택하지 않음 |
| **기존 Lightsail의 Caddy와 내부 production-web 서비스** | 추가 인스턴스 없이 같은 출처 웹 경로 구성 | 2GB 서버의 메모리·전송량과 장애 영역 공유. 용량·비용 확인 후에만 외부 전환 |
| 새 Lightsail/관리형 서비스 | 자원 격리 | 새 과금 자원이어서 현재 범위 밖 |

운영 웹은 `/app/`에 배치하고 Caddy가 prefix를 제거해 기존 상대 CSS/JS 주소를 보존한다. 정확한 `/merchants` 요청은 기존 `apps/production-web/server.mjs`로만 전달한다. 이 서버가 응답 스키마 확인, 가상 행 제거, 공개 필드만 남기는 처리를 하므로 Caddy에서 API의 원 응답으로 바로 바꾸지 않는다. `api.masscom.kr` Caddy 블록은 그대로 유지한다.

## 공개 파일과 개인정보 경계

포털은 `docs/` 전체를 호스트에 복사하지 않는다. 공개 허용 파일은 `index.html`, `open.html`, `privacy.html`, `account-deletion.html`, `presentation.html`, 세 CSS, 아이콘, 발표 화면의 네 PNG, `/.well-known/assetlinks.json`으로 고정한다. Markdown 인수인계·테스트 원장·JSON 증거·환경 파일은 파일 서버 루트에 존재하지 않아야 한다. 발표 페이지의 상대 `TEST_STATUS.md` 링크는 private GitHub 링크로 바꾼다.

`/`, `/open`, `/privacy`, `/account-deletion`, `/presentation`, `/.well-known/assetlinks.json`, `/app/`, `/merchants`만 공개 경로로 확인한다. `/claim`, `/mint`, 임의 `/api/web/*`는 이번 이관에서 열지 않는다. 웹 인증을 구현할 때는 `masscom.kr/api/web/*`의 명시적 허용 경로만 추가하고 host-only `HttpOnly; Secure; SameSite=Lax; Path=/api/web` 쿠키를 사용한다. 앱 Bearer/지갑 세션을 브라우저로 복사하지 않는다.

## 배포와 되돌리기

공개 파일 allowlist로 만든 번들과 production-web 이미지를 새 웹 전용 release에 둔다. 웹 배포는 기존 API 이미지를 재빌드하거나 DB 마이그레이션을 재실행하지 않고, Caddy·웹 서비스만 교체한다. 현재 Caddy는 `admin off`이므로 설정 파일 구문 검증 뒤 controlled recreate를 사용하며 실패 시 이전 Caddy 설정·웹 release로 돌린다. `/opt/masscom/DEPLOYED_COMMIT`은 API 이력으로 남기고 웹 배포 기록을 따로 둔다.

DNS 전에는 apex의 현재 Vercel A/AAAA/CNAME·TTL·CAA를 저장하고, 기존 Vercel 배포·도메인 연결을 유지한다. AWS static IP의 실제 소유와 서버 여유, 새 호스트 라우트, TLS 발급 방법을 확인한 뒤에만 apex를 바꾼다. 전환 후 운영 API 건강 상태와 모든 공개 경로·assetlinks 내용/형식·웹 빈 상태·개인 API 401을 외부에서 검사한다. 실패 시 Caddy release와 DNS 복구를 각각 수행하며 DNS TTL 지연을 기록한다.

**다음 행동:** [구현 계획](../plans/2026-09-24-lightsail-web-consolidation.md)의 공개 파일 allowlist 시험부터 시작한다.
