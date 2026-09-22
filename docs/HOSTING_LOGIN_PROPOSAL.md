# 외부 HTTPS·운영 로그인 결정과 실제 배포

상태: `IMPLEMENTED / PARTIALLY_VERIFIED`. 2026-09-22 사용자가 AWS Free Plan Lightsail 2GB(월 최대 USD 12, 크레딧 차감), `masscom.kr`, Google 로그인을 승인했다. API·PostgreSQL·Caddy를 서울 리전에 배포했고 `https://api.masscom.kr/health` HTTPS 200, Android 첫 Google 로그인·session 복원·logout revoke를 확인했다. Worker·Base Sepolia·운영 복원 drill은 별도 상태다.

## 지금 코드가 요구하는 것

| 요구 | 근거 |
| --- | --- |
| Node.js API 1개, 장기 실행 Worker 1개 | `apps/api`, `apps/worker`. Worker는 lease·heartbeat 루프라 요청 단위 serverless에 맞지 않음 |
| PostgreSQL(비공개 네트워크) | migration 0001~0010, 백업·복원 drill `scripts/db-restore-drill.sh` |
| HTTPS 고정 origin | 앱은 loopback 외 HTTP를 거절(`wallet-runtime-config`), SIWE `domain`·`uri`가 origin에 묶임 |
| 공개 페이지 2개 | 개인정보처리방침, 앱 밖 계정 삭제 요청(Play 요구, `docs/PRIVACY_DELETION.md`) |
| 비밀 주입 | `ACCOUNT_DELETION_HMAC_SECRET`, claim reference HMAC, DB URL, (Worker) minter signer. 저장소·이미지에 넣지 않음 |
| 인증 연결 지점 | `createApiServer({ resolveAccountId })`. 현재는 `ALLOW_INSECURE_DEMO_ACCOUNT=true`일 때만 `x-account-id`를 믿는 DEMO resolver |

## 호스팅 후보

| 후보 | 구성 | 장점 | 주의 |
| --- | --- | --- | --- |
| A. 관리형 PaaS 1곳(예: Railway·Render·Fly.io 중 하나) | API·Worker 서비스 2개 + 관리형 PostgreSQL + 자동 HTTPS | 설정이 가장 적고 중단이 쉬움(서비스 정지·삭제). 시연·심사 기간에 적합 | 무료 구간은 sleep·용량 제한이 있어 Worker 상시 실행에는 유료 구간이 필요할 수 있음 |
| B. 단일 VM(국내 리전 클라우드) + Docker Compose + Caddy | VM 1대에 API·Worker·PostgreSQL·reverse proxy | 비용 예측 쉬움, 국내 지연 낮음 | OS 패치·방화벽·백업을 직접 운영. DB를 같은 VM에 두면 백업을 VM 밖으로 내보내야 함(`OPERATIONS_RUNBOOK`) |
| C. 기존 보유 자원 | 소유자가 이미 가진 서버·도메인 | 추가 비용 없음 | 승인 범위·다른 서비스와의 격리 확인 필요 |

실제 선택: **B**. AWS Lightsail `masscom-api-seoul` 한 대에서 Docker Compose로 PostgreSQL·API·Caddy를 실행한다. DB 5432와 API 3000은 publish하지 않고 Caddy 80/443만 공개한다. 현재 Worker는 올리지 않았다.

도메인: 소유 도메인이 있으면 하위 도메인(`api.<도메인>`)을 쓰고, 없으면 PaaS 기본 도메인으로 시작할 수 있습니다. 다만 SIWE `domain`과 Play에 적는 삭제 URL이 origin에 묶이므로 **나중에 도메인을 바꾸면 앱 재빌드와 Console 수정이 필요**합니다.

## 운영 로그인 후보

| 후보 | 서버 검증 | 재인증(삭제 전) | 주의 |
| --- | --- | --- | --- |
| 1. Google 로그인(OIDC ID token) | Google 공개키로 ID token 서명·`aud`·`exp` 검증 → `sub`를 계정 ID로 | 최근 로그인 시각(`auth_time`/재로그인) 요구 | Android OAuth client는 **Play 앱 서명 인증서** SHA-1/256에 묶임. upload key 지문이 아님 |
| 2. 이메일 일회용 코드 | 자체 코드 발급·검증 테이블 | 코드 재입력 | 메일 발송 서비스(과금·발신 도메인) 필요, 남용 방지 필요 |
| 3. 지갑만으로 로그인 | 기존 SIWE | 재서명 | 제품 원칙(“지갑은 마지막 선택”)과 어긋남. 지갑 없는 사용자가 앱을 못 씀 |

실제 선택: **1**. Google Web client ID token을 서버가 검증하고 `sub`를 내부 계정으로 매핑한다. 개발 Android package/SHA와 upload-key package/SHA client를 분리했다. Play App Signing 인증서 client는 Play Console 키가 나온 뒤 별도 생성한다.

## 승인 요청 묶음

| 결정 | 선택지 | 영향 | 중단 방법 |
| --- | --- | --- | --- |
| 호스팅 | A / B / C | 월 과금 발생 가능(상한 설정 권장). API origin이 공개됨 | 서비스 정지·삭제, DNS 레코드 제거 |
| 도메인 | 보유 도메인 / PaaS 기본 도메인 / 신규 구매 | 신규 구매는 연 단위 비용 | 갱신 중지 |
| 로그인 | 1 / 2 / 3 | 1은 Google Cloud 프로젝트와 OAuth 동의 화면(소유자 계정) 필요 | OAuth client 삭제 |

승인되면 에이전트가 할 일: Dockerfile·Compose 또는 PaaS 설정 파일, 상태 점검 endpoint 확인, 환경변수 목록과 비밀 주입 절차, 개인정보처리방침·삭제 페이지, 배포 뒤 외부 접속 검사(HTTPS·보안 헤더·`no-store`·DB 포트 비공개), 백업 drill, 발행 중지 절차 연습.
소유자가 직접 할 일: 업체 계정 로그인·결제 수단 등록·약관 동의, DNS 레코드 입력, Google Cloud OAuth 동의 화면 제출.
