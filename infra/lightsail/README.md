# 기존 Lightsail의 포털·운영 웹 이관

상태: **로컬 Caddy/웹 경로·SSH/용량/dry-run PASS, 원격 웹 배포·DNS 전환 NOT_RUN**. 현재 `masscom.kr`은 Vercel, `api.masscom.kr`은 기존 Lightsail이다. [설계](../../docs/superpowers/specs/2026-09-24-lightsail-web-consolidation-design.md)와 [테스트 원장](../../docs/TEST_STATUS.md)을 구분해 읽는다.

## 실행 순서

1. AWS 콘솔·호스트에서 현재 비용/크레딧, `free -m`, `df -h /opt`, 운영 API·DB 컨테이너 ID/재시작 수, static IP 소유와 `https://api.masscom.kr/health`를 확인한다. 이유: 기존 2GB 서버에 웹을 추가해 운영 API를 밀어내거나 승인되지 않은 비용을 만들면 안 된다. 완료 기준: 24시간 이내 측정값을 저장소 밖 mode 600 JSON에 기록하고 승인 크레딧 범위임을 확인한다.
2. GitHub PR·CI와 로컬 `node --test tests/site/build_public_site_test.mjs`, `node scripts/verify-lightsail-web.mjs`, `bash tests/ops/run_aws_web_smoke.sh`, `bash tests/ops/deploy_lightsail_web_test.sh`를 통과시킨다. 이유: 비공개 `docs/` 누출과 API/DB 재기동을 배포 전에 막는다. 완료 기준: Caddy의 허용 경로 200, 비공개 경로 404, API/DB 시험 컨테이너 0건이 기록된다.
3. 기존 배포용 SSH 키·runtime env·확인된 known_hosts와 1단계의 비공개 용량 증거를 지정해 `bash scripts/deploy-lightsail-web.sh --dry-run`을 실행한다. 이 명령은 원격 검사를 하지 않는다. 같은 설정의 `--deploy`는 기존 API/DB를 유지하며 웹/Caddy만 교체한다. 이유: 웹 갱신을 위해 API 이미지나 DB migration을 다시 실행하지 않는다. 완료 기준: 기존 API/DB 컨테이너 ID 동일, 웹 서비스 healthy, API HTTPS health 정상, 웹 배포 커밋 별도 기록.
4. 현재 Vercel apex A/AAAA/CNAME·TTL·CAA와 rollback 목적지를 저장한 뒤, 실제 서버의 `masscom.kr` TLS 준비와 1~3단계가 통과했을 때에만 가비아 apex DNS를 검증된 Lightsail static IP로 바꾼다. 기존 Vercel 배포는 안정화 전까지 유지한다. 이유: DNS 전환 중 인증서 발급 또는 캐시 지연으로 접속 공백이 생길 수 있다. 완료 기준: 두 외부 네트워크에서 `/`, `/open`, 법적 페이지, `/presentation`, `/.well-known/assetlinks.json`, `/app/`, `/merchants`와 기존 API를 확인한다.
5. Android에서 `https://masscom.kr/open`의 verified App Link 복귀를 시험하고 운영 웹 개인 도감은 별도 웹 세션·OAuth 수용 기준까지 비활성으로 둔다. 이유: 정적 이관만으로 본인 도감 인증은 완성되지 않는다. 완료 기준: 기기·앱 버전·커밋·결과와 재현 방법을 `docs/TEST_STATUS.md`에 남긴다.

실패하면 먼저 웹 전용 스크립트의 이전 Caddy release 복귀 결과와 운영 API health를 확인한다. DNS를 이미 바꿨다면 기록한 Vercel 목적지로 되돌리되 TTL 지연을 `BLOCKED` 증거로 남긴다. 운영 DB 볼륨 삭제·`/opt/masscom/DEPLOYED_COMMIT` 수정은 복구 절차에 포함하지 않는다.

**다음 행동:** 웹 프록시 점검 수정 PR·CI를 마친 뒤 3단계 원격 staging에서 API/DB 컨테이너 ID와 health를 전후 대조한다. DNS는 4단계 전까지 Vercel로 유지한다.
