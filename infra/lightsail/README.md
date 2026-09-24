# 기존 Lightsail의 포털·운영 웹 이관

상태(2026-09-25): **운영 포털·웹의 Lightsail 이관 및 apex DNS/TLS PASS, 웹 Google 로그인 BLOCKED**. [PR #163](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/163) 병합·main CI 통과 후 `masscom.kr`의 가비아 apex A를 `43.200.56.97`로 전환했고 Let's Encrypt 인증서와 외부 HTTPS 경로를 확인했다. API/DB는 기존 인스턴스에 그대로 있으며, 운영 API는 `ec57eb4`로 갱신돼 0014·0015 migration이 적용됐다. Google 콜백 URI는 등록됐으나 새 OAuth 비밀값이 아직 런타임에 없어 로그인 경로는 예상대로 503이다. 첫 원격 staging 실패는 역사적 기록이며 현재 배포 상태가 아니다. [설계](../../docs/superpowers/specs/2026-09-24-lightsail-web-consolidation-design.md)와 [테스트 원장](../../docs/TEST_STATUS.md)을 구분해 읽는다.

## 실행 순서

1. AWS 콘솔·호스트에서 현재 비용/크레딧, `free -m`, `df -h /opt`, 운영 API·DB 컨테이너 ID/재시작 수, static IP 소유와 `https://api.masscom.kr/health`를 확인한다. 이유: 기존 2GB 서버에 웹을 추가해 운영 API를 밀어내거나 승인되지 않은 비용을 만들면 안 된다. 완료 기준: 24시간 이내 측정값을 저장소 밖 mode 600 JSON에 기록하고 승인 크레딧 범위임을 확인한다.
2. GitHub PR·CI와 로컬 `node --test tests/site/build_public_site_test.mjs`, `node scripts/verify-lightsail-web.mjs`, `bash tests/ops/run_aws_web_smoke.sh`, `bash tests/ops/deploy_lightsail_web_test.sh`를 통과시킨다. 이유: 비공개 `docs/` 누출과 API/DB 재기동을 배포 전에 막는다. 완료 기준: Caddy의 허용 경로 200, 비공개 경로 404, API/DB 시험 컨테이너 0건이 기록된다.
3. 기존 배포용 SSH 키·runtime env·확인된 known_hosts와 1단계의 비공개 용량 증거를 지정해 `bash scripts/deploy-lightsail-web.sh --dry-run`을 실행한다. 이 명령은 원격 검사를 하지 않는다. 같은 설정의 `--deploy`는 기존 API/DB를 유지하며 웹/Caddy만 교체한다. 이유: 웹 갱신을 위해 API 이미지나 DB migration을 다시 실행하지 않는다. 완료 기준: 기존 API/DB 컨테이너 ID 동일, 웹 서비스 healthy, API HTTPS health 정상, 웹 배포 커밋 별도 기록.
4. 완료: 가비아 apex A는 `43.200.56.97`, `api` A는 기존 값, `www` CNAME은 기존 Vercel 목적지로 유지했다. 공인 DNS·Let's Encrypt·`/`, `/open`, 법적 페이지, `/presentation`, assetlinks, `/app/`, `/merchants`, API health를 확인했다. 기존 Vercel 배포는 DNS 복구 후보로 유지한다. `www` 이관은 별도 검증 전까지 완료로 쓰지 않는다.
5. 완료된 범위: Samsung SM-S928N의 이전 `test.2` APK에서 `https://masscom.kr/open` 명시적 Android VIEW intent가 앱을 열었고, 휴대전화 Chrome에서 `/app/` 운영 웹이 표시됐다. Android 설정의 사용자 선택 상태는 `Disabled`여서 일반 링크 탭의 기본 열기까지 PASS로 확대하지 않는다.
6. 남은 작업: Google 콘솔의 `MassCOM Android Server` Web client에 등록된 `https://masscom.kr/api/web/auth/callback`을 유지하고, 소유자가 새 클라이언트 비밀값을 생성·복사한 뒤 `pbpaste | node scripts/install-web-oauth-runtime.mjs .tmp/lightsail-runtime.env`로 저장한다. 값은 Git·채팅·명령 인자에 두지 않는다. mode 600 런타임 파일을 운영 서버에 반영한 뒤 API 재시작, 실제 Google 코드 교환·쿠키·A/B 계정 격리·로그아웃을 검증한다. 이 전에는 개인 도감을 `VERIFIED`로 표기하지 않는다.

실패하면 먼저 웹 전용 스크립트의 이전 Caddy release 복귀 결과와 운영 API health를 확인한다. DNS를 이미 바꿨다면 기록한 Vercel 목적지로 되돌리되 TTL 지연을 `BLOCKED` 증거로 남긴다. 운영 DB 볼륨 삭제·`/opt/masscom/DEPLOYED_COMMIT` 수정은 복구 절차에 포함하지 않는다.

**다음 행동:** 새 OAuth 비밀값의 사용자 생성·비공개 저장 후 운영 API에 반영하고 실계정 웹 도감을 검증한다. 시연 API/앱·`demo.masscom.kr`, 최신 운영 APK와 일반 링크 탭 동작은 별도 미완료 게이트다.
