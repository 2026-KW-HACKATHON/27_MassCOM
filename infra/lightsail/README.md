# 기존 Lightsail의 포털·운영 웹 이관

**최신 웹 전용 배포(2026-09-28):** [PR #200](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/200) merge `088cebe`의 PR/main CI PASS 뒤 기존 Lightsail의 웹·Caddy만 갱신했습니다. 첫 전송은 SSH exit 255로 중단돼 기존 웹 `174aa13`이 유지됐고 재시도는 exit 0입니다. apex/www `/open`은 운영 test.3·시연 Preview 3의 공개 APK를 안내하며 외부 HTTPS 200/TLS·소스 해시 일치, 다른 www 경로·두 API 정상과 API/DB 이미지 불변을 [실측](../../docs/evidence/public-open-page-2026-09-28.json)했습니다. 이전 `174aa13`에서는 [계정 삭제 안내](../../docs/evidence/web-only-deployment-2026-09-28.json)를 갱신했습니다. 실제 삭제 대상 식별·처리는 [B-020](../../docs/BLOCKERS.md)으로 계속 차단됩니다.

`www.masscom.kr` 추가 전환은 [승인 설계](../../docs/superpowers/specs/2026-09-25-www-web-consolidation-design.md)를 따른다. PR #169의 정적 `/preview/`와 호스트별 인증 코드를 기존 서버에 배포했고 apex 경로·DB migration·백업·Google `www` 승인 URI·가비아 www A·공인 TLS·휴대전화 한 계정 로그인을 확인했다([전환 증거](../../docs/evidence/www-web-cutover-2026-09-25.json)). apex DNS와 `/open`·Reown 출처는 유지한다. www 두 번째 계정과 기록이 있는 도감 격리는 미검증이며, [최신 시험 원장](../../docs/TEST_STATUS.md)에 별도로 남긴다.

**이전 운영 웹 실증(2026-09-25):** 당시 운영 배포 `d787471`, 기존 PostgreSQL 컨테이너 유지, Google 로그인 시작 302와 데스크톱의 기존 계정 빈 도감·새로고침·로그아웃 및 익명 401을 확인했다. Samsung Android Chrome에서도 서로 다른 Google 계정 2개를 순차 로그인하고 A 로그아웃 후 B 세션 유지를 확인했다. OAuth 비밀값은 Git 밖 mode 600 파일에만 저장했고 클립보드를 비웠다. 두 계정 모두 기록 0건이라 실제 데이터가 있는 도감의 교차 노출과 최신 운영 APK는 `NOT_RUN`이다. [최신 시험 원장](../../docs/TEST_STATUS.md)을 우선한다.

## 이관 당시 상태와 실행 기록

상태(2026-09-25): **운영 포털·웹의 Lightsail 이관 및 apex DNS/TLS PASS, 웹 Google 로그인 BLOCKED**. [PR #163](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/163) 병합·main CI 통과 후 `masscom.kr`의 가비아 apex A를 `43.200.56.97`로 전환했고 Let's Encrypt 인증서와 외부 HTTPS 경로를 확인했다. API/DB는 기존 인스턴스에 그대로 있으며, 운영 API는 `ec57eb4`로 갱신돼 0014·0015 migration이 적용됐다. Google 콜백 URI는 등록됐으나 새 OAuth 비밀값이 아직 런타임에 없어 로그인 경로는 예상대로 503이다. 첫 원격 staging 실패는 역사적 기록이며 현재 배포 상태가 아니다. [설계](../../docs/superpowers/specs/2026-09-24-lightsail-web-consolidation-design.md)와 [테스트 원장](../../docs/TEST_STATUS.md)을 구분해 읽는다.

## 실행 순서

1. AWS 콘솔·호스트에서 현재 비용/크레딧, `free -m`, `df -h /opt`, 운영 API·DB 컨테이너 ID/재시작 수, static IP 소유와 `https://api.masscom.kr/health`를 확인한다. 이유: 기존 2GB 서버에 웹을 추가해 운영 API를 밀어내거나 승인되지 않은 비용을 만들면 안 된다. 완료 기준: 24시간 이내 측정값을 저장소 밖 mode 600 JSON에 기록하고 승인 크레딧 범위임을 확인한다.
2. GitHub PR·CI와 로컬 `node --test tests/site/build_public_site_test.mjs`, `node scripts/verify-lightsail-web.mjs`, `bash tests/ops/run_aws_web_smoke.sh`, `bash tests/ops/deploy_lightsail_web_test.sh`를 통과시킨다. 이유: 비공개 `docs/` 누출과 API/DB 재기동을 배포 전에 막는다. 완료 기준: Caddy의 허용 경로 200, 비공개 경로 404, API/DB 시험 컨테이너 0건이 기록된다.
3. 기존 배포용 SSH 키·runtime env·확인된 known_hosts와 1단계의 비공개 용량 증거를 지정해 `bash scripts/deploy-lightsail-web.sh --dry-run`을 실행한다. 이 명령은 원격 검사를 하지 않는다. 같은 설정의 `--deploy`는 기존 API/DB를 유지하며 웹/Caddy만 교체한다. 이유: 웹 갱신을 위해 API 이미지나 DB migration을 다시 실행하지 않는다. 완료 기준: 기존 API/DB 컨테이너 ID 동일, 웹 서비스 healthy, API HTTPS health 정상, 웹 배포 커밋 별도 기록.
4. 당시 완료 범위: 가비아 apex A는 `43.200.56.97`, `api` A는 기존 값, `www` CNAME은 Vercel로 유지했었다. 공인 DNS·Let's Encrypt·`/`, `/open`, 법적 페이지, `/presentation`, assetlinks, `/app/`, `/merchants`, API health를 확인했다. 후속 `www` A 전환·공인 TLS·로그인은 이 문서 맨 위의 새 전환 증거를 따른다. 기존 Vercel 배포는 DNS 복구 후보로 보존한다.
5. 완료된 범위: Samsung SM-S928N의 이전 `test.2` APK에서 `https://masscom.kr/open` 명시적 Android VIEW intent가 앱을 열었고, 휴대전화 Chrome에서 `/app/` 운영 웹이 표시됐다. Android 설정의 사용자 선택 상태는 `Disabled`여서 일반 링크 탭의 기본 열기까지 PASS로 확대하지 않는다.
6. 완료된 범위: Google 콜백 URI와 새 비밀값을 등록·배포했고, 데스크톱과 휴대전화 Chrome에서 실제 로그인·빈 도감·로그아웃/세션 전환을 확인했다. 비밀값을 Git·채팅·명령 인자에 두지 않았다. 남은 검증은 실제 기록이 있는 계정 간 격리다.

실패하면 먼저 웹 전용 스크립트의 이전 Caddy release 복귀 결과와 운영 API health를 확인한다. DNS를 이미 바꿨다면 기록한 Vercel 목적지로 되돌리되 TTL 지연을 `BLOCKED` 증거로 남긴다. 운영 DB 볼륨 삭제·`/opt/masscom/DEPLOYED_COMMIT` 수정은 복구 절차에 포함하지 않는다.

## 운영 전체 API·웹 배포 안전장치 (후속 코드, 원격 미실행)

정적 페이지 변경은 위의 웹 전용 배포를 사용한다. API와 웹을 함께 교체해야 할 때만 `scripts/deploy-lightsail.sh`를 사용한다. 후속 `fix/release-readiness` 변경은 기존 운영 API의 40자리 배포 커밋, 대상 `HEAD`, `backward_compatible=yes`가 들어간 Git 밖 mode 600 호환성 증거 파일을 `MASSCOM_MIGRATION_COMPATIBILITY_EVIDENCE_FILE`로 요구한다. 이 표시는 실제 migration을 검토했다는 기록이지 DB 복구를 자동화하지 않는다.

전체 배포는 기존 런타임 환경·Caddyfile·운영 DB의 custom-format 백업과 복원 목록 검증을 **migration 전에** 수행한다. 실패하면 이전 API·웹·Caddy 이미지와 시연 edge 연결, 환경 파일·배포 포인터·커밋 마커를 되돌리고 운영/시연 HTTPS를 다시 확인한다. migration이 시작된 뒤의 DB 변경은 자동 되돌리지 않는다. 백업 경로와 적용된 migration을 대조해 별도로 수동 복구를 판단해야 하며, 이 코드의 실제 원격 롤백은 아직 `NOT_RUN`이다. 운영 DB 볼륨 삭제나 테스트 데이터 삽입은 복구 방법이 아니다.

기존 원격 release 경로나 API·웹 이미지 태그가 있으면 동일 SHA 재배포를 거절한다. 실패한 업로드도 해당 경로를 남길 수 있으므로 재시도 전에는 남은 파일·이미지·백업과 현재 서비스를 읽기 전용으로 대조하고, 검토된 새 커밋/릴리스 ID로 진행한다. 복구가 필요한 실제 자료를 자동 삭제하지 않는다. 기존 Lightsail의 Docker Compose 2.40.3에서 `--wait`·`--wait-timeout` 지원을 읽기 확인했지만 이 전체 배포 코드를 원격 실행한 것은 아니다.

**다음 행동:** 운영 기록이 있는 두 계정의 도감 격리와 최신 APK를 별도로 검증한다. 시연 API/앱·`demo.masscom.kr`와 일반 링크 탭 동작도 미완료 게이트다.
